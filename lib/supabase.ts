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
