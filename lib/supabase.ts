import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase 환경변수가 설정되지 않았습니다. Vercel 또는 .env.local 에 NEXT_PUBLIC_SUPABASE_URL 과 NEXT_PUBLIC_SUPABASE_ANON_KEY 를 설정해주세요."
    );
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    const value = client[prop as string];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : Reflect.get(client as object, prop, receiver);
  },
});

export const TRANSPORT_TYPES = [
  "vehicle",
  "public",
  "walk",
  "flight",
  "train",
] as const;
export type TransportType = (typeof TRANSPORT_TYPES)[number];

export const TRANSPORT_LABEL: Record<TransportType, string> = {
  vehicle: "기관차량",
  public: "대중교통",
  walk: "도보/기타",
  flight: "항공",
  train: "기차",
};

export const TRANSPORT_ICON: Record<TransportType, string> = {
  vehicle: "🚗",
  public: "🚌",
  walk: "🚶",
  flight: "✈️",
  train: "🚆",
};

// =====================================================================
// Activities (통합 활동: 외근 / 출장 / 국내연수 / 해외연수 / 교육)
// =====================================================================
export const ACTIVITY_KINDS = [
  "outside_work",
  "business_trip",
  "domestic_training",
  "overseas_training",
  "education",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  outside_work: "외근",
  business_trip: "출장",
  domestic_training: "국내연수",
  overseas_training: "해외연수",
  education: "교육",
};

export const ACTIVITY_ICON: Record<ActivityKind, string> = {
  outside_work: "🚗",
  business_trip: "📋",
  domestic_training: "📚",
  overseas_training: "✈️",
  education: "🎓",
};

// Tailwind JIT 호환을 위해 정적 클래스 매핑
export const ACTIVITY_BADGE_CLASS: Record<ActivityKind, string> = {
  outside_work: "bg-blue-100 text-blue-700 border-blue-200",
  business_trip: "bg-violet-100 text-violet-700 border-violet-200",
  domestic_training: "bg-emerald-100 text-emerald-700 border-emerald-200",
  overseas_training: "bg-cyan-100 text-cyan-700 border-cyan-200",
  education: "bg-amber-100 text-amber-700 border-amber-200",
};

export const ACTIVITY_CARD_CLASS: Record<ActivityKind, string> = {
  outside_work: "border-blue-200 hover:border-blue-400 hover:bg-blue-50",
  business_trip:
    "border-violet-200 hover:border-violet-400 hover:bg-violet-50",
  domestic_training:
    "border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50",
  overseas_training: "border-cyan-200 hover:border-cyan-400 hover:bg-cyan-50",
  education: "border-amber-200 hover:border-amber-400 hover:bg-amber-50",
};

export const ACTIVITY_BAR_CLASS: Record<ActivityKind, string> = {
  outside_work: "from-blue-400 to-blue-600",
  business_trip: "from-violet-400 to-violet-600",
  domestic_training: "from-emerald-400 to-emerald-600",
  overseas_training: "from-cyan-400 to-cyan-600",
  education: "from-amber-400 to-amber-600",
};

export type Activity = {
  id: string;
  kind: ActivityKind;
  author: string;
  companion: string[];
  purpose: string;
  content: string;
  result: string;
  photos: string[];
  receipts: string[];
  certificate: string[];

  start_date: string | null;
  end_date: string | null;
  location: string | null;
  organization: string | null;
  city: string | null;
  country: string | null;

  transport_type: TransportType | null;
  transport_cost: number | null;
  accommodation: boolean | null;
  accommodation_cost: number | null;
  training_cost: number | null;

  course_name: string | null;
  visa_info: string | null;
  education_type: string | null;
  instructor: string | null;
  education_hours: number | null;
  attendees_count: number | null;

  driving_log_id: string | null;

  created_at: string;
};

// 차량 운행 기본 출발지/도착지 (왕복 고정)
export const DEFAULT_DEPARTURE = "동래구청소년센터";
// 차량 운행 기본 확인자 (관장 확인)
export const DEFAULT_VEHICLE_CONFIRMER = "허일수";

