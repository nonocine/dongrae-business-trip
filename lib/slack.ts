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
  const token = process.env.SLACK_BOT_TOKEN;
  const addr = (email ?? "").trim();
  if (!addr) return false;
  if (!token) {
    console.warn("[slack] SLACK_BOT_TOKEN 미설정 — DM skip");
    return false;
  }
  try {
    const userId = await lookupUserIdByEmail(token, addr);
    if (!userId) {
      console.warn(`[slack] 사용자 매칭 실패(미연결): ${addr}`);
      return false;
    }
    return await postMessage(token, userId, text);
  } catch (e) {
    console.warn("[slack] DM 실패:", e instanceof Error ? e.message : e);
    return false;
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

async function lookupUserIdByEmail(
  token: string,
  email: string
): Promise<string | null> {
  const { ok, data } = await slackApi(
    token,
    "users.lookupByEmail",
    new URLSearchParams({ email }),
    true
  );
  if (!ok) return null;
  const user = data.user as { id?: string } | undefined;
  return user?.id ?? null;
}

async function postMessage(
  token: string,
  channel: string,
  text: string
): Promise<boolean> {
  const { ok } = await slackApi(
    token,
    "chat.postMessage",
    { channel, text },
    false
  );
  return ok;
}
