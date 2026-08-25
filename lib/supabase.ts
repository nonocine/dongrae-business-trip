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

export const EMPLOYEE_RANKS = ["관장", "부장", "팀장", "팀원"] as const;
export type EmployeeRank = (typeof EMPLOYEE_RANKS)[number];

// 차량 어플과 공유하는 직원 테이블 (drivers).
// 출장일지에서는 "직원"이라는 표현을 그대로 유지하지만 DB 테이블은 drivers 입니다.
export type Driver = {
  id: string;
  name: string;
  rank: EmployeeRank | null;
  // SEC-1: 비밀번호 값은 절대 이 타입에 담지 않습니다(브라우저까지 전달됨).
  //   설정 여부만 필요하므로 boolean 으로 환원합니다.
  has_password: boolean;
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

// =====================================================================
// HR 인사 모듈
// =====================================================================

// 명칭 변경 분기일: 이 날짜 이전 시점의 문서는 organization_name_old(과거 명칭)를,
// 이후 시점의 문서는 organization_name(현재 명칭)을 사용합니다.
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
export const EDUCATION_DEGREES = [
  "졸업",
  "재학",
  "중퇴",
  "수료",
  "졸업예정",
] as const;
export type EducationDegree = (typeof EDUCATION_DEGREES)[number];

export type EmployeeEducation = {
  school: string;
  major: string;
  degree: EducationDegree;
  enter_date: string;
  graduate_date: string;
  note: string;
};
export const FAMILY_RELATIONS = [
  "본인",
  "배우자",
  "자녀",
  "부",
  "모",
  "형제",
  "자매",
  "조부",
  "조모",
  "기타",
] as const;
export type FamilyRelation = (typeof FAMILY_RELATIONS)[number];

export type EmployeeFamily = {
  relation: FamilyRelation;
  name: string;
  birth_date: string;
  occupation: string;
  cohabit: boolean;
  note: string;
};
export type EmployeeLicense = {
  name: string;
  issuer: string;
  acquired_date: string;
  registration_number: string;
  note: string;
};
export type EmployeeCareer = {
  company: string;
  department: string;
  start_date: string;
  end_date: string;
  current: boolean;
  duties: string;
  note: string;
};
export type EmployeeAward = {
  name: string;
  issuer: string;
  date: string;
  reason: string;
  note: string;
};
export type EmployeeTraining = {
  name: string;
  institution: string;
  start_date: string;
  end_date: string;
  hours: string;
  note: string;
};

export const APPOINTMENT_TYPES = [
  "입사",
  "승진",
  "전보",
  "직위변경",
  "휴직",
  "복직",
  "퇴사",
  "기타",
] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

// =====================================================================
// 부서(DP-1) — 인사발령의 부서 칸 선택지.
//   * 부서는 employee_profiles 에 별도 컬럼이 없고 appointments jsonb 안의
//     department 필드로만 존재한다(최신 발령의 값이 그 직원의 현재 부서).
//   * 자유 텍스트라 오타·표기 흔들림이 생기기 쉬워 선택지를 고정한다. 다만
//     조직 개편으로 새 부서가 생길 수 있으므로 "직접 입력"도 함께 둔다.
//   * 관장·부장처럼 팀 소속이 없는 자리는 발령을 만들지 않는다 — 그 경우
//     화면은 drivers.rank 로 폴백해 직책을 보여 준다.
// =====================================================================
export const DEPARTMENTS = [
  "교육문화사업팀",
  "청소년사업팀",
  "방과후아카데미팀",
] as const;

// 셀렉트 선택지 — 상수 부서를 앞에 고정하고, 기존 데이터에만 있는 부서명을
//   뒤에 가나다순으로 덧붙인다(과거 표기를 잃지 않기 위함).
export function departmentOptions(
  ...sources: (readonly (string | null | undefined)[] | undefined)[]
): string[] {
  const extra = new Set<string>();
  for (const list of sources) {
    for (const v of list ?? []) {
      const s = (v ?? "").trim();
      if (s && !(DEPARTMENTS as readonly string[]).includes(s)) extra.add(s);
    }
  }
  return [
    ...DEPARTMENTS,
    ...[...extra].sort((a, b) => a.localeCompare(b, "ko")),
  ];
}

export type EmployeeAppointment = {
  type: AppointmentType;
  title: string;
  department: string;
  effective_date: string;
  note: string;
};

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
  // 재직 상태 — 급여·증명서의 기준 필드(레거시 leave_date 와 별개로 신설).
  //   'active'(재직) | 'resigned'(퇴사). 퇴사면 resignation_date 를 채웁니다.
  //   DB 기본값 'active' — 합격자→직원 전환 시 컬럼 미지정이라 자동 재직 처리됩니다.
  employment_status: "active" | "resigned";
  resignation_date: string | null;
  education: EmployeeEducation[];
  family: EmployeeFamily[];
  licenses: EmployeeLicense[];
  career: EmployeeCareer[];
  awards: EmployeeAward[];
  trainings: EmployeeTraining[];
  appointments: EmployeeAppointment[];
  military_service: string | null;
  // ERP 호환 권한등급(M0/M1/M3 등). 직급(drivers.rank)과 별개. 자유 text → 그대로 보존.
  auth_level: string | null;
  // 인사기록 첨부서류 { docKey: storagePath }. (lib/employeeDocs.ts 슬롯 기준)
  documents: Record<string, string>;
  // 잠금(Phase C에서 사용) — 인사기록카드 확정 후 수정 방지
  is_locked: boolean;
  locked_at: string | null;
  locked_by: string | null;
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

// jsonb 의 { docKey: path } 매핑을 안전한 Record<string,string> 으로 보정합니다.
//   값이 비문자열/빈문자열이면 버립니다. 배열/누락이면 빈 객체.
export function normalizeDocMap(raw: unknown): Record<string, string> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim().length > 0) out[k] = v;
  }
  return out;
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
    // 알 수 없는 값/누락은 'active' 로 보정(기존 행 하위호환).
    employment_status:
      raw.employment_status === "resigned" ? "resigned" : "active",
    resignation_date: (raw.resignation_date as string | null) ?? null,
    education: toJsonbArray<EmployeeEducation>(raw.education),
    family: toJsonbArray<EmployeeFamily>(raw.family),
    licenses: toJsonbArray<EmployeeLicense>(raw.licenses),
    career: toJsonbArray<EmployeeCareer>(raw.career),
    awards: toJsonbArray<EmployeeAward>(raw.awards),
    trainings: toJsonbArray<EmployeeTraining>(raw.trainings),
    appointments: toJsonbArray<EmployeeAppointment>(raw.appointments),
    military_service: (raw.military_service as string | null) ?? null,
    auth_level: (raw.auth_level as string | null) ?? null,
    documents: normalizeDocMap(raw.documents),
    is_locked: raw.is_locked === true,
    locked_at: (raw.locked_at as string | null) ?? null,
    locked_by: (raw.locked_by as string | null) ?? null,
    created_at: String(raw.created_at ?? ""),
    updated_at: (raw.updated_at as string | null) ?? null,
  };
}