export type DrivingLog = {
  id: string;
  driven_at: string;
  driver: string;
  purpose: string;
  departure: string | null;
  waypoint: string | null;
  destination: string | null;
  distance: number | null;
  total_distance: number | null;
  confirmed_by: string | null;
  created_at: string;
};

export type Settings = {
  id: number;
  vehicle_number: string | null;
  vehicle_model: string | null;
  insurance_company: string | null;
  initial_mileage: number | null;
  organization_name: string | null;
  organization_name_old: string | null;
  organization_name_changed_at: string | null;
  organization_head_name: string | null;
  organization_head_title: string | null;
  organization_head_title_old: string | null;
  organization_address: string | null;
  organization_phone: string | null;
  organization_email: string | null;
  updated_at: string | null;
};

export function normalizeDrivingLog(raw: Record<string, unknown>): DrivingLog {
  return {
    id: String(raw.id ?? ""),
    driven_at: String(raw.driven_at ?? ""),
    driver: String(raw.driver ?? ""),
    purpose: String(raw.purpose ?? ""),
    departure: (raw.departure as string | null) ?? null,
    waypoint: (raw.waypoint as string | null) ?? null,
    destination: (raw.destination as string | null) ?? null,
    distance: raw.distance == null ? null : Number(raw.distance),
    total_distance:
      raw.total_distance == null ? null : Number(raw.total_distance),
    confirmed_by: (raw.confirmed_by as string | null) ?? null,
    created_at: String(raw.created_at ?? ""),
  };
}

