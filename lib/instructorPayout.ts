// =====================================================================
// 강사비 지출표 — 회계 담당(김혜지 팀장)이 실제로 이체·품의를 올리는 화면의
//   순수 규칙 모음. DB·네트워크 없이 도는 함수만 둡니다(테스트 가능하게).
//
//   ★ 이 모듈은 금액을 "계산" 하지 않습니다.
//     정산(saem_settlement_items)에 이미 저장된 gross/deduction/net 을 그대로
//     쓰고, 합계만 화면에서 더합니다. 계산 로직은 lib/settlement.ts 하나뿐이고
//     여기서 다시 계산하면 두 벌이 되어 언젠가 어긋납니다.
//
//   ★ 설계의 핵심 — 한 사람이 여러 재원에 걸칩니다.
//     실측(2026-09): 박해경·김세화·강보현·황리나·박시은 5명이 '3차시
//     강사비(보조금)' 와 '3차시 강사비(운영비)' 두 정산에 동시에 들어 있습니다.
//     재원이 다른 돈이 같은 사람에게 나갑니다. 그래서 보기를 둘로 나눕니다.
//       ⓐ 재원(정산)별 — 지출 품의를 올리는 단위. 정산 하나 = 품의 하나.
//       ⓑ 사람별      — "이 사람에게 이번 달 총 얼마" + 어느 재원에서 얼마씩.
//     한 사람 한 줄로 합쳐 버리면 ⓐ 가 불가능해지고, 정산별로만 보면 ⓑ 를
//     알 수 없습니다. 둘 다 있어야 합니다.
// =====================================================================

export type PayoutStatus = "draft" | "confirmed";

// 지급 전 확인 필요 사유 — 김혜지가 이체하다 막히는 지점을 미리 잡습니다.
//   실측: 이민정은 계좌·예금주·주민번호가 하나도 없는데 정산에 올라 있습니다.
export type PayoutBlocker =
  | "은행 미등록"
  | "계좌번호 미등록"
  | "예금주 미등록"
  | "주민번호 미등록"
  | "실지급액 0 이하"
  | "작성중 정산";

// 표의 한 줄 = (정산 × 강사) 하나. saem_settlement_items 한 행과 1:1 입니다.
export type PayoutRow = {
  key: string; // settlementId|instructorId
  settlementId: string;
  settlementTitle: string; // 재원 — 화면·엑셀의 "재원(정산명)"
  projectId: string;
  projectName: string; // 사업명
  periodStart: string | null;
  periodEnd: string | null;
  status: PayoutStatus;

  instructorId: string;
  name: string;
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
  // 주민번호는 마스크만 화면까지 옵니다. 복호화하지 않습니다.
  rrnMask: string | null;
  hasRrn: boolean; // 등록 여부만 — "지급 전 확인" 판정용

  gross: number;
  deductionRate: number;
  deduction: number;
  net: number;
  adjusted: boolean; // 담당자가 손으로 조정한 항목(계산과 다른 이유)

  blockers: PayoutBlocker[];
};

export type PayoutTotals = {
  people: number; // 사람 수(중복 제거)
  rows: number; // 줄 수
  gross: number;
  deduction: number;
  net: number;
};

// 사람별 보기 한 덩이 — 한 사람 + 그 사람에게 나가는 재원별 내역.
export type PayoutPerson = {
  instructorId: string;
  name: string;
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
  rrnMask: string | null;
  rows: PayoutRow[];
  gross: number;
  deduction: number;
  net: number;
  blockers: PayoutBlocker[];
  sources: number; // 재원 수 — 2 이상이면 화면에서 눈에 띄게 표시
};

// 재원(정산)별 보기 한 덩이.
export type PayoutSource = {
  settlementId: string;
  title: string;
  projectName: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: PayoutStatus;
  rows: PayoutRow[];
  gross: number;
  deduction: number;
  net: number;
  blockerCount: number;
};

// =====================================================================
// 지급 전 확인 사유 판정
//   * 계좌 세 칸(은행·번호·예금주)은 이체에 그대로 필요합니다.
//   * 주민번호는 지급대장·원천징수에 필요해 '등록 여부' 만 봅니다(복호화 금지).
//   * 작성중(draft) 정산은 금액이 아직 바뀔 수 있어 지출 근거가 못 됩니다.
// =====================================================================
export function payoutBlockers(input: {
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
  hasRrn: boolean;
  net: number;
  status: PayoutStatus;
}): PayoutBlocker[] {
  const out: PayoutBlocker[] = [];
  if (!input.bankName?.trim()) out.push("은행 미등록");
  if (!input.bankAccount?.trim()) out.push("계좌번호 미등록");
  if (!input.accountHolder?.trim()) out.push("예금주 미등록");
  if (!input.hasRrn) out.push("주민번호 미등록");
  if (!(input.net > 0)) out.push("실지급액 0 이하");
  if (input.status !== "confirmed") out.push("작성중 정산");
  return out;
}

