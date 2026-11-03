import { resolveSmsAccess } from "@/lib/smsAccess";
import { getSmsSenders } from "@/lib/sms";

// 발신번호 목록 — 중계 서버 /senders 그대로(화면은 display 를 그대로 씁니다).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, private" };

export async function GET() {
  if (!(await resolveSmsAccess()))
    return Response.json({ ok: false, error: "권한이 없습니다." }, { status: 403, headers });
  const r = await getSmsSenders();
  if (!r.ok)
    return Response.json({ ok: false, error: r.error }, { status: r.status, headers });
  return Response.json(r, { headers });
}
