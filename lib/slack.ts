// =====================================================================
// 슬랙 Incoming Webhook 공용 유틸 — 알림은 "부가기능".
//   * env(웹훅 URL) 없으면 조용히 skip(콘솔 경고만).
//   * 발송 실패·타임아웃(3초)해도 절대 throw 하지 않음 → 본 작업(공지 등록·
//     증명서 승인 등)이 알림 때문에 실패하지 않도록 완전히 격리.
//   * 서버 전용(webhook URL 은 NEXT_PUBLIC_ 아님).
// =====================================================================

const TIMEOUT_MS = 3000;

// webhookEnvKey 예: "SLACK_WEBHOOK_ANNOUNCE" | "SLACK_WEBHOOK_ADMIN".
// 반환: 실제로 발송(2xx) 되면 true, skip/실패면 false.
export async function sendSlack(
  webhookEnvKey: string,
  text: string
): Promise<boolean> {
  const url = process.env[webhookEnvKey];
  if (!url) {
    console.warn(`[slack] ${webhookEnvKey} 미설정 — 알림 skip`);
    return false;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        console.warn(`[slack] ${webhookEnvKey} 응답 ${res.status}`);
        return false;
      }
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.warn(
      `[slack] ${webhookEnvKey} 발송 실패:`,
      e instanceof Error ? e.message : e
    );
    return false;
  }
}

// 절대 URL 베이스 — 링크 첨부용. 없으면 null(링크 생략).
export function siteBaseUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;
  const dep = process.env.VERCEL_URL;
  if (dep) return `https://${dep}`;
  return null;
}

// 슬랙 링크 문법 <url|label>.
export function slackLink(url: string, label: string): string {
  return `<${url}|${label}>`;
}

// --- Slack Web API DM (Bot Token) -------------------------------------
// 이메일로 슬랙 유저를 찾아(users.lookupByEmail) DM(chat.postMessage) 발송.
//   * SLACK_BOT_TOKEN(xoxb-) 필요. 없으면 skip.
//   * 매칭 실패(슬랙 미가입/이메일 불일치)·API 실패·타임아웃 → false, 절대 throw 안 함.
//   * 반환 true=DM 발송 성공, false=미연결/실패(호출부에서 '미연결' 표기에 사용).
export async function sendSlackDM(
  email: string | null | undefined,
  text: string
): Promise<boolean> {
  const { ok } = await sendSlackDMDetailed(email, text);
  return ok;
}

// 상세 결과판 — 실패 사유(reason)를 함께 돌려줍니다.
//   호출부가 화면·다이제스트에 "왜 안 갔는지" 를 표시할 수 있도록 하기 위함.
//   sendSlackDM 과 마찬가지로 절대 throw 하지 않습니다.
export async function sendSlackDMDetailed(
  email: string | null | undefined,
  text: string
): Promise<{ ok: boolean; reason: string | null }> {
  const token = process.env.SLACK_BOT_TOKEN;
  const addr = (email ?? "").trim();
  if (!addr) {
    const reason = "직원 이메일이 등록되어 있지 않습니다(인사기록카드 email)";
    console.warn(`[slack] DM 불가 — ${reason}`);
    return { ok: false, reason };
  }
  if (!token) {
    const reason = "SLACK_BOT_TOKEN 미설정";
    console.warn(`[slack] DM 불가 — ${reason} (대상 ${addr})`);
    return { ok: false, reason };
  }
  try {
    const { id: userId, reason: lookupReason } = await lookupUserIdByEmail(
      token,
      addr
    );
    if (!userId) {
      const reason = lookupReason ?? "사용자 매칭 실패";
      console.warn(`[slack] 사용자 매칭 실패 (${addr}) — ${reason}`);
      return { ok: false, reason };
    }
    const { ok, reason: postReason } = await postMessage(token, userId, text);
    if (!ok) {
      const reason = postReason ?? "발송 실패";
      console.warn(`[slack] DM 발송 실패 (${addr}) — ${reason}`);
      return { ok: false, reason };
    }
    return { ok: true, reason: null };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "알 수 없는 오류";
    console.warn(`[slack] DM 실패 (${addr}) — ${reason}`);
    return { ok: false, reason };
  }
}

// 슬랙 API 오류코드 → 사람이 읽을 수 있는 원인.
//   ★ 원인을 로그·화면에 남기기 위해 추가했습니다. 예전에는 실패를 boolean
//     으로만 돌려줘서 "왜" 안 갔는지 알 수 없었습니다(스코프 부족인지,
//     계정 매칭 실패인지, 토큰 자체가 없는지 구분 불가).
export function describeSlackError(
  error: string,
  data?: Record<string, unknown>
): string {
  switch (error) {
    case "missing_scope": {
      const needed = String(data?.needed ?? "");
      const provided = String(data?.provided ?? "");
      return `봇 토큰 스코프 부족 — 필요: ${needed || "(미상)"} / 현재: ${provided || "(미상)"}`;
    }
    case "users_not_found":
      return "해당 이메일의 슬랙 사용자를 찾을 수 없습니다(슬랙 계정 이메일 불일치 또는 미가입)";
    case "invalid_auth":
    case "token_revoked":
    case "account_inactive":
      return `봇 토큰이 유효하지 않습니다(${error})`;
    case "not_allowed_token_type":
      return "토큰 종류가 맞지 않습니다(봇 토큰 xoxb- 필요)";
    case "channel_not_found":
      return "DM 대화를 열 수 없습니다(im:write 스코프 확인 필요)";
    case "ratelimited":
      return "슬랙 API 호출 한도 초과";
    default:
      return `슬랙 오류(${error})`;
  }
}

async function slackApi(
  token: string,
  method: string,
  body: URLSearchParams | Record<string, unknown>,
  form: boolean
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": form
          ? "application/x-www-form-urlencoded"
          : "application/json; charset=utf-8",
      },
      body: form ? (body as URLSearchParams) : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = (await res.json()) as Record<string, unknown>;
    return { ok: res.ok && data.ok === true, data };
  } finally {
    clearTimeout(timer);
  }
}

// 실패 시 원인 문자열을 함께 돌려줍니다(로그·화면 안내용).
async function lookupUserIdByEmail(
  token: string,
  email: string
): Promise<{ id: string | null; reason: string | null }> {
  const { ok, data } = await slackApi(
    token,
    "users.lookupByEmail",
    new URLSearchParams({ email }),
    true
  );
  if (!ok) {
    return {
      id: null,
      reason: describeSlackError(String(data?.error ?? "unknown"), data),
    };
  }
  const user = data.user as { id?: string } | undefined;
  return user?.id
    ? { id: user.id, reason: null }
    : { id: null, reason: "슬랙 응답에 사용자 ID가 없습니다" };
}

async function postMessage(
  token: string,
  channel: string,
  text: string
): Promise<{ ok: boolean; reason: string | null }> {
  const { ok, data } = await slackApi(
    token,
    "chat.postMessage",
    { channel, text },
    false
  );
  return ok
    ? { ok: true, reason: null }
    : {
        ok: false,
        reason: describeSlackError(String(data?.error ?? "unknown"), data),
      };
}
