// 발송 수단 — 문자(SMS/LMS). 문자 중계 서버(sms-relay) 경유(lib/sms/relay).
//   1,000명을 넘으면 500명씩 나눠 보냅니다(sendSmsBatch).

import { sendSmsBatch } from "@/lib/sms/relay";
import {
  LMS_MAX_BYTES,
  SMS_AD_PREFIX,
  SMS_MAX_RECIPIENTS,
  SMS_OPTOUT_NUMBER,
  eucKrBytes,
  isNightKst,
} from "@/lib/sms/text";
import type { SmsChannel } from "./types";

export const smsChannel: SmsChannel = {
  key: "sms",
  label: "문자",
  icon: "💬",
  requiresTemplate: false,
  allowsAd: true,
  canUse: () => true,

  validate(text, count, opts) {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!text.trim()) errors.push("본문을 입력하세요.");
    if (eucKrBytes(text) > LMS_MAX_BYTES)
      errors.push(`본문이 ${LMS_MAX_BYTES.toLocaleString()}바이트를 넘습니다.`);
    if (count === 0) errors.push("보낼 번호가 없습니다.");
    if (count > SMS_MAX_RECIPIENTS)
      errors.push(`한 번에 ${SMS_MAX_RECIPIENTS.toLocaleString()}명까지 보낼 수 있습니다(지금 ${count}명).`);
    const night = isNightKst(opts.now);
    if (opts.advertising) {
      if (!text.startsWith(SMS_AD_PREFIX) || !text.includes(`수신거부 ${SMS_OPTOUT_NUMBER}`))
        errors.push(`광고성 문자는 맨 앞 "${SMS_AD_PREFIX}"와 "수신거부 ${SMS_OPTOUT_NUMBER}"가 있어야 합니다.`);
      if (!opts.test && night)
        errors.push("광고성 문자는 밤 9시부터 아침 8시까지 보낼 수 없습니다(테스트 발송은 가능).");
    }
    if (night && !opts.test) warnings.push("야간 발송입니다.");
    return { errors, warnings };
  },

  async send(to, text, opts) {
    return sendSmsBatch({ to, text, test: opts.test, sender: opts.sender });
  },
};
