// =====================================================================
// 직원 상조회 — 규정 금액표·계산 헬퍼. MU-1~MU-4
//   * 15년치 엑셀 장부를 디지털화한 모듈. 회장이 교체되는 자치 조직이므로
//     전용 직무 'mutual' 로 접근을 분리한다(lib/mutualAccess).
//   * 순수 모듈(DB·@/ 의존 없음) — 액션·화면·엑셀 빌더가 모두 이 표를 공유한다.
//   * 금액은 원 단위 정수. 프리셋으로 자동 계산하되 화면에서 담당이 수정할 수
//     있게 한다(미납·실비 정산 등 예외가 매년 생기는 장부다).
// =====================================================================

export type MutualKind = "income" | "expense";
export type MutualMemberStatus = "active" | "paused" | "left";

export const MUTUAL_MEMBER_STATUS_LABEL: Record<MutualMemberStatus, string> = {
  active: "활동",
  paused: "일시정지",
  left: "탈퇴",
};
export function normalizeMemberStatus(v: unknown): MutualMemberStatus {
  return v === "paused" ? "paused" : v === "left" ? "left" : "active";
}

// --- 회비 ------------------------------------------------------------
// 월 회비(급여공제). 월 기입액 = 그 달 active 회원 수 × FEE.
export const MUTUAL_FEE = 15_000;

export function monthlyFeeAmount(activeMembers: number): number {
  return Math.max(0, Math.round(activeMembers)) * MUTUAL_FEE;
}
export function monthlyFeeDescription(month: number, members: number): string {
  return `${month}월 상조회비 (회원 ${members}명)`;
}

// =====================================================================
// 금액 산정 방식
// =====================================================================
export type MutualAmountRule =
  // 정액.
  | { type: "fixed"; amount: number }
  // 인원 × 단가(생일간식비·연말상여).
  | { type: "per_head"; unit: number }
  // 출산 축하금 — 차수 + 산정방식.
  | { type: "childbirth"; base: number }
  // 퇴사지원금 — 근속 구간표(구간 불명이면 직접 입력).
  | { type: "tier" }
  // 자유 입력(케이크 실비·화환·환급 등).
  | { type: "free" };

export type MutualCategory = {
  key: string;
  kind: MutualKind;
  label: string;
  rule: MutualAmountRule;
  // 대상 직원을 고르면 적요를 자동 생성한다. {name} 치환.
  descriptionTemplate?: string;
  note?: string;
};

// --- 출산 축하금 -----------------------------------------------------
//   지시문의 규정이 두 가지로 읽혀(“100,000 × 출산차수” vs “매 출산 두 배 증액”)
//   두 방식을 모두 두고 담당이 화면에서 고르게 했다. 1·2차는 결과가 같고
//   3차부터 갈린다(30만 vs 40만). 규정이 확정되면 한쪽을 지우면 된다.
export type ChildbirthMethod = "linear" | "double";
export const CHILDBIRTH_METHOD_LABEL: Record<ChildbirthMethod, string> = {
  linear: "차수 비례 (100,000 × 차수)",
  double: "두 배 증액 (100,000 × 2^(차수-1))",
};
// 두 배 증액이 폭주하지 않도록 차수 상한을 둔다(8차 = 1,280만).
const CHILDBIRTH_MAX_ORDER = 8;

export function childbirthAmount(
  order: number,
  method: ChildbirthMethod,
  base = 100_000
): number {
  const n = Math.min(
    CHILDBIRTH_MAX_ORDER,
    Math.max(1, Math.round(Number(order) || 1))
  );
  return method === "double" ? base * 2 ** (n - 1) : base * n;
}

// --- 생일간식비 ------------------------------------------------------
//   당일 근무인원 × 5,000. 같은 날 생일자가 2인 이상이면 생일자 수만큼 배수
//   (“동일 생일 2인 이상 시 인원당 5,000 추가” 옵션).
export const SNACK_UNIT = 5_000;
export function birthdaySnackAmount(
  workingCount: number,
  birthdayCount = 1
): number {
  const n = Math.max(0, Math.round(Number(workingCount) || 0));
  const b = Math.max(1, Math.round(Number(birthdayCount) || 1));
  return n * SNACK_UNIT * b;
}

// --- 퇴사지원금 ------------------------------------------------------
//   지시문에 "1년 이상~ 50,000 등"만 주어져 구간표 전체가 확정되지 않았다.
//   확인된 구간만 상수로 두고, 나머지는 담당이 직접 입력한다(지시문 지시).
export type RetirementTier = {
  key: string;
  label: string;
  minYears: number;
  amount: number;
};
export const RETIREMENT_TIERS: RetirementTier[] = [
  { key: "y1", label: "1년 이상", minYears: 1, amount: 50_000 },
];
export function retirementTier(key: string): RetirementTier | null {
  return RETIREMENT_TIERS.find((t) => t.key === key) ?? null;
}

