// =====================================================================
// 연봉계약서 — 계산·조항·문장 조립 (순수 모듈, 클라이언트에서도 씀)
//   * 노미현 부장 요청 두 번째 건(2026-10). 흐름(보내기·서명·센터장 서명·PDF·교부)은
//     근로계약서와 같은 lib/contractServer 를 씁니다. 여기는 연봉계약서 고유 부분만.
//   * 서식 = 2026년 실제 발급분(1~6항). 4~6항은 settings(CONTRACT_KINDS.salary.clausesKey)
//     에 두고 화면에서 고칩니다. 발송 시 그 시점 문구로 고정.
//
//   계산 규칙 — 2026년 실제 발급분 4명(한지형·김준호·박준우·노미현)과 대조해 확정.
//     · 단가는 salary_config / salary_grade_table 에서 읽습니다(하드코딩 금지).
//     · 기본급 단가 = 계약 시작일 기준 유효한 호봉표 발효분(pickEffectiveBase).
//       계약은 시작일에 맺으므로 8월 인상분 같은 연중 인상은 반영하지 않습니다
//       (실제 발급분이 12개월 내내 01-01 단가).
//     · 구간 = employee_salary_profiles 의 월 구간. 호봉·자격·급식/교통·관리업무
//       대상·가족수당이 같고 이어진 구간은 하나로 합칩니다(급여대장용으로 8월에 쪼갠 행 등).
//       수당 대상·금액은 급여 계산(lib/salary.calcMonthlyPayroll)과 같은 extra 에서 읽습니다.
//     · 수당 단가는 **달마다 그 달 값**입니다(2026-10 관장 원칙: 수당은 언제든 바뀔 수 있다).
//       salary_config 의 적용 시작 월(effective_month)을 lib/salary.salaryConfigForMonth 한
//       규칙으로 읽고, 값이 바뀌는 달에서 구간을 자동으로 나눕니다(splitSegmentsByConfig —
//       승급 구간과 함께). 이미 체결한 계약은 저장된 금액 그대로이고 다시 계산하지 않습니다.
//     · 급식비 = 달마다 meal_allowance 의 합
//     · 교통보조비 = 달마다 구간 급수의 월액 합 — 월별 급여와 같은 lib/salary.transportAllowanceKey
//       (1~2급/3~4급/5~6급/7급 → transport_allowance_12/34/56/7). 그 달에 급수 key 가 없으면
//       그 달의 일괄 transport_allowance. 근거("7급 120,000원/월 (8월~)")를 transport_basis 에.
//     · 자격수당 = 달마다 cert_allowance_{extra.cert_level} 의 합
//     · 관리업무수당 = 기본급(구간 합) × mgmt_allowance_rate, extra.mgmt_target 인 구간만,
//       10원 미만 절사. (2026-10: 처음엔 "1~4급"으로 판정했으나 급여 계산과 같은
//       mgmt_target 으로 맞춤 — 현재 데이터에선 대상자 같음: 노미현·허일수)
//     · 명절휴가비 = 설·추석 각각 월기본급 × (holiday_bonus_rate ÷ 2), 10원 미만 절사.
//       그 명절이 속한 달이 구간에 들어갈 때만 그 구간에 더합니다.
//       명절 날짜는 settings(SALARY_HOLIDAYS_KEY)에 연도별로 둡니다.
//     · 가족수당 = extra.family_allowance(월액) × 구간 개월 (2026-10 정정 — 처음엔
//       근거가 없다고 보고 화면 입력으로 뒀으나 급여설정에 구간별로 들어 있음).
//       연중에 생긴 가족수당(예: 9월부터)도 그대로 반영되므로, 계약 시점과 다르면
//       화면에서 구간을 고칩니다(김준호 호봉 건과 같은 성격).
//   ※ 비율 곱은 정수로 계산합니다 — 2,054,600 × 0.6 같은 부동소수 오차가 10원
//     절사에서 10원 차이를 만들기 때문입니다.
// =====================================================================

import {
  clauseLines,
  clauseText,
  fmtDot,
  lastDayOfMonth,
  periodLabel,
  workflowFields,
  type ContractBlock,
  type ContractStatus,
} from "./contractCore";
import {
  pickEffectiveBase,
  resolveTransportAllowance,
  salaryConfigForMonth,
  type ConfigValueRow,
} from "./salary";

