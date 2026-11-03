import { getSmsSenders } from "@/lib/sms/relay";
import { smsFail, smsGate, smsJson } from "@/lib/sms/http";

// 발신번호 목록 — 중계 서버 /senders 그대로(화면은 display 를 그대로 씁니다).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await smsGate();
  if (user instanceof Response) return user;
  const r = await getSmsSenders();
  if (!r.ok) return smsFail(r.status, r.error);
  return smsJson(r);
}
