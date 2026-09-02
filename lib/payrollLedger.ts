// =====================================================================
// 강사비 지급대장 행 만들기 — 순수 함수(DB·복호화 없음).
//   * 행은 "강사 + 과목" 단위입니다. 같은 과목이면 프로그램이 여러 개
//     (기초반·전문반)라도 한 행으로 합산하고, 과목이 다르면 행을 나눕니다.
//     담당자(이민정)가 쓰던 양식과 같은 모양입니다.
//   * 주민번호는 이미 평문으로 넘겨받습니다 — 이 모듈은 암호문을 모릅니다.
//     복호화는 서버 액션(getPayrollLedgerData)에서만 합니다.
//   * 엑셀 서식은 lib/payrollLedgerExport.ts, 값 만들기는 여기입니다.
//     순수 함수라 scripts/test-payroll-ledger.ts 로 바로 검증할 수 있습니다.
// =====================================================================

import { detailMethod, type SettlementProgramDetail } from "@/lib/settlement";

// 지급대장 한 행(= 강사 1명의 과목 1개).
export type PayrollLedgerRow = {
  seq: number;
  name: string;
  subject: string;
  // 주민번호 평문에 하이픈을 넣은 표기. 없거나 복호화 실패면 "".
  rrn: string;
  // 산출내역. 시급·시간이 다른 프로그램이 섞이면 줄바꿈으로 여러 줄이 됩니다.
  calc: string;
  amount: number;
  bankName: string;
  bankAccount: string;
};
export type PayrollLedgerData = {
  title: string;
  projectName: string;
  period_start: string | null;
  period_end: string | null;
  rows: PayrollLedgerRow[];
};

// 강사 1명분 입력 — 서버 액션이 정산 항목 + 복호화한 주민번호를 담아 넘깁니다.
export type LedgerInstructorInput = {
  name: string;
  rrn: string;
  bankName: string;
  bankAccount: string;
  // 항목(강사) 단위 확정 지급총액. 과목이 하나로 묶일 때 이 값을 씁니다.
  gross: number;
  detail: SettlementProgramDetail[];
};

const krw = (n: number) => Number(n ?? 0).toLocaleString("ko-KR");

// 1회 시간 — 정수면 "1", 소수면 "1.5"(소수점 2자리까지). 양식 표기와 동일.
function hourText(per: number): string {
  return String(Math.round(per * 100) / 100);
}

// 한 과목의 산출내역.
//   * 시급제는 (시급, 1회 시간)이 같은 것끼리 회차를 더해 한 줄로 씁니다.
//     예) 4회 + 3회 (둘 다 1.5h·40,000) → "40,000원*1.5H*7회"
//   * 시급이나 시간이 다르면 한 줄로 표현할 수 없어 줄바꿈으로 나열합니다.
//     예) "40,000원*1.5H*4회\n40,000원*1H*4회"
//   * d.hours 는 그 프로그램의 총 시간이라 회차로 나눠 1회 시간을 냅니다
//     (lib/settlement 의 calcFormula 와 같은 계산).
//   * 분배제는 인원·수강료·비율이 제각각이라 합치지 않고 항목별 한 줄입니다.
export function ledgerCalcLines(list: SettlementProgramDetail[]): string {
  const lines: string[] = [];

  const hourly = new Map<
    string,
    { rate: number; per: number; sessions: number }
  >();
  for (const d of list) {
    if (detailMethod(d) === "revenue_share") continue;
    const sessions = d.sessions ?? 0;
    const hours = d.hours ?? 0;
    const per =
      Math.round((sessions > 0 ? hours / sessions : hours) * 100) / 100;
    const rate = d.rate ?? 0;
    const key = `${rate}|${per}`;
    const g = hourly.get(key) ?? { rate, per, sessions: 0 };
    g.sessions += sessions;
    hourly.set(key, g);
  }
  for (const g of hourly.values())
    lines.push(`${krw(g.rate)}원*${hourText(g.per)}H*${g.sessions}회`);

  for (const d of list) {
    if (detailMethod(d) !== "revenue_share") continue;
    lines.push(
      `${d.enrolled ?? 0}명*${krw(d.tuition ?? 0)}원*${d.share_rate ?? 0}%`
    );
  }

  return lines.join("\n");
}

// 강사 목록 → 지급대장 행. 연번은 최종 행 기준으로 1씩 올라갑니다.
//   * subjectById 는 program_id → 과목명. 없으면 program_name 으로 폴백합니다
//     (과목 미입력 프로그램, 그리고 program_id 가 없던 과거 항목).
//   * Map 은 삽입 순서를 지키므로 detail 순서가 그대로 유지됩니다.
export function buildLedgerRows(
  instructors: LedgerInstructorInput[],
  subjectById: Map<string, string>
): PayrollLedgerRow[] {
  const rows: PayrollLedgerRow[] = [];

  for (const ins of instructors) {
    // 프로그램 내역이 없는 항목 — 항목 값만 한 행으로.
    if (ins.detail.length === 0) {
      rows.push({
        seq: rows.length + 1,
        name: ins.name,
        subject: "",
        rrn: ins.rrn,
        calc: "",
        amount: ins.gross,
        bankName: ins.bankName,
        bankAccount: ins.bankAccount,
      });
      continue;
    }

    const groups = new Map<
      string,
      { subject: string; items: SettlementProgramDetail[] }
    >();
    for (const d of ins.detail) {
      const subject =
        (d.program_id ? subjectById.get(d.program_id) : undefined) ??
        d.program_name ??
        "";
      const g = groups.get(subject) ?? { subject, items: [] };
      g.items.push(d);
      groups.set(subject, g);
    }

    const groupList = [...groups.values()];
    for (const g of groupList) {
      rows.push({
        seq: rows.length + 1,
        name: ins.name,
        subject: g.subject,
        rrn: ins.rrn,
        calc: ledgerCalcLines(g.items),
        // 과목이 하나로 묶이면 항목 확정값을, 여러 과목이면 묶음별 합계를 씁니다.
        //   gross 는 프로그램 amount 의 단순 합이라 두 값이 일치합니다
        //   (lib/settlement 의 accumulate) — 강사 총액은 어느 쪽이든 같습니다.
        amount:
          groupList.length === 1
            ? ins.gross
            : g.items.reduce((s, d) => s + Number(d.amount ?? 0), 0),
        bankName: ins.bankName,
        bankAccount: ins.bankAccount,
      });
    }
  }

  return rows;
}
