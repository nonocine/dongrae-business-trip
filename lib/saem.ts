// =====================================================================
// 동래샘들(강사·프로그램) 공용 타입·상수·헬퍼 — 동업자씨 측(/hr/saems).
//   * 같은 Supabase 의 saem_* 테이블 공유. RLS 0개 → service_role 경유.
// =====================================================================

import { normalizeHolidays } from "@/lib/saemSchedule";

// 동래샘들 앱 베이스 URL(초대 링크용). env 우선, 기본값 배포 주소.
export function saemAppUrl(): string {
  return (process.env.SAEM_APP_URL ?? "https://dongrae-saems.vercel.app").replace(
    /\/+$/,
    ""
  );
}

// 전화번호 정규화 — 숫자만(하이픈/공백 제거).
export function normalizePhone(input: string): string {
  return (input ?? "").replace(/\D/g, "");
}

// 강사 서류 슬롯 7종(고정). 인사기록 서류함 슬롯 패턴 동일.
export type SaemDocSlot = {
  key: string;
  label: string;
};
export const SAEM_DOC_SLOTS: SaemDocSlot[] = [
  { key: "resume", label: "이력서" },
  { key: "bank_copy", label: "통장사본" },
  { key: "id_card", label: "신분증" },
  { key: "crime_check", label: "범죄경력조회" },
  { key: "contract", label: "위촉계약서" },
  { key: "license", label: "자격증" },
  { key: "etc", label: "기타" },
];
export function isSaemDocSlot(key: string): boolean {
  return SAEM_DOC_SLOTS.some((s) => s.key === key);
}
export function saemDocLabel(key: string): string {
  return SAEM_DOC_SLOTS.find((s) => s.key === key)?.label ?? key;
}

export type SaemStatus = "active" | "inactive";
export type TermStatus = "draft" | "active" | "closed";
export const TERM_STATUS_LABEL: Record<TermStatus, string> = {
  draft: "준비",
  active: "진행중",
  closed: "종료",
};

// ST-5. 정산 방식 — 시급제(기본) / 수강료 분배제.
//   계산 규칙은 lib/settlement.ts(양쪽 저장소 공용)에 있다.
export type PayType = "hourly" | "revenue_share";
export const PAY_TYPE_LABEL: Record<PayType, string> = {
  hourly: "시급제",
  revenue_share: "수강료 분배",
};
export function normalizePayType(v: unknown): PayType {
  return v === "revenue_share" ? "revenue_share" : "hourly";
}
// 목록용 짧은 표기 — "시급 40,000" / "분배 70%".
export function payTypeSummary(p: {
  pay_type: PayType;
  hourly_rate: number | null;
  share_rate: number | null;
}): string {
  if (p.pay_type === "revenue_share")
    return `분배 ${p.share_rate == null ? "-" : trimRate(p.share_rate)}%`;
  return `시급 ${formatKRW(p.hourly_rate)}`;
}
// 비율 표기 — 70.00 → "70", 66.67 → "66.67".
export function trimRate(n: number): string {
  return String(Math.round(Number(n) * 100) / 100);
}

// --- 타입 ---
export type SaemInstructor = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  bank_name: string | null;
  bank_account: string | null;
  account_holder: string | null;
  password_set_at: string | null;
  must_change_password: boolean;
  invite_token: string | null;
  invite_expires_at: string | null;
  status: SaemStatus;
  memo: string | null;
};

export type SaemInstructorDoc = {
  id: string;
  instructor_id: string;
  slot: string;
  file_path: string;
  original_name: string | null;
  uploaded_by: string | null;
  created_at: string | null;
  issued_on: string | null; // 발급일 — crime_check(성범죄경력조회) 필수
};

export type SaemProject = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  sort_order: number;
};

export type SaemTerm = {
  id: string;
  project_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: TermStatus;
  // 기본 스케줄 — 프로그램 추가 모달 프리필용. 실제 회차는 프로그램이 결정한다.
  default_weekday: number | null; // 0 일 ~ 6 토
  default_weeks: number | null;
  default_holidays: string[];
};

export type SaemProgram = {
  id: string;
  term_id: string;
  name: string;
  instructor_id: string | null;
  period_no: number | null;
  time_start: string | null;
  time_end: string | null;
  target: string | null;
  capacity: number | null;
  tuition: number | null;
  room: string | null;
  hourly_rate: number | null;
  deduction_rate: number | null; // 원천징수 공제율(%) — 기본 3.30
  // ST-5. 정산 방식. hourly 면 hourly_rate, revenue_share 면 share_rate 를 쓴다.
  pay_type: PayType;
  share_rate: number | null; // 강사 분배 비율(%) — 기본 70.00
  status: string;
  sort_order: number;
  // 실제 스케줄(진실의 원천) — 이 값으로 saem_sessions 를 생성·재생성한다.
  session_start: string | null; // 1회차 날짜
  session_weekday: number | null; // 0 일 ~ 6 토
  session_weeks: number | null;
  session_holidays: string[];
};