// settings 테이블이 (key, value) Key-Value 구조이므로,
// 행 배열을 받아 Settings 모양으로 매핑합니다.
export function settingsFromRows(
  rows: Array<{ key?: unknown; value?: unknown }>
): Settings {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (typeof r?.key === "string") {
      const v = r.value;
      map.set(r.key, v == null ? "" : String(v));
    }
  }
  const num = (k: string): number | null => {
    const s = map.get(k);
    if (s == null || s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const str = (k: string): string | null => {
    const s = map.get(k);
    return s == null || s === "" ? null : s;
  };
  return {
    id: 1,
    vehicle_number: str("vehicle_number"),
    vehicle_model: str("vehicle_model"),
    insurance_company: str("insurance_company"),
    initial_mileage: num("initial_mileage"),
    organization_name: str("organization_name"),
    organization_name_old: str("organization_name_old"),
    organization_name_changed_at: str("organization_name_changed_at"),
    organization_head_name: str("organization_head_name"),
    organization_head_title: str("organization_head_title"),
    organization_head_title_old: str("organization_head_title_old"),
    organization_address: str("organization_address"),
    organization_phone: str("organization_phone"),
    organization_email: str("organization_email"),
    updated_at: null,
  };
}

export function isActivityKind(s: string): s is ActivityKind {
  return (ACTIVITY_KINDS as readonly string[]).includes(s);
}

export function getAllowedTransports(kind: ActivityKind): TransportType[] {
  switch (kind) {
    case "outside_work":
      return ["vehicle", "public", "walk"];
    case "business_trip":
      return ["vehicle", "public", "flight", "train"];
    case "domestic_training":
      return ["vehicle", "public", "flight", "train"];
    case "overseas_training":
      return ["flight"];
    case "education":
      return ["vehicle", "public", "walk"];
  }
}

export function normalizeActivity(raw: Record<string, unknown>): Activity {
  return {
    id: String(raw.id ?? ""),
    // DB column is `activity_type`; we keep `kind` as the internal field name
    kind: (raw.activity_type as ActivityKind) ?? "outside_work",
    author: String(raw.author ?? ""),
    companion: toStringArray(raw.companion),
    purpose: String(raw.purpose ?? ""),
    content: String(raw.content ?? ""),
    result: String(raw.result ?? ""),
    photos: toStringArray(raw.photos),
    receipts: toStringArray(raw.receipts),
    certificate: toStringArray(raw.certificate),

    start_date: (raw.start_date as string | null) ?? null,
    end_date: (raw.end_date as string | null) ?? null,
    location: (raw.location as string | null) ?? null,
    organization: (raw.organization as string | null) ?? null,
    city: (raw.city as string | null) ?? null,
    country: (raw.country as string | null) ?? null,

    transport_type: (raw.transport_type as TransportType | null) ?? null,
    transport_cost:
      raw.transport_cost == null ? null : Number(raw.transport_cost),
    accommodation:
      raw.accommodation == null ? null : Boolean(raw.accommodation),
    accommodation_cost:
      raw.accommodation_cost == null ? null : Number(raw.accommodation_cost),
    training_cost:
      raw.training_cost == null ? null : Number(raw.training_cost),

    course_name: (raw.course_name as string | null) ?? null,
    visa_info: (raw.visa_info as string | null) ?? null,
    education_type: (raw.education_type as string | null) ?? null,
    instructor: (raw.instructor as string | null) ?? null,
    education_hours:
      raw.education_hours == null ? null : Number(raw.education_hours),
    attendees_count:
      raw.attendees_count == null ? null : Number(raw.attendees_count),

    driving_log_id: (raw.driving_log_id as string | null) ?? null,

    created_at: String(raw.created_at ?? ""),
  };
}

export type BusinessTrip = {
  id: string;
  trip_date: string;
  destination: string;
  traveler: string;
  companion: string[];
  purpose: string;
  transport_type: TransportType;
  transport_cost: number | null;
  meeting_content: string;
  main_agenda: string;
  result: string;
  photos: string[];
  receipts: string[];
  created_at: string;
};

export const EMPLOYEE_RANKS = ["관장", "부장", "팀장", "팀원"] as const;
export type EmployeeRank = (typeof EMPLOYEE_RANKS)[number];

// 차량 어플과 공유하는 직원 테이블 (drivers).
// 출장일지에서는 "직원"이라는 표현을 그대로 유지하지만 DB 테이블은 drivers 입니다.
export type Driver = {
  id: string;
  name: string;
  rank: EmployeeRank | null;
  password: string | null;
  is_active: boolean;
  created_at: string;
  // 아래 두 컬럼은 DB에 아직 없을 수 있어 옵셔널입니다.
  must_change_password?: boolean | null;
  password_changed_at?: string | null;
};

// 호환성을 위한 별칭 (기존 코드는 Employee 라는 이름을 사용)
export type Employee = Driver;

// 컬럼이 text[] 가 아니라 text(JSON 문자열, Postgres 배열 리터럴, 콤마구분 등)
// 으로 저장돼 있어도 안전하게 string[] 로 변환합니다.
export function toStringArray(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x : String(x ?? "")))
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return toStringArray(parsed);
      } catch {
        // fall through
      }
    }
    if (s.startsWith("{") && s.endsWith("}")) {
      const inner = s.slice(1, -1);
      if (!inner) return [];
      return inner
        .split(",")
        .map((t) => t.replace(/^"|"$/g, "").trim())
        .filter((t) => t.length > 0);
    }
    return s
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }
  return [];
}

export function normalizeBusinessTrip(raw: Record<string, unknown>): BusinessTrip {
  return {
    id: String(raw.id ?? ""),
    trip_date: String(raw.trip_date ?? ""),
    destination: String(raw.destination ?? ""),
    traveler: String(raw.traveler ?? ""),
    companion: toStringArray(raw.companion),
    purpose: String(raw.purpose ?? ""),
    transport_type: (raw.transport_type as TransportType) ?? "vehicle",
    transport_cost:
      raw.transport_cost == null ? null : Number(raw.transport_cost),
    meeting_content: String(raw.meeting_content ?? ""),
    main_agenda: String(raw.main_agenda ?? ""),
    result: String(raw.result ?? ""),
    photos: toStringArray(raw.photos),
    receipts: toStringArray(raw.receipts),
    created_at: String(raw.created_at ?? ""),
  };
}

