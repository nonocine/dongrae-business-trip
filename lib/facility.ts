// =====================================================================
// 시설관리(비품관리) 공용 타입·상수·헬퍼 — /hr/facility
//   * DB: facility_assets / facility_locations (RLS 0개 → service_role 경유).
//   * amount(=unit_price*quantity), disposal_scheduled_on(=acquired_on+내용연수)
//     은 DB GENERATED 컬럼 → INSERT/UPDATE 시 절대 넣지 않습니다.
//   * 급여(lib/salary.ts)·의무교육(lib/trainings.ts) 과 동일하게 기능별 lib 파일에
//     타입/상수/순수 헬퍼를 모읍니다.
// =====================================================================

// --- 상수(드롭다운) ---------------------------------------------------
export const UNIT_OPTIONS = ["개", "대", "식", "조", "세트", "M"] as const;
export const BUDGET_SOURCES = [
  "지자체",
  "보조금",
  "운영비",
  "이전 물품",
  "자부담",
  "기타",
] as const;

// 취득구분 — DB acquisition_type(text, 기본 '구매').
export const ACQUISITION_TYPES = ["구매", "관리전환"] as const;
export type AcquisitionType = (typeof ACQUISITION_TYPES)[number];

export type AssetStatus = "all" | "active" | "disposed";
export const ASSET_STATUS_OPTIONS: { value: AssetStatus; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "active", label: "사용중" },
  { value: "disposed", label: "불용" },
];

// --- 타입 -------------------------------------------------------------
export type FacilityAsset = {
  id: string;
  acquired_on: string | null; // 취득일자 YYYY-MM-DD
  item_name: string; // 품목
  spec: string | null; // 규격
  location: string | null; // 설치장소(facility_locations.name 문자열)
  unit: string | null; // 단위
  quantity: number; // 수량
  unit_price: number; // 단가
  amount: number; // 금액 = unit_price*quantity (DB GENERATED)
  useful_life_years: number | null; // 내용연수(년)
  disposal_scheduled_on: string | null; // 폐기예정일 (DB GENERATED)
  budget_source: string | null; // 예산출처
  acquisition_type: AcquisitionType; // 취득구분(구매/관리전환)
  is_registered: boolean; // 물품등록 여부
  disposed_on: string | null; // 불용(폐기)일자 — null 이면 사용중
  classification_no: string | null; // 분류번호
  note: string | null; // 비고
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type FacilityLocation = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string | null;
};

// 등록/수정 입력 — GENERATED(amount·disposal_scheduled_on)·created_by 제외.
export type AssetInput = {
  acquired_on: string | null;
  item_name: string;
  spec: string | null;
  location: string | null;
  unit: string | null;
  quantity: number;
  unit_price: number;
  useful_life_years: number | null;
  budget_source: string | null;
  acquisition_type: AcquisitionType;
  note: string | null;
};

// 목록 필터 — 조합 가능. year 는 취득일 기준 연도.
export type AssetFilters = {
  year?: number | "all";
  location?: string | "all";
  budget_source?: string | "all";
  acquisition_type?: AcquisitionType | "all";
  status?: AssetStatus;
  q?: string; // 품목·규격 부분일치
};

// --- 정규화(DB row → 타입) --------------------------------------------
function str(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s.length > 0 ? s : null;
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function intOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function toFacilityAsset(raw: Record<string, unknown>): FacilityAsset {
  return {
    id: String(raw.id ?? ""),
    acquired_on: str(raw.acquired_on),
    item_name: String(raw.item_name ?? ""),
    spec: str(raw.spec),
    location: str(raw.location),
    unit: str(raw.unit),
    quantity: num(raw.quantity),
    unit_price: num(raw.unit_price),
    amount: num(raw.amount),
    useful_life_years: intOrNull(raw.useful_life_years),
    disposal_scheduled_on: str(raw.disposal_scheduled_on),
    budget_source: str(raw.budget_source),
    acquisition_type: raw.acquisition_type === "관리전환" ? "관리전환" : "구매",
    is_registered: raw.is_registered === true,
    disposed_on: str(raw.disposed_on),
    classification_no: str(raw.classification_no),
    note: str(raw.note),
    created_by: str(raw.created_by),
    created_at: str(raw.created_at),
    updated_at: str(raw.updated_at),
  };
}

export function toFacilityLocation(
  raw: Record<string, unknown>
): FacilityLocation {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    sort_order: num(raw.sort_order),
    is_active: raw.is_active !== false,
    created_at: str(raw.created_at),
  };
}

// --- 순수 계산 헬퍼 ----------------------------------------------------
// 미리보기용 — DB GENERATED 와 동일 식(저장값은 DB 계산 사용).
export function calcAmount(unitPrice: number, quantity: number): number {
  return Math.round((Number(unitPrice) || 0) * (Number(quantity) || 0));
}

// 취득일 + 내용연수(년) → 폐기예정일 YYYY-MM-DD (미리보기용).
export function calcDisposalScheduled(
  acquiredOn: string | null,
  usefulLifeYears: number | null
): string | null {
  if (!acquiredOn || usefulLifeYears == null) return null;
  const m = acquiredOn.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]) + Math.round(usefulLifeYears);
  return `${y}-${m[2]}-${m[3]}`;
}

// 천단위 콤마(정수 원). null/NaN → "".
export function formatNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "";
  return Math.round(Number(n)).toLocaleString("ko-KR");
}

// target(YYYY-MM-DD)까지 남은 일수. 양수=남음, 0=오늘, 음수=지남. 없으면 null.
//   * todayYmd 는 서버에서 계산해 넘겨 하이드레이션 불일치를 막습니다.
const MS_PER_DAY = 86_400_000;
export function daysUntilYmd(
  target: string | null,
  todayYmd: string
): number | null {
  if (!target) return null;
  const d = Date.parse(`${target}T00:00:00Z`);
  const t = Date.parse(`${todayYmd}T00:00:00Z`);
  if (Number.isNaN(d) || Number.isNaN(t)) return null;
  return Math.round((d - t) / MS_PER_DAY);
}

// 내용연수 배지 — 폐기예정일(disposal_scheduled_on) 대비 오늘.
//   * 불용(disposed_on) 있으면 '불용'(회색)으로 대체.
//   * 지남 → '만료'(빨강), 6개월(183일) 이내 → '임박(D-일수)'(주황), 그 외 정상(회색).
//   * 폐기예정일 없음(내용연수 미입력 등) → 'none'.
export type LifeBadgeKind =
  | "disposed"
  | "expired"
  | "soon"
  | "normal"
  | "none";
export type LifeBadge = { kind: LifeBadgeKind; label: string; dday: number | null };

export const LIFE_SOON_DAYS = 183; // 약 6개월

export function lifeBadge(asset: FacilityAsset, todayYmd: string): LifeBadge {
  if (asset.disposed_on) return { kind: "disposed", label: "불용", dday: null };
  const dday = daysUntilYmd(asset.disposal_scheduled_on, todayYmd);
  if (dday == null) return { kind: "none", label: "—", dday: null };
  if (dday < 0) return { kind: "expired", label: "만료", dday };
  if (dday <= LIFE_SOON_DAYS)
    return { kind: "soon", label: `임박(D-${dday})`, dday };
  return { kind: "normal", label: "정상", dday };
}
