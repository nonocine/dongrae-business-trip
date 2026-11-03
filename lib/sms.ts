// =====================================================================
// 문자 중계 서버(sms-relay) 클라이언트 — 서버 전용. 알리고를 직접 부르지 않습니다.
//   * SMS_RELAY_URL · SMS_RELAY_KEY 는 서버 라우트에서만 씁니다(브라우저 노출 금지).
//   * 타임아웃 15초. 실패하면 중계 서버의 error 문구를 그대로 돌려줍니다.
//   ⚠️ 전화번호를 로그·콘솔·DB 어디에도 남기지 않습니다 — 여기서도 출력하지 않습니다.
// =====================================================================

import type { SmsResultSummary, SmsSendersInfo } from "@/lib/smsText";

const APP = "dongupssi";
const TIMEOUT_MS = 15_000;

export type RelayFailure = { ok: false; status: number; error: string };

function relayConfig(): { url: string; key: string } | null {
  const url = (process.env.SMS_RELAY_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.SMS_RELAY_KEY ?? "").trim();
  return url && key ? { url, key } : null;
}

async function relayFetch(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: true; status: number; data: Record<string, unknown> } | RelayFailure> {
  const cfg = relayConfig();
  if (!cfg)
    return {
      ok: false,
      status: 503,
      error: "문자 중계 서버 설정(SMS_RELAY_URL·SMS_RELAY_KEY)이 없습니다.",
    };
  let res: Response;
  try {
    res = await fetch(`${cfg.url}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "X-App-Key": cfg.key,
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return {
      ok: false,
      status: 504,
      error: timedOut
        ? "문자 중계 서버가 15초 안에 답하지 않았습니다."
        : "문자 중계 서버에 연결하지 못했습니다.",
    };
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // 본문이 JSON 이 아니면 비워 둡니다.
  }
  if (!res.ok || data.ok === false) {
    const err =
      typeof data.error === "string" && data.error
        ? data.error
        : `문자 중계 서버 오류(${res.status})`;
    return { ok: false, status: res.ok ? 502 : res.status, error: err };
  }
  return { ok: true, status: res.status, data };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown) => (typeof v === "string" && v ? v : v != null && v !== "" ? String(v) : null);

export type SendSmsInput = {
  to: string[];
  text: string;
  test: boolean;
  sender?: string;
};

export type SendSmsResult =
  | {
      ok: true;
      sent: number;
      failed: number;
      msg_type: string | null;
      provider_msg_id: string | null;
      sender: string | null;
    }
  | RelayFailure;

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const r = await relayFetch("/send", {
    method: "POST",
    body: {
      to: input.to,
      text: input.text,
      test: input.test,
      ...(input.sender ? { sender: input.sender } : {}),
    },
  });
  if (!r.ok) return r;
  return {
    ok: true,
    sent: num(r.data.sent),
    failed: num(r.data.failed),
    msg_type: str(r.data.msg_type),
    provider_msg_id: str(r.data.provider_msg_id),
    sender: str(r.data.sender),
  };
}

export async function getSmsSenders(): Promise<
  ({ ok: true } & SmsSendersInfo) | RelayFailure
> {
  const r = await relayFetch(`/senders?app=${APP}`);
  if (!r.ok) return r;
  const allowed = Array.isArray(r.data.allowed) ? r.data.allowed : [];
  return {
    ok: true,
    enabled: r.data.enabled === true,
    default: str(r.data.default),
    allowed: allowed
      .map((a) => a as Record<string, unknown>)
      .map((a) => ({
        number: str(a.number) ?? "",
        label: str(a.label) ?? "",
        display: str(a.display) ?? str(a.number) ?? "",
      }))
      .filter((a) => a.number),
  };
}

// 건별 결과 → 성공·실패·대기 수. 번호 등 건별 내용은 밖으로 내보내지 않습니다.
//   중계 서버가 합계(sent/failed)를 주면 그대로, 목록을 주면 상태 문구로 셉니다.
export function summarizeRelayResult(top: Record<string, unknown>): Omit<SmsResultSummary, "ok"> {
  // 합계가 최상위 또는 result/data 객체 아래에 올 수 있습니다(youthforten 과 같은 수용).
  const nested = [top.result, top.data].find(
    (v) => v && typeof v === "object" && !Array.isArray(v),
  ) as Record<string, unknown> | undefined;
  const data = nested ?? top;
  const list = [data.list, data.results, data.items, data.data, data.result].find(
    Array.isArray,
  ) as Record<string, unknown>[] | undefined;
  if (!list) {
    return {
      sent: num(data.sent ?? data.success ?? data.success_cnt),
      failed: num(data.failed ?? data.fail ?? data.error_cnt),
      pending: num(data.pending ?? data.waiting),
    };
  }
  let sent = 0;
  let failed = 0;
  let pending = 0;
  for (const item of list) {
    const state = [item.sms_state, item.state, item.status, item.result]
      .map((v) => (v == null ? "" : String(v)))
      .join(" ");
    if (/실패|fail|error|reject/i.test(state)) failed += 1;
    else if (/완료|성공|success|delivered|done/i.test(state)) sent += 1;
    else pending += 1;
  }
  return { sent, failed, pending };
}

export async function getSmsResult(msgId: string): Promise<SmsResultSummary & { status: number }> {
  const r = await relayFetch(
    `/result?app=${APP}&msg_id=${encodeURIComponent(msgId)}`,
  );
  if (!r.ok)
    return { ok: false, status: r.status, sent: 0, failed: 0, pending: 0, error: r.error };
  return { ok: true, status: 200, ...summarizeRelayResult(r.data) };
}