export const SALARY_HOLIDAYS_KEY = "salary_contract_holidays";

export type CertLevel = "" | "1" | "2" | "3";

// 구간 입력(화면에서 고칠 수 있는 값). 금액은 서버가 다시 계산합니다.
export type SegmentInput = {
  start_month: number;
  end_month: number;
  grade: string;
  step: number;
  cert_level: CertLevel;
  meal: boolean;
  transport: boolean;
  mgmt_target?: boolean; // 관리업무수당 대상(extra.mgmt_target). 옛 저장분엔 없을 수 있음
  family_monthly: number;
  // 작성 중 단계에서 관장·부장이 직접 고친 항목 금액(구간 합계 기준, 원). 없으면 계산값.
  //   2026-10: 교통보조비 인상처럼 계산값과 실제 금액이 다를 때 — 고치면 사유가 note 에 남습니다.
  overrides?: SalaryOverrides;
};

// 직접 고칠 수 있는 항목(구간 합계 금액).
export const SALARY_AMOUNT_KEYS = ["base", "meal_amt", "cert", "transport_amt", "holiday", "family", "mgmt"] as const;
export type SalaryAmountKey = (typeof SALARY_AMOUNT_KEYS)[number];
export type SalaryOverrides = Partial<Record<SalaryAmountKey, number>>;
export const SALARY_AMOUNT_LABEL: Record<SalaryAmountKey, string> = {
  base: "기본급",
  meal_amt: "급식비",
  cert: "자격수당",
  transport_amt: "교통보조비",
  holiday: "명절휴가비",
  family: "가족수당",
  mgmt: "관리업무수당",
};

// 저장·계산 전에 고친 금액을 정리합니다 — 정한 항목만, 0 이상 정수만.
export function cleanOverrides(v: unknown): SalaryOverrides | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: SalaryOverrides = {};
  for (const k of SALARY_AMOUNT_KEYS) {
    const n = Number((v as Record<string, unknown>)[k]);
    if ((v as Record<string, unknown>)[k] != null && Number.isFinite(n) && n >= 0) out[k] = Math.round(n);
  }
  return Object.keys(out).length ? out : undefined;
}

export function hasOverrides(segs: { overrides?: SalaryOverrides }[]): boolean {
  return segs.some((s) => !!s.overrides && Object.keys(s.overrides).length > 0);
}

export type SalarySegment = SegmentInput & {
  months: number;
  monthly_base: number;
  base: number;
  meal_amt: number;
  cert: number;
  transport_amt: number;
  holiday: number;
  holidays: string[]; // 이 구간에 든 명절("설"/"추석")
  family: number;
  mgmt: number;
  total: number;
  computed?: SalaryOverrides; // 직접 고친 항목의 원래 계산값(화면 "계산값과 다름" 표시용)
  transport_basis?: string; // 교통보조비 근거 — "7급 120,000원/월 (8월~)"
};

export type HolidayDates = { seol: string | null; chuseok: string | null };
export type GradeRow = { grade: string; step: number; base_salary: number; effective_from: string };
// salary_config 그해 행들(적용 시작 월 포함). 달마다 값은 salaryConfigForMonth 로 고릅니다.
export type ConfigRows = ConfigValueRow[];

export type SalaryTotals = {
  base: number;
  meal: number;
  cert: number;
  transport: number;
  holiday: number;
  family: number;
  mgmt: number;
};

export type SalaryCalc = {
  year: number;
  period_start: string;
  period_end: string;
  months: number;
  segments: SalarySegment[];
  totals: SalaryTotals;
  total: number;
  holidayNames: string[];
  errors: string[];
};

const pad2 = (n: number) => String(n).padStart(2, "0");

// 비율(소수)을 1/100000 단위 정수로. 0.09 → 9000, 0.6 → 60000.
const rateInt = (r: number) => Math.round(r * 100000);
// amount × rate 를 10원 미만 절사(정수 연산).
export function floor10Rate(amount: number, rate: number): number {
  return Math.floor((amount * rateInt(rate)) / 1000000) * 10;
}