// =====================================================================
// HR 인사 모듈
// =====================================================================

// 명칭 변경 분기일: 이 날짜 이전은 "수련관", 이후는 "센터"
export const HR_NAME_CHANGE_DATE = "2025-12-15";

export const CERTIFICATE_TYPES = ["재직", "경력", "기타"] as const;
export type CertificateType = (typeof CERTIFICATE_TYPES)[number];

export const CERTIFICATE_TYPE_LABEL: Record<CertificateType, string> = {
  재직: "재직증명서",
  경력: "경력증명서",
  기타: "기타",
};

export const CERTIFICATE_TYPE_BADGE_CLASS: Record<CertificateType, string> = {
  재직: "bg-emerald-100 text-emerald-700 border-emerald-200",
  경력: "bg-violet-100 text-violet-700 border-violet-200",
  기타: "bg-slate-100 text-slate-700 border-slate-200",
};

export const GENDER_TYPES = ["남", "여"] as const;
export type GenderType = (typeof GENDER_TYPES)[number];

export const GENDER_LABEL: Record<GenderType, string> = {
  남: "남자",
  여: "여자",
};

export const HR_ADMIN_RANKS = ["관장", "부장"] as const;
export type HrAdminRank = (typeof HR_ADMIN_RANKS)[number];

// JSONB sub-types — 폼 작성하면서 좁힐 예정
export type EmployeeEducation = Record<string, unknown>;
export type EmployeeFamily = Record<string, unknown>;
export type EmployeeLicense = Record<string, unknown>;
export type EmployeeCareer = Record<string, unknown>;
export type EmployeeAward = Record<string, unknown>;
export type EmployeeTraining = Record<string, unknown>;
export type EmployeeAppointment = Record<string, unknown>;

export type EmployeeProfile = {
  id: string;
  driver_id: string;
  name_chinese: string | null;
  resident_number: string | null;
  gender: GenderType | null;
  birth_date: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  photo_url: string | null;
  join_date: string | null;
  leave_date: string | null;
  education: EmployeeEducation[];
  family: EmployeeFamily[];
  licenses: EmployeeLicense[];
  career: EmployeeCareer[];
  awards: EmployeeAward[];
  trainings: EmployeeTraining[];
  appointments: EmployeeAppointment[];
  military_service: string | null;
  created_at: string;
  updated_at: string | null;
};

export type EmploymentContract = {
  id: string;
  driver_id: string;
  contract_start: string;
  contract_end: string | null;
  position: string | null;
  work_hours: string | null;
  work_days: string | null;
  weekly_hours: number | null;
  workplace: string | null;
  break_time: string | null;
  payment_day: string | null;
  contract_pdf_url: string | null;
  signed_by_employee: string | null;
  signed_by_employer: string | null;
  signed_at: string | null;
  created_at: string;
};

export type SalaryContract = {
  id: string;
  driver_id: string;
  year: number;
  period_start: string | null;
  period_end: string | null;
  base_salary: number | null;
  meal_allowance: number | null;
  qualification_allowance: number | null;
  family_allowance: number | null;
  management_allowance: number | null;
  holiday_bonus: number | null;
  transport_allowance: number | null;
  total_annual: number | null;
  contract_pdf_url: string | null;
  signed_at: string | null;
  created_at: string;
};

export type CertificateIssued = {
  id: string;
  driver_id: string;
  certificate_type: CertificateType;
  issue_number: string | null;
  year: number | null;
  year_seq: number | null;
  issue_date: string | null;
  purpose: string | null;
  department: string | null;
  position_detail: string | null;
  period_from: string | null;
  period_to: string | null;
  duration: string | null;
  issued_by: string | null;
  pdf_url: string | null;
  created_at: string;
};

