import { findSmsChannel } from "@/lib/sms/channels";
import { SMS_LOG_TABLE } from "@/lib/sms/logs";
import { cleanBundles, computeRecipients } from "@/lib/sms/recipients";
import { errText, readJson, smsFail, smsGate, smsJson } from "@/lib/sms/http";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  isValidSmsPhone,
  normalizeSmsPhone,
  smsMsgType,
  type SmsSendRequest,
} from "@/lib/sms/text";

// 발송 — 담긴 명단(묶음들)을 서버가 다시 계산해 번호를 정하고, 고른 발송 수단(channel)으로 보냅니다.
//   * 수단별 검사·발송은 lib/sms/channels/*(지금은 문자만). 문자는 1,000명 초과 시 500명씩 나눠 보냄.
//   * 광고성: "(광고)"·"수신거부 051-988-0924" 확인, 밤 9시~아침 8시 실제 발송 차단(테스트는 허용).
//   * 성공·실패 모두 sms_send_logs 에 기록 — 출처 요약은 audience_desc("동래미래 4차시 158 + 강사 5").
//   ⚠️ 전화번호는 DB·로그·콘솔·응답 어디에도 남기지 않습니다(인원 수만).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await smsGate();
  if (user instanceof Response) return user;
  const body = await readJson<SmsSendRequest>(req);
  if (!body) return smsFail(400, "요청 형식이 올바르지 않습니다.");

  const channel = findSmsChannel(typeof body.channel === "string" ? body.channel : undefined);
  if (!channel) return smsFail(400, "알 수 없는 발송 수단입니다.");
  if (!channel.canUse(user)) return smsFail(403, `"${channel.label}"(으)로 보낼 권한이 없습니다.`);

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const test = body.test === true;
  const advertising = body.advertising === true;
  if (advertising && !channel.allowsAd)
    return smsFail(400, `"${channel.label}"(으)로는 광고성 내용을 보낼 수 없습니다.`);
  const sender = typeof body.sender === "string" && body.sender.trim() ? body.sender.trim() : undefined;
  const opts = { test, advertising, sender };

  let to: string[];
  let summary: string;
  let program: string;
  if (test) {
    const d = normalizeSmsPhone(body.testNumber ?? "");
    if (!d.startsWith("010") || !isValidSmsPhone(d)) return smsFail(400, "테스트 받을 내 번호(010)를 확인하세요.");
    to = [d];
    summary = "테스트 발송(내 번호)";
    program = "test";
  } else {
    const bundles = cleanBundles(body.bundles);
    if (bundles.length === 0) return smsFail(400, "받는 사람을 담으세요.");
    try {
      const r = await computeRecipients(user, bundles);
      to = r.phones;
      summary = r.preview.summary;
      program = r.sources.length === 1 ? r.sources[0] : "mixed";
    } catch (e) {
      return smsFail(400, errText(e));
    }
  }

  const check = channel.validate(text, to.length, opts);
  if (check.errors.length > 0) return smsFail(400, check.errors.join(" "));

  const result = await channel.send(to, text, opts);

  const log = {
    sent_by: user.driverId,
    channel: channel.key,
    program,
    audience_desc: `${advertising ? "[광고] " : ""}${summary}`.slice(0, 500),
    recipient_count: to.length,
    text_body: text,
    msg_type: result.ok ? result.msg_type ?? smsMsgType(text) : smsMsgType(text),
    sender: result.ok ? result.sender ?? sender ?? null : sender ?? null,
    is_test: test,
    ok: result.ok,
    sent_count: result.ok ? result.sent : 0,
    failed_count: result.ok ? result.failed : to.length,
    provider_msg_id: result.ok ? result.provider_msg_id : null,
    error: result.ok ? result.partial ?? null : result.error,
  };
  await insertLog(log);
  if (!result.ok) {
    console.error(`[sms] 발송 실패(${channel.key}/${program}, ${to.length}명, test=${test}): ${result.error}`);
    return smsFail(result.status, result.error);
  }
  if (result.partial) console.error(`[sms] 일부 실패(${channel.key}/${program}, ${to.length}명): ${result.partial}`);

  return smsJson({
    ok: true,
    sent: result.sent,
    failed: result.failed,
    msg_type: log.msg_type,
    provider_msg_id: result.provider_msg_id,
    sender: log.sender,
    ...(result.partial ? { partial: result.partial } : {}),
  });
}

// 이력 기록 — channel 칸은 마이그레이션 적용 전엔 없어서, 없다는 오류면 그 칸만 빼고 다시 씁니다.
async function insertLog(log: Record<string, unknown>) {
  let { error } = await supabaseAdmin.from(SMS_LOG_TABLE).insert(log);
  if (error && /channel/.test(error.message ?? "") && (error.code === "PGRST204" || error.code === "42703")) {
    const { channel: _omit, ...rest } = log;
    void _omit;
    ({ error } = await supabaseAdmin.from(SMS_LOG_TABLE).insert(rest));
  }
  if (error) console.error(`[sms] 발송 이력 기록 실패: ${error.message}`);
}
