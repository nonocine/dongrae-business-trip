// =====================================================================
// 비품대장 엑셀 빌더 — /hr/facility/assets/export (검수본 양식 재현)
//   * 컬럼: 취득일자·품목·규격·설치장소·단위·수량·단가·금액·내구연한·
//     폐기예정일·예산출처·불용일자·비고.
//   * 헤더 굵게(네이비 배경·흰 글씨), 숫자 천단위 콤마, 날짜 yyyy-mm-dd.
//   * 맨 아래 합계행(수량 합·금액 합).
//   * @/ 별칭·DB 의존 없음 — Route Handler 가 데이터를 만들어 넘깁니다.
//     (급여대장 lib/salaryLedger 와 동일한 구성.)
// =====================================================================

import ExcelJS from "exceljs";
import type { FacilityAsset } from "./facility";

const HEADERS = [
  "취득일자",
  "품목",
  "규격",
  "설치장소",
  "단위",
  "수량",
  "단가",
  "금액",
  "내구연한",
  "폐기예정일",
  "예산출처",
  "취득구분",
  "불용일자",
  "비고",
] as const;

// 숫자(콤마) 컬럼 인덱스(1-based): 수량6·단가7·금액8·내구연한9.
const NUM_COLS = [6, 7, 8, 9];
const COMMA_COLS = [6, 7, 8]; // 내구연한은 콤마 불필요(소수 자릿수 없이 정수)

const NAVY = "FF1F3A5F";
const TOTAL_FILL = "FFDCE3EE";

export async function buildFacilityAssetsWorkbook(input: {
  title: string;
  assets: FacilityAsset[];
}): Promise<ArrayBuffer> {
  const { title, assets } = input;

  const wb = new ExcelJS.Workbook();
  wb.creator = "동래구청소년센터";
  const ws = wb.addWorksheet("비품대장", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  // 제목.
  const titleRow = ws.addRow([title]);
  titleRow.font = { bold: true, size: 15 };
  titleRow.height = 24;
  ws.mergeCells(1, 1, 1, HEADERS.length);
  titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

  // 머리글.
  const headerRow = ws.addRow([...HEADERS]);
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFBBBBBB" } } };
  });

  const thin = { style: "hair" as const, color: { argb: "FFCCCCCC" } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };

  // 데이터 행.
  let qtySum = 0;
  let amountSum = 0;
  for (const a of assets) {
    qtySum += a.quantity;
    amountSum += a.amount;
    const row = ws.addRow([
      a.acquired_on ?? "",
      a.item_name,
      a.spec ?? "",
      a.location ?? "",
      a.unit ?? "",
      a.quantity,
      a.unit_price,
      a.amount,
      a.useful_life_years ?? "",
      a.disposal_scheduled_on ?? "",
      a.budget_source ?? "",
      a.acquisition_type ?? "",
      a.disposed_on ?? "",
      a.note ?? "",
    ]);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = border;
      cell.alignment = {
        horizontal: NUM_COLS.includes(col) ? "right" : "left",
        vertical: "middle",
      };
      if (COMMA_COLS.includes(col)) cell.numFmt = "#,##0";
    });
  }

  // 합계행 — 수량 합·금액 합.
  const totalRow = ws.addRow([
    "합계",
    "",
    "",
    "",
    "",
    qtySum,
    "",
    amountSum,
    "",
    "",
    "",
    "",
    "",
    "",
  ]);
  ws.mergeCells(totalRow.number, 1, totalRow.number, 5);
  totalRow.getCell(1).value = "합계";
  totalRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  totalRow.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.font = { bold: true, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
    cell.border = border;
    if (COMMA_COLS.includes(col)) {
      cell.numFmt = "#,##0";
      cell.alignment = { horizontal: "right", vertical: "middle" };
    }
  });

  // 열 너비.
  const widths = [12, 20, 26, 16, 7, 8, 12, 13, 9, 12, 11, 10, 11, 20];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
