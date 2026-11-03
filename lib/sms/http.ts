// /api/sms/* 공용 응답 도우미 — 개인정보가 든 응답이라 캐시하지 않습니다.
import { resolveSmsAccess, type SmsUser } from "@/lib/sms/access";

export const SMS_NO_STORE = { "Cache-Control": "no-store, private" };

export function smsJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: SMS_NO_STORE });
}

export function smsFail(status: number, error: string): Response {
  return smsJson({ ok: false, error }, status);
}

// 권한 확인 → 통과하면 사용자, 아니면 403 응답.
export async function smsGate(): Promise<SmsUser | Response> {
  const user = await resolveSmsAccess();
  return user ?? smsFail(403, "권한이 없습니다.");
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
