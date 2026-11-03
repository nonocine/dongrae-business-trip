// =====================================================================
// 문자 발송 — 순수 상수·헬퍼(화면·서버 공용). 서버 전용 모듈을 import 하지 않습니다.
//   * 번호: 숫자만 남기고 010 으로 시작하는 10~11자리만 유효.
//   * 길이: EUC-KR 기준 — 한글 등 비 ASCII 2바이트, ASCII 1바이트.
//     90바이트 초과면 LMS, 2,000바이트 초과는 보내지 않습니다.
// =====================================================================

export const SMS_HEADER = "[동래구청소년센터]";
export const SMS_MAX_BYTES = 90;
export const LMS_MAX_BYTES = 2000;
export const SMS_MAX_RECIPIENTS = 500;
// 예상 비용(원/건) — 안내용 근사치.
export const SMS_COST_WON = 9;
export const LMS_COST_WON = 27;

export type SmsProgram = "bk" | "manual";
export type SmsMsgType = "SMS" | "LMS";
export type BkGuardianMode = "primary" | "all";

export function normalizeSmsPhone(input: string): string {
  return (input ?? "").replace(/\D/g, "");
}

export function isValidSmsPhone(digits: string): boolean {
  return /^010\d{7,8}$/.test(digits);
}

// 붙여넣기(줄바꿈·쉼표·세미콜론) → 유효 번호(중복 제거, 입력 순서 유지) + 잘못된 항목 수.
export function parsePhoneList(text: string): {
  valid: string[];
  invalidCount: number;
} {
  const seen = new Set<string>();
  const valid: string[] = [];
  let invalidCount = 0;
  for (const raw of (text ?? "").split(/[\n\r,;]+/)) {
    if (!raw.trim()) continue;
    const d = normalizeSmsPhone(raw);
    if (!isValidSmsPhone(d)) {
      invalidCount += 1;
      continue;
    }
    if (seen.has(d)) continue;
    seen.add(d);
    valid.push(d);
  }
  return { valid, invalidCount };
}

export function eucKrBytes(text: string): number {
  let n = 0;
  for (const ch of text ?? "") {
    n += (ch.codePointAt(0) ?? 0) <= 0x7f ? 1 : 2;
  }
  return n;
}

export function smsMsgType(text: string): SmsMsgType {
  return eucKrBytes(text) > SMS_MAX_BYTES ? "LMS" : "SMS";
}

// 머리말 붙이기 — 이미 머리말로 시작하면 다시 붙이지 않습니다.
export function withSmsHeader(body: string, on: boolean): string {
  const text = (body ?? "").trim();
  if (!on || !text || text.startsWith(SMS_HEADER)) return text;
  return `${SMS_HEADER} ${text}`;
}

export function smsCostWon(type: SmsMsgType, count: number): number {
  return (type === "LMS" ? LMS_COST_WON : SMS_COST_WON) * count;
}

// 한국시간 밤 9시 ~ 아침 8시 — 야간 발송 경고.
export function isNightKst(now: Date = new Date()): boolean {
  const h = new Date(now.getTime() + 9 * 3600 * 1000).getUTCHours();
  return h >= 21 || h < 8;
}

// --- 화면 ↔ 서버 공용 타입 ---------------------------------------------

export type SmsSenderOption = { number: string; label: string; display: string };
export type SmsSendersInfo = {
  enabled: boolean;
  default: string | null;
  allowed: SmsSenderOption[];
};

// 방과후 학생 한 명 — 전화번호는 화면에 보내지 않고 보호자 id 만 넘깁니다.
export type SmsBkStudent = {
  id: string;
  name: string;
  grade: string;
  class_code: string;
  // 번호가 유효한 정상(active) 보호자 — 대표 보호자 / 그 밖의 보호자.
  primaryGuardianIds: string[];
  otherGuardianIds: string[];
};

export function bkGuardianIdsFor(
  s: SmsBkStudent,
  mode: BkGuardianMode,
): string[] {
  return mode === "all"
    ? [...s.primaryGuardianIds, ...s.otherGuardianIds]
    : s.primaryGuardianIds;
}

export type SmsLogRow = {
  id: string;
  created_at: string;
  sender_name: string | null;
  program: string;
  audience_desc: string | null;
  recipient_count: number;
  msg_type: string | null;
  sender: string | null;
  is_test: boolean;
  ok: boolean;
  sent_count: number | null;
  failed_count: number | null;
  provider_msg_id: string | null;
  error: string | null;
};

export type SmsSendRequest = {
  program: SmsProgram;
  // program='bk'
  studentIds?: string[];
  guardianMode?: BkGuardianMode;
  // program='manual'
  numbers?: string;
  text: string; // 머리말까지 붙은 최종 본문
  sender?: string;
  test: boolean;
  testNumber?: string;
};

export type SmsSendResponse =
  | {
      ok: true;
      sent: number;
      failed: number;
      msg_type: string | null;
      provider_msg_id: string | null;
      sender: string | null;
    }
  | { ok: false; error: string };

export type SmsResultSummary = {
  ok: boolean;
  sent: number;
  failed: number;
  pending: number;
  error?: string;
};
