// =====================================================================
// 급여대장 엑셀 빌더 (급여 2차 PART 4) — 실제 7월 대장 양식 재현.
//   * 열: 번호·직책·성명·기본급·관리업무수당(시간외)·급식비·지도사자격수당·
//     가족수당·교통보조비·지급총액·갑근세·주민세·국민연금·국민건강·고용보험·
//     상조회비·공제액·차인지급액·비고.
//   * 국민건강 열 = health + longterm_care 합산(실제 대장 양식과 동일).
//   * 그룹: 센터 / 방과후아카데미, 각 그룹 소계 + 맨 아래 총합계.
//   * 0원 항목은 빈칸, 천단위 콤마. 초안이면 제목에 "(초안)".
//   * @/ 별칭·DB 의존 없음 — Route Handler 가 데이터를 만들어 넘깁니다.
// =====================================================================

import ExcelJS from "exceljs";
import { type PayItem, type PayrollTeam, TEAM_LABEL } from "./salary";

// 대장 매핑에 필요한 최소 레코드 형태(payroll_records / MonthlyRow 공용).
type LedgerRecordLike = {
  pay_items: PayItem[];
  deduct_items: PayItem[];
  total_pay: number;
  total_deduct: number;
  net_pay: number;
};

// 대장 한 행의 금액 열(직책·성명·비고 제외).
export type LedgerCols = {
  base: number;
  mgmtOrOvertime: number; // 관리업무수당 또는 시간외수당(같은 열)
  meal: number;
  cert: number;
  family: number;
  transport: number;
  totalPay: number;
  incomeTax: number;
  residentTax: number;
  pension: number;
  healthCombined: number; // 국민건강 + 장기요양
  employment: number;
  sangjo: number;
  totalDeduct: number;
  netPay: number;
};

export type LedgerRowInput = {
  team: PayrollTeam;
  name: string;
  rank: string | null; // 직책
  cols: LedgerCols;
  note: string;
};

// 급여대장 고정 열에 매핑되는 표준 항목 키.
const MAPPED_PAY_KEYS = new Set([
  "base",
  "mgmt_allowance",
  "overtime",
  "meal_allowance",
  "cert_allowance",
  "family_allowance",
  "transport_allowance",
]);
const MAPPED_DEDUCT_KEYS = new Set([
  "income_tax",
  "resident_tax",
  "pension",
  "health",
  "longterm_care",
  "employment",
  "sangjo",
]);

function amt(items: PayItem[], key: string): number {
  const hit = items.find((i) => i.key === key);
  return hit && Number.isFinite(hit.amount) ? Math.round(hit.amount) : 0;
}

// 매핑되지 않은 항목(명절휴가비·연가보상비 등) → 비고 문자열.
function unmappedNote(record: LedgerRecordLike): string {
  const parts: string[] = [];
  for (const it of record.pay_items) {
    if (!MAPPED_PAY_KEYS.has(it.key) && it.amount > 0) {
      parts.push(`${it.label} ${it.amount.toLocaleString("ko-KR")}`);
    }
  }
  for (const it of record.deduct_items) {
    if (!MAPPED_DEDUCT_KEYS.has(it.key) && it.amount > 0) {
      parts.push(`(공제) ${it.label} ${it.amount.toLocaleString("ko-KR")}`);
    }
  }
  return parts.join(", ");
}

// payroll_records 1건 → 대장 금액 열. (라우트·테스트 공용)
export function ledgerColsFromRecord(record: LedgerRecordLike): {
  cols: LedgerCols;
  note: string;
} {
  const pay = record.pay_items;
  const ded = record.deduct_items;
  const cols: LedgerCols = {
    base: amt(pay, "base"),
    mgmtOrOvertime: amt(pay, "mgmt_allowance") + amt(pay, "overtime"),
    meal: amt(pay, "meal_allowance"),
    cert: amt(pay, "cert_allowance"),
    family: amt(pay, "family_allowance"),
    transport: amt(pay, "transport_allowance"),
    totalPay: record.total_pay,
    incomeTax: amt(ded, "income_tax"),
    residentTax: amt(ded, "resident_tax"),
    pension: amt(ded, "pension"),
    healthCombined: amt(ded, "health") + amt(ded, "longterm_care"),
    employment: amt(ded, "employment"),
    sangjo: amt(ded, "sangjo"),
    totalDeduct: record.total_deduct,
    netPay: record.net_pay,
  };
  return { cols, note: unmappedNote(record) };
}

const HEADERS = [
  "번호",
  "직책",
  "성명",
  "기본급",
  "관리업무수당\n(시간외수당)",
  "급식비",
  "지도사자격수당",
  "가족수당",
  "교통보조비",
  "지급총액",
  "갑근세",
  "주민세",
  "국민연금",
  "국민건강",
  "고용보험",
  "상조회비",
  "공제액",
  "차인지급액",
  "비고",
];
const MONEY_COL_START = 4; // 기본급
const MONEY_COL_END = 18; // 차인지급액
const NOTE_COL = 19;

