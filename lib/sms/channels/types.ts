// =====================================================================
// 발송 수단(channel) 인터페이스 — 수단 1개 = 파일 1개(lib/sms/channels/*.ts).
//   지금은 문자(sms)만. 카카오 알림톡·브랜드 메시지는 같은 모양으로 파일을 더하고
//   등록표(index.ts)에 한 줄 넣으면 4단계 "보내는 방법"에 나타납니다(docs/SMS_SOURCES.md).
//   * 서버 전용.
// =====================================================================

import type { SmsUser } from "@/lib/sms/access";

export type ChannelCheck = {
  errors: string[]; // 하나라도 있으면 보내지 않음
  warnings: string[]; // 안내만
};

export type ChannelSendOptions = {
  test: boolean;
  advertising: boolean;
  sender?: string;
  // 알림톡처럼 검수된 템플릿이 필요한 수단용(sms 는 쓰지 않음).
  templateCode?: string;
};

export type ChannelSendResult =
  | {
      ok: true;
      sent: number;
      failed: number;
      msg_type: string | null;
      provider_msg_id: string | null;
      sender: string | null;
      partial?: string;
    }
  | { ok: false; status: number; error: string };

export type SmsChannel = {
  key: string; // 고유값 — sms_send_logs.channel 에 저장됩니다. 바꾸지 마세요.
  label: string;
  icon: string;
  // 검수된 템플릿(kakao_template_code)이 있어야 보낼 수 있는가 — 알림톡 true.
  requiresTemplate: boolean;
  // 광고성(홍보) 내용을 보낼 수 있는가 — 알림톡은 false, 브랜드 메시지는 true.
  allowsAd: boolean;
  canUse(user: SmsUser): boolean;
  // 본문·수신자 수 검사. opts.now 는 시험용(기본 지금).
  validate(text: string, recipientCount: number, opts: ChannelSendOptions & { now?: Date }): ChannelCheck;
  // 실제 발송 — 받는 번호(숫자만)·최종 본문.
  send(to: string[], text: string, opts: ChannelSendOptions): Promise<ChannelSendResult>;
};