// "7급" → 7. 숫자를 못 읽으면 null.
export function gradeNumber(grade: string): number | null {
  const m = String(grade ?? "").match(/\d+/);
  return m ? Number(m[0]) : null;
}

// 급여설정 행 → 계약 구간. 같은 조건이 이어지면 합칩니다.
export function mergeProfileSegments(
  rows: {
    start_month: number;
    end_month: number;
    grade: string;
    step: number;
    extra?: {
      cert_level?: string | null;
      meal_target?: boolean | null;
      transport_target?: boolean | null;
      mgmt_target?: boolean | null;
      family_allowance?: number | string | null;
    } | null;
  }[]
): SegmentInput[] {
  const sorted = [...rows].sort((a, b) => a.start_month - b.start_month);
  const out: SegmentInput[] = [];
  for (const r of sorted) {
    const cert = (["1", "2", "3"].includes(String(r.extra?.cert_level ?? "")) ? String(r.extra?.cert_level) : "") as CertLevel;
    const seg: SegmentInput = {
      start_month: r.start_month,
      end_month: r.end_month,
      grade: r.grade,
      step: Number(r.step),
      cert_level: cert,
      meal: r.extra?.meal_target !== false,
      transport: r.extra?.transport_target !== false,
      mgmt_target: r.extra?.mgmt_target === true,
      family_monthly: Math.max(0, Math.round(Number(r.extra?.family_allowance) || 0)),
    };
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.end_month + 1 === seg.start_month &&
      prev.grade === seg.grade &&
      prev.step === seg.step &&
      prev.cert_level === seg.cert_level &&
      prev.meal === seg.meal &&
      prev.transport === seg.transport &&
      prev.mgmt_target === seg.mgmt_target &&
      prev.family_monthly === seg.family_monthly
    ) {
      prev.end_month = seg.end_month;
    } else {
      out.push(seg);
    }
  }
  return out;
}

const HOLIDAY_ORDER: [keyof HolidayDates, string][] = [
  ["seol", "설"],
  ["chuseok", "추석"],
];

// 대상 여부가 없는 옛 저장분만 예전 규칙(1~4급)으로 관리업무수당 대상을 정합니다.
function mgmtOn(s: SegmentInput): boolean {
  const gn = gradeNumber(s.grade);
  return s.mgmt_target ?? (gn != null && gn >= 1 && gn <= 4);
}

// 한 달에 쓰는 수당 단가(null = 그 달 기준값 없음).
type MonthRates = {
  meal: number | null;
  cert: number | null;
  transport: ReturnType<typeof resolveTransportAllowance>;
  mgmtRate: number | null;
  holidayRate: number | null;
};

function monthRates(rows: ConfigRows, s: SegmentInput, m: number): MonthRates {
  const cfg = salaryConfigForMonth(rows, m);
  const v = (k: string) => (cfg[k] != null && Number.isFinite(cfg[k]) ? cfg[k] : null);
  return {
    meal: v("meal_allowance"),
    cert: s.cert_level ? v(`cert_allowance_${s.cert_level}`) : 0,
    transport: resolveTransportAllowance(rows, s.grade, m),
    mgmtRate: v("mgmt_allowance_rate"),
    holidayRate: v("holiday_bonus_rate"),
  };
}

// 이 구간 금액에 영향을 주는 단가만 비교합니다(대상 아닌 수당이 바뀌어도 나누지 않음).
function ratesKey(s: SegmentInput, r: MonthRates): string {
  return JSON.stringify([
    s.meal ? r.meal : null,
    r.cert,
    s.transport ? (r.transport?.value ?? null) : null,
    mgmtOn(s) ? r.mgmtRate : null,
    r.holidayRate,
  ]);
}

