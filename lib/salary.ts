// =====================================================================
// 급여 공통 상수·타입·순수 헬퍼 (클라이언트 안전).
//   * 급여 "1차": 계산·명세서·발송은 없음. 기준값/설정 데이터 모델과 검증만.
//   * 서버 액션(app/hr/salary/actions.ts)과 클라이언트(SalaryManager)가 공유합니다.
//   * DB 테이블(조사 결과):
//     - salary_grade_table(id, year, grade text, step int, base_salary int,
//                           effective_from date)
//       ⚠️ 호봉표는 (year, grade, step, effective_from) 단위입니다. 임금 인상이
//       연중에 발효되므로 같은 (year, grade, step) 에 발효월이 다른 행이 여럿
//       있습니다(2026: 01-01 구 단가 / 08-01 신 단가). 기본급을 끌어올 때는
//       반드시 급여월 기준으로 유효한 발효분을 골라야 합니다 → pickEffectiveBase.
//     - salary_config(id, year, config_key text, config_value numeric, label text)
//     - employee_salary_profiles(id, driver_id, year, grade text, step int,
//                                start_month int, end_month int, extra jsonb)
// =====================================================================

export type SalaryGradeRow = {
  id: string;
  year: number;
  grade: string;
  step: number;
  base_salary: number;
  // 이 단가가 발효되는 날 "YYYY-MM-DD". 연중 인상분을 소급하지 않기 위한 축.
  effective_from: string;
};

// =====================================================================
// 발효월(effective_from) 규칙 — 기본급 조회의 단일 출처
//   * 급여월이 M월이면 그 달 1일을 기준으로, effective_from <= 기준일 인 행 중
//     effective_from 이 가장 큰(최신) 행의 base_salary 를 씁니다.
//       - 2026년 7월 계산 → 2026-01-01 만 조건 충족 → 구 단가
//       - 2026년 8월 이후 → 2026-08-01 이 최신     → 신 단가
//   * 인상분이 과거로 소급되지 않게 하는 것이 이 규칙의 목적입니다.
//     확정·발송된 지난달 명세서를 다시 계산해도 그때 단가가 그대로 나옵니다.
//   * 날짜는 "YYYY-MM-DD" 문자열 비교로 충분합니다(사전순 = 시간순).
// =====================================================================

const pad2 = (n: number) => String(n).padStart(2, "0");

