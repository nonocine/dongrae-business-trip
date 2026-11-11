// =====================================================================
// 연차수당 산정 — 통상임금·금액 계산(순수 함수, 화면·서버 공용).
//   * 월 통상임금 = 포함 항목의 월액 합. 항목 월액은 그 직원 연봉계약서(salary_contracts)의
//     12월이 든 구간 금액 ÷ 구간 개월 수(구간 금액은 '구간 합계' — lib/salaryContracts 의 computeSalaryContract).
//     명절휴가비만 '연액 ÷ 12'(설·추석이 든 구간이 따로 있어 구간 기준으로는 0 이 될 수 있음).
//   * 시간급 = 월 통상임금 ÷ 209, 일급 = 시간급 × 8(원 미만 절사 — 정수로 floor(월 × 8 ÷ 209)).
//   * 금액 = 일급 × 미사용 일수(0.5일 단위), 원 미만 절사.
//   * 포함 항목 기본값: 기본급·식대·자격수당·관리수당·교통보조비·명절휴가비 포함, 가족수당 제외.
// =====================================================================

export type PayoutCategory = "first_year_monthly" | "annual_unpromoted" | "annual_promoted";
export const PAYOUT_CATEGORY_LABEL: Record<PayoutCategory, string> = {
  first_year_monthly: "첫해 월차(12/31 리셋분)",
  annual_unpromoted: "회계연도 연차(촉진 미완료)",
  annual_promoted: "회계연도 연차(촉진 완료 — 제외)",
};
export const PROMOTED_EXCLUDE_REASON = "사용촉진 완료(제61조)";

export const WAGE_ITEMS = ["base", "meal", "cert", "mgmt", "transport", "holiday", "family"] as const;
export type WageItem = (typeof WAGE_ITEMS)[number];
export const WAGE_ITEM_LABEL: Record<WageItem, string> = {
  base: "기본급",
  meal: "식대",
  cert: "자격수당",
  mgmt: "관리수당",
  transport: "교통보조비",
  holiday: "명절휴가비(연액÷12)",
  family: "가족수당",
};
export type WageBasis = Record<WageItem, boolean>;
export const DEFAULT_WAGE_BASIS: WageBasis = {
  base: true,
  meal: true,
  cert: true,
  mgmt: true,
  transport: true,
  holiday: true,
  family: false,
};
export const HOLIDAY_BONUS_NOTE =
  "명절휴가비 포함 여부는 대법원 2024.12.19. 전원합의체 판결(재직조건부 정기상여 통상임금 인정) 취지를 반영한 기본값입니다. 확정 전 노무사 확인이 필요합니다.";
export const MONTHLY_HOURS = 209;

export function normalizeWageBasis(v: unknown): WageBasis {
  const out = { ...DEFAULT_WAGE_BASIS };
  if (v && typeof v === "object")
    for (const k of WAGE_ITEMS) if (typeof (v as Record<string, unknown>)[k] === "boolean") out[k] = (v as Record<string, boolean>)[k];
  return out;
}

export const roundHalfDay = (v: number) => Math.round(Math.max(0, Number(v) || 0) * 2) / 2;

// 계약서 구간(구간 합계 금액) → 항목별 월액.
export type ContractSegmentLike = {
  start_month: number;
  end_month: number;
  months?: number;
  base: number;
  meal_amt: number;
  cert: number;
  mgmt: number;
  transport_amt: number;
  family: number;
  holiday: number;
};
export type WageItemValue = { key: WageItem; label: string; monthly: number; basis: string };

export function monthlyItemsFromContract(segments: ContractSegmentLike[]): {
  items: WageItemValue[];
  segment: { start_month: number; end_month: number } | null;
} {
  const segs = [...segments].sort((a, b) => a.start_month - b.start_month);
  const dec = segs.find((s) => s.start_month <= 12 && s.end_month >= 12) ?? segs[segs.length - 1];
  if (!dec) return { items: [], segment: null };
  const months = Math.max(1, dec.months ?? dec.end_month - dec.start_month + 1);
  const per = (v: number) => Math.floor((Number(v) || 0) / months);
  const holidayYear = segs.reduce((a, s) => a + (Number(s.holiday) || 0), 0);
  const seg = `${dec.start_month}~${dec.end_month}월 구간(${months}개월)`;
  return {
    segment: { start_month: dec.start_month, end_month: dec.end_month },
    items: [
      { key: "base", label: WAGE_ITEM_LABEL.base, monthly: per(dec.base), basis: `${seg} 기본급 ÷ ${months}` },
      { key: "meal", label: WAGE_ITEM_LABEL.meal, monthly: per(dec.meal_amt), basis: `${seg} 급식비 ÷ ${months}` },
      { key: "cert", label: WAGE_ITEM_LABEL.cert, monthly: per(dec.cert), basis: `${seg} 자격수당 ÷ ${months}` },
      { key: "mgmt", label: WAGE_ITEM_LABEL.mgmt, monthly: per(dec.mgmt), basis: `${seg} 관리업무수당 ÷ ${months}` },
      { key: "transport", label: WAGE_ITEM_LABEL.transport, monthly: per(dec.transport_amt), basis: `${seg} 교통보조비 ÷ ${months}` },
      { key: "holiday", label: WAGE_ITEM_LABEL.holiday, monthly: Math.floor(holidayYear / 12), basis: `연간 명절휴가비 ${holidayYear.toLocaleString("ko-KR")} ÷ 12` },
      { key: "family", label: WAGE_ITEM_LABEL.family, monthly: per(dec.family), basis: `${seg} 가족수당 ÷ ${months}` },
    ],
  };
}

export type PayoutCalc = {
  monthly: number;
  hourly: number; // 표시용(소수 둘째 자리)
  daily: number;
  amount: number;
  formula: string;
};

export function calcPayout(items: WageItemValue[], basis: WageBasis, unusedDays: number): PayoutCalc {
  const monthly = items.filter((i) => basis[i.key]).reduce((a, i) => a + i.monthly, 0);
  const daily = Math.floor((monthly * 8) / MONTHLY_HOURS);
  const days = roundHalfDay(unusedDays);
  const amount = Math.floor(daily * days);
  const hourly = Math.round((monthly / MONTHLY_HOURS) * 100) / 100;
  const won = (n: number) => n.toLocaleString("ko-KR");
  return {
    monthly,
    hourly,
    daily,
    amount,
    formula: `월 통상임금 ${won(monthly)}원 ÷ ${MONTHLY_HOURS} = 시간급 ${hourly.toLocaleString("ko-KR")}원 → × 8 = 일급 ${won(daily)}원(원 미만 절사) → × ${days}일 = ${won(amount)}원`,
  };
}
