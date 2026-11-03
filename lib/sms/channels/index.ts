// =====================================================================
// 발송 수단 등록표 — 배열에 한 줄 넣으면 4단계 "보내는 방법"에 나타납니다.
//   수단이 1개(문자)뿐이면 화면은 선택 영역을 숨기고 문자로 고정합니다.
//   예정: kakao-alimtalk.ts(알림톡, requiresTemplate), kakao-brand.ts(브랜드 메시지, allowsAd).
//   * 서버 전용 — 화면에는 smsChannelMetas() 메타만.
// =====================================================================

import type { SmsUser } from "@/lib/sms/access";
import type { SmsChannelMeta } from "@/lib/sms/text";
import type { SmsChannel } from "./types";
import { smsChannel } from "./sms";

export const SMS_CHANNELS: SmsChannel[] = [
  smsChannel, // 문자
];

export const DEFAULT_CHANNEL = "sms";

export function findSmsChannel(key: string | undefined): SmsChannel | undefined {
  return SMS_CHANNELS.find((c) => c.key === (key || DEFAULT_CHANNEL));
}

export function smsChannelMetas(user: SmsUser): SmsChannelMeta[] {
  return SMS_CHANNELS.filter((c) => c.canUse(user)).map((c) => ({
    key: c.key,
    label: c.label,
    icon: c.icon,
    requiresTemplate: c.requiresTemplate,
    allowsAd: c.allowsAd,
  }));
}