// 수당 단가가 바뀌는 달에서 구간을 나눕니다(승급 구간은 입력 그대로 두고 그 안에서 한 번 더).
//   예) 6급 1~12월 → 1~7월(교통 50,000) / 8~12월(130,000).
//   * 금액을 직접 고친 구간은 나누지 않습니다 — 고친 금액이 구간 합계 기준이라 쪼개면
//     어느 쪽 금액인지 알 수 없습니다. 그런 구간도 금액은 달마다 단가로 더해 맞게 나옵니다.
//   * 이미 나뉜 구간에 다시 돌려도 그대로입니다(화면·저장 양쪽에서 부름).
export function splitSegmentsByConfig(segments: SegmentInput[], rows: ConfigRows): SegmentInput[] {
  const out: SegmentInput[] = [];
  for (const s of segments) {
    const valid = s.start_month >= 1 && s.end_month <= 12 && s.start_month <= s.end_month;
    if (!valid || hasOverrides([s])) {
      out.push(s);
      continue;
    }
    let cur: SegmentInput = { ...s };
    let prevKey = ratesKey(s, monthRates(rows, s, s.start_month));
    for (let m = s.start_month + 1; m <= s.end_month; m++) {
      const k = ratesKey(s, monthRates(rows, s, m));
      if (k === prevKey) continue;
      out.push({ ...cur, end_month: m - 1 });
      cur = { ...s, start_month: m };
      prevKey = k;
    }
    out.push(cur);
  }
  return out;
}

// 교통보조비 근거 한 줄 — "7급 120,000원/월 (8월~)".
function transportBasisText(grade: string, t: NonNullable<MonthRates["transport"]>): string {
  if (!t.fallback) return `${grade} ${won(t.value)}원/월 (${t.from}월~)`;
  return gradeNumber(grade) == null
    ? `일괄 ${won(t.value)}원/월 (${t.from}월~, 급수를 읽지 못함)`
    : `${grade} 일괄 ${won(t.value)}원/월 (${t.from}월~)`;
}

