// =====================================================================
// 강사비 지급조서 엑셀 — exceljs(급여대장/강사명단 패턴). saem_* 만.
//   * 가드 없음(라우트가 requireSaemAccess 후 호출).
// =====================================================================

import ExcelJS from "exceljs";
import type { SettlementDetail } from "@/app/hr/saems/settlementActions";
import { uniqueDeductionRates } from "@/lib/settlement";

const NAVY = "FF1F3A5F";
const MONEY = "#,##0";

const krw = (n: number) => n.toLocaleString("ko-KR");

// 프로그램 요약 — 프로그램별 단가 내역과 공제(율·액)를 함께 적는다.
//   공제 표기는 ST-4 이후 항목만 가능(이전 정산 jsonb 에는 프로그램별 공제 없음).
function programSummary(
  detail: SettlementDetail["items"][number]["detail"]
): string {
  return detail
    .map((d) => {
      const base = `${d.program_name}(${d.sessions}회·${d.hours}h×${krw(
        d.rate
      )}=${krw(d.amount)}`;
      const ded =
        d.deduction_amount != null
          ? `, 공제 ${d.deduction_rate}% ${krw(d.deduction_amount)}`
          : "";
      return `${base}${ded})`;
    })
    .join("; ");
}

// 공제율 셀 — 단일 율이면 숫자로, 프로그램별로 다르면 "3.3/8.8" 문자열로.
function rateCell(
  item: SettlementDetail["items"][number]
): number | string {
  const rates = uniqueDeductionRates(item.detail);
  if (rates.length === 0) return item.deduction_rate;
  if (rates.length === 1) return rates[0];
  return rates.join("/");
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

  // 공제 산출 방식 안내(회계 담당 확인용).
  const noteRow = ws.addRow([
    "공제는 프로그램별 공제율로 각각 계산하며, 강사별 합계에 10원 미만 절사를 1회 적용합니다.",
  ]);
  ws.mergeCells(3, 1, 3, COLS);
  noteRow.getCell(1).font = { size: 9, color: { argb: "FF6B7280" } };
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
      rateCell(it),
      it.deduction_amount,
      it.net_amount,
    ]);
    row.getCell(6).alignment = { wrapText: true, vertical: "top" };
    row.getCell(7).numFmt = MONEY;
    row.getCell(8).alignment = { horizontal: "center" };
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

  const widths = [12, 14, 10, 18, 9, 56, 13, 11, 12, 13];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