// 임의의 객체를 EmployeeEducation 모양으로 보정합니다.
function normalizeEducationItem(item: unknown): EmployeeEducation {
  const o = (item ?? {}) as Record<string, unknown>;
  const degreeRaw = String(o.degree ?? "");
  const degree: EducationDegree = (
    EDUCATION_DEGREES as readonly string[]
  ).includes(degreeRaw)
    ? (degreeRaw as EducationDegree)
    : "졸업";
  return {
    school: String(o.school ?? "").trim(),
    major: String(o.major ?? "").trim(),
    degree,
    enter_date: String(o.enter_date ?? "").trim(),
    graduate_date: String(o.graduate_date ?? "").trim(),
    note: String(o.note ?? "").trim(),
  };
}

// DB/폼에서 온 학력 배열을 안전한 EmployeeEducation[] 로 보정합니다.
export function normalizeEducationList(items: unknown): EmployeeEducation[] {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeEducationItem);
}

// 폼에서 전달된 학력 JSON 문자열을 EmployeeEducation[] 로 파싱합니다.
// 빈 값은 빈 배열, 형식 오류면 throw.
export function parseEducationInput(raw: string | null): EmployeeEducation[] {
  if (!raw || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("학력 데이터 형식이 올바르지 않습니다.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("학력 데이터 형식이 올바르지 않습니다.");
  }
  return normalizeEducationList(parsed);
}

// --- 가족 ---
function normalizeFamilyItem(item: unknown): EmployeeFamily {
  const o = (item ?? {}) as Record<string, unknown>;
  const relRaw = String(o.relation ?? "");
  const relation: FamilyRelation = (
    FAMILY_RELATIONS as readonly string[]
  ).includes(relRaw)
    ? (relRaw as FamilyRelation)
    : "기타";
  return {
    relation,
    name: String(o.name ?? "").trim(),
    birth_date: String(o.birth_date ?? "").trim(),
    occupation: String(o.occupation ?? "").trim(),
    cohabit: o.cohabit === true,
    note: String(o.note ?? "").trim(),
  };
}

export function normalizeFamilyList(items: unknown): EmployeeFamily[] {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeFamilyItem);
}