// 향후 며칠 내 생일을 배너·Cron 알림에 띄우는지(MU-3).
export const BIRTHDAY_AHEAD_DAYS = 7;

// 연말상여 — 1인당.
export const YEAR_END_BONUS_UNIT = 50_000;
// 연말상여 제안 조건 — 12월 1일 기준 잔액이 이 금액 이상일 때.
export const YEAR_END_BONUS_MIN_BALANCE = 2_000_000;

// =====================================================================
// 규정 금액표 — 화면 프리셋의 단일 출처.
// =====================================================================
export const MUTUAL_RULES: MutualCategory[] = [
  // --- 세입 ---
  {
    key: "fee",
    kind: "income",
    label: "상조회비",
    rule: { type: "fixed", amount: MUTUAL_FEE },
    note: "월 15,000 급여공제. [월 회비 기입] 버튼이 회원 수로 자동 계산합니다.",
  },
  {
    key: "interest",
    kind: "income",
    label: "이자",
    rule: { type: "free" },
    note: "통장 이자 — 월말 담당 입력.",
  },
  {
    key: "cashback",
    kind: "income",
    label: "캐시백",
    rule: { type: "free" },
  },
  {
    key: "income_etc",
    kind: "income",
    label: "기타 세입",
    rule: { type: "free" },
    note: "환급·반환 등.",
  },

  // --- 세출 ---
  {
    key: "birthday_cash",
    kind: "expense",
    label: "생일 축하금",
    rule: { type: "fixed", amount: 60_000 },
    descriptionTemplate: "{name} 생일 축하금",
  },
  {
    key: "birthday_snack",
    kind: "expense",
    label: "생일 간식비",
    rule: { type: "per_head", unit: SNACK_UNIT },
    descriptionTemplate: "{name} 생일 간식비",
    note: "당일 근무인원 × 5,000. 같은 날 생일자가 여러 명이면 생일자 수만큼 배수.",
  },
  {
    key: "marriage",
    kind: "expense",
    label: "결혼 축하금(본인)",
    rule: { type: "fixed", amount: 300_000 },
    descriptionTemplate: "{name} 결혼 축하금",
  },
  {
    key: "death_self_spouse",
    kind: "expense",
    label: "조의금(본인·배우자)",
    rule: { type: "fixed", amount: 300_000 },
    descriptionTemplate: "{name} 조의금(본인·배우자)",
  },
  {
    key: "death_parent",
    kind: "expense",
    label: "조의금(부모·배우자 부모)",
    rule: { type: "fixed", amount: 200_000 },
    descriptionTemplate: "{name} 조의금(부모)",
  },
  {
    key: "death_child",
    kind: "expense",
    label: "조의금(자녀)",
    rule: { type: "fixed", amount: 200_000 },
    descriptionTemplate: "{name} 조의금(자녀)",
  },
  {
    key: "death_sibling",
    kind: "expense",
    label: "조의금(형제자매)",
    rule: { type: "fixed", amount: 100_000 },
    descriptionTemplate: "{name} 조의금(형제자매)",
  },
  {
    key: "childbirth",
    kind: "expense",
    label: "출산 축하금",
    rule: { type: "childbirth", base: 100_000 },
    descriptionTemplate: "{name} 출산 축하금",
    note: "출산차수를 입력하세요. 산정방식(차수 비례 / 두 배 증액)은 규정 확인 후 선택합니다.",
  },
  {
    key: "retirement",
    kind: "expense",
    label: "퇴사지원금",
    rule: { type: "tier" },
    descriptionTemplate: "{name} 퇴사지원금",
    note: "근속 구간을 고르면 금액이 채워집니다. 구간표에 없으면 직접 입력하세요.",
  },
  {
    key: "year_end_bonus",
    kind: "expense",
    label: "연말 상여",
    rule: { type: "per_head", unit: YEAR_END_BONUS_UNIT },
    note: "회원 1인당 50,000. 잔액이 넉넉한 해에 총회 의결로 지급합니다.",
  },
  {
    key: "expense_etc",
    kind: "expense",
    label: "기타 세출",
    rule: { type: "free" },
    note: "케이크 실비·화환·환급 등 자유 입력.",
  },
];

export function mutualCategory(key: string): MutualCategory | null {
  return MUTUAL_RULES.find((c) => c.key === key) ?? null;
}
export function mutualCategoryLabel(key: string): string {
  return mutualCategory(key)?.label ?? key;
}
export function mutualCategories(kind: MutualKind): MutualCategory[] {
  return MUTUAL_RULES.filter((c) => c.kind === kind);
}
export function normalizeKind(v: unknown): MutualKind {
  return v === "expense" ? "expense" : "income";
}

// 적요 자동 생성 — 대상 직원이 있고 템플릿이 있으면 치환, 없으면 카테고리 라벨.
export function buildDescription(
  categoryKey: string,
  employeeName: string | null
): string {
  const c = mutualCategory(categoryKey);
  if (!c) return "";
  if (c.descriptionTemplate && employeeName)
    return c.descriptionTemplate.replace("{name}", employeeName);
  return c.label;
}

