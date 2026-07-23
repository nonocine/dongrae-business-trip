// =====================================================================
// 급여 공통 상수·타입·순수 헬퍼 (클라이언트 안전).
//   * 급여 "1차": 계산·명세서·발송은 없음. 기준값/설정 데이터 모델과 검증만.
//   * 서버 액션(app/hr/salary/actions.ts)과 클라이언트(SalaryManager)가 공유합니다.
//   * DB 테이블(조사 결과):
//     - salary_grade_table(id, year, grade text, step int, base_salary int)
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
};

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

// extra jsonb — 개인 항목. 2차 계산에서 salary_config 단가와 결합됩니다.
export type SalaryExtra = {
  family_allowance: number; // 가족수당 월액(없으면 0)
  cert_level: "" | "1" | "2" | "3"; // 자격수당 등급(빈=없음)
  mgmt_target: boolean; // 관리업무수당 대상(관장·부장)
  overtime_target: boolean; // 시간외수당 대상(지도자·팀원)
  sangjo: number | null; // 상조회비 개인 예외(null=기본 config 값 사용)
  income_tax: number; // 갑근세 월액(담당자 직접 입력. 주민세는 2차에서 10% 자동)
};

export const EMPTY_SALARY_EXTRA: SalaryExtra = {
  family_allowance: 0,
  cert_level: "",
  mgmt_target: false,
  overtime_target: false,
  sangjo: null,
  income_tax: 0,
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
    mgmt_target: r.mgmt_target === true,
    overtime_target: r.overtime_target === true,
    sangjo:
      r.sangjo == null || r.sangjo === ""
        ? null
        : Number.isFinite(Number(r.sangjo))
          ? Number(r.sangjo)
          : null,
    income_tax: num(r.income_tax),
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
//   [4대보험 기준액] 1차는 "지급총액(월)"을 기준액으로 사용합니다.
//     · 실제 명세서의 국민연금·건강보험은 연간 고정된 보수월액/기준소득월액
//       (전년도 소득·상여 포함 평균)을 기준으로 하므로, 우리 데이터만으로는
//       정확히 재현되지 않습니다. 미리보기는 "월 지급총액 기준 추정치"이며
//       실제 공제액과 차이가 날 수 있습니다(작업 보고 및 하단 안내문 참조).
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
}): MonthlyPayroll {
  const { baseSalary, extra, config } = input;
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
  add(payItems, "meal_allowance", "급식비", cfg("meal_allowance"));
  const certKey = certAllowanceKey(extra.cert_level);
  if (certKey) {
    add(payItems, "cert_allowance", "지도사자격수당", cfg(certKey));
  }
  add(payItems, "family_allowance", "가족수당", Math.round(extra.family_allowance));
  add(payItems, "transport_allowance", "교통보조비", cfg("transport_allowance"));

  const totalPay = payItems.reduce((s, i) => s + i.amount, 0);

  // --- 공제내역 ---
  const deductItems: PayItem[] = [];
  const incomeTax = Math.round(extra.income_tax);
  add(deductItems, "income_tax", "갑근세", incomeTax);
  add(deductItems, "resident_tax", "주민세", floor10(incomeTax * cfg("resident_tax_rate")));
  // 기준액=지급총액(1차). 위 [4대보험 기준액] 주석 참조.
  add(deductItems, "pension", "국민연금", floor10(totalPay * cfg("pension_rate")));
  const health = floor10(totalPay * cfg("health_rate"));
  add(deductItems, "health", "국민건강", health);
  add(deductItems, "longterm_care", "장기요양", floor10(health * cfg("longterm_care_rate")));
  add(deductItems, "employment", "고용보험", floor10(totalPay * cfg("employment_rate")));
  const sangjo = extra.sangjo ?? cfg("sangjo_fee");
  add(deductItems, "sangjo", "상조회비", Math.round(sangjo));
  // 산재보험(accident_rate)은 사업주 부담 → 직원 공제내역에서 제외.

  const totalDeduct = deductItems.reduce((s, i) => s + i.amount, 0);
  const netPay = totalPay - totalDeduct;
  return { payItems, deductItems, totalPay, totalDeduct, netPay };
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
