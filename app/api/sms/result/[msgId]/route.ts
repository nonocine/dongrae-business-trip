import { resolveSmsAccess } from "@/lib/smsAccess";
import { getSmsResult } from "@/lib/sms";
import { SMS_LOG_TABLE } from "@/lib/smsServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// 건별 결과 → 성공·실패 수. 알리고는 24시간 뒤 최종 확정이라 그 전에는 바뀔 수 있습니다.
//   이력 행(sms_send_logs)의 sent_count·failed_count 도 함께 갱신합니다.
//   ⚠️ 건별 내용(번호)은 응답·로그에 싣지 않습니다 — 합계만.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, private" };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ msgId: string }> }
) {
  if (!(await resolveSmsAccess()))
    return Response.json({ ok: false, error: "권한이 없습니다." }, { status: 403, headers });
  const { msgId } = await params;
  const id = (msgId ?? "").trim();
  if (!id || id.length > 100)
    return Response.json({ ok: false, error: "msg_id 가 올바르지 않습니다." }, { status: 400, headers });

  const r = await getSmsResult(id);
  if (!r.ok)
    return Response.json(
      { ok: false, sent: 0, failed: 0, pending: 0, error: r.error },
      { status: r.status, headers }
    );

  const { error } = await supabaseAdmin
    .from(SMS_LOG_TABLE)
    .update({ sent_count: r.sent, failed_count: r.failed })
    .eq("provider_msg_id", id);
  if (error) console.error(`[sms] 결과 갱신 실패(msg_id ${id}): ${error.message}`);

  return Response.json(
    { ok: true, sent: r.sent, failed: r.failed, pending: r.pending },
    { headers }
  );
}