export function computeSalaryContract(input: {
  year: number;
  segments: SegmentInput[];
  gradeRows: GradeRow[];
  configRows: ConfigRows;
  holidays: HolidayDates;
}): SalaryCalc {
  const { year, configRows, holidays } = input;
  const errors: string[] = [];
  const segs = [...input.segments].sort((a, b) => a.start_month - b.start_month);
  if (segs.length === 0) errors.push("구간이 없습니다. 급여설정(직원별 급여 구간)을 먼저 입력해주세요.");
  segs.forEach((s, i) => {
    if (!(s.start_month >= 1 && s.end_month <= 12 && s.start_month <= s.end_month)) {
      errors.push(`구간 ${i + 1}의 월 범위가 올바르지 않습니다.`);
    }
    if (i > 0 && segs[i - 1].end_month + 1 !== s.start_month) {
      errors.push(`구간 ${i}와 ${i + 1} 사이가 이어지지 않습니다(${segs[i - 1].end_month}월 → ${s.start_month}월).`);
    }
  });
  const startMonth = segs[0]?.start_month ?? 1;
  const endMonth = segs[segs.length - 1]?.end_month ?? 12;
  const period_start = `${year}-${pad2(startMonth)}-01`;
  const period_end = lastDayOfMonth(year, endMonth);

  // 그 달 기준값이 없으면 오류로 모으고 0 으로 계산을 이어갑니다.
  const need = (m: number, key: string, v: number | null): number => {
    if (v == null) {
      errors.push(`급여 설정값 ${key} 가 ${year}년 ${m}월에 없습니다.`);
      return 0;
    }
    return v;
  };

  const holidayMonths: { name: string; month: number }[] = [];
  for (const [key, name] of HOLIDAY_ORDER) {
    const d = holidays[key];
    if (!d) {
      errors.push(`${year}년 ${name} 날짜가 없습니다. [명절 날짜]에서 입력해주세요.`);
      continue;
    }
    if (!d.startsWith(`${year}-`)) errors.push(`${name} 날짜(${d})가 ${year}년이 아닙니다.`);
    holidayMonths.push({ name, month: Number(d.slice(5, 7)) });
  }

  const segments: SalarySegment[] = segs.map((s) => {
    const months = Math.max(0, s.end_month - s.start_month + 1);
    const rows = input.gradeRows.filter((g) => g.grade === s.grade && Number(g.step) === Number(s.step));
    const mb = pickEffectiveBase(rows, period_start);
    if (mb == null) errors.push(`호봉표에 ${year}년 ${s.grade} ${s.step}호봉이 없습니다.`);
    const monthly_base = mb ?? 0;
    const base = monthly_base * months;

    // 수당은 달마다 그 달 단가로 더합니다.
    let meal_amt = 0;
    let cert = 0;
    let transport_amt = 0;
    const mgmtRates: number[] = [];
    const runs: { from: number; to: number; text: string }[] = [];
    for (let m = s.start_month; m <= s.end_month; m++) {
      const r = monthRates(configRows, s, m);
      if (s.meal) meal_amt += need(m, "meal_allowance", r.meal);
      if (s.cert_level) cert += need(m, `cert_allowance_${s.cert_level}`, r.cert);
      if (s.transport) {
        if (!r.transport) need(m, "transport_allowance", null);
        else {
          transport_amt += r.transport.value;
          const text = transportBasisText(s.grade, r.transport);
          const last = runs[runs.length - 1];
          if (last && last.text === text) last.to = m;
          else runs.push({ from: m, to: m, text });
        }
      }
      if (mgmtOn(s)) mgmtRates.push(need(m, "mgmt_allowance_rate", r.mgmtRate));
    }
    const inSeg = holidayMonths.filter((h) => h.month >= s.start_month && h.month <= s.end_month);
    const holiday = inSeg.reduce((acc, h) => {
      const rate = need(h.month, "holiday_bonus_rate", monthRates(configRows, s, h.month).holidayRate) / 2; // 명절 1회분
      return acc + floor10Rate(monthly_base, rate);
    }, 0);
    // 관리업무수당 — 요율이 구간 내내 같으면(보통) 구간 기본급 합 × 요율, 다르면 달마다.
    const mgmt = !mgmtRates.length
      ? 0
      : mgmtRates.every((x) => x === mgmtRates[0])
        ? floor10Rate(base, mgmtRates[0])
        : mgmtRates.reduce((a, x) => a + floor10Rate(monthly_base, x), 0);
    const family = Math.max(0, Math.round(Number(s.family_monthly) || 0)) * months;
    const transport_basis = !s.transport
      ? null
      : runs.length <= 1
        ? (runs[0]?.text ?? "기준값 없음")
        : runs.map((x) => `${x.from}~${x.to}월 ${x.text}`).join(" / ");
    // 직접 고친 금액이 있으면 그 값을 쓰고, 원래 계산값은 computed 에 남깁니다.
    const amounts: Record<SalaryAmountKey, number> = { base, meal_amt, cert, transport_amt, holiday, family, mgmt };
    const overrides = cleanOverrides(s.overrides);
    const computed: SalaryOverrides = {};
    for (const k of SALARY_AMOUNT_KEYS) {
      const o = overrides?.[k];
      if (o != null && o !== amounts[k]) {
        computed[k] = amounts[k];
        amounts[k] = o;
      }
    }
    const kept = overrides
      ? (Object.fromEntries(Object.entries(overrides).filter(([k]) => k in computed)) as SalaryOverrides)
      : undefined;
    const total = SALARY_AMOUNT_KEYS.reduce((a, k) => a + amounts[k], 0);
    const { overrides: _drop, ...rest } = s;
    void _drop;
    return {
      ...rest,
      ...(kept && Object.keys(kept).length ? { overrides: kept } : {}),
      months,
      monthly_base,
      ...amounts,
      // 명절휴가비를 0 으로 고치면 그 구간 명절은 지급방법 문구에서 빠집니다.
      holidays: amounts.holiday === 0 ? [] : inSeg.map((h) => h.name),
      total,
      ...(Object.keys(computed).length ? { computed } : {}),
      ...(transport_basis ? { transport_basis } : {}),
    };
  });

  const sum = (k: keyof SalarySegment) => segments.reduce((a, s) => a + (s[k] as number), 0);
  const totals: SalaryTotals = {
    base: sum("base"),
    meal: sum("meal_amt"),
    cert: sum("cert"),
    transport: sum("transport_amt"),
    holiday: sum("holiday"),
    family: sum("family"),
    mgmt: sum("mgmt"),
  };
  const holidayNames = HOLIDAY_ORDER.map(([, n]) => n).filter((n) => segments.some((s) => s.holidays.includes(n)));
  return {
    year,
    period_start,
    period_end,
    months: endMonth - startMonth + 1,
    segments,
    totals,
    total: segments.reduce((a, s) => a + s.total, 0),
    holidayNames,
    errors: [...new Set(errors)],
  };
}

