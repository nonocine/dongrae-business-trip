// =====================================================================
// 한 사람에게 문자 1건 + 문자 이력(sms_send_logs) 기록 — 서버 전용.
//   방카 접수 문자(lib/bangkaEnrollServer.sendEnrollSms)에 있던 흐름을 꺼내
//   강사 계약서 문자와 함께 씁니다.
//   ⚠️ 받는 번호는 이력·로그·콘솔 어디에도 남기지 않습니다(인원 수만).
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendSms } from "@/lib/sms/relay";
import { SMS_LOG_TABLE } from "@/lib/sms/logs";
import { smsMsgType } from "@/lib/sms/text";

export async function sendLoggedSms(input: {
  to: string;
  text: string;
  sender: string;
  sentBy: string | null; // drivers.id
  program: string; // 문자 이력 분류
  purpose: string; // audience_desc
  invalidPhoneMessage?: string;
  logTag?: string; // 콘솔 접두어
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const tag = input.logTag ?? "sms";
  const to = (input.to ?? "").replace(/\D/g, "");
  if (!/^01[0-9]{8,9}$/.test(to))
    return { ok: false, error: input.invalidPhoneMessage ?? "휴대전화 번호가 올바르지 않습니다." };
  const r = await sendSms({ to: [to], text: input.text, test: false, sender: input.sender });
  const log: Record<string, unknown> = {
    sent_by: input.sentBy,
    channel: "sms",
    program: input.program,
    audience_desc: input.purpose.slice(0, 500),
    recipient_count: 1,
    text_body: input.text,
    msg_type: r.ok ? r.msg_type ?? smsMsgType(input.text) : smsMsgType(input.text),
    sender: r.ok ? r.sender ?? input.sender : input.sender,
    is_test: false,
    ok: r.ok,
    sent_count: r.ok ? r.sent : 0,
    failed_count: r.ok ? r.failed : 1,
    provider_msg_id: r.ok ? r.provider_msg_id : null,
    error: r.ok ? null : r.error,
  };
  let { error } = await supabaseAdmin.from(SMS_LOG_TABLE).insert(log);
  if (error && /channel/.test(error.message ?? "") && (error.code === "PGRST204" || error.code === "42703")) {
    const { channel: _omit, ...rest } = log;
    void _omit;
    ({ error } = await supabaseAdmin.from(SMS_LOG_TABLE).insert(rest));
  }
  if (error) console.error(`[${tag}] 문자 이력 기록 실패: ${error.message}`);
  if (!r.ok) {
    console.error(`[${tag}] 문자 발송 실패(${input.purpose}): ${r.error}`);
    return { ok: false, error: r.error };
  }
  if (r.failed > 0 && r.sent === 0) return { ok: false, error: "문자 발송이 실패로 집계되었습니다." };
  return { ok: true };
}