// =====================================================================
// 장부 집계
// =====================================================================
export type LedgerEntryLike = {
  entry_date: string; // YYYY-MM-DD
  kind: MutualKind;
  amount: number;
};

export function isYmd(v: unknown): boolean {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
export function yearOf(entryDate: string): number {
  return Number(entryDate.slice(0, 4));
}
export function monthOf(entryDate: string): number {
  return Number(entryDate.slice(5, 7));
}

export type MutualTotals = {
  income: number;
  expense: number;
  net: number; // 세입 − 세출
};

export function sumEntries(entries: LedgerEntryLike[]): MutualTotals {
  let income = 0;
  let expense = 0;
  for (const e of entries) {
    const amt = Math.round(Number(e.amount) || 0);
    if (e.kind === "expense") expense += amt;
    else income += amt;
  }
  return { income, expense, net: income - expense };
}

// 월별 소계(1~12월). 그 달에 아무 것도 없으면 0.
export type MonthlyTotals = { month: number } & MutualTotals;
export function monthlyTotals(entries: LedgerEntryLike[]): MonthlyTotals[] {
  const rows: MonthlyTotals[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    income: 0,
    expense: 0,
    net: 0,
  }));
  for (const e of entries) {
    const m = monthOf(e.entry_date);
    if (m < 1 || m > 12) continue;
    const bucket = rows[m - 1];
    const amt = Math.round(Number(e.amount) || 0);
    if (e.kind === "expense") bucket.expense += amt;
    else bucket.income += amt;
  }
  for (const r of rows) r.net = r.income - r.expense;
  return rows;
}

// 잔액 = 이월 + 세입 − 세출.
export function closingBalance(carryOver: number, totals: MutualTotals): number {
  return Math.round(carryOver) + totals.net;
}

// 그 달에 이미 회비가 기입됐는지(중복 기입 방지).
export function hasFeeForMonth(
  entries: { entry_date: string; category: string; kind: MutualKind }[],
  year: number,
  month: number
): boolean {
  return entries.some(
    (e) =>
      e.kind === "income" &&
      e.category === "fee" &&
      yearOf(e.entry_date) === year &&
      monthOf(e.entry_date) === month
  );
}

export function formatKRW(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "-";
  return Math.round(Number(n)).toLocaleString("ko-KR");
}

// =====================================================================
// 생일 — MU-3 알림·장부 배너 공용.
//   생년월일에서 월·일만 본다(연도 무시). 오늘부터 aheadDays 일 이내.
// =====================================================================
export type BirthdaySoon = {
  name: string;
  birthDate: string; // 원본 YYYY-MM-DD
  monthDay: string; // "2/24"
  dday: number; // 0 = 오늘
};

// today·birthDate 모두 YYYY-MM-DD. 윤년 2/29 생일은 평년에 3/1 로 옮기지 않고
// 다음 윤년까지 기다린다(임의로 날짜를 바꿔 축하금을 잘못 잡지 않기 위해).
//   → 그래서 올해·내년만 보면 2/29 가 null 이 된다. 다음 윤년이 잡히도록
//     8년까지 훑는다(7일 배너에서는 어차피 범위 밖으로 걸러진다).
const BIRTHDAY_SCAN_YEARS = 8;

export function daysUntilBirthday(
  birthDate: string,
  today: string
): number | null {
  if (!isYmd(birthDate) || !isYmd(today)) return null;
  const bm = Number(birthDate.slice(5, 7));
  const bd = Number(birthDate.slice(8, 10));
  const ty = Number(today.slice(0, 4));
  const t = Date.UTC(ty, Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));

  // 오늘 이후로 가장 가까운 생일.
  for (let i = 0; i <= BIRTHDAY_SCAN_YEARS; i++) {
    const y = ty + i;
    const d = new Date(Date.UTC(y, bm - 1, bd));
    // 존재하지 않는 날짜(2/29 평년)는 Date 가 3/1 로 넘긴다 → 그 해는 건너뛴다.
    if (d.getUTCMonth() !== bm - 1) continue;
    const diff = Math.round((d.getTime() - t) / 86_400_000);
    if (diff >= 0) return diff;
  }
  return null;
}

export function birthdaysWithin(
  members: { name: string; birthDate: string | null }[],
  today: string,
  aheadDays: number
): BirthdaySoon[] {
  const out: BirthdaySoon[] = [];
  for (const m of members) {
    if (!m.birthDate) continue;
    const dday = daysUntilBirthday(m.birthDate, today);
    if (dday == null || dday > aheadDays) continue;
    out.push({
      name: m.name,
      birthDate: m.birthDate,
      monthDay: `${Number(m.birthDate.slice(5, 7))}/${Number(
        m.birthDate.slice(8, 10)
      )}`,
      dday,
    });
  }
  return out.sort((a, b) => a.dday - b.dday || a.name.localeCompare(b.name, "ko"));
}