// =====================================================================
// 기간 겹침 — 정산 기간과 조회 기간이 하루라도 겹치면 포함합니다.
//   * 정산은 "7/4 ~ 8/29" 처럼 달을 걸치는 일이 흔해서, 시작일만 보면
//     8월 조회에서 7월 시작 정산이 통째로 사라집니다.
//   * 정산 쪽 날짜가 비어 있으면(옛 데이터) 기간으로 걸러내지 않습니다 —
//     안 보이는 것보다 보이는 편이 회계에 안전합니다.
// =====================================================================
export function overlapsPeriod(
  row: { periodStart: string | null; periodEnd: string | null },
  from: string,
  to: string
): boolean {
  if (!from && !to) return true;
  const s = row.periodStart ?? "";
  const e = row.periodEnd ?? "";
  if (!s && !e) return true;
  const start = s || e;
  const end = e || s;
  if (from && end < from) return false;
  if (to && start > to) return false;
  return true;
}

// =====================================================================
// 집계
// =====================================================================
export function sumTotals(rows: PayoutRow[]): PayoutTotals {
  const people = new Set(rows.map((r) => r.instructorId));
  return {
    people: people.size,
    rows: rows.length,
    gross: rows.reduce((a, r) => a + r.gross, 0),
    deduction: rows.reduce((a, r) => a + r.deduction, 0),
    net: rows.reduce((a, r) => a + r.net, 0),
  };
}

// 사람별로 묶기 — 이름 가나다순, 한 사람 안에서는 재원명 순.
export function groupByPerson(rows: PayoutRow[]): PayoutPerson[] {
  const map = new Map<string, PayoutRow[]>();
  for (const r of rows) {
    const list = map.get(r.instructorId) ?? [];
    list.push(r);
    map.set(r.instructorId, list);
  }
  const out: PayoutPerson[] = [];
  for (const [instructorId, list] of map) {
    const sorted = [...list].sort((a, b) =>
      a.settlementTitle.localeCompare(b.settlementTitle, "ko")
    );
    const head = sorted[0];
    // 확인 사유는 사람 단위로 합칩니다(계좌가 없으면 모든 재원에서 막힘).
    const blockers = [...new Set(sorted.flatMap((r) => r.blockers))];
    out.push({
      instructorId,
      name: head.name,
      bankName: head.bankName,
      bankAccount: head.bankAccount,
      accountHolder: head.accountHolder,
      rrnMask: head.rrnMask,
      rows: sorted,
      gross: sorted.reduce((a, r) => a + r.gross, 0),
      deduction: sorted.reduce((a, r) => a + r.deduction, 0),
      net: sorted.reduce((a, r) => a + r.net, 0),
      blockers,
      sources: new Set(sorted.map((r) => r.settlementId)).size,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

// 재원(정산)별로 묶기 — 기간 늦은 순, 같으면 제목순.
export function groupBySource(rows: PayoutRow[]): PayoutSource[] {
  const map = new Map<string, PayoutRow[]>();
  for (const r of rows) {
    const list = map.get(r.settlementId) ?? [];
    list.push(r);
    map.set(r.settlementId, list);
  }
  const out: PayoutSource[] = [];
  for (const [settlementId, list] of map) {
    const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const head = sorted[0];
    out.push({
      settlementId,
      title: head.settlementTitle,
      projectName: head.projectName,
      periodStart: head.periodStart,
      periodEnd: head.periodEnd,
      status: head.status,
      rows: sorted,
      gross: sorted.reduce((a, r) => a + r.gross, 0),
      deduction: sorted.reduce((a, r) => a + r.deduction, 0),
      net: sorted.reduce((a, r) => a + r.net, 0),
      blockerCount: sorted.filter((r) => r.blockers.length > 0).length,
    });
  }
  return out.sort((a, b) => {
    const ae = a.periodEnd ?? a.periodStart ?? "";
    const be = b.periodEnd ?? b.periodStart ?? "";
    if (ae !== be) return be.localeCompare(ae);
    return a.title.localeCompare(b.title, "ko");
  });
}

// =====================================================================
// 기간 기본값 — 이번 달 1일 ~ 말일 (KST).
//   서버·브라우저가 같은 값을 써야 하이드레이션이 어긋나지 않으므로,
//   화면은 서버가 계산해 내려준 값을 그대로 씁니다.
// =====================================================================
export function monthRange(ymd: string): { from: string; to: string } {
  const [y, m] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

export const KRW = (n: number): string => n.toLocaleString("ko-KR");

// =====================================================================
// 필터 — 화면과 엑셀이 같은 규칙을 쓰도록 여기 한 벌만 둡니다.
//   (엑셀이 화면과 다른 줄을 뽑으면 품의서와 이체 내역이 어긋납니다)
// =====================================================================
export type PayoutFilters = {
  from: string; // "YYYY-MM-DD" — 빈 문자열이면 기간 제한 없음
  to: string;
  projectId: string; // "" = 전체
  settlementId: string; // "" = 전체
};

export function filterPayoutRows(
  rows: PayoutRow[],
  f: PayoutFilters
): PayoutRow[] {
  return rows.filter((r) => {
    if (f.settlementId && r.settlementId !== f.settlementId) return false;
    if (f.projectId && r.projectId !== f.projectId) return false;
    return overlapsPeriod(r, f.from, f.to);
  });
}