// --- 금액 한글 ------------------------------------------------------------
const DIGIT = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const SMALL = ["", "십", "백", "천"];
const BIG = ["", "만", "억", "조"];

// 33487880 → "금삼천삼백사십팔만칠천팔백팔십원"
export function amountInKorean(n: number): string {
  const v = Math.floor(Math.abs(n));
  if (v === 0) return "금영원";
  const s = String(v);
  let out = "";
  const groups: string[] = [];
  for (let end = s.length; end > 0; end -= 4) groups.unshift(s.slice(Math.max(0, end - 4), end));
  groups.forEach((g, gi) => {
    const bigIdx = groups.length - 1 - gi;
    let part = "";
    const digits = g.padStart(4, "0").split("").map(Number);
    digits.forEach((d, di) => {
      if (d === 0) return;
      part += DIGIT[d] + SMALL[3 - di];
    });
    if (part) out += part + BIG[bigIdx];
  });
  return `금${out}원`;
}

export const won = (n: number) => n.toLocaleString("ko-KR");

// --- 표 -----------------------------------------------------------------
// 금액이 0 인 수당은 열 자체를 넣지 않습니다. 구간이 하나면 비고 열도 뺍니다.
const COLUMNS: { key: keyof SalarySegment; label: string }[] = [
  { key: "base", label: "기본급" },
  { key: "meal_amt", label: "급식비" },
  { key: "cert", label: "청소년지도사\n자격수당" },
  { key: "transport_amt", label: "교통보조비" },
  { key: "holiday", label: "명절휴가비" },
  { key: "family", label: "가족수당" },
  { key: "mgmt", label: "관리업무수당" },
];

export function salaryTable(segments: SalarySegment[]): {
  headers: string[];
  rows: string[][];
  align: ("center" | "right")[];
} {
  const cols = COLUMNS.filter((c) => segments.some((s) => (s[c.key] as number) > 0));
  const withNote = segments.length > 1;
  const headers = [...cols.map((c) => c.label), "합계", ...(withNote ? ["비고"] : [])];
  const rows = segments.map((s) => [
    ...cols.map((c) => won(s[c.key] as number)),
    won(s.total),
    ...(withNote ? [`${s.months}개월`] : []),
  ]);
  const align = headers.map((h) => (h === "비고" ? "center" : "right") as "center" | "right");
  return { headers, rows, align };
}

// --- 조항 ---------------------------------------------------------------
export type SalaryClauses = {
  lead: string;
  // 4. 보수 지급방법 — 줄마다 ○ 한 줄. 자리표시: {개월수} {명절} {횟수}
  //   {명절} 이 든 줄은 그 계약에 명절이 하나도 없으면 빠집니다.
  payment: string[];
  renewal: string; // 5. 연봉재계약의 시기
  etc: string; // 6. 기타
};

export const DEFAULT_SALARY_CLAUSES: SalaryClauses = {
  lead: "동래구청소년센터 직원을 채용함에 있어 계약당사자는 상호간에 다음과 같이 계약을 체결한다.",
  payment: ["연봉의 1/{개월수}을 균등액으로 매월 25일 지급", "명절휴가비는 {명절}이 속한 달로 연 {횟수}회 지급"],
  renewal: "연봉계약 만료 시",
  etc: "상기에 명기되지 않은 내용은 근로기준법, 센터 운영규정 및 통상사업장의 관행에 따른다.",
};

export function parseSalaryClauses(raw: string | null | undefined): SalaryClauses {
  const d = DEFAULT_SALARY_CLAUSES;
  if (!raw) return d;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return d;
  }
  if (!o || typeof o !== "object") return d;
  return {
    lead: clauseText(o.lead, d.lead),
    payment: clauseLines(o.payment, d.payment),
    renewal: clauseText(o.renewal, d.renewal),
    etc: clauseText(o.etc, d.etc),
  };
}