// LedgerCols → 셀 배열(금액 순서, 0은 null=빈칸).
function colsToCells(c: LedgerCols): (number | null)[] {
  const b = (n: number): number | null => (n > 0 ? n : null);
  return [
    b(c.base),
    b(c.mgmtOrOvertime),
    b(c.meal),
    b(c.cert),
    b(c.family),
    b(c.transport),
    b(c.totalPay),
    b(c.incomeTax),
    b(c.residentTax),
    b(c.pension),
    b(c.healthCombined),
    b(c.employment),
    b(c.sangjo),
    b(c.totalDeduct),
    b(c.netPay),
  ];
}

function emptyCols(): LedgerCols {
  return {
    base: 0,
    mgmtOrOvertime: 0,
    meal: 0,
    cert: 0,
    family: 0,
    transport: 0,
    totalPay: 0,
    incomeTax: 0,
    residentTax: 0,
    pension: 0,
    healthCombined: 0,
    employment: 0,
    sangjo: 0,
    totalDeduct: 0,
    netPay: 0,
  };
}

function sumCols(rows: LedgerRowInput[]): LedgerCols {
  const acc = emptyCols();
  for (const r of rows) {
    (Object.keys(acc) as (keyof LedgerCols)[]).forEach((k) => {
      acc[k] += r.cols[k];
    });
  }
  return acc;
}

const NAVY = "FF1F3A5F";
const SUBTOTAL_FILL = "FFEAEFF5";
const TOTAL_FILL = "FFDCE3EE";

export async function buildPayrollLedgerWorkbook(input: {
  year: number;
  month: number;
  draft: boolean;
  rows: LedgerRowInput[];
}): Promise<ArrayBuffer> {
  const { year, month, draft, rows } = input;

  const wb = new ExcelJS.Workbook();
  wb.creator = "동래구청소년센터";
  const ws = wb.addWorksheet(`${year}년 ${month}월 급여대장`, {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  // 제목.
  const title = `${draft ? "(초안) " : ""}${year}년 ${month}월 급여대장`;
  const titleRow = ws.addRow([title]);
  titleRow.font = { bold: true, size: 15 };
  titleRow.height = 24;
  ws.mergeCells(1, 1, 1, HEADERS.length);
  titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

  // 머리글.
  const headerRow = ws.addRow(HEADERS);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
    cell.border = { bottom: { style: "thin", color: { argb: "FFBBBBBB" } } };
  });

  const thin = { style: "hair" as const, color: { argb: "FFCCCCCC" } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };

  const writeMoneyRow = (
    cells: (number | null)[],
    opts: { fill?: string; bold?: boolean } = {}
  ) => {
    const row = ws.lastRow!;
    for (let c = MONEY_COL_START; c <= MONEY_COL_END; c++) {
      const cell = row.getCell(c);
      cell.numFmt = "#,##0";
      cell.alignment = { horizontal: "right", vertical: "middle" };
      if (opts.bold) cell.font = { bold: true, size: 10 };
      if (opts.fill)
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: opts.fill },
        };
    }
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = border;
      if (opts.fill && !cell.fill)
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: opts.fill },
        };
    });
    void cells;
  };

  // 그룹 순서: 센터 → 방과후아카데미. 있는 그룹만.
  const teamsOrder: PayrollTeam[] = ["center", "afterschool"];
  let seq = 1;
  for (const team of teamsOrder) {
    const teamRows = rows.filter((r) => r.team === team);
    if (teamRows.length === 0) continue;

    for (const r of teamRows) {
      const money = colsToCells(r.cols);
      const row = ws.addRow([
        seq++,
        r.rank ?? "",
        r.name,
        ...money,
        r.note || "",
      ]);
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(NOTE_COL).alignment = {
        horizontal: "left",
        vertical: "middle",
        wrapText: true,
      };
      writeMoneyRow(money);
    }

    // 그룹 소계.
    const subtotal = sumCols(teamRows);
    ws.addRow([
      "",
      "",
      `${TEAM_LABEL[team]} 소계`,
      ...colsToCells(subtotal),
      "",
    ]);
    ws.mergeCells(ws.lastRow!.number, 1, ws.lastRow!.number, 3);
    ws.getCell(ws.lastRow!.number, 1).value = `${TEAM_LABEL[team]} 소계`;
    ws.getCell(ws.lastRow!.number, 1).alignment = {
      horizontal: "center",
      vertical: "middle",
    };
    ws.getCell(ws.lastRow!.number, 1).font = { bold: true };
    writeMoneyRow(colsToCells(subtotal), { fill: SUBTOTAL_FILL, bold: true });
  }

  // 총합계.
  const grand = sumCols(rows);
  ws.addRow(["", "", "총합계", ...colsToCells(grand), ""]);
  ws.mergeCells(ws.lastRow!.number, 1, ws.lastRow!.number, 3);
  ws.getCell(ws.lastRow!.number, 1).value = "총합계";
  ws.getCell(ws.lastRow!.number, 1).alignment = {
    horizontal: "center",
    vertical: "middle",
  };
  ws.getCell(ws.lastRow!.number, 1).font = { bold: true, size: 11 };
  writeMoneyRow(colsToCells(grand), { fill: TOTAL_FILL, bold: true });

  // 열 너비.
  const widths = [
    5, 8, 9, 11, 13, 9, 12, 9, 10, 12, 10, 9, 10, 10, 10, 9, 11, 12, 20,
  ];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
