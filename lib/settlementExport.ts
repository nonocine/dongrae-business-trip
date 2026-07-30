// =====================================================================
// 강사비 지급조서 엑셀 — exceljs(급여대장/강사명단 패턴). saem_* 만.
//   * 가드 없음(라우트가 requireSaemAccess 후 호출).
// =====================================================================

import ExcelJS from "exceljs";
import type { SettlementDetail } from "@/app/hr/saems/settlementActions";

const NAVY = "FF1F3A5F";
const MONEY = "#,##0";

function programSummary(
  detail: SettlementDetail["items"][number]["detail"]
): string {
  return detail
    .map(
      (d) =>
        `${d.program_name}(${d.sessions}회·${d.hours}h×${d.rate.toLocaleString(
          "ko-KR"
        )})`
    )
    .join("; ");
}

export async function buildSettlementWorkbook(
  s: SettlementDetail
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "동래구청소년센터";
  const ws = wb.addWorksheet("지급조서");

  const headers = [
    "강사",
    "연락처",
    "은행",
    "계좌",
    "예금주",
    "프로그램 요약",
    "지급총액",
    "공제율(%)",
    "공제액",
    "차인지급액",
  ];
  const COLS = headers.length;

  // 제목·기간 헤더(병합).
  const titleRow = ws.addRow([`강사비 지급조서 — ${s.title}`]);
  ws.mergeCells(1, 1, 1, COLS);
  titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: NAVY } };
  titleRow.height = 24;

  const periodRow = ws.addRow([
    `${s.projectName} · 기간 ${s.period_start ?? "?"} ~ ${s.period_end ?? "?"} · 상태 ${
      s.status === "confirmed" ? "확정" : "작성중"
    }`,
  ]);
  ws.mergeCells(2, 1, 2, COLS);
  periodRow.getCell(1).font = { size: 10, color: { argb: "FF6B7280" } };
  ws.addRow([]);

  // 표 헤더.
  const headerRow = ws.addRow(headers);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  for (const it of s.items) {
    const row = ws.addRow([
      it.instructorName,
      it.phone ?? "",
      it.bank_name ?? "",
      it.bank_account ?? "",
      it.account_holder ?? "",
      programSummary(it.detail),
      it.gross_amount,
      it.deduction_rate,
      it.deduction_amount,
      it.net_amount,
    ]);
    row.getCell(7).numFmt = MONEY;
    row.getCell(9).numFmt = MONEY;
    row.getCell(10).numFmt = MONEY;
  }

  // 합계 행.
  const totalRow = ws.addRow([
    "합계",
    "",
    "",
    "",
    "",
    `강사 ${s.items.length}명`,
    s.totalGross,
    "",
    s.totalDeduction,
    s.totalNet,
  ]);
  totalRow.font = { bold: true };
  totalRow.getCell(7).numFmt = MONEY;
  totalRow.getCell(9).numFmt = MONEY;
  totalRow.getCell(10).numFmt = MONEY;

  const widths = [12, 14, 10, 18, 9, 40, 13, 9, 12, 13];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