export function parseFamilyInput(raw: string | null): EmployeeFamily[] {
  if (!raw || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("가족 데이터 형식이 올바르지 않습니다.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("가족 데이터 형식이 올바르지 않습니다.");
  }
  return normalizeFamilyList(parsed);
}

// --- 자격증 ---
function normalizeLicenseItem(item: unknown): EmployeeLicense {
  const o = (item ?? {}) as Record<string, unknown>;
  return {
    name: String(o.name ?? "").trim(),
    issuer: String(o.issuer ?? "").trim(),
    acquired_date: String(o.acquired_date ?? "").trim(),
    registration_number: String(o.registration_number ?? "").trim(),
    note: String(o.note ?? "").trim(),
  };
}

export function normalizeLicenseList(items: unknown): EmployeeLicense[] {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeLicenseItem);
}

export function parseLicenseInput(raw: string | null): EmployeeLicense[] {
  if (!raw || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("자격증 데이터 형식이 올바르지 않습니다.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("자격증 데이터 형식이 올바르지 않습니다.");
  }
  return normalizeLicenseList(parsed);
}

// --- 경력 ---
function normalizeCareerItem(item: unknown): EmployeeCareer {
  const o = (item ?? {}) as Record<string, unknown>;
  return {
    company: String(o.company ?? "").trim(),
    department: String(o.department ?? "").trim(),
    start_date: String(o.start_date ?? "").trim(),
    end_date: String(o.end_date ?? "").trim(),
    current: o.current === true,
    duties: String(o.duties ?? "").trim(),
    note: String(o.note ?? "").trim(),
  };
}

export function normalizeCareerList(items: unknown): EmployeeCareer[] {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeCareerItem);
}

export function parseCareerInput(raw: string | null): EmployeeCareer[] {
  if (!raw || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("경력 데이터 형식이 올바르지 않습니다.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("경력 데이터 형식이 올바르지 않습니다.");
  }
  return normalizeCareerList(parsed);
}

// --- 수상 ---
function normalizeAwardItem(item: unknown): EmployeeAward {
  const o = (item ?? {}) as Record<string, unknown>;
  return {
    name: String(o.name ?? "").trim(),
    issuer: String(o.issuer ?? "").trim(),
    date: String(o.date ?? "").trim(),
    reason: String(o.reason ?? "").trim(),
    note: String(o.note ?? "").trim(),
  };
}

export function normalizeAwardList(items: unknown): EmployeeAward[] {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeAwardItem);
}

export function parseAwardInput(raw: string | null): EmployeeAward[] {
  if (!raw || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("수상 데이터 형식이 올바르지 않습니다.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("수상 데이터 형식이 올바르지 않습니다.");
  }
  return normalizeAwardList(parsed);
}

// --- 교육이수 ---
function normalizeTrainingItem(item: unknown): EmployeeTraining {
  const o = (item ?? {}) as Record<string, unknown>;
  return {
    name: String(o.name ?? "").trim(),
    institution: String(o.institution ?? "").trim(),
    start_date: String(o.start_date ?? "").trim(),
    end_date: String(o.end_date ?? "").trim(),
    hours: String(o.hours ?? "").trim(),
    note: String(o.note ?? "").trim(),
  };
}

export function normalizeTrainingList(items: unknown): EmployeeTraining[] {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeTrainingItem);
}

