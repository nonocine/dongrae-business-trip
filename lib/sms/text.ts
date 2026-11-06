// =====================================================================
// 문자 발송 — 순수 상수·헬퍼·화면↔서버 공용 타입. 서버 전용 모듈을 import 하지 않습니다.
//   * 번호: 숫자만 남김. 휴대폰은 010 + 8자리(11자리), 지역번호(02·031 등)도 허용.
//   * 길이: EUC-KR 기준 — 비 ASCII 2바이트, ASCII 1바이트. 90 초과 LMS, 2,000 초과 금지.
// =====================================================================

export const SMS_HEADER = "[동래구청소년센터]";
// 광고성 문자 수신거부 번호 — 센터 대표번호. 바꿀 때는 여기 한 곳만.
export const SMS_OPTOUT_NUMBER = "051-988-0924";
export const SMS_AD_PREFIX = "(광고)";
export const SMS_MAX_BYTES = 90;
export const LMS_MAX_BYTES = 2000;
// 한 번에 보낼 수 있는 최대 인원. 1,000명을 넘으면 서버가 500명씩 나눠 보냅니다.
export const SMS_MAX_RECIPIENTS = 3000;
export const SMS_SPLIT_THRESHOLD = 1000;
export const SMS_CHUNK_SIZE = 500;
// 예상 비용(원/건) — 안내용 근사치.
export const SMS_COST_WON = 9;
export const LMS_COST_WON = 27;

export type SmsMsgType = "SMS" | "LMS";

// --- 번호 -------------------------------------------------------------

export function normalizeSmsPhone(input: string): string {
  return (input ?? "").replace(/\D/g, "");
}

// 010 은 11자리만. 그 밖의 01x(옛 번호)는 받지 않음. 지역번호(0[2-9]…)는 9~11자리.
export function isValidSmsPhone(digits: string): boolean {
  if (digits.startsWith("010")) return digits.length === 11;
  if (digits.startsWith("01")) return false;
  return /^0[2-9]\d{7,9}$/.test(digits);
}

export type ParsedContactLine = {
  line: number; // 1부터
  raw: string;
  name: string;
  phone: string; // 정규화된 숫자(잘못된 줄은 숫자만 남긴 값)
  valid: boolean;
};

// 붙여넣기 — 한 줄에 "이름, 번호" / "이름<TAB>번호"(엑셀 두 열) / "번호, 이름" / 번호만.
//   한 줄에 번호만 여러 개를 쉼표로 쓴 경우도 각각 받습니다.
export function parseContactLines(text: string): ParsedContactLine[] {
  const out: ParsedContactLine[] = [];
  const lines = (text ?? "").split(/\r?\n/);
  lines.forEach((rawLine, i) => {
    const raw = rawLine.trim();
    if (!raw) return;
    const cells = raw.split(/[\t,;]+/).map((c) => c.trim()).filter(Boolean);
    const phoneCells = cells.filter((c) => /\d/.test(c) && normalizeSmsPhone(c).length >= 7);
    const nameCells = cells.filter((c) => !phoneCells.includes(c));
    if (phoneCells.length > 1 && nameCells.length === 0) {
      for (const c of phoneCells) {
        const d = normalizeSmsPhone(c);
        out.push({ line: i + 1, raw: c, name: "", phone: d, valid: isValidSmsPhone(d) });
      }
      return;
    }
    const phoneRaw = phoneCells[0] ?? (nameCells.length === 1 && /\d/.test(raw) ? raw : "");
    const d = normalizeSmsPhone(phoneRaw);
    out.push({
      line: i + 1,
      raw,
      name: nameCells.join(" ").slice(0, 40),
      phone: d,
      valid: isValidSmsPhone(d),
    });
  });
  return out;
}

// --- 본문 -------------------------------------------------------------

export function eucKrBytes(text: string): number {
  let n = 0;
  for (const ch of text ?? "") n += (ch.codePointAt(0) ?? 0) <= 0x7f ? 1 : 2;
  return n;
}

export function smsMsgType(text: string): SmsMsgType {
  return eucKrBytes(text) > SMS_MAX_BYTES ? "LMS" : "SMS";
}

// 최종 본문 — 머리말·광고 표기를 붙입니다. 이미 붙어 있으면 다시 붙이지 않습니다.
//   광고: 맨 앞 "(광고)", 맨 끝 "수신거부 051-988-0924".
export function composeSmsText(
  body: string,
  opts: { header: boolean; advertising: boolean },
): string {
  let text = (body ?? "").trim();
  if (!text) return "";
  if (opts.header && !text.startsWith(SMS_HEADER) && !text.startsWith(`${SMS_AD_PREFIX}${SMS_HEADER}`))
    text = `${SMS_HEADER} ${text}`;
  if (opts.advertising) {
    if (!text.startsWith(SMS_AD_PREFIX)) text = `${SMS_AD_PREFIX}${text}`;
    const optout = `수신거부 ${SMS_OPTOUT_NUMBER}`;
    if (!text.endsWith(optout)) text = `${text}\n${optout}`;
  }
  return text;
}

// 광고성으로 보이는 단어 — 체크 안 했을 때 안내만 합니다.
const AD_WORDS = /모집|신청하세요|접수|할인|이벤트|무료|특가|선착순/;
export function looksLikeAdvertising(body: string): boolean {
  return AD_WORDS.test(body ?? "");
}

export function smsCostWon(type: SmsMsgType, count: number): number {
  return (type === "LMS" ? LMS_COST_WON : SMS_COST_WON) * count;
}

// 한국시간 밤 9시 ~ 아침 8시.
export function isNightKst(now: Date = new Date()): boolean {
  const h = new Date(now.getTime() + 9 * 3600 * 1000).getUTCHours();
  return h >= 21 || h < 8;
}

