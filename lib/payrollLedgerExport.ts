// =====================================================================
// 강사비 지급대장 엑셀 — 회계 제출용. 이민정 담당자가 손으로 옮겨 적던
//   "강사비 지급대장(운영비).xlsx" 양식을 그대로 재현합니다.
//   * 기존 지급조서(lib/settlementExport.ts)와는 다른 문서입니다 — 그쪽은
//     내부 확인용, 이쪽은 회계로 나가는 양식이라 따로 둡니다.
//   * ⚠️ 공제는 양식 수식을 그대로 넣습니다(값이 아니라 수식):
//       G(소득세)  = F*0.03
//       H(주민세)  = ROUNDDOWN(G*0.1, -1)   ← 10원 절사
//       I(합계)    = SUM(G,H)
//       J(실지급액) = F-I
//     김혜지 팀장이 셀을 눌러 검산할 수 있어야 하므로 값으로 굳히지 않습니다.
//     동업자씨 정산은 3.3% 통합 + 강사 합계에 절사 1회라, 여기 결과와 몇 원
//     다를 수 있습니다. 그 사실을 시트 하단 안내 한 줄로 남깁니다.
//   * ⚠️ 이 파일은 주민번호 평문을 셀에 씁니다. 호출부(지급대장 라우트)가
//     권한을 재검증하고, 결과는 파일 다운로드로만 나갑니다. 로그 금지.
//   * 가드 없음(라우트가 requireSaemAccess 후 호출) — settlementExport 와 동일.
// =====================================================================

import ExcelJS from "exceljs";
import type { PayrollLedgerData } from "@/app/hr/saems/settlementActions";

const NAVY = "FF1F3A5F";
const MONEY = "#,##0";
const GRAY = "FF6B7280";
const TOTAL_BG = "FFF3F4F6";

const COLS = 12; // A~L
const thin = { style: "thin" as const, color: { argb: "FFE5E7EB" } };
const border = { top: thin, bottom: thin, left: thin, right: thin };

// 양식 열 순서 — A 연번 / B 이름 / C 과목 / D 주민번호 / E 산출내역 / F 금액 /
//   G 소득세 / H 주민세 / I 공제합계 / J 실지급액 / K 은행명 / L 계좌번호
const C_SEQ = 1;
const C_AMOUNT = 6;
const C_TAX = 7;
const C_LOCAL = 8;
const C_DED = 9;
const C_NET = 10;

// 데이터 시작 행(1 제목여백 · 2 제목 · 3 빈줄 · 4 단위 · 5~6 헤더 → 7행부터).
const FIRST_DATA_ROW = 7;