export function paymentLines(c: SalaryClauses, months: number, holidayNames: string[]): string[] {
  return c.payment
    .filter((l) => !l.includes("{명절}") || holidayNames.length > 0)
    .map((l) =>
      l
        .replaceAll("{개월수}", String(months))
        .replaceAll("{명절}", holidayNames.join(", "))
        .replaceAll("{횟수}", String(holidayNames.length))
    );
}

// --- 계약 행 ------------------------------------------------------------
export type SalaryContract = {
  id: string;
  driver_id: string;
  employee_name: string;
  year: number;
  period_start: string;
  period_end: string;
  total_annual: number;
  amount_in_korean: string;
  segments: SalarySegment[];
  status: ContractStatus;
  sent_at: string | null;
  employee_signed_at: string | null;
  employer_signed_at: string | null;
  delivered_at: string | null;
  has_pdf: boolean;
  created_by: string | null;
  created_at: string;
  // 2026-10: 종이로 체결해 이관한 건은 'paper' — 내용은 원본 스캔(contract_pdf_url)으로 봅니다.
  signing_method: "electronic" | "paper";
  employer_title: string | null; // 고용자 표기. null = 동래구청소년센터장(employerTitleOf)
  note: string | null;
};

export const SALARY_LIST_COLUMNS =
  "id, driver_id, year, period_start, period_end, total_annual, amount_in_korean, segments, status, sent_at, employee_signed_at, employer_signed_at, delivered_at, contract_pdf_url, created_by, created_at, signing_method, employer_title, note";

export function toSalaryContract(raw: Record<string, unknown>, employeeName: string): SalaryContract {
  const segs = Array.isArray(raw.segments) ? (raw.segments as SalarySegment[]) : [];
  return {
    ...workflowFields(raw),
    employee_name: employeeName,
    year: Number(raw.year ?? 0),
    period_start: String(raw.period_start ?? ""),
    period_end: String(raw.period_end ?? ""),
    total_annual: Number(raw.total_annual ?? 0),
    amount_in_korean: String(raw.amount_in_korean ?? ""),
    segments: segs,
    signing_method: raw.signing_method === "paper" ? "paper" : "electronic",
    employer_title: typeof raw.employer_title === "string" && raw.employer_title.trim() ? raw.employer_title.trim() : null,
    note: typeof raw.note === "string" && raw.note.trim() ? raw.note : null,
  };
}

// "2026년 1월 1일" — 실제 발급분 표기(앞자리 0 없음).
export function fmtKoreanPlain(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

export function buildSalaryContractBlocks(input: {
  contract: Pick<SalaryContract, "period_start" | "period_end" | "total_annual" | "amount_in_korean" | "segments"> & {
    employer_title?: string | null;
  };
  employeeName: string;
  clauses: SalaryClauses;
}): ContractBlock[] {
  const { contract: c, clauses } = input;
  const holidayNames = ["설", "추석"].filter((n) => c.segments.some((s) => s.holidays?.includes(n)));
  const months = c.segments.reduce((a, s) => a + s.months, 0);
  const table = salaryTable(c.segments);
  const b: ContractBlock[] = [
    { kind: "title", text: "연 봉 계 약 서" },
    { kind: "para", text: clauses.lead },
    {
      kind: "heading",
      text: `1. 기 간 : ${fmtDot(c.period_start)} ~ ${fmtDot(c.period_end)} (${periodLabel(c.period_start, c.period_end)})`,
    },
    { kind: "heading", text: `2. 연 봉 액 : 금${won(c.total_annual)}원(${c.amount_in_korean})` },
    { kind: "heading", text: "3. 연봉내역" },
    { kind: "table", caption: "(단위 : 원)", ...table },
    { kind: "heading", text: "4. 보수 지급방법" },
    ...paymentLines(clauses, months, holidayNames).map((text) => ({ kind: "bullet" as const, text })),
    { kind: "heading", text: `5. 연봉재계약의 시기 : ${clauses.renewal}` },
    { kind: "heading", text: `6. 기타 ${clauses.etc}` },
    {
      kind: "sign",
      date: fmtKoreanPlain(c.period_start),
      employeeName: input.employeeName,
      employerTitle: c.employer_title ?? undefined,
    },
  ];
  return b;
}