// --- 정규화 ---
const s = (v: unknown): string | null => {
  const x = v == null ? "" : String(v).trim();
  return x.length ? x : null;
};
const nOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function toInstructor(r: Record<string, unknown>): SaemInstructor {
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    phone: s(r.phone),
    email: s(r.email),
    bank_name: s(r.bank_name),
    bank_account: s(r.bank_account),
    account_holder: s(r.account_holder),
    password_set_at: s(r.password_set_at),
    must_change_password: r.must_change_password === true,
    invite_token: s(r.invite_token),
    invite_expires_at: s(r.invite_expires_at),
    status: r.status === "inactive" ? "inactive" : "active",
    memo: s(r.memo),
  };
}

export function toInstructorDoc(r: Record<string, unknown>): SaemInstructorDoc {
  return {
    id: String(r.id ?? ""),
    instructor_id: String(r.instructor_id ?? ""),
    slot: String(r.slot ?? ""),
    file_path: String(r.file_path ?? ""),
    original_name: s(r.original_name),
    uploaded_by: s(r.uploaded_by),
    created_at: s(r.created_at),
    issued_on: s(r.issued_on),
  };
}

export function toProject(r: Record<string, unknown>): SaemProject {
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    description: s(r.description),
    status: String(r.status ?? "active"),
    sort_order: Number(r.sort_order ?? 0),
  };
}

export function toTerm(r: Record<string, unknown>): SaemTerm {
  const st = r.status;
  return {
    id: String(r.id ?? ""),
    project_id: String(r.project_id ?? ""),
    name: String(r.name ?? ""),
    start_date: s(r.start_date),
    end_date: s(r.end_date),
    status: st === "active" ? "active" : st === "closed" ? "closed" : "draft",
    default_weekday: nOrNull(r.default_weekday),
    default_weeks: nOrNull(r.default_weeks),
    default_holidays: normalizeHolidays(r.default_holidays),
  };
}

export function toProgram(r: Record<string, unknown>): SaemProgram {
  return {
    id: String(r.id ?? ""),
    term_id: String(r.term_id ?? ""),
    name: String(r.name ?? ""),
    instructor_id: s(r.instructor_id),
    period_no: nOrNull(r.period_no),
    time_start: s(r.time_start),
    time_end: s(r.time_end),
    target: s(r.target),
    capacity: nOrNull(r.capacity),
    tuition: nOrNull(r.tuition),
    room: s(r.room),
    hourly_rate: nOrNull(r.hourly_rate),
    deduction_rate: nOrNull(r.deduction_rate),
    pay_type: normalizePayType(r.pay_type),
    share_rate: nOrNull(r.share_rate),
    status: String(r.status ?? "active"),
    sort_order: Number(r.sort_order ?? 0),
    session_start: s(r.session_start),
    session_weekday: nOrNull(r.session_weekday),
    session_weeks: nOrNull(r.session_weeks),
    session_holidays: normalizeHolidays(r.session_holidays),
  };
}

export function formatKRW(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "-";
  return Math.round(Number(n)).toLocaleString("ko-KR");
}

// =====================================================================
// 강의확인증 — 강사가 동래샘들에서 신청(pending) → 담당자가 검토·승인/반려.
//   승인된 것만 강사가 출력한다(출력 시 printed_at 기록 — 2부-b).
//   ⚠️ 신청 데이터에 주민번호는 없다. 만들지도, 표시하지도 않는다.
// =====================================================================
export type CertStatus = "pending" | "approved" | "rejected";
export const CERT_STATUS_LABEL: Record<CertStatus, string> = {
  pending: "신청중",
  approved: "승인",
  rejected: "반려",
};
export function normalizeCertStatus(v: unknown): CertStatus {
  return v === "approved" || v === "rejected" ? v : "pending";
}

// 발급번호 표시 — "제2026년-3호". 채번은 승인 시점에만 한다(2부-a) —
//   신청중·반려 건은 번호가 없다(cert_no = null). 반려된 건이 번호를 먹으면
//   승인건 번호가 건너뛰어지기 때문이다(이민정 요청, 2026-08-20).
//   번호가 없으면 "" 를 준다 — 화면은 "미발급"(CERT_NO_UNISSUED), 양식(PDF)은 공란.
export function certNoLabel(
  year: number | null | undefined,
  no: number | null | undefined
): string {
  if (year == null || no == null) return "";
  return `제${year}년-${no}호`;
}

// 아직 번호가 없는 건(신청중·반려)의 표기 — 발급대장·파일명이 함께 쓴다.
export const CERT_NO_UNISSUED = "미발급";
