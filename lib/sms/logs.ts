// =====================================================================
// 문자 발송 이력(sms_send_logs) — 서버 전용.
//   ⚠️ 받는 번호는 저장하지 않습니다. 인원 수와 출처 요약(audience_desc)만.
//   출처 요약은 audience_desc 를 씁니다(예: "동래미래 4차시 158 + 강사 5") —
//   같은 뜻의 칸이 이미 있어 source_summary 를 따로 만들지 않았습니다.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { canSeeFullBody, previewBody, type SmsUser } from "@/lib/sms/access";
import type { SmsLogRow } from "@/lib/sms/text";

export const SMS_LOG_TABLE = "sms_send_logs";

// 전 직원이 같은 목록을 봅니다. 본문 전체는 보낸 본인·관장·부장만 — 나머지는 앞 20자를
//   서버에서 잘라 보냅니다(화면에서 가리는 게 아니라 아예 내려보내지 않음).
export async function listSmsLogs(
  viewer: Pick<SmsUser, "driverId" | "isM0">,
  limit = 50,
): Promise<SmsLogRow[]> {
  const { data, error } = await supabaseAdmin
    .from(SMS_LOG_TABLE)
    .select(
      "id, created_at, sent_by, program, audience_desc, recipient_count, text_body, msg_type, sender, is_test, ok, sent_count, failed_count, provider_msg_id, error",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`발송 이력 조회 실패: ${error.message}`);
  const rows = (data ?? []) as (Omit<SmsLogRow, "sender_name" | "text_truncated"> & {
    sent_by: string | null;
  })[];
  const ids = [...new Set(rows.map((r) => r.sent_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: drv } = await supabaseAdmin.from("drivers").select("id, name").in("id", ids);
    for (const d of (drv ?? []) as { id: string; name: string }[]) names.set(d.id, d.name);
  }
  return rows.map(({ sent_by, text_body, ...r }) => {
    const body = text_body ?? "";
    const shown = canSeeFullBody(viewer, sent_by) ? body : previewBody(body);
    return {
      ...r,
      sender_name: sent_by ? names.get(sent_by) ?? null : null,
      text_body: shown,
      text_truncated: shown !== body,
    };
  });
}
