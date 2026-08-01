// =====================================================================
// 강사비 정산 공용 계산 — 동업자씨/동래샘들 양쪽 저장소 동일 구현.
//   * 순수 계산(DB 접근 없음·import 없음). 입력을 받아 강사 1명의 정산 항목을 산출.
//   * 정산 방식 2종(ST-5):
//     - hourly(시급제)       : amount = round(Σwork_hours × hourly_rate)
//     - revenue_share(분배제): amount = round(enrolled × tuition × share_rate/100)
//       분배제는 근무일지 확정 여부와 무관하다(등록 인원이 기준). 대상 판정은
//       호출자(정산 액션)가 한다 — "정산 기간에 그 프로그램 세션이 1개 이상".
//   * 규칙(ST-4 — 프로그램별 공제)은 두 방식에 동일하게 적용한다:
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
//   * 담당자 조정(ST-5): 분배제만 조정 가능. 인원 또는 금액을 직접 지정하면
//     그 값으로 amount 를 정하고, 자동 계산값을 auto_enrolled/auto_amount 에
//     보존한다(화면 툴팁·"조정됨" 배지 근거). 시급제는 조정하지 않는다 —
//     금액이 틀리면 근무일지를 고쳐 재계산한다(단일 진실 원칙).
// =====================================================================

export type SettlementPayType = "hourly" | "revenue_share";

// 정산 대상 세션 1건(시급제 계산 입력).
export type SettlementSessionInput = {
  program_id: string;
  program_name: string;
  hourly_rate: number; // 프로그램 시급
  deduction_rate: number; // 프로그램 공제율(%)
  work_hours: number; // 세션 근무시간
};

// 분배제 프로그램 1개(계산 입력). 세션이 아니라 프로그램 단위로 들어온다.
export type SettlementRevenueInput = {
  program_id: string;
  program_name: string;
  deduction_rate: number; // 프로그램 공제율(%)
  enrolled: number; // 등록 인원(status='active')
  tuition: number; // 수강료(1인)
  share_rate: number; // 강사 분배 비율(%)
  // 담당자 조정 — 둘 중 하나라도 있으면 조정 항목으로 취급한다.
  //   adjusted_amount 가 있으면 금액을 그대로 쓴다(인원 표시는 adjusted_enrolled).
  //   adjusted_amount 가 없고 adjusted_enrolled 만 있으면 그 인원으로 재계산한다.
  adjusted_enrolled?: number | null;
  adjusted_amount?: number | null;
};

// detail jsonb 항목(프로그램별 내역).
//   ⚠ 과거에 저장된 jsonb 에는 없는 키가 있다. 표시할 때 반드시 유무를 확인한다
//     (확정된 과거 정산은 그대로 보존한다).
//     - deduction_rate/deduction_amount : ST-4 이후
//     - program_id/method 이하           : ST-5 이후. method 가 없으면 hourly.
export type SettlementProgramDetail = {
  program_name: string;
  amount: number;
  // --- 시급제 전용 ---
  sessions?: number; // 회
  hours?: number;
  rate?: number; // 시급
  // --- 공통(ST-4) ---
  deduction_rate?: number;
  deduction_amount?: number;
  // --- 공통(ST-5) ---
  program_id?: string; // 조정 대상 식별용. 이름은 교시가 다르면 중복될 수 있다.
  method?: SettlementPayType;
  // --- 분배제 전용(ST-5) ---
  enrolled?: number;
  tuition?: number;
  share_rate?: number;
  adjusted?: boolean; // 담당자가 인원/금액을 직접 지정했다
  auto_enrolled?: number; // 조정 전 자동 인원
  auto_amount?: number; // 조정 전 자동 금액
};

// 강사 1명 정산 결과.
export type SettlementItemCalc = {
  detail: SettlementProgramDetail[];
  gross_amount: number;
  deduction_rate: number; // 대표값(최고율) — 실제 공제는 detail 참조
  deduction_amount: number;
  net_amount: number;
  adjusted: boolean; // detail 에 조정 항목이 하나라도 있으면 true
};

// 10원 미만 절사(원천징수 관례).
export function truncateTo10(v: number): number {
  return Math.floor(v / 10) * 10;
}

// 프로그램 1개의 공제액 — 절사·반올림 전 원본.
export function calcProgramDeduction(amount: number, rate: number): number {
  return (amount * rate) / 100;
}

