// =====================================================================
// 강사비 정산 공용 계산 — 동업자씨/동래샘들 양쪽 저장소 동일 구현.
//   * 순수 계산(DB 접근 없음). 세션 입력을 받아 강사 1명의 정산 항목을 산출.
//   * 규칙(ST-4 — 프로그램별 공제):
//     - 강사별·프로그램별 집계: hours=Σwork_hours, amount=round(hours×hourly_rate).
//     - 프로그램별 공제: 자기 프로그램의 deduction_rate 로 amount×rate/100.
//       detail 에는 표시용으로 원 미만 절사한 deduction_amount 를 담는다.
//       ※ 절사는 합계에만 적용하므로, 표시용 프로그램별 공제의 단순 합이 항목
//         deduction_amount 보다 최대 9원 클 수 있다(정상). 지급 기준은 항목값.
//     - gross=Σamount(프로그램 합).
//     - deduction=floor(Σ프로그램별공제 / 10)×10  — 합계에 10원 미만 절사 1회만
//       적용(급여 모듈 관례). 프로그램별로는 절사하지 않는다.
//     - net=gross−deduction.
//     - items.deduction_rate 컬럼에는 대표값(최고율)만 기록한다. 실제 공제는
//       프로그램별이므로 화면·엑셀은 detail 의 프로그램별 공제를 표시한다.
//   * 합계는 반올림 전 원본으로 계산하므로, 프로그램이 1개인 정산(대부분)의
//     결과는 프로그램별 공제 도입 전과 완전히 동일하다.
// =====================================================================

// 정산 대상 세션 1건(정규화된 계산 입력).
export type SettlementSessionInput = {
  program_id: string;
  program_name: string;
  hourly_rate: number; // 프로그램 시급
  deduction_rate: number; // 프로그램 공제율(%)
  work_hours: number; // 세션 근무시간
};

// detail jsonb 항목(프로그램별 내역).
export type SettlementProgramDetail = {
  program_name: string;
  sessions: number; // 회
  hours: number;
  rate: number; // 시급
  amount: number; // round(hours×rate)
  // 아래 2개는 ST-4 이후 생성·재계산된 항목에만 있다. 그 전에 저장된 jsonb 에는
  // 없으므로 표시할 때 반드시 유무를 확인한다(확정된 과거 정산은 그대로 보존).
  deduction_rate?: number; // 프로그램 공제율(%)
  deduction_amount?: number; // 프로그램 공제액(원 미만 절사, 표시용)
};

// 강사 1명 정산 결과.
export type SettlementItemCalc = {
  detail: SettlementProgramDetail[];
  gross_amount: number;
  deduction_rate: number; // 대표값(최고율) — 실제 공제는 detail 참조
  deduction_amount: number;
  net_amount: number;
};

// 10원 미만 절사(원천징수 관례).
export function truncateTo10(v: number): number {
  return Math.floor(v / 10) * 10;
}

// 프로그램 1개의 공제액 — 절사·반올림 전 원본.
export function calcProgramDeduction(amount: number, rate: number): number {
  return (amount * rate) / 100;
}

// 한 강사의 세션들(여러 프로그램 가능)로 정산 항목을 계산.
export function calcInstructorSettlement(
  sessions: SettlementSessionInput[]
): SettlementItemCalc {
  // 프로그램별 그룹핑.
  const byProgram = new Map<
    string,
    { name: string; rate: number; ded: number; hours: number; count: number }
  >();
  for (const s of sessions) {
    const g =
      byProgram.get(s.program_id) ??
      {
        name: s.program_name,
        rate: s.hourly_rate,
        ded: s.deduction_rate,
        hours: 0,
        count: 0,
      };
    g.hours += s.work_hours;
    g.count += 1;
    byProgram.set(s.program_id, g);
  }

  const detail: SettlementProgramDetail[] = [];
  let gross = 0;
  let dedRaw = 0; // 프로그램별 공제 합계(절사 전)
  let maxRate = 0; // items.deduction_rate 대표값
  for (const g of byProgram.values()) {
    const amount = Math.round(g.hours * g.rate);
    const raw = calcProgramDeduction(amount, g.ded);
    detail.push({
      program_name: g.name,
      sessions: g.count,
      hours: g.hours,
      rate: g.rate,
      amount,
      deduction_rate: g.ded,
      deduction_amount: Math.floor(raw),
    });
    gross += amount;
    dedRaw += raw;
    if (g.ded > maxRate) maxRate = g.ded;
  }
  detail.sort((a, b) => a.program_name.localeCompare(b.program_name, "ko"));

  const deduction_amount = truncateTo10(dedRaw);
  const net_amount = gross - deduction_amount;

  return {
    detail,
    gross_amount: gross,
    deduction_rate: maxRate,
    deduction_amount,
    net_amount,
  };
}

// detail 에 실제로 쓰인 공제율들(오름차순·중복 제거). ST-4 이전 항목은 비어 있다.
export function uniqueDeductionRates(
  detail: SettlementProgramDetail[]
): number[] {
  const set = new Set<number>();
  for (const d of detail) {
    if (typeof d.deduction_rate === "number") set.add(d.deduction_rate);
  }
  return [...set].sort((a, b) => a - b);
}

// 화면·엑셀 공용 공제율 표시(% 기호 없음). 프로그램별로 다르면 모두 나열.
//   rates 가 비면(ST-4 이전 항목) 항목 대표값으로 폴백.
export function deductionRateLabel(
  detail: SettlementProgramDetail[],
  fallbackRate: number
): string {
  const rates = uniqueDeductionRates(detail);
  if (rates.length === 0) return String(fallbackRate);
  return rates.join("/");
}