export async function buildPayrollLedgerWorkbook(
  d: PayrollLedgerData
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "동래구청소년센터";
  const ws = wb.addWorksheet("지급대장");

  // --- 1행: 제목 위 여백(양식에 A1 은 비어 있음) ---
  ws.addRow([]);

  // --- 2행: 제목 A2:L2 병합 ---
  const titleRow = ws.addRow([
    [d.projectName, d.title].filter(Boolean).join(" "),
  ]);
  ws.mergeCells(2, 1, 2, COLS);
  titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: NAVY } };
  titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  titleRow.height = 28;

  // --- 3행: K3:L3 병합(양식에 있는 빈 병합칸) ---
  ws.addRow([]);
  ws.mergeCells(3, 11, 3, COLS);

  // --- 4행: L4 "(단위: 원)" ---
  const unitRow = ws.addRow([]);
  unitRow.getCell(COLS).value = "(단위: 원)";
  unitRow.getCell(COLS).font = { size: 9, color: { argb: GRAY } };
  unitRow.getCell(COLS).alignment = { horizontal: "right" };

  // --- 5~6행: 2단 헤더 ---
  //   공제액만 2단(G5:I5 묶음 + G6/H6/I6), 나머지는 5~6 세로 병합.
  const head1 = ws.addRow([
    "연번",
    "이름",
    "과목",
    "주민번호",
    "산출내역",
    "금액",
    "공제액",
    "",
    "",
    "실지급액",
    "은행명",
    "계좌번호",
  ]);
  const head2 = ws.addRow(["", "", "", "", "", "", "소득세", "주민세", "합계"]);
  head1.height = 20;
  head2.height = 20;

  // 세로 병합(5~6행) — 공제액 3칸(G·H·I)만 빼고 전부.
  for (const c of [1, 2, 3, 4, 5, 6, 10, 11, 12]) ws.mergeCells(5, c, 6, c);
  // 공제액 가로 병합(G5:I5).
  ws.mergeCells(5, C_TAX, 5, C_DED);

  for (const row of [head1, head2]) {
    for (let c = 1; c <= COLS; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
      cell.border = border;
    }
  }

  // --- 7행부터: 데이터 ---
  //   강사가 프로그램 여러 개면 양식처럼 프로그램별로 행을 나눕니다.
  //   연번은 행마다 1씩 올라갑니다(getPayrollLedgerData 가 이미 매겨 둠).
  for (const r of d.rows) {
    const line = ws.rowCount + 1;
    const row = ws.addRow([
      r.seq,
      r.name,
      r.subject,
      r.rrn,
      r.calc,
      r.amount,
      // 양식 수식 그대로 — 회계에서 셀을 눌러 검산할 수 있게 둡니다.
      { formula: `F${line}*0.03` },
      { formula: `ROUNDDOWN(G${line}*0.1,-1)` },
      { formula: `SUM(G${line},H${line})` },
      { formula: `F${line}-I${line}` },
      r.bankName,
      r.bankAccount,
    ]);
    styleDataRow(row);
  }

  // --- 합계 행: A:E 병합 "합계", F~J 는 SUM ---
  const lastData = ws.rowCount;
  const hasData = d.rows.length > 0;
  const totalRow = ws.addRow([
    "합계",
    "",
    "",
    "",
    "",
    ...["F", "G", "H", "I", "J"].map((col) =>
      hasData
        ? { formula: `SUM(${col}${FIRST_DATA_ROW}:${col}${lastData})` }
        : 0
    ),
    "",
    "",
  ]);
  const totalLine = ws.rowCount;
  ws.mergeCells(totalLine, 1, totalLine, 5);
  for (let c = 1; c <= COLS; c++) {
    const cell = totalRow.getCell(c);
    cell.border = border;
    cell.font = { bold: true, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
  }
  totalRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  totalRow.getCell(1).font = { bold: true, size: 11, color: { argb: NAVY } };
  for (const c of [C_AMOUNT, C_TAX, C_LOCAL, C_DED, C_NET])
    totalRow.getCell(c).numFmt = MONEY;

  // --- 안내 한 줄 ---
  //   동업자씨 정산(3.3% 통합)과 몇 원 다를 수 있는 이유를 남깁니다.
  ws.addRow([]);
  const noteLine = ws.rowCount + 1;
  const noteRow = ws.addRow([
    "공제는 소득세 3% + 주민세(소득세의 10%, 10원 절사) 기준",
  ]);
  ws.mergeCells(noteLine, 1, noteLine, COLS);
  noteRow.getCell(1).font = { size: 9, color: { argb: GRAY } };

  // --- 열 너비 · 창 고정 ---
  //   주민번호·계좌번호·산출내역을 넓게 잡습니다.
  const widths = [6, 10, 14, 16, 20, 12, 11, 11, 11, 13, 11, 20];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  ws.views = [{ state: "frozen", ySplit: 6 }];

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function styleDataRow(row: ExcelJS.Row) {
  for (let c = 1; c <= COLS; c++) row.getCell(c).border = border;
  for (const c of [C_AMOUNT, C_TAX, C_LOCAL, C_DED, C_NET])
    row.getCell(c).numFmt = MONEY;
  row.getCell(C_SEQ).alignment = { horizontal: "center" };
  // 주민번호·과목은 가운데, 산출내역은 왼쪽(문장이라 길다).
  row.getCell(3).alignment = { horizontal: "center" };
  row.getCell(4).alignment = { horizontal: "center" };
  row.getCell(5).alignment = { horizontal: "left" };
}
