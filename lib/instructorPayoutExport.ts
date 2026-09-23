// =====================================================================
// 강사비 지출표 엑셀 — 은행 제출·품의 첨부에 바로 쓰는 문서.
//
//   * 서식은 기존 강사비 지급대장(lib/payrollLedgerExport.ts)을 따릅니다 —
//     네이비 머리줄, 얇은 회색 테두리, #,##0 금액, 합계 행 SUM 수식,
//     창 고정, 하단 안내 한 줄. 회계가 두 문서를 나란히 놓고 봅니다.
//   * 지급대장과 다른 점(일부러 다릅니다)
//       · 주민번호 평문을 쓰지 않습니다. 이 화면은 복호화하지 않습니다.
//       · 금액은 정산에 저장된 값을 그대로 씁니다(지급대장은 양식 수식을
//         새로 넣어 몇 원 달라질 수 있습니다 — 그쪽 주석 참고).
//         여기서 수식을 넣으면 화면 합계와 엑셀 합계가 갈라집니다.
//       · 합계 행만 SUM 수식입니다. 김혜지 팀장이 눌러 검산할 수 있게.
//   * ⚠️ 계좌번호는 반드시 텍스트 서식("@")입니다. 숫자로 들어가면
//     "01012345678" 의 앞자리 0 이 날아가 이체가 실패합니다.
//   * 가드 없음 — 라우트가 requireSalaryAccess 후 호출합니다.
// =====================================================================

import ExcelJS from "exceljs";
import {
  groupByPerson,
  sumTotals,
  type PayoutRow,
} from "@/lib/instructorPayout";

const NAVY = "FF1F3A5F";
const MONEY = "#,##0";
const TEXT = "@"; // 계좌번호 — 앞자리 0 보존
const GRAY = "FF6B7280";
const TOTAL_BG = "FFF3F4F6";
const SUB_BG = "FFF8F9FA";
const WARN = "FFB91C1C";

const thin = { style: "thin" as const, color: { argb: "FFE5E7EB" } };
const border = { top: thin, bottom: thin, left: thin, right: thin };

// A 연번 / B 성명 / C 은행 / D 계좌번호 / E 예금주 / F 총지급액 /
// G 공제액 / H 실지급액 / I 재원(정산명) / J 사업명 / K 비고
const COLS = 11;
const C_SEQ = 1;
const C_ACCOUNT = 4;
const C_GROSS = 6;
const C_DED = 7;
const C_NET = 8;
const C_NOTE = 11;
const HEADERS = [
  "연번",
  "성명",
  "은행",
  "계좌번호",
  "예금주",
  "총지급액",
  "공제액",
  "실지급액",
  "재원(정산명)",
  "사업명",
  "비고",
];

export type PayoutExportMode = "source" | "person";

export type PayoutExportInput = {
  rows: PayoutRow[];
  mode: PayoutExportMode;
  from: string;
  to: string;
  filterLabel: string; // "사업: 전체 · 재원: 전체" 처럼 화면에서 고른 조건
};

// 비고 — 회계가 이 줄에서 왜 멈춰야 하는지 한 칸으로 압축합니다.
function noteOf(r: PayoutRow): string {
  const parts: string[] = [];
  if (r.blockers.length) parts.push(`⚠ ${r.blockers.join(", ")}`);
  if (r.adjusted) parts.push("수동 조정");
  return parts.join(" / ");
}