// --- 출처(받는 사람) — 화면 ↔ 서버 공용 타입 ----------------------------

// 화면 선택기 종류. 같은 종류를 쓰는 새 출처는 화면 코드를 고치지 않아도 됩니다.
//   list         : 필터 + 체크 목록(사람 또는 묶음)
//   term-program : 차시 고르기 + 프로그램 목록(인원 표시) — list 와 같은 선택기, 표시만 다름
//   search       : 검색어 → 묶음(거래처)별 사람 체크
//   paste        : 붙여넣기(이름, 번호)
export type SmsPickerType = "list" | "term-program" | "search" | "paste";
export type SmsChipColor = "blue" | "green" | "amber" | "violet";

export type SmsSourceMeta = {
  key: string;
  label: string;
  icon: string;
  description: string;
  pickerType: SmsPickerType;
  color: SmsChipColor;
};

export type SmsFilterDef = {
  key: string;
  label: string;
  kind: "select" | "radio";
  options: { value: string; label: string }[];
  value: string;
};

// 선택기 한 줄 — 번호는 없고 "번호 있음" 여부만.
export type SmsOptionItem = {
  id: string;
  name: string;
  sub?: string; // 소속·반·요일시간 등
  count?: number; // 묶음(프로그램·그룹)일 때 사람 수
  reachable?: number; // 묶음일 때 번호 있는 사람 수
  hasPhone: boolean;
  group?: string; // search 선택기에서 묶어 보여줄 이름(거래처명)
};

export type SmsOptionsResult = {
  filters: SmsFilterDef[];
  items: SmsOptionItem[];
  // [전체 담기] 같은 버튼 문구. 없으면 "보이는 항목 모두 선택".
  bulkLabel?: string;
  note?: string;
  // 선택 단위가 묶음(프로그램·그룹)이면 true — 목록에 인원 수를 보여 줍니다.
  grouped?: boolean;
};

export type SmsOptionsRequest = {
  source: string;
  filter?: Record<string, string>;
  query?: string;
};

// 담긴 명단의 묶음 하나 — 화면은 이것만 들고 있다가 서버에 넘깁니다.
export type SmsSelection = {
  filter?: Record<string, string>;
  ids?: string[];
  text?: string; // paste
};

export type SmsBundle = {
  uid: string;
  source: string;
  selection: SmsSelection;
  // 개별로 뺀 사람(ResolvedPerson.key).
  excluded: string[];
};

export type SmsPreviewPerson = {
  key: string;
  bundle: string; // uid
  name: string;
  sourceLabel: string;
  hasPhone: boolean;
  duplicate: boolean; // 앞 묶음과 같은 번호
};

export type SmsPreviewResult = {
  ok: true;
  total: number; // 실제로 보낼 인원(중복·번호없음 제외)
  duplicates: number;
  noPhone: number;
  restricted: number; // 주소록 안 권한 밖 출처 구성원(서버에서 제외)
  bundles: { uid: string; label: string; count: number; color: SmsChipColor }[];
  people: SmsPreviewPerson[];
  summary: string; // "동래미래 4차시 158 + 강사 5"
};

// 발송 수단 메타(화면용) — lib/sms/channels 등록표에서 만듭니다.
export type SmsChannelMeta = {
  key: string;
  label: string;
  icon: string;
  requiresTemplate: boolean;
  allowsAd: boolean;
};

export type SmsSendRequest = {
  channel?: string; // 발송 수단 key — 없으면 'sms'
  bundles: SmsBundle[];
  text: string; // 머리말·광고 표기까지 붙은 최종 본문
  advertising: boolean;
  sender?: string;
  test: boolean;
  testNumber?: string; // 발송 점검(test) 또는 본인 확인용(self) 받을 내 번호
  self?: boolean; // 본인 확인용 — testNumber 한 곳으로만 실제 발송(test:false), 명단 무시
};

export type SmsSendResponse =
  | {
      ok: true;
      sent: number;
      failed: number;
      msg_type: string | null;
      provider_msg_id: string | null;
      sender: string | null;
      partial?: string;
    }
  | { ok: false; error: string };

export type SmsSenderOption = { number: string; label: string; display: string };
export type SmsSendersInfo = {
  enabled: boolean;
  default: string | null;
  allowed: SmsSenderOption[];
};

export type SmsResultSummary = {
  ok: boolean;
  sent: number;
  failed: number;
  pending: number;
  error?: string;
};

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
  // 본문 — 보낸 본인·관장·부장은 전체, 다른 직원은 앞 20자(서버가 잘라서 줌).
  text_body: string;
  text_truncated: boolean;
};

// --- 문구함·주소록 ----------------------------------------------------

export const SMS_TEMPLATE_CATEGORIES = ["안내", "공지", "강사", "모집", "기타"] as const;
export type SmsVisibility = "private" | "shared";

export type SmsTemplate = {
  id: string;
  title: string;
  body: string;
  category: string;
  visibility: SmsVisibility;
  owner_name: string | null;
  use_count: number;
  is_favorite: boolean;
  can_edit: boolean;
};

export type SmsGroup = {
  id: string;
  name: string;
  category: string | null;
  visibility: SmsVisibility;
  business_program_id: string | null;
  business_program_name: string | null;
  owner_name: string | null;
  member_count: number;
  can_edit: boolean;
};

// 테이블이 아직 없을 때(마이그레이션 미적용) 화면에 보여 줄 문구.
export const SMS_TABLE_MISSING =
  "이 기능의 DB 표가 아직 만들어지지 않았습니다(마이그레이션 적용 후 사용 가능).";
