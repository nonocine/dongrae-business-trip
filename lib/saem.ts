// =====================================================================
// 동래샘들(강사·프로그램) 공용 타입·상수·헬퍼 — 동업자씨 측(/hr/saems).
//   * 같은 Supabase 의 saem_* 테이블 공유. RLS 0개 → service_role 경유.
// =====================================================================

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
  status: string;
  sort_order: number;
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
    status: String(r.status ?? "active"),
    sort_order: Number(r.sort_order ?? 0),
  };
}

export function formatKRW(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "-";
  return Math.round(Number(n)).toLocaleString("ko-KR");
}