// JSONB 배열을 안전하게 객체 배열로 변환합니다.
// 컬럼이 jsonb 가 아닌 text(JSON 문자열)로 와도 처리합니다.
function toJsonbArray<T extends Record<string, unknown>>(v: unknown): T[] {
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v.filter(
      (x): x is T => x != null && typeof x === "object" && !Array.isArray(x)
    );
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (x): x is T =>
            x != null && typeof x === "object" && !Array.isArray(x)
        );
      }
    } catch {
      // fall through
    }
  }
  return [];
}

export function normalizeEmployeeProfile(
  raw: Record<string, unknown>
): EmployeeProfile {
  return {
    id: String(raw.id ?? ""),
    driver_id: String(raw.driver_id ?? ""),
    name_chinese: (raw.name_chinese as string | null) ?? null,
    resident_number: (raw.resident_number as string | null) ?? null,
    gender: (raw.gender as GenderType | null) ?? null,
    birth_date: (raw.birth_date as string | null) ?? null,
    address: (raw.address as string | null) ?? null,
    email: (raw.email as string | null) ?? null,
    phone: (raw.phone as string | null) ?? null,
    photo_url: (raw.photo_url as string | null) ?? null,
    join_date: (raw.join_date as string | null) ?? null,
    leave_date: (raw.leave_date as string | null) ?? null,
    education: toJsonbArray<EmployeeEducation>(raw.education),
    family: toJsonbArray<EmployeeFamily>(raw.family),
    licenses: toJsonbArray<EmployeeLicense>(raw.licenses),
    career: toJsonbArray<EmployeeCareer>(raw.career),
    awards: toJsonbArray<EmployeeAward>(raw.awards),
    trainings: toJsonbArray<EmployeeTraining>(raw.trainings),
    appointments: toJsonbArray<EmployeeAppointment>(raw.appointments),
    military_service: (raw.military_service as string | null) ?? null,
    created_at: String(raw.created_at ?? ""),
    updated_at: (raw.updated_at as string | null) ?? null,
  };
}

export function normalizeEmploymentContract(
  raw: Record<string, unknown>
): EmploymentContract {
  return {
    id: String(raw.id ?? ""),
    driver_id: String(raw.driver_id ?? ""),
    contract_start: String(raw.contract_start ?? ""),
    contract_end: (raw.contract_end as string | null) ?? null,
    position: (raw.position as string | null) ?? null,
    work_hours: (raw.work_hours as string | null) ?? null,
    work_days: (raw.work_days as string | null) ?? null,
    weekly_hours: raw.weekly_hours == null ? null : Number(raw.weekly_hours),
    workplace: (raw.workplace as string | null) ?? null,
    break_time: (raw.break_time as string | null) ?? null,
    payment_day: (raw.payment_day as string | null) ?? null,
    contract_pdf_url: (raw.contract_pdf_url as string | null) ?? null,
    signed_by_employee: (raw.signed_by_employee as string | null) ?? null,
    signed_by_employer: (raw.signed_by_employer as string | null) ?? null,
    signed_at: (raw.signed_at as string | null) ?? null,
    created_at: String(raw.created_at ?? ""),
  };
}

export function normalizeSalaryContract(
  raw: Record<string, unknown>
): SalaryContract {
  return {
    id: String(raw.id ?? ""),
    driver_id: String(raw.driver_id ?? ""),
    year: Number(raw.year ?? 0),
    period_start: (raw.period_start as string | null) ?? null,
    period_end: (raw.period_end as string | null) ?? null,
    base_salary: raw.base_salary == null ? null : Number(raw.base_salary),
    meal_allowance:
      raw.meal_allowance == null ? null : Number(raw.meal_allowance),
    qualification_allowance:
      raw.qualification_allowance == null
        ? null
        : Number(raw.qualification_allowance),
    family_allowance:
      raw.family_allowance == null ? null : Number(raw.family_allowance),
    management_allowance:
      raw.management_allowance == null
        ? null
        : Number(raw.management_allowance),
    holiday_bonus:
      raw.holiday_bonus == null ? null : Number(raw.holiday_bonus),
    transport_allowance:
      raw.transport_allowance == null
        ? null
        : Number(raw.transport_allowance),
    total_annual: raw.total_annual == null ? null : Number(raw.total_annual),
    contract_pdf_url: (raw.contract_pdf_url as string | null) ?? null,
    signed_at: (raw.signed_at as string | null) ?? null,
    created_at: String(raw.created_at ?? ""),
  };
}

