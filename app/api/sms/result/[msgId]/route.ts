import { getSmsResultMulti } from "@/lib/sms/relay";
import { SMS_LOG_TABLE } from "@/lib/sms/logs";
import { smsFail, smsGate, smsJson } from "@/lib/sms/http";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// 건별 결과 → 성공·실패·대기 수. 알리고는 24시간 뒤 최종 확정이라 그 전에는 바뀔 수 있습니다.
//   나눠 보낸 발송은 msg_id 가 쉼표로 이어져 있어 각각 조회해 합산합니다.
//   이력 행(sms_send_logs)의 sent_count·failed_count 도 함께 갱신합니다.
//   ⚠️ 건별 내용(번호)은 응답·로그에 싣지 않습니다 — 합계만.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ msgId: string }> }
) {
  const user = await smsGate();
  if (user instanceof Response) return user;
  const { msgId } = await params;
  const id = decodeURIComponent(msgId ?? "").trim();
  if (!id || id.length > 500 || !/^[\w,.-]+$/.test(id))
    return smsFail(400, "msg_id 가 올바르지 않습니다.");

  const r = await getSmsResultMulti(id);
  if (!r.ok) return smsJson({ ok: false, sent: 0, failed: 0, pending: 0, error: r.error }, r.status);

  const { error } = await supabaseAdmin
    .from(SMS_LOG_TABLE)
    .update({ sent_count: r.sent, failed_count: r.failed })
    .eq("provider_msg_id", id);
  if (error) console.error(`[sms] 결과 갱신 실패: ${error.message}`);

  return smsJson({ ok: true, sent: r.sent, failed: r.failed, pending: r.pending });
}