export async function buildPayoutWorkbook(
  d: PayoutExportInput
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "동래구청소년센터";
  const ws = wb.addWorksheet("강사비 지출표");

  // --- 1행: 제목 위 여백(지급대장과 같은 모양) ---
  ws.addRow([]);

  // --- 2행: 제목 ---
  const modeLabel = d.mode === "person" ? "사람별" : "재원별";
  const titleRow = ws.addRow([`강사비 지출표 (${modeLabel})`]);
  ws.mergeCells(2, 1, 2, COLS);
  titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: NAVY } };
  titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  titleRow.height = 28;

  // --- 3행: 조회 조건(왼쪽) + 단위(오른쪽) ---
  const condRow = ws.addRow([]);
  const period = d.from || d.to ? `${d.from || "처음"} ~ ${d.to || "끝"}` : "전체 기간";
  condRow.getCell(1).value = `조회 기간 ${period} · ${d.filterLabel}`;
  condRow.getCell(1).font = { size: 9, color: { argb: GRAY } };
  ws.mergeCells(3, 1, 3, COLS - 1);
  condRow.getCell(COLS).value = "(단위: 원)";
  condRow.getCell(COLS).font = { size: 9, color: { argb: GRAY } };
  condRow.getCell(COLS).alignment = { horizontal: "right" };

  // --- 4행: 머리줄 ---
  const head = ws.addRow(HEADERS);
  head.height = 22;
  for (let c = 1; c <= COLS; c++) {
    const cell = head.getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = border;
  }
  // --- 5행부터: 데이터 ---
  //   재원별은 화면 정렬(재원 → 이름)을 그대로, 사람별은 사람으로 묶고
  //   재원이 둘 이상인 사람 뒤에 소계 한 줄을 넣습니다 — 실측에서 5명이
  //   보조금·운영비 두 재원에 걸쳐 있어, 이 소계가 "이 사람에게 총 얼마" 입니다.
  let seq = 0;
  const dataLines: number[] = []; // 합계에서 셀 소계 행을 빼기 위해 데이터 행만 기록

  const writeRow = (r: PayoutRow) => {
    seq += 1;
    const row = ws.addRow([
      seq,
      r.name,
      r.bankName ?? "",
      r.bankAccount ?? "",
      r.accountHolder ?? "",
      r.gross,
      r.deduction,
      r.net,
      r.settlementTitle,
      r.projectName,
      noteOf(r),
    ]);
    dataLines.push(ws.rowCount);
    styleDataRow(row, r.blockers.length > 0);
  };

  if (d.mode === "person") {
    for (const p of groupByPerson(d.rows)) {
      for (const r of p.rows) writeRow(r);
      if (p.sources > 1) {
        const sub = ws.addRow([
          "",
          `${p.name} 소계`,
          "",
          "",
          "",
          p.gross,
          p.deduction,
          p.net,
          `재원 ${p.sources}건`,
          "",
          "",
        ]);
        for (let c = 1; c <= COLS; c++) {
          const cell = sub.getCell(c);
          cell.border = border;
          cell.font = { bold: true, size: 10 };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: SUB_BG },
          };
        }
        for (const c of [C_GROSS, C_DED, C_NET]) sub.getCell(c).numFmt = MONEY;
      }
    }
  } else {
    for (const r of d.rows) writeRow(r);
  }

  // --- 합계 행 ---
  //   소계 행이 섞여 있어 SUM(범위)를 쓰면 두 번 더해집니다. 데이터 행만
  //   골라 SUM(A5,A9,…) 형태로 씁니다 — 눌러서 검산할 수 있게 값이 아니라 수식.
  const totals = sumTotals(d.rows);
  const sumOf = (col: string) =>
    dataLines.length
      ? { formula: `SUM(${dataLines.map((n) => `${col}${n}`).join(",")})` }
      : 0;
  const totalRow = ws.addRow([
    "합계",
    `${totals.people}명 / ${totals.rows}건`,
    "",
    "",
    "",
    sumOf("F"),
    sumOf("G"),
    sumOf("H"),
    "",
    "",
    "",
  ]);
  const totalLine = ws.rowCount;
  for (let c = 1; c <= COLS; c++) {
    const cell = totalRow.getCell(c);
    cell.border = border;
    cell.font = { bold: true, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
  }
  totalRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  totalRow.getCell(1).font = { bold: true, size: 11, color: { argb: NAVY } };
  for (const c of [C_GROSS, C_DED, C_NET]) totalRow.getCell(c).numFmt = MONEY;

  // --- 지급 전 확인 필요 목록 ---
  //   표 아래에 다시 모아 둡니다. 실측에서 이민정은 계좌·주민번호가 없는데
  //   정산에 올라 있었습니다 — 이체하다 막히는 지점을 문서에도 남깁니다.
  const blocked = d.rows.filter((r) => r.blockers.length > 0);
  ws.addRow([]);
  if (blocked.length) {
    const h = ws.addRow([`지급 전 확인 필요 ${blocked.length}건`]);
    ws.mergeCells(ws.rowCount, 1, ws.rowCount, COLS);
    h.getCell(1).font = { bold: true, size: 11, color: { argb: WARN } };
    for (const r of blocked) {
      const line = ws.addRow([
        "",
        r.name,
        // 제목이 같은 정산이 실제로 있어(‘테스트용’ 2건) 기간까지 붙입니다.
        `${r.settlementTitle} (${r.periodStart ?? "-"} ~ ${
          r.periodEnd ?? "-"
        }) — ${r.blockers.join(", ")}`,
      ]);
      ws.mergeCells(ws.rowCount, 3, ws.rowCount, COLS);
      line.getCell(2).font = { bold: true, size: 10 };
      line.getCell(3).font = { size: 10, color: { argb: WARN } };
    }
  } else {
    const h = ws.addRow(["지급 전 확인 필요 항목 없음"]);
    ws.mergeCells(ws.rowCount, 1, ws.rowCount, COLS);
    h.getCell(1).font = { size: 10, color: { argb: GRAY } };
  }

  // --- 안내 한 줄 ---
  ws.addRow([]);
  const noteLine = ws.rowCount + 1;
  const noteRow = ws.addRow([
    "금액은 정산에 확정된 값입니다(공제 3.3% = 소득세 3% + 주민세 0.3%). 계좌번호는 텍스트 서식이라 앞자리 0 이 보존됩니다.",
  ]);
  ws.mergeCells(noteLine, 1, noteLine, COLS);
  noteRow.getCell(1).font = { size: 9, color: { argb: GRAY } };

  // --- 열 너비 · 창 고정 ---
  const widths = [6, 11, 11, 20, 11, 13, 12, 13, 24, 20, 26];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  // 계좌번호 열 전체를 텍스트로 — 셀 단위 지정만으로는 빈 칸에 나중에
  //   손으로 채워 넣을 때 다시 숫자가 됩니다.
  ws.getColumn(C_ACCOUNT).numFmt = TEXT;
  ws.views = [{ state: "frozen", ySplit: 4 }];
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: totalLine - 1, column: COLS } };

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function styleDataRow(row: ExcelJS.Row, warn: boolean) {
  for (let c = 1; c <= COLS; c++) {
    const cell = row.getCell(c);
    cell.border = border;
    cell.alignment = { ...(cell.alignment ?? {}), vertical: "middle" };
  }
  for (const c of [C_GROSS, C_DED, C_NET]) row.getCell(c).numFmt = MONEY;
  row.getCell(C_SEQ).alignment = { horizontal: "center", vertical: "middle" };
  row.getCell(C_ACCOUNT).numFmt = TEXT;
  row.getCell(C_ACCOUNT).alignment = { horizontal: "left", vertical: "middle" };
  if (warn) {
    // 확인 필요 줄은 성명·비고를 빨갛게 — 스크롤하다 눈에 걸리게.
    row.getCell(2).font = { bold: true, color: { argb: WARN }, size: 10 };
    row.getCell(C_NOTE).font = { color: { argb: WARN }, size: 9 };
  }
  row.getCell(C_NOTE).alignment = {
    horizontal: "left",
    vertical: "middle",
    wrapText: true,
  };
}
