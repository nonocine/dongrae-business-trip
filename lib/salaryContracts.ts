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
//     · 구간 = employee_salary_profiles 의 월 구간. 호봉·자격·급식/교통 대상이 같고
//       이어진 구간은 하나로 합칩니다(급여대장용으로 8월에 쪼갠 행 등).
//     · 급식비 = meal_allowance × 개월, 교통보조비 = transport_allowance × 개월
//       (급수별 transport_allowance_12/34/56/7 은 쓰지 않음 — 실제 계약서가 전부 5만원)
//     · 자격수당 = cert_allowance_{extra.cert_level} × 개월
//     · 관리업무수당 = 기본급(구간 합) × mgmt_allowance_rate, 1~4급만, 10원 미만 절사
//     · 명절휴가비 = 설·추석 각각 월기본급 × (holiday_bonus_rate ÷ 2), 10원 미만 절사.
//       그 명절이 속한 달이 구간에 들어갈 때만 그 구간에 더합니다.
//       명절 날짜는 settings(SALARY_HOLIDAYS_KEY)에 연도별로 둡니다.
//     · 가족수당 = 화면에서 입력한 월액 × 개월(자동 근거 없음)
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
import { pickEffectiveBase } from "./salary";

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
  family_monthly: number;
};

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
};

export type HolidayDates = { seol: string | null; chuseok: string | null };
export type GradeRow = { grade: string; step: number; base_salary: number; effective_from: string };
export type ConfigMap = Record<string, number>;

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
    extra?: { cert_level?: string | null; meal_target?: boolean | null; transport_target?: boolean | null } | null;
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
      family_monthly: 0,
    };
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.end_month + 1 === seg.start_month &&
      prev.grade === seg.grade &&
      prev.step === seg.step &&
      prev.cert_level === seg.cert_level &&
      prev.meal === seg.meal &&
      prev.transport === seg.transport
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

export function computeSalaryContract(input: {
  year: number;
  segments: SegmentInput[];
  gradeRows: GradeRow[];
  config: ConfigMap;
  holidays: HolidayDates;
}): SalaryCalc {
  const { year, config, holidays } = input;
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

  const need = (key: string): number => {
    const v = config[key];
    if (v == null || !Number.isFinite(v)) {
      errors.push(`급여 설정값 ${key} 가 ${year}년에 없습니다.`);
      return 0;
    }
    return v;
  };
  const meal = need("meal_allowance");
  const transport = need("transport_allowance");
  const holidayRate = need("holiday_bonus_rate") / 2; // 명절 1회분
  const mgmtRate = need("mgmt_allowance_rate");

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
    const certKey = s.cert_level ? `cert_allowance_${s.cert_level}` : null;
    const cert = certKey ? need(certKey) * months : 0;
    const inSeg = holidayMonths.filter((h) => h.month >= s.start_month && h.month <= s.end_month);
    const holiday = inSeg.reduce((acc) => acc + floor10Rate(monthly_base, holidayRate), 0);
    const gn = gradeNumber(s.grade);
    const mgmt = gn != null && gn >= 1 && gn <= 4 ? floor10Rate(base, mgmtRate) : 0;
    const family = Math.max(0, Math.round(Number(s.family_monthly) || 0)) * months;
    const meal_amt = s.meal ? meal * months : 0;
    const transport_amt = s.transport ? transport * months : 0;
    const total = base + meal_amt + cert + transport_amt + holiday + family + mgmt;
    return {
      ...s,
      months,
      monthly_base,
      base,
      meal_amt,
      cert,
      transport_amt,
      holiday,
      holidays: inSeg.map((h) => h.name),
      family,
      mgmt,
      total,
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
};

export const SALARY_LIST_COLUMNS =
  "id, driver_id, year, period_start, period_end, total_annual, amount_in_korean, segments, status, sent_at, employee_signed_at, employer_signed_at, delivered_at, contract_pdf_url, created_by, created_at";

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
  };
}

// "2026년 1월 1일" — 실제 발급분 표기(앞자리 0 없음).
export function fmtKoreanPlain(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

export function buildSalaryContractBlocks(input: {
  contract: Pick<SalaryContract, "period_start" | "period_end" | "total_annual" | "amount_in_korean" | "segments">;
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
    { kind: "sign", date: fmtKoreanPlain(c.period_start), employeeName: input.employeeName },
  ];
  return b;
}