export function parseTrainingInput(raw: string | null): EmployeeTraining[] {
  if (!raw || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("교육이수 데이터 형식이 올바르지 않습니다.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("교육이수 데이터 형식이 올바르지 않습니다.");
  }
  return normalizeTrainingList(parsed);
}

// --- 인사발령 ---
function normalizeAppointmentItem(item: unknown): EmployeeAppointment {
  const o = (item ?? {}) as Record<string, unknown>;
  const typeRaw = String(o.type ?? "");
  const type: AppointmentType = (
    APPOINTMENT_TYPES as readonly string[]
  ).includes(typeRaw)
    ? (typeRaw as AppointmentType)
    : "기타";
  return {
    type,
    title: String(o.title ?? "").trim(),
    department: String(o.department ?? "").trim(),
    effective_date: String(o.effective_date ?? "").trim(),
    note: String(o.note ?? "").trim(),
  };
}

export function normalizeAppointmentList(
  items: unknown
): EmployeeAppointment[] {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeAppointmentItem);
}

export function parseAppointmentInput(
  raw: string | null
): EmployeeAppointment[] {
  if (!raw || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("인사발령 데이터 형식이 올바르지 않습니다.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("인사발령 데이터 형식이 올바르지 않습니다.");
  }
  return normalizeAppointmentList(parsed);
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

// 특수문자 — 일반적으로 인정되는 ASCII 특수문자 셋.
const SPECIAL_CHAR_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/;

// 비밀번호 강도 검증.
//   * 일반 직원(팀장/팀원 등): 4자리 숫자 (기존 정책 유지)
//   * 인사 권한자(관장/부장): 8자 이상 + 영문·숫자·특수문자 모두 포함
export function validatePasswordStrength(
  password: string,
  rank: EmployeeRank | null
): { ok: boolean; error?: string } {
  const pw = password ?? "";
  const isHrAdmin =
    !!rank && (HR_ADMIN_RANKS as readonly string[]).includes(rank);

  if (isHrAdmin) {
    if (pw.length < 8) {
      return {
        ok: false,
        error: "관장·부장 비밀번호는 8자 이상이어야 합니다.",
      };
    }
    if (!/[A-Za-z]/.test(pw)) {
      return {
        ok: false,
        error: "비밀번호는 영문을 1자 이상 포함해야 합니다.",
      };
    }
    if (!/\d/.test(pw)) {
      return {
        ok: false,
        error: "비밀번호는 숫자를 1자 이상 포함해야 합니다.",
      };
    }
    if (!SPECIAL_CHAR_RE.test(pw)) {
      return {
        ok: false,
        error: "비밀번호는 특수문자(!@#$%^&* 등)를 1자 이상 포함해야 합니다.",
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
// "Temp" + 4자리 숫자 + "!" → 9자/영문/숫자/특수문자 모두 포함하여
// 관장·부장 강화 정책(8자 이상 · 영문 · 숫자 · 특수)도 자동 통과합니다.
export function generateTempPassword(): string {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `Temp${n}!`;
}

// =====================================================================
// 주민등록번호 파싱
// =====================================================================

// 주민등록번호에서 생년월일·성별을 추출합니다.
//   * 형식: "YYMMDD-SXXXXXX" (하이픈·공백 유무 무관, 숫자 13자리)
//   * S(7번째): 1,2,5,6 → 1900년대 / 3,4,7,8 → 2000년대
//   * 홀수(1,3,5,7) → 남 / 짝수(2,4,6,8) → 여
//   * 형식이 올바르지 않으면 null 을 반환합니다.
export function parseResidentNumber(
  rrn: string
): { birthDate: string | null; gender: GenderType | null } | null {
  const digits = (rrn ?? "").replace(/\D/g, "");
  if (digits.length !== 13) return null;

  const yy = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const dd = digits.slice(4, 6);
  const s = digits.charAt(6);

  let century: number;
  if (s === "1" || s === "2" || s === "5" || s === "6") century = 1900;
  else if (s === "3" || s === "4" || s === "7" || s === "8") century = 2000;
  else return null;

  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const birthDate = `${century + Number(yy)}-${mm}-${dd}`;
  const gender: GenderType = Number(s) % 2 === 1 ? "남" : "여";

  return { birthDate, gender };
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

// =====================================================================
// HR 문서 Storage (hr-documents 버킷 — Private)
//   * Private 버킷이므로 photo_url 등에는 path 만 저장하고,
//     열람 시 signHrDocument() 로 1시간 임시 URL 을 발급합니다.
//   * getPublicUrl 은 Private 버킷에서 동작하지 않으므로 사용 금지.
// =====================================================================
export const HR_DOCUMENTS_BUCKET = "hr-documents";

// 이미지 MIME → 확장자
const PROFILE_PHOTO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// 본인 증명사진 업로드 — 경로 employees/{driverId}/profile-photo.{ext}.
// 성공 시 저장된 path 를 반환합니다(공개 URL 아님).
export async function uploadProfilePhoto(
  driverId: string,
  file: File
): Promise<string> {
  const ext = PROFILE_PHOTO_EXT[file.type];
  if (!ext) {
    throw new Error("JPG, PNG, WEBP 이미지만 업로드할 수 있습니다.");
  }
  const path = `employees/${driverId}/profile-photo.${ext}`;
  const { error } = await supabase.storage
    .from(HR_DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw new Error(`사진 업로드 실패: ${error.message}`);
  return path;
}

// hr-documents 버킷의 객체 삭제
export async function removeHrDocuments(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await supabase.storage.from(HR_DOCUMENTS_BUCKET).remove(paths);
}

// 도장(서명) 이미지 허용 형식 — png/jpg 만. webp 는 docx(ImageRun) 삽입 불가라 금지.
export const STAMP_IMAGE_MIME: Record<string, "png" | "jpg"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

// 도장 이미지 업로드 — 고정 path 에 upsert(재등록 시 덮어쓰기). path 반환.
//   data 는 File/Blob/ArrayBuffer/Uint8Array. contentType 은 image/png|image/jpeg.
export async function uploadStampImage(
  path: string,
  data: Blob | ArrayBuffer | Uint8Array,
  contentType: string
): Promise<string> {
  const { error } = await supabase.storage
    .from(HR_DOCUMENTS_BUCKET)
    .upload(path, data, { contentType, upsert: true });
  if (error) throw new Error(`도장 업로드 실패: ${error.message}`);
  return path;
}

// Private 버킷용 1시간 임시 열람 URL. path 가 없으면 null.
export async function signHrDocument(
  path: string | null | undefined
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(HR_DOCUMENTS_BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data) return null;
  return data.signedUrl;
}

// =====================================================================
// 채용 시스템 v1.2 — 공고 · 심사위원 · 서류채점 · 면접채점 · 면접일정
// (recruitment_scores 는 폐기 예정. 신규 4테이블로 분리)
// =====================================================================

// --- 공고 (recruitment_postings) ---
export const RECRUITMENT_POSTING_STATUSES = [
  "draft",
  "published",
  "closed",
] as const;
export type RecruitmentPostingStatus =
  (typeof RECRUITMENT_POSTING_STATUSES)[number];

export type RecruitmentPosting = {
  id: string;
  slug: string;
  title: string;
  field: string;
  recruit_count: number;
  application_start: string;
  application_end: string;
  qualifications: string | null;
  preferred: string | null;
  salary_info: string | null;
  process_info: string | null;
  notice: string | null;
  attachment_url: string | null;
  status: RecruitmentPostingStatus;
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
};

export function normalizeRecruitmentPosting(
  raw: Record<string, unknown>
): RecruitmentPosting {
  const sRaw = String(raw.status ?? "draft");
  const status: RecruitmentPostingStatus = (
    RECRUITMENT_POSTING_STATUSES as readonly string[]
  ).includes(sRaw)
    ? (sRaw as RecruitmentPostingStatus)
    : "draft";
  return {
    id: String(raw.id ?? ""),
    slug: String(raw.slug ?? ""),
    title: String(raw.title ?? ""),
    field: String(raw.field ?? ""),
    recruit_count: raw.recruit_count == null ? 0 : Number(raw.recruit_count),
    application_start: String(raw.application_start ?? ""),
    application_end: String(raw.application_end ?? ""),
    qualifications: (raw.qualifications as string | null) ?? null,
    preferred: (raw.preferred as string | null) ?? null,
    salary_info: (raw.salary_info as string | null) ?? null,
    process_info: (raw.process_info as string | null) ?? null,
    notice: (raw.notice as string | null) ?? null,
    attachment_url: (raw.attachment_url as string | null) ?? null,
    status,
    created_at: String(raw.created_at ?? ""),
    updated_at: (raw.updated_at as string | null) ?? null,
    created_by: (raw.created_by as string | null) ?? null,
  };
}

// --- 심사위원 (recruitment_judges) ---
export const JUDGE_TYPES = ["internal", "external"] as const;
export type JudgeType = (typeof JUDGE_TYPES)[number];

export const JUDGE_TYPE_LABEL: Record<JudgeType, string> = {
  internal: "내부위원",
  external: "외부위원",
};

// DB CHECK 제약:
//   internal → driver_id NOT NULL & external_pool_id NULL
//   external → external_pool_id NOT NULL & driver_id NULL
export type Judge = {
  id: string;
  posting_id: string;
  name: string;
  role: string;
  affiliation: string | null;
  judge_type: JudgeType;
  driver_id: string | null;
  external_pool_id: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
};

export function normalizeJudge(raw: Record<string, unknown>): Judge {
  const t = String(raw.judge_type ?? "internal");
  const judge_type: JudgeType = (JUDGE_TYPES as readonly string[]).includes(t)
    ? (t as JudgeType)
    : "internal";
  return {
    id: String(raw.id ?? ""),
    posting_id: String(raw.posting_id ?? ""),
    name: String(raw.name ?? ""),
    role: String(raw.role ?? ""),
    affiliation: (raw.affiliation as string | null) ?? null,
    judge_type,
    driver_id: (raw.driver_id as string | null) ?? null,
    external_pool_id: (raw.external_pool_id as string | null) ?? null,
    is_active: raw.is_active !== false,
    display_order: raw.display_order == null ? 0 : Number(raw.display_order),
    created_at: String(raw.created_at ?? ""),
    updated_at: (raw.updated_at as string | null) ?? null,
    created_by: (raw.created_by as string | null) ?? null,
  };
}

// --- 외부위원 마스터 (external_judges_pool) ---
// 외부위원은 풀에 한 번 등록해두고, 각 공고에 재사용. 등록 시 phone 은 11자리 숫자만.
// 공고에 배정될 때 recruitment_judges.name/affiliation 으로 스냅샷 복사됨.
export type ExternalJudge = {
  id: string;
  name: string;
  phone: string;
  affiliation: string;
  default_role: string;
  notes: string | null;
  privacy_agreed_at: string | null;
  privacy_agreed_by: string | null;
  is_active: boolean;
  // 도장(서명) 이미지 경로 — hr-documents 버킷 path(공개 URL 아님). 없으면 null.
  stamp_path: string | null;
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
};

export function normalizeExternalJudge(
  raw: Record<string, unknown>
): ExternalJudge {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    phone: String(raw.phone ?? ""),
    affiliation: String(raw.affiliation ?? ""),
    default_role: String(raw.default_role ?? "외부위원"),
    notes: (raw.notes as string | null) ?? null,
    privacy_agreed_at: (raw.privacy_agreed_at as string | null) ?? null,
    privacy_agreed_by: (raw.privacy_agreed_by as string | null) ?? null,
    is_active: raw.is_active !== false,
    stamp_path: (raw.stamp_path as string | null) ?? null,
    created_at: String(raw.created_at ?? ""),
    updated_at: (raw.updated_at as string | null) ?? null,
    created_by: (raw.created_by as string | null) ?? null,
  };
}

// --- 채점 옵션 공용 타입 ---
export type ScoreOption = { label: string; value: number };

// =====================================================================
// 서류 채점 (recruitment_document_scores) — 1명이 채점, 만점 35점
// =====================================================================
export const DOCUMENT_SCORE_MAX = 35;

export const SCORE_DEGREE_OPTIONS: readonly ScoreOption[] = [
  { label: "박사", value: 5 },
  { label: "석사", value: 3 },
  { label: "학사", value: 2 },
  { label: "전문학사", value: 1 },
] as const;

export const SCORE_GRADE_OPTIONS: readonly ScoreOption[] = [
  { label: "4.5 ~ 4.0", value: 5 },
  { label: "3.9 ~ 3.5", value: 3 },
  { label: "3.4 ~ 3.0", value: 2 },
  { label: "2.9 ~ 2.5", value: 1 },
] as const;

export const SCORE_YOUTH_LICENSE_OPTIONS: readonly ScoreOption[] = [
  { label: "1급", value: 5 },
  { label: "2급", value: 4 },
  { label: "3급", value: 2 },
] as const;

export const SCORE_OTHER_LICENSE_OPTIONS: readonly ScoreOption[] = [
  { label: "3개 이상", value: 5 },
  { label: "2개 이상", value: 4 },
  { label: "1개 이상", value: 2 },
] as const;

export const SCORE_SELF_INTRO_OPTIONS: readonly ScoreOption[] = [
  { label: "우수", value: 10 },
  { label: "보통", value: 5 },
  { label: "미흡", value: 3 },
] as const;

export const SCORE_QUALITATIVE_OPTIONS: readonly ScoreOption[] = [
  { label: "우수", value: 5 },
  { label: "보통", value: 3 },
  { label: "미흡", value: 1 },
] as const;

export const DOCUMENT_SCORE_OPTIONS = {
  degree: SCORE_DEGREE_OPTIONS,
  grade: SCORE_GRADE_OPTIONS,
  youth_license: SCORE_YOUTH_LICENSE_OPTIONS,
  other_license: SCORE_OTHER_LICENSE_OPTIONS,
  self_intro: SCORE_SELF_INTRO_OPTIONS,
  qualitative: SCORE_QUALITATIVE_OPTIONS,
} as const;

// UI 라벨 — 폼/대시보드에서 컬럼 헤더로 사용
export const DOCUMENT_SCORE_LABEL = {
  degree: "학위",
  grade: "성적",
  youth_license: "청소년지도사",
  other_license: "국가자격증",
  self_intro: "자기소개서",
  qualitative: "정성평가",
} as const;

export type DocumentScore = {
  id: string;
  application_id: string;
  judge_id: string;
  score_degree: number | null;
  score_grade: number | null;
  score_youth_license: number | null;
  score_other_license: number | null;
  score_self_intro: number | null;
  score_qualitative: number | null;
  total_score: number | null;
  is_disqualified: boolean;
  disqualified_reason: string | null;
  memo: string | null;
  signed_at: string | null;
  created_at: string;
  updated_at: string | null;
};

export function normalizeDocumentScore(
  raw: Record<string, unknown>
): DocumentScore {
  const num = (k: string): number | null =>
    raw[k] == null ? null : Number(raw[k]);
  return {
    id: String(raw.id ?? ""),
    application_id: String(raw.application_id ?? ""),
    judge_id: String(raw.judge_id ?? ""),
    score_degree: num("score_degree"),
    score_grade: num("score_grade"),
    score_youth_license: num("score_youth_license"),
    score_other_license: num("score_other_license"),
    score_self_intro: num("score_self_intro"),
    score_qualitative: num("score_qualitative"),
    total_score: num("total_score"),
    is_disqualified: raw.is_disqualified === true,
    disqualified_reason: (raw.disqualified_reason as string | null) ?? null,
    memo: (raw.memo as string | null) ?? null,
    signed_at: (raw.signed_at as string | null) ?? null,
    created_at: String(raw.created_at ?? ""),
    updated_at: (raw.updated_at as string | null) ?? null,
  };
}

// =====================================================================
// 면접 채점 (recruitment_interview_scores) — 위원별 × 지원자별, 만점 65점
// =====================================================================
export const INTERVIEW_SCORE_MAX = 65;

export const SCORE_UNDERSTANDING_OPTIONS: readonly ScoreOption[] = [
  { label: "매우적합", value: 20 },
  { label: "적합", value: 15 },
  { label: "양호", value: 10 },
  { label: "보통", value: 5 },
] as const;

// 자질·인생관 / 성실성 / 적극성 — 동일 척도(15/12/9/6) · 동일 라벨.
// PDF 원본 면접 심사표에 4개 항목 모두 매우적합/적합/양호/보통 으로 통일돼 있음.
export const SCORE_APTITUDE_OPTIONS: readonly ScoreOption[] = [
  { label: "매우적합", value: 15 },
  { label: "적합", value: 12 },
  { label: "양호", value: 9 },
  { label: "보통", value: 6 },
] as const;

export const SCORE_SINCERITY_OPTIONS: readonly ScoreOption[] = [
  { label: "매우적합", value: 15 },
  { label: "적합", value: 12 },
  { label: "양호", value: 9 },
  { label: "보통", value: 6 },
] as const;

export const SCORE_INITIATIVE_OPTIONS: readonly ScoreOption[] = [
  { label: "매우적합", value: 15 },
  { label: "적합", value: 12 },
  { label: "양호", value: 9 },
  { label: "보통", value: 6 },
] as const;

export const INTERVIEW_SCORE_OPTIONS = {
  understanding: SCORE_UNDERSTANDING_OPTIONS,
  aptitude: SCORE_APTITUDE_OPTIONS,
  sincerity: SCORE_SINCERITY_OPTIONS,
  initiative: SCORE_INITIATIVE_OPTIONS,
} as const;

export const INTERVIEW_SCORE_LABEL = {
  understanding: "운영이해도",
  aptitude: "자질·인생관",
  sincerity: "성실성",
  initiative: "적극성",
} as const;

export type InterviewScore = {
  id: string;
  application_id: string;
  judge_id: string;
  score_understanding: number | null;
  score_aptitude: number | null;
  score_sincerity: number | null;
  score_initiative: number | null;
  total_score: number | null;
  is_absent: boolean;
  memo: string | null;
  signed_at: string | null;
  created_at: string;
  updated_at: string | null;
};

export function normalizeInterviewScore(
  raw: Record<string, unknown>
): InterviewScore {
  const num = (k: string): number | null =>
    raw[k] == null ? null : Number(raw[k]);
  return {
    id: String(raw.id ?? ""),
    application_id: String(raw.application_id ?? ""),
    judge_id: String(raw.judge_id ?? ""),
    score_understanding: num("score_understanding"),
    score_aptitude: num("score_aptitude"),
    score_sincerity: num("score_sincerity"),
    score_initiative: num("score_initiative"),
    total_score: num("total_score"),
    is_absent: raw.is_absent === true,
    memo: (raw.memo as string | null) ?? null,
    signed_at: (raw.signed_at as string | null) ?? null,
    created_at: String(raw.created_at ?? ""),
    updated_at: (raw.updated_at as string | null) ?? null,
  };
}

// =====================================================================
// 면접 일정 (recruitment_interview_schedule)
// =====================================================================
export type InterviewSchedule = {
  id: string;
  application_id: string;
  interview_at: string;
  location: string | null;
  display_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
};

export function normalizeInterviewSchedule(
  raw: Record<string, unknown>
): InterviewSchedule {
  return {
    id: String(raw.id ?? ""),
    application_id: String(raw.application_id ?? ""),
    interview_at: String(raw.interview_at ?? ""),
    location: (raw.location as string | null) ?? null,
    display_order: raw.display_order == null ? 0 : Number(raw.display_order),
    notes: (raw.notes as string | null) ?? null,
    created_at: String(raw.created_at ?? ""),
    updated_at: (raw.updated_at as string | null) ?? null,
  };
}