// 급여월의 기준일 — 그 달 1일.
export function payrollEffectiveDate(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`;
}

// 발효월이 유효한 행들 중 가장 최신 것. 없으면 null.
export function pickEffectiveRow<T extends { effective_from: string }>(
  rows: T[],
  asOf: string,
): T | null {
  let best: T | null = null;
  for (const row of rows) {
    // 발효월이 비어 있는 행(옛 데이터)은 항상 유효한 것으로 봅니다.
    const from = row.effective_from || "";
    if (from && from > asOf) continue;
    if (!best || from > (best.effective_from || "")) best = row;
  }
  return best;
}

// 급여월 기준 기본급. 해당 (grade, step) 에 유효한 발효분이 없으면 null.
export function pickEffectiveBase(
  rows: { effective_from: string; base_salary: number }[],
  asOf: string,
): number | null {
  const hit = pickEffectiveRow(rows, asOf);
  return hit ? hit.base_salary : null;
}

// 화면에 보여줄(=편집 대상) 발효분 — "지금 유효한 최신 발효분".
//   today 기준으로 아직 발효 전인 세트만 있으면 가장 이른 것으로 폴백합니다.
//   지난 발효분(구 단가)은 이력으로 DB 에 남고 화면에서만 빠집니다.
export function currentEffectiveFrom(
  rows: { effective_from: string }[],
  today: string,
): string | null {
  const dates = [...new Set(rows.map((r) => r.effective_from || ""))]
    .filter(Boolean)
    .sort();
  if (dates.length === 0) return null;
  const valid = dates.filter((d) => d <= today);
  return valid.length > 0 ? valid[valid.length - 1] : dates[0];
}

export type SalaryConfigRow = {
  id: string;
  year: number;
  config_key: string;
  config_value: number;
  label: string | null;
};

// 직원별 급여 설정 행(월 구간 단위). 연중 호봉 변동 시 여러 행으로 나눕니다.
export type EmployeeSalaryProfileRow = {
  id: string;
  driver_id: string;
  year: number;
  grade: string;
  step: number;
  start_month: number;
  end_month: number;
  extra: SalaryExtra;
};

// 급여대장 그룹(팀) — 센터 / 방과후아카데미 2그룹.
export type PayrollTeam = "center" | "afterschool";
export const TEAM_LABEL: Record<PayrollTeam, string> = {
  center: "센터",
  afterschool: "방과후아카데미",
};
export const TEAM_OPTIONS: { value: SalaryTeamValue; label: string }[] = [
  { value: "", label: "자동(이름 기준)" },
  { value: "center", label: "센터" },
  { value: "afterschool", label: "방과후아카데미" },
];
// extra.team 저장값 — "" 는 미지정(이름 시드로 자동 분류).
export type SalaryTeamValue = "" | PayrollTeam;

// 팀 시드 — extra.team 미설정 직원의 이름 기반 기본 분류.
//   실제 2026-07 급여대장 기준 방과후아카데미 인원. 화면에서 extra.team 을
//   지정하면 그 값이 우선하며, 이 시드는 미지정 직원의 방어적 기본값입니다.
//   (인사이동은 직원별 급여설정의 '소속 팀' 선택으로 반영)
export const AFTERSCHOOL_SEED_NAMES = ["김소연", "한지형", "권수현", "박수선"];

// 직원의 최종 팀 판정 — extra.team 우선, 없으면 이름 시드, 그래도 없으면 센터.
export function resolveTeam(input: {
  team?: SalaryTeamValue | null;
  name?: string | null;
}): PayrollTeam {
  if (input.team === "center" || input.team === "afterschool") return input.team;
  const nm = (input.name ?? "").replace(/\s+/g, "");
  return AFTERSCHOOL_SEED_NAMES.includes(nm) ? "afterschool" : "center";
}

// 직원의 저장된 소속 팀 값 — 여러 급여 구간 중 지정된 값이 있으면 그것을 우선.
//   * 소속 팀은 직원 단위(UI: "모든 구간에 동일 적용")이므로, 특정 월 구간의
//     extra.team 이 ""(미지정)이어도 다른 구간에 지정값이 있으면 그것을 사용합니다.
//   * 이렇게 해야 "구간을 나눠 저장하는 과정에서 일부 구간만 팀이 지정된" 경우에도
//     저장된 값이 시드(이름 기반 기본값)에 밀리지 않습니다.
//   * 전 구간이 미지정일 때만 ""(→ resolveTeam 이 이름 시드 적용)을 반환.
export function effectiveTeamValue(
  profiles: { extra?: { team?: SalaryTeamValue | null } | null }[]
): SalaryTeamValue {
  for (const p of profiles) {
    const t = p?.extra?.team;
    if (t === "center" || t === "afterschool") return t;
  }
  return "";
}

// extra jsonb — 개인 항목. 급여 값은 회계담당이 화면에서 직접 입력합니다.
//   * 4대보험(pension·health·longterm_care·employment_ins)은 요율 계산이 실제
//     공단 고지액과 불일치(개인별 예외)하여 갑근세처럼 "월액 입력값"으로 둡니다.
//     0/미입력 = 해당 없음(명세서에서 제외). 요율 계산은 참고치로만 사용합니다.
export type SalaryExtra = {
  family_allowance: number; // 가족수당 월액(없으면 0)
  cert_level: "" | "1" | "2" | "3"; // 자격수당 등급(빈=없음)
  meal_target: boolean; // 급식비 대상(기본 true — 전원. 예외만 해제)
  transport_target: boolean; // 교통보조비 대상(기본 true — 전원. 예외만 해제)
  mgmt_target: boolean; // 관리업무수당 대상(관장·부장. 기본 false)
  overtime_target: boolean; // 시간외수당 대상(지도자·팀원. 기본 false)
  sangjo: number | null; // 상조회비 개인 예외(null=기본 config 값 사용)
  income_tax: number; // 갑근세 월액(공단/원천 입력. 주민세는 이 값의 10% 자동)
  pension: number; // 국민연금 월액(공단 고지액 입력. 0=미표시)
  health: number; // 국민건강 월액(공단 고지액 입력. 0=미표시)
  longterm_care: number; // 장기요양 월액(공단 고지액 입력. 0=미표시)
  employment_ins: number; // 고용보험 월액(공단 고지액 입력. 0=미표시)
  team: SalaryTeamValue; // 소속 팀(급여대장 그룹). ""=미지정(이름 시드 자동)
};

export const EMPTY_SALARY_EXTRA: SalaryExtra = {
  family_allowance: 0,
  cert_level: "",
  meal_target: true,
  transport_target: true,
  mgmt_target: false,
  overtime_target: false,
  sangjo: null,
  income_tax: 0,
  pension: 0,
  health: 0,
  longterm_care: 0,
  employment_ins: 0,
  team: "",
};

// 자격수당 등급 옵션(UI). key 는 salary_config 의 cert_allowance_{n} 과 연결.
export const CERT_LEVEL_OPTIONS: { value: SalaryExtra["cert_level"]; label: string }[] =
  [
    { value: "", label: "없음" },
    { value: "1", label: "1급" },
    { value: "2", label: "2급" },
    { value: "3", label: "3급" },
  ];

// 자격수당 등급 → salary_config key (2차 계산 연동용 참고).
export function certAllowanceKey(level: SalaryExtra["cert_level"]): string | null {
  return level ? `cert_allowance_${level}` : null;
}

// 교통보조비 급수 구간 → salary_config key.
//   * 8월 임금 권고안부터 급수별 차등입니다(그전에는 전 직원 동일 5만원).
//     1~2급 / 3~4급 / 5~6급 / 7급 네 구간이며, 자격수당이 cert_allowance_{n} 으로
//     나뉜 것과 같은 방식입니다.
//   * ⚠️ 금액은 코드에 두지 않습니다 — salary_config 값을 그대로 씁니다.
//     (권고안이 바뀌면 화면에서 기준값만 고치면 됩니다)
//   * 급수를 구간으로 읽을 수 없으면 null → 호출부가 옛 단일 key 로 폴백합니다.
export function transportAllowanceKey(grade: string): string | null {
  const n = gradeSortKey(grade); // "6급" → 6, 숫자가 없으면 9999
  if (n >= 1 && n <= 2) return "transport_allowance_12";
  if (n >= 3 && n <= 4) return "transport_allowance_34";
  if (n >= 5 && n <= 6) return "transport_allowance_56";
  if (n === 7) return "transport_allowance_7";
  return null;
}

// 알 수 없는 jsonb → 안전한 SalaryExtra 로 보정.
export function normalizeSalaryExtra(raw: unknown): SalaryExtra {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...EMPTY_SALARY_EXTRA };
  }
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const level = String(r.cert_level ?? "");
  return {
    family_allowance: num(r.family_allowance),
    cert_level:
      level === "1" || level === "2" || level === "3" ? level : "",
    // 급식비·교통보조비 — 키 없음/undefined = 기본 true(전원). 명시적 false 만 제외.
    //   (기존 저장 데이터 하위호환: 새 키가 없어도 정상 지급되도록)
    meal_target: r.meal_target !== false,
    transport_target: r.transport_target !== false,
    mgmt_target: r.mgmt_target === true,
    overtime_target: r.overtime_target === true,
    sangjo:
      r.sangjo == null || r.sangjo === ""
        ? null
        : Number.isFinite(Number(r.sangjo))
          ? Number(r.sangjo)
          : null,
    income_tax: num(r.income_tax),
    // 4대보험 — 기존 저장(키 없음)은 0(미입력) 취급 → 하위호환.
    pension: num(r.pension),
    health: num(r.health),
    longterm_care: num(r.longterm_care),
    employment_ins: num(r.employment_ins),
    // 소속 팀 — 잘못된/없는 값은 ""(미지정)로 보정(하위호환).
    team: r.team === "center" || r.team === "afterschool" ? r.team : "",
  };
}

// 정수 원화 표시 — "1234560" → "1,234,560".
export function formatKRW(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "-";
  return Math.round(Number(n)).toLocaleString("ko-KR");
}

// config_key 가 요율(비율)인지 — 소수(0<v<1)로 저장되므로 금액과 다르게 표시해야 함.
//   * 요율은 key 가 _rate 로 끝납니다(예: pension_rate 0.0475).
//   * 금액용 formatKRW(Math.round)로 표시하면 0.0475 → "0" 으로 뭉개지므로 분리.
export function isRateKey(key: string): boolean {
  return key.endsWith("_rate");
}

// 요율(소수) → 퍼센트 문자열. 0.0475 → "4.75%", 0.09 → "9%", 1.2 → "120%".
export function formatRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  // 부동소수 잡음 제거(0.03595*100=3.5949999… 방지) 후 불필요한 0 절삭.
  const pct = Number((Number(value) * 100).toFixed(6));
  return `${pct.toLocaleString("ko-KR")}%`;
}

// 기준값 표시 — 요율 key 는 퍼센트, 그 외는 원화. (기준값 표에서 사용)
export function formatConfigValue(key: string, value: number): string {
  return isRateKey(key) ? formatRate(value) : formatKRW(value);
}

// 급수 정렬용 숫자 추출 — "6급" → 6, 파싱 실패 시 큰 수(뒤로).
export function gradeSortKey(grade: string): number {
  const m = grade.match(/\d+/);
  return m ? Number(m[0]) : 9999;
}

// 호봉표 정렬 — 급수(숫자) → 호봉.
export function sortGradeRows<T extends { grade: string; step: number }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    const g = gradeSortKey(a.grade) - gradeSortKey(b.grade);
    if (g !== 0) return g;
    return a.step - b.step;
  });
}

// =====================================================================
// 공용 월 급여 계산 엔진 — calcMonthlyPayroll
//   * 이 함수가 급여 계산의 단일 출처입니다. 미리보기(1차)와 월별 명세서
//     생성·확정(2차)이 모두 이 함수를 재사용합니다(계산 이원화 금지).
//   * 순수 함수(부수효과 없음) — 입력만으로 결정됩니다.
//
//   [원 단위 처리] 10원 미만 절사(floor10).
//     · 실측 근거: 허일수 2026-05 명세서에서 관리업무수당 4,756,180×0.09=428,056.2
//       → 428,050, 주민세 385,960×0.1=38,596 → 38,590. 둘 다 10원 절사와 일치.
//       (반올림이면 각각 428,060 / 38,600 이 되어 실측과 어긋남)
//
//   [4대보험] 국민연금·건강·장기요양·고용보험은 공단 고지액이 요율 계산과
//     불일치(개인별 예외: 관장 고용보험 0원 등)하므로 extra 의 "입력값"을 그대로
//     공제합니다. 0/미입력 항목은 명세서에서 제외합니다(줄 자체가 안 나옴).
//     요율 계산은 estimateInsuranceByRate 로 분리 보존 — 입력 칸 옆 참고치·예산용.
//
//   [월 미리보기 제외 항목] 시간외수당·명절휴가비·연가보상비는 월 변동/특정 월
//     지급이라 여기서 제외하고 2차(월별 생성) 시 "해당 월 추가 항목"으로 더합니다.
// =====================================================================
export type PayItem = { key: string; label: string; amount: number };

export type MonthlyPayroll = {
  payItems: PayItem[];
  deductItems: PayItem[];
  totalPay: number;
  totalDeduct: number;
  netPay: number;
};

// 10원 미만 절사(원 단위 버림). 위 [원 단위 처리] 주석 참조.
export function floor10(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n / 10) * 10;
}

export function calcMonthlyPayroll(input: {
  baseSalary: number;
  extra: SalaryExtra;
  config: Record<string, number>;
  // 교통보조비 급수 구간 판정용(예: "6급"). 없으면 옛 단일 key 로 계산합니다.
  grade?: string;
}): MonthlyPayroll {
  const { baseSalary, extra, config, grade } = input;
  const cfg = (key: string): number => {
    const v = Number(config[key]);
    return Number.isFinite(v) ? v : 0;
  };
  const add = (arr: PayItem[], key: string, label: string, amount: number) => {
    if (amount > 0) arr.push({ key, label, amount });
  };

  // --- 지급내역 (0/미대상 항목은 제외) ---
  const payItems: PayItem[] = [];
  add(payItems, "base", "기본급", Math.round(baseSalary));
  if (extra.mgmt_target) {
    add(
      payItems,
      "mgmt_allowance",
      "관리업무수당",
      floor10(baseSalary * cfg("mgmt_allowance_rate"))
    );
  }
  if (extra.meal_target) {
    add(payItems, "meal_allowance", "급식비", cfg("meal_allowance"));
  }
  const certKey = certAllowanceKey(extra.cert_level);
  if (certKey) {
    add(payItems, "cert_allowance", "지도사자격수당", cfg(certKey));
  }
  add(payItems, "family_allowance", "가족수당", Math.round(extra.family_allowance));
  if (extra.transport_target) {
    // 급수 구간별 차등(8월 권고안). 구간 key 가 salary_config 에 아직 없으면
    //   cfg 가 0 을 돌려주고 add 가 줄을 빼므로 명세가 깨지지 않습니다.
    //   급수를 구간으로 읽을 수 없는 예외에서만 옛 단일 key 로 폴백합니다.
    const transportKey = transportAllowanceKey(grade ?? "");
    add(
      payItems,
      "transport_allowance",
      "교통보조비",
      cfg(transportKey ?? "transport_allowance")
    );
  }

  const totalPay = payItems.reduce((s, i) => s + i.amount, 0);

  // --- 공제내역 ---
  const deductItems: PayItem[] = [];
  const incomeTax = Math.round(extra.income_tax);
  add(deductItems, "income_tax", "갑근세", incomeTax);
  // 주민세는 규칙이 확실(갑근세 × 10%) → 자동 계산 유지(10원 절사).
  add(deductItems, "resident_tax", "주민세", floor10(incomeTax * cfg("resident_tax_rate")));
  // 4대보험 — 공단 고지액(extra 입력값) 그대로. 0/미입력이면 add 가 제외.
  add(deductItems, "pension", "국민연금", Math.round(extra.pension));
  add(deductItems, "health", "국민건강", Math.round(extra.health));
  add(deductItems, "longterm_care", "장기요양", Math.round(extra.longterm_care));
  add(deductItems, "employment", "고용보험", Math.round(extra.employment_ins));
  const sangjo = extra.sangjo ?? cfg("sangjo_fee");
  add(deductItems, "sangjo", "상조회비", Math.round(sangjo));
  // 산재보험(accident_rate)은 사업주 부담 → 직원 공제내역에서 제외.

  const totalDeduct = deductItems.reduce((s, i) => s + i.amount, 0);
  const netPay = totalPay - totalDeduct;
  return { payItems, deductItems, totalPay, totalDeduct, netPay };
}

// 4대보험 요율 참고치 — 실제 공제는 입력값이지만, 입력 칸 옆 "계산 참고" 표시와
//   향후 연간 예산 산출을 위해 요율 기반 추정을 보존합니다(지급총액 × config 요율).
//   실제 공단 고지액과는 차이가 있으므로 어디까지나 참고용입니다.
export type InsuranceEstimate = {
  pension: number;
  health: number;
  longterm_care: number;
  employment: number;
};

export function estimateInsuranceByRate(input: {
  baseSalary: number;
  extra: SalaryExtra;
  config: Record<string, number>;
  // 지급총액에 교통보조비(급수 구간별)가 들어가므로 급수도 함께 받습니다.
  grade?: string;
}): InsuranceEstimate {
  const { config } = input;
  const cfg = (key: string): number => {
    const v = Number(config[key]);
    return Number.isFinite(v) ? v : 0;
  };
  // 지급총액은 계산 엔진 재사용(지급 항목은 4대보험 입력값과 무관).
  const { totalPay } = calcMonthlyPayroll(input);
  const health = floor10(totalPay * cfg("health_rate"));
  return {
    pension: floor10(totalPay * cfg("pension_rate")),
    health,
    longterm_care: floor10(health * cfg("longterm_care_rate")),
    employment: floor10(totalPay * cfg("employment_rate")),
  };
}

// =====================================================================
// 월별 급여(급여 2차) — payroll_records 모델·합계·월 대상 판정 (순수)
//   * payroll_records: driver_id, year, month, pay_items/deduct_items(jsonb),
//     total_pay/total_deduct/net_pay, confirmed_at/confirmed_by, emailed_at,
//     UNIQUE(driver_id, year, month).
//   * 계산은 calcMonthlyPayroll 단일 출처. 여기서는 저장 모델과 파생 헬퍼만.
// =====================================================================
export type PayrollRecord = {
  id: string;
  driver_id: string;
  year: number;
  month: number;
  pay_items: PayItem[];
  deduct_items: PayItem[];
  total_pay: number;
  total_deduct: number;
  net_pay: number;
  confirmed_at: string | null;
  confirmed_by: string | null;
  emailed_at: string | null;
};

// "이 달 추가 항목" 프리셋 — 명절 있는 달·연말에만 담당자가 더하는 변동 지급.
//   급여대장 고정 열에 없는 항목(명절휴가비·연가보상비)은 대장 '비고'에 표기됩니다.
//   시간외수당은 관리업무수당과 같은 열을 공유합니다(직책에 따라 택일).
export const PAY_ADDON_PRESETS: { key: string; label: string }[] = [
  { key: "overtime", label: "시간외수당" },
  { key: "holiday_bonus", label: "명절휴가비" },
  { key: "annual_leave", label: "연가보상비" },
];

// 확정 여부 — confirmed_at 이 있으면 확정본.
export function isConfirmed(rec: { confirmed_at: string | null }): boolean {
  return !!rec.confirmed_at;
}

// PayItem[] 금액 합계(방어적 — 비정상 값은 0 취급, 원 단위 반올림).
export function sumAmount(items: PayItem[]): number {
  return items.reduce(
    (s, i) => s + (Number.isFinite(i.amount) ? Math.round(i.amount) : 0),
    0
  );
}

// 지급·공제 배열로부터 합계·차인지급액 재계산(수정 시 자동 재계산).
export function recalcTotals(
  payItems: PayItem[],
  deductItems: PayItem[]
): { total_pay: number; total_deduct: number; net_pay: number } {
  const total_pay = sumAmount(payItems);
  const total_deduct = sumAmount(deductItems);
  return { total_pay, total_deduct, net_pay: total_pay - total_deduct };
}

// 급여 설정 구간이 해당 월을 포함하는지.
export function rangeIncludesMonth(
  r: { start_month: number; end_month: number },
  month: number
): boolean {
  return month >= r.start_month && month <= r.end_month;
}

// 퇴사 경계 — 해당 연·월에 급여 대상인지. 퇴사월까지 포함, 그 다음 달부터 제외.
//   resignation_date 는 'YYYY-MM-DD'. 없거나 파싱 실패면 방어적으로 포함.
export function isEmployedInMonth(input: {
  year: number;
  month: number;
  employment_status: "active" | "resigned";
  resignation_date: string | null;
}): boolean {
  if (input.employment_status !== "resigned" || !input.resignation_date) {
    return true;
  }
  const m = input.resignation_date.match(/^(\d{4})-(\d{1,2})/);
  if (!m) return true;
  const resYear = Number(m[1]);
  const resMonth = Number(m[2]);
  if (input.year < resYear) return true; // 미래 퇴사 → 아직 재직
  if (input.year > resYear) return false; // 퇴사 연도 지남
  return input.month <= resMonth; // 같은 해: 퇴사월까지 포함
}

export type MonthRange = { start_month: number; end_month: number };

// 월 구간 검증 — 각 구간 1~12·start≤end, 같은 직원·연도 내 구간 겹침 금지.
//   서버(저장 거부)와 클라이언트(즉시 안내) 공용.
export function validateMonthRanges(
  ranges: MonthRange[]
): { ok: true } | { ok: false; message: string } {
  if (ranges.length === 0) {
    return { ok: false, message: "최소 1개의 적용 월 구간이 필요합니다." };
  }
  for (const r of ranges) {
    if (
      !Number.isInteger(r.start_month) ||
      !Number.isInteger(r.end_month) ||
      r.start_month < 1 ||
      r.start_month > 12 ||
      r.end_month < 1 ||
      r.end_month > 12
    ) {
      return { ok: false, message: "적용 월은 1~12 사이여야 합니다." };
    }
    if (r.start_month > r.end_month) {
      return {
        ok: false,
        message: "적용 월 구간의 시작월이 종료월보다 클 수 없습니다.",
      };
    }
  }
  // 겹침 검사 — 시작월 기준 정렬 후 인접 구간 비교.
  const sorted = [...ranges].sort((a, b) => a.start_month - b.start_month);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start_month <= sorted[i - 1].end_month) {
      return {
        ok: false,
        message: `적용 월 구간이 겹칩니다(${sorted[i - 1].start_month}~${
          sorted[i - 1].end_month
        }월 ↔ ${sorted[i].start_month}~${sorted[i].end_month}월).`,
      };
    }
  }
  return { ok: true };
}
