// =====================================================================
// 청소년수련시설 안전점검 공용 타입·상수·헬퍼 — /hr/facility/safety
//   * DB: safety_check_items(법정 67항목) / safety_checks(월별 헤더, unique
//     check_year+check_month) / safety_check_results(항목별 pass/fail/na + note).
//   * RLS 0개 → service_role. 접근=facilityAccess(시설 직무 또는 M0).
// =====================================================================

export type SafetyResult = "pass" | "fail" | "na";

export const SAFETY_RESULTS: { value: SafetyResult; label: string }[] = [
  { value: "pass", label: "적합" },
  { value: "fail", label: "부적합" },
  { value: "na", label: "해당없음" },
];
export const SAFETY_RESULT_LABEL: Record<SafetyResult, string> = {
  pass: "적합",
  fail: "부적합",
  na: "해당없음",
};

export type SafetyCheckStatus = "draft" | "completed";

export type SafetyCheckItem = {
  id: string;
  section: string; // 부문(토목/건축/안전관리체계…)
  category: string; // 구분
  item_no: number;
  content: string; // 점검 항목
  sort_order: number;
  default_na: boolean;
  is_active: boolean;
};

export type SafetyCheck = {
  id: string;
  check_year: number;
  check_month: number;
  status: SafetyCheckStatus;
  inspector: string | null;
  checked_on: string | null; // 점검일시(YYYY-MM-DD)
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type SafetyResultRow = {
  id: string;
  check_id: string;
  item_id: string;
  result: SafetyResult;
  note: string | null;
};

// 항목 + 해당 점검의 결과(상세 화면·PDF 공용).
export type SafetyItemWithResult = SafetyCheckItem & {
  result: SafetyResult;
  note: string | null;
};

// --- 정규화 ----------------------------------------------------------
function toResult(v: unknown): SafetyResult {
  return v === "fail" ? "fail" : v === "na" ? "na" : "pass";
}
export function toSafetyItem(raw: Record<string, unknown>): SafetyCheckItem {
  return {
    id: String(raw.id ?? ""),
    section: String(raw.section ?? ""),
    category: String(raw.category ?? ""),
    item_no: Number(raw.item_no ?? 0),
    content: String(raw.content ?? ""),
    sort_order: Number(raw.sort_order ?? 0),
    default_na: raw.default_na === true,
    is_active: raw.is_active !== false,
  };
}
export function toSafetyCheck(raw: Record<string, unknown>): SafetyCheck {
  return {
    id: String(raw.id ?? ""),
    check_year: Number(raw.check_year ?? 0),
    check_month: Number(raw.check_month ?? 0),
    status: raw.status === "completed" ? "completed" : "draft",
    inspector: (raw.inspector as string | null) ?? null,
    checked_on: (raw.checked_on as string | null) ?? null,
    created_by: (raw.created_by as string | null) ?? null,
    created_at: (raw.created_at as string | null) ?? null,
    updated_at: (raw.updated_at as string | null) ?? null,
  };
}
export function toSafetyResultRow(raw: Record<string, unknown>): SafetyResultRow {
  return {
    id: String(raw.id ?? ""),
    check_id: String(raw.check_id ?? ""),
    item_id: String(raw.item_id ?? ""),
    result: toResult(raw.result),
    note: (raw.note as string | null) ?? null,
  };
}

// 항목 정렬 — sort_order → item_no. (부문>구분>번호 순으로 세팅돼 있음)
export function sortSafetyItems<T extends { sort_order: number; item_no: number }>(
  items: T[]
): T[] {
  return [...items].sort(
    (a, b) => a.sort_order - b.sort_order || a.item_no - b.item_no
  );
}

// 부문>구분으로 그룹화(정렬된 항목 기준, 등장 순서 유지).
export type SafetyGroup = {
  section: string;
  categories: { category: string; items: SafetyItemWithResult[] }[];
};
export function groupSafetyItems(items: SafetyItemWithResult[]): SafetyGroup[] {
  const sorted = sortSafetyItems(items);
  const sections: SafetyGroup[] = [];
  for (const it of sorted) {
    let sec = sections.find((s) => s.section === it.section);
    if (!sec) {
      sec = { section: it.section, categories: [] };
      sections.push(sec);
    }
    let cat = sec.categories.find((c) => c.category === it.category);
    if (!cat) {
      cat = { category: it.category, items: [] };
      sec.categories.push(cat);
    }
    cat.items.push(it);
  }
  return sections;
}

// 연월 표기.
export function ymLabel(year: number, month: number): string {
  return `${year}년 ${month}월`;
}
