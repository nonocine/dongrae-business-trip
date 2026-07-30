// =====================================================================
// 강사비 지급조서 엑셀 — exceljs(급여대장/강사명단 패턴). saem_* 만.
//   * 가드 없음(라우트가 requireSaemAccess 후 호출).
//   * 구조(SA-16): 강사당 프로그램별 1행으로 풀고, 프로그램이 2개 이상이면
//     강사 소계 행을 붙인다(1개면 그 행이 곧 소계이므로 생략). 맨 아래 전체 합계.
//   * 금액 기준은 항목(강사) 단위 값 — 공제는 프로그램별로 계산하지만 10원 미만
//     절사는 강사 합계에 한 번만 적용하므로, 프로그램 행 공제액의 단순 합이
//     소계 공제액과 최대 9원 다를 수 있다. 지급 기준은 소계·합계 행.
// =====================================================================

import ExcelJS from "exceljs";
import type { SettlementDetail } from "@/app/hr/saems/settlementActions";

const NAVY = "FF1F3A5F";
const MONEY = "#,##0";
const GRAY = "FF6B7280";
const SUBTOTAL_BG = "FFF3F4F6";

const krw = (n: number) => n.toLocaleString("ko-KR");

// 소수점 두 자리까지, 불필요한 0 은 떼고.
function trimNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}

// 산출내역 — "4회 × 3h × 40,000" 단순 표기(h 는 회차당 시간).
function calcText(d: {
  sessions: number;
  hours: number;
  rate: number;
}): string {
  const per = d.sessions > 0 ? d.hours / d.sessions : d.hours;
  return `${d.sessions}회 × ${trimNum(per)}h × ${krw(d.rate)}`;
}

type Item = SettlementDetail["items"][number];

const COLS = 11;
const C_PROGRAM = 6;
const C_CALC = 7;
const C_GROSS = 8;
const C_RATE = 9;
const C_DED = 10;
const C_NET = 11;

const thin = { style: "thin" as const, color: { argb: "FFE5E7EB" } };

export async function buildSettlementWorkbook(
  s: SettlementDetail
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "동래구청소년센터";
  const ws = wb.addWorksheet("지급조서");

  // --- 머리글 ---
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
  periodRow.getCell(1).font = { size: 10, color: { argb: GRAY } };

  const noteRow = ws.addRow([
    "공제는 프로그램별 공제율로 계산하고, 10원 미만 절사는 강사 합계에 한 번만 적용합니다.",
  ]);
  ws.mergeCells(3, 1, 3, COLS);
  noteRow.getCell(1).font = { size: 9, color: { argb: GRAY } };
  ws.addRow([]);

  // --- 표 머리 ---
  const headers = [
    "강사",
    "연락처",
    "은행",
    "계좌",
    "예금주",
    "프로그램",
    "산출내역",
    "지급액",
    "공제율(%)",
    "공제액",
    "차인지급액",
  ];
  const headerRow = ws.addRow(headers);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  // 인적사항(강사~예금주) — 강사의 첫 행에만 기재하고 나머지는 빈칸.
  const person = (it: Item): (string | number)[] => [
    it.instructorName,
    it.phone ?? "",
    it.bank_name ?? "",
    it.bank_account ?? "",
    it.account_holder ?? "",
  ];
  const blankPerson = ["", "", "", "", ""];

  const moneyCells = [C_GROSS, C_DED, C_NET];
  function styleRow(row: ExcelJS.Row, opts?: { bold?: boolean; fill?: string }) {
    for (let c = 1; c <= COLS; c++) {
      const cell = row.getCell(c);
      cell.border = { top: thin, bottom: thin, left: thin, right: thin };
      if (opts?.bold) cell.font = { bold: true, size: 10 };
      if (opts?.fill)
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
    }
    for (const c of moneyCells) row.getCell(c).numFmt = MONEY;
    row.getCell(C_RATE).alignment = { horizontal: "center" };
    row.getCell(C_CALC).alignment = { horizontal: "left" };
  }

  // --- 강사별 블록 ---
  for (const it of s.items) {
    const detail = it.detail ?? [];
    const multi = detail.length > 1;
    const firstDataRow = ws.rowCount + 1;

    if (detail.length === 0) {
      // 프로그램 내역이 없는 항목 — 항목 값만 한 행으로.
      const row = ws.addRow([
        ...person(it),
        "-",
        "",
        it.gross_amount,
        it.deduction_rate,
        it.deduction_amount,
        it.net_amount,
      ]);
      styleRow(row);
      continue;
    }

    detail.forEach((d, i) => {
      // 프로그램이 1개면 이 행이 곧 소계 — 항목 단위 확정값(절사 반영)을 쓴다.
      const single = !multi;
      const row = ws.addRow([
        ...(i === 0 ? person(it) : blankPerson),
        d.program_name,
        calcText(d),
        single ? it.gross_amount : d.amount,
        single
          ? it.deduction_rate
          : d.deduction_rate != null
            ? d.deduction_rate
            : "",
        single
          ? it.deduction_amount
          : d.deduction_amount != null
            ? d.deduction_amount
            : "",
        // 차인지급액은 강사 단위에서만 확정된다(프로그램 행은 비워 둔다).
        single ? it.net_amount : "",
      ]);
      styleRow(row, single ? { bold: false } : undefined);
    });

    if (multi) {
      const sub = ws.addRow([
        ...blankPerson,
        "소계",
        `프로그램 ${detail.length}개`,
        it.gross_amount,
        it.deduction_rate,
        it.deduction_amount,
        it.net_amount,
      ]);
      styleRow(sub, { bold: true, fill: SUBTOTAL_BG });

      // 인적사항 세로 병합 — 프로그램 행 + 소계 행을 한 덩어리로.
      const lastRow = ws.rowCount;
      for (let c = 1; c <= 5; c++) {
        ws.mergeCells(firstDataRow, c, lastRow, c);
        ws.getCell(firstDataRow, c).alignment = {
          vertical: "middle",
          wrapText: true,
        };
      }
    }
  }

  // --- 전체 합계 ---
  const totalRow = ws.addRow([
    "합계",
    "",
    "",
    "",
    "",
    `강사 ${s.items.length}명`,
    "",
    s.totalGross,
    "",
    s.totalDeduction,
    s.totalNet,
  ]);
  styleRow(totalRow, { bold: true, fill: SUBTOTAL_BG });
  totalRow.getCell(1).font = { bold: true, size: 11, color: { argb: NAVY } };

  const widths = [11, 14, 10, 18, 9, 18, 22, 13, 10, 12, 13];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  ws.views = [{ state: "frozen", ySplit: 5 }];

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