export function normalizeCertificateIssued(
  raw: Record<string, unknown>
): CertificateIssued {
  return {
    id: String(raw.id ?? ""),
    driver_id: String(raw.driver_id ?? ""),
    certificate_type: (raw.certificate_type as CertificateType) ?? "재직",
    issue_number: (raw.issue_number as string | null) ?? null,
    year: raw.year == null ? null : Number(raw.year),
    year_seq: raw.year_seq == null ? null : Number(raw.year_seq),
    issue_date: (raw.issue_date as string | null) ?? null,
    purpose: (raw.purpose as string | null) ?? null,
    department: (raw.department as string | null) ?? null,
    position_detail: (raw.position_detail as string | null) ?? null,
    period_from: (raw.period_from as string | null) ?? null,
    period_to: (raw.period_to as string | null) ?? null,
    duration: (raw.duration as string | null) ?? null,
    issued_by: (raw.issued_by as string | null) ?? null,
    pdf_url: (raw.pdf_url as string | null) ?? null,
    created_at: String(raw.created_at ?? ""),
  };
}

export function canAccessHr(rank: EmployeeRank | null): boolean {
  if (!rank) return false;
  return (HR_ADMIN_RANKS as readonly string[]).includes(rank);
}

// =====================================================================
// 비밀번호 정책
// =====================================================================

// 비밀번호 강도 검증.
//   * 일반 직원(팀장/팀원 등): 4자리 숫자 (기존 정책 유지)
//   * 인사 권한자(관장/부장): 6자리 이상 + 영문 1자 이상 포함
export function validatePasswordStrength(
  password: string,
  rank: EmployeeRank | null
): { ok: boolean; error?: string } {
  const pw = password ?? "";
  const isHrAdmin =
    !!rank && (HR_ADMIN_RANKS as readonly string[]).includes(rank);

  if (isHrAdmin) {
    if (pw.length < 6) {
      return {
        ok: false,
        error: "관장·부장은 6자리 이상 비밀번호를 사용해야 합니다.",
      };
    }
    if (!/[A-Za-z]/.test(pw)) {
      return {
        ok: false,
        error: "관장·부장 비밀번호는 영문을 1자 이상 포함해야 합니다.",
      };
    }
    return { ok: true };
  }

  if (!/^\d{4}$/.test(pw)) {
    return { ok: false, error: "4자리 숫자 비밀번호를 입력해주세요." };
  }
  return { ok: true };
}

// 관리자가 직원 비번을 재설정할 때 발급하는 임시 비밀번호.
// "Temp" + 4자리 숫자 → 영문 포함 8자라 인사 권한자 정책도 자동 통과합니다.
export function generateTempPassword(): string {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `Temp${n}`;
}

// 주어진 시점의 기관명/대표 직함을 반환합니다.
// HR_NAME_CHANGE_DATE 이전이면 *_old 값을, 이후면 신규 값을 사용합니다.
export function getOrgInfoAt(
  asOfDate: string | Date,
  settings: Settings
): { name: string; head_title: string } {
  const dateStr =
    asOfDate instanceof Date
      ? asOfDate.toISOString().slice(0, 10)
      : String(asOfDate).slice(0, 10);
  const isBefore = dateStr < HR_NAME_CHANGE_DATE;
  return {
    name:
      (isBefore
        ? settings.organization_name_old ?? settings.organization_name
        : settings.organization_name) ?? "",
    head_title:
      (isBefore
        ? settings.organization_head_title_old ??
          settings.organization_head_title
        : settings.organization_head_title) ?? "",
  };
}
