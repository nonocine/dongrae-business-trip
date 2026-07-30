// =====================================================================
// 강사비 정산 공용 계산 — 동업자씨/동래샘들 양쪽 저장소 동일 구현.
//   * 순수 계산(DB 접근 없음). 세션 입력을 받아 강사 1명의 정산 항목을 산출.
//   * 규칙:
//     - 강사별·프로그램별 집계: hours=Σwork_hours, amount=round(hours×hourly_rate).
//     - gross=Σamount(프로그램 합).
//     - deduction=floor(gross×rate/100/10)×10  (원천징수 10원 미만 절사, 급여 모듈 관례).
//     - net=gross−deduction.
//     - detail: 프로그램별 [{program_name, sessions(회), hours, rate, amount}].
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
};

// 강사 1명 정산 결과.
export type SettlementItemCalc = {
  detail: SettlementProgramDetail[];
  gross_amount: number;
  deduction_rate: number;
  deduction_amount: number;
  net_amount: number;
};

// 원천징수 공제액 — 10원 미만 절사.
export function calcDeduction(gross: number, rate: number): number {
  return Math.floor((gross * rate) / 100 / 10) * 10;
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
  const dedRates: number[] = [];
  for (const g of byProgram.values()) {
    const amount = Math.round(g.hours * g.rate);
    detail.push({
      program_name: g.name,
      sessions: g.count,
      hours: g.hours,
      rate: g.rate,
      amount,
    });
    gross += amount;
    dedRates.push(g.ded);
  }
  detail.sort((a, b) => a.program_name.localeCompare(b.program_name, "ko"));

  // 공제율: 강사의 프로그램들이 동일하면 그 값, 다르면 최대값(보수적 원천징수).
  const deduction_rate = dedRates.length ? Math.max(...dedRates) : 0;
  const deduction_amount = calcDeduction(gross, deduction_rate);
  const net_amount = gross - deduction_amount;

  return { detail, gross_amount: gross, deduction_rate, deduction_amount, net_amount };
}
