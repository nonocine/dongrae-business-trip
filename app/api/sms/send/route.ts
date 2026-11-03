import { resolveSmsAccess } from "@/lib/smsAccess";
import { sendSms } from "@/lib/sms";
import { SMS_LOG_TABLE, resolveBkRecipients } from "@/lib/smsServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  LMS_MAX_BYTES,
  SMS_MAX_RECIPIENTS,
  eucKrBytes,
  isValidSmsPhone,
  normalizeSmsPhone,
  parsePhoneList,
  smsMsgType,
  type SmsSendRequest,
} from "@/lib/smsText";

// 문자 발송 — 받는 사람을 서버에서 다시 정하고(방과후는 학생 id → 보호자 번호)
//   중계 서버로 보냅니다. 성공·실패 모두 sms_send_logs 에 남깁니다.
//   ⚠️ 전화번호는 DB·로그·콘솔·응답 어디에도 남기지 않습니다(인원 수만).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, private" };
const fail = (status: number, error: string) =>
  Response.json({ ok: false, error }, { status, headers });

export async function POST(req: Request) {
  const access = await resolveSmsAccess();
  if (!access) return fail(403, "권한이 없습니다.");

  let body: SmsSendRequest;
  try {
    body = (await req.json()) as SmsSendRequest;
  } catch {
    return fail(400, "요청 형식이 올바르지 않습니다.");
  }
  const program = body.program === "bk" ? "bk" : body.program === "manual" ? "manual" : null;
  if (!program) return fail(400, "받는 사람 종류(program)가 올바르지 않습니다.");
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return fail(400, "본문을 입력하세요.");
  if (eucKrBytes(text) > LMS_MAX_BYTES)
    return fail(400, `본문이 ${LMS_MAX_BYTES.toLocaleString()}바이트를 넘습니다.`);
  const test = body.test === true;
  const sender = typeof body.sender === "string" && body.sender.trim() ? body.sender.trim() : undefined;

  let to: string[];
  let audienceDesc: string;
  if (test) {
    const d = normalizeSmsPhone(body.testNumber ?? "");
    if (!isValidSmsPhone(d)) return fail(400, "테스트 받을 번호(010)를 확인하세요.");
    to = [d];
    audienceDesc = "테스트 발송(내 번호)";
  } else if (program === "bk") {
    const ids = Array.isArray(body.studentIds)
      ? body.studentIds.filter((x): x is string => typeof x === "string")
      : [];
    if (ids.length === 0) return fail(400, "학생을 고르세요.");
    const mode = body.guardianMode === "all" ? "all" : "primary";
    const r = await resolveBkRecipients(ids, mode);
    to = r.phones;
    audienceDesc = `방과후아카데미 보호자(${mode === "all" ? "모든 보호자" : "대표 보호자만"}) · 학생 ${r.studentCount}명`;
  } else {
    const r = parsePhoneList(typeof body.numbers === "string" ? body.numbers : "");
    to = r.valid;
    audienceDesc = `직접 입력 ${r.valid.length}명${r.invalidCount > 0 ? ` (잘못된 번호 ${r.invalidCount}개 제외)` : ""}`;
  }
  if (to.length === 0) return fail(400, "보낼 번호가 없습니다.");
  if (to.length > SMS_MAX_RECIPIENTS)
    return fail(400, `한 번에 ${SMS_MAX_RECIPIENTS}명까지 보낼 수 있습니다(지금 ${to.length}명).`);

  const result = await sendSms({ to, text, test, sender });

  const log = {
    sent_by: access.driverId,
    program,
    audience_desc: audienceDesc,
    recipient_count: to.length,
    text_body: text,
    msg_type: result.ok ? result.msg_type ?? smsMsgType(text) : smsMsgType(text),
    sender: result.ok ? result.sender ?? sender ?? null : sender ?? null,
    is_test: test,
    ok: result.ok,
    sent_count: result.ok ? result.sent : 0,
    failed_count: result.ok ? result.failed : to.length,
    provider_msg_id: result.ok ? result.provider_msg_id : null,
    error: result.ok ? null : result.error,
  };
  const { error: logError } = await supabaseAdmin.from(SMS_LOG_TABLE).insert(log);
  if (logError) console.error(`[sms] 발송 이력 기록 실패: ${logError.message}`);
  if (!result.ok) {
    console.error(`[sms] 발송 실패(${program}, ${to.length}명, test=${test}): ${result.error}`);
    return fail(result.status, result.error);
  }

  return Response.json(
    {
      ok: true,
      sent: result.sent,
      failed: result.failed,
      msg_type: log.msg_type,
      provider_msg_id: result.provider_msg_id,
      sender: log.sender,
    },
    { headers }
  );
}