// 분배제 기준 금액 — 등록 인원 × 수강료 × 분배율.
export function calcRevenueShareAmount(
  enrolled: number,
  tuition: number,
  shareRate: number
): number {
  return Math.round((enrolled * tuition * shareRate) / 100);
}

// detail 항목의 정산 방식. ST-5 이전 항목에는 method 가 없으므로 hourly 로 본다.
export function detailMethod(d: SettlementProgramDetail): SettlementPayType {
  return d.method === "revenue_share" ? "revenue_share" : "hourly";
}

// 한 강사의 세션(시급제)·프로그램(분배제)으로 정산 항목을 계산.
export function calcInstructorSettlement(
  sessions: SettlementSessionInput[],
  revenue: SettlementRevenueInput[] = []
): SettlementItemCalc {
  const detail: SettlementProgramDetail[] = [];
  let gross = 0;
  let dedRaw = 0; // 프로그램별 공제 합계(절사 전)
  let maxRate = 0; // items.deduction_rate 대표값
  let anyAdjusted = false;

  // 프로그램별 공제·합계 누적(두 방식 공통).
  const accumulate = (amount: number, rate: number): number => {
    const raw = calcProgramDeduction(amount, rate);
    gross += amount;
    dedRaw += raw;
    if (rate > maxRate) maxRate = rate;
    return raw;
  };

  // --- 시급제: 프로그램별 그룹핑 후 Σhours × 시급 ---
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
  for (const [programId, g] of byProgram) {
    const amount = Math.round(g.hours * g.rate);
    const raw = accumulate(amount, g.ded);
    detail.push({
      program_name: g.name,
      amount,
      sessions: g.count,
      hours: g.hours,
      rate: g.rate,
      deduction_rate: g.ded,
      deduction_amount: Math.floor(raw),
      program_id: programId,
      method: "hourly",
    });
  }

  // --- 분배제: 프로그램 1개 = 항목 1개 ---
  for (const r of revenue) {
    const autoAmount = calcRevenueShareAmount(r.enrolled, r.tuition, r.share_rate);
    const adjEnrolled =
      r.adjusted_enrolled == null ? null : Math.max(0, Math.round(r.adjusted_enrolled));
    const adjAmount =
      r.adjusted_amount == null ? null : Math.max(0, Math.round(r.adjusted_amount));
    const isAdjusted = adjEnrolled != null || adjAmount != null;

    // 금액 지정이 우선. 인원만 지정하면 그 인원으로 다시 계산한다.
    const enrolled = adjEnrolled ?? r.enrolled;
    const amount =
      adjAmount != null
        ? adjAmount
        : adjEnrolled != null
          ? calcRevenueShareAmount(adjEnrolled, r.tuition, r.share_rate)
          : autoAmount;

    const raw = accumulate(amount, r.deduction_rate);
    const entry: SettlementProgramDetail = {
      program_name: r.program_name,
      amount,
      deduction_rate: r.deduction_rate,
      deduction_amount: Math.floor(raw),
      program_id: r.program_id,
      method: "revenue_share",
      enrolled,
      tuition: r.tuition,
      share_rate: r.share_rate,
    };
    if (isAdjusted) {
      entry.adjusted = true;
      entry.auto_enrolled = r.enrolled;
      entry.auto_amount = autoAmount;
      anyAdjusted = true;
    }
    detail.push(entry);
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
    adjusted: anyAdjusted,
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

// 소수점 두 자리까지, 불필요한 0 은 떼고(회차당 시간·비율 표기).
function trimNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}

// 산출내역 문구 — 화면·엑셀·강사앱이 같은 문장을 쓴다.
//   hourly        : "4회 × 3h × 40,000"
//   revenue_share : "13명 × 88,000 × 70%"
//   조정된 항목은 "(조정)" 접미가 붙는다.
export function calcFormula(d: SettlementProgramDetail): string {
  const krw = (n: number) => n.toLocaleString("ko-KR");
  let text: string;
  if (detailMethod(d) === "revenue_share") {
    text = `${d.enrolled ?? 0}명 × ${krw(d.tuition ?? 0)} × ${trimNum(
      d.share_rate ?? 0
    )}%`;
  } else {
    const sessions = d.sessions ?? 0;
    const hours = d.hours ?? 0;
    const per = sessions > 0 ? hours / sessions : hours;
    text = `${sessions}회 × ${trimNum(per)}h × ${krw(d.rate ?? 0)}`;
  }
  return d.adjusted ? `${text} (조정)` : text;
}
