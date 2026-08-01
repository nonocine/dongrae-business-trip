// =====================================================================
// 상조회 연도 장부 엑셀 — exceljs. MU-4
//   * 기존 양식("상조회비 지출현황.xlsx" 신형 시트)의 레이아웃을 재현한다.
//       2행 제목 / 3행 근무자 메모 / 5행 "세 입"·"세 출"·"잔액" / 6행 머리글
//       7행부터 세입(A 적요·B 금액) | 세출(C 날짜·D 적요·E 금액)
//       마지막 "합 계" 행, 우측 G~L 회원명단 + 퇴사자
//   * 가드 없음(라우트가 requireMutualAccess 후 호출) — settlementExport 와 동일.
// =====================================================================

import ExcelJS from "exceljs";
import { MUTUAL_FEE, formatKRW } from "@/lib/mutual";

const NAVY = "FF1F3A5F";
const MONEY = "#,##0";
const GRAY = "FF6B7280";
const INCOME_BG = "FFEFF4FB";
const EXPENSE_BG = "FFFDF2F2";
const TOTAL_BG = "FFF3F4F6";

const thin = { style: "thin" as const, color: { argb: "FFD1D5DB" } };
const box = { top: thin, bottom: thin, left: thin, right: thin };

export type ExportEntry = {
  entry_date: string;
  description: string;
  amount: number;
};

export type ExportMember = {
  name: string;
  birthDate: string | null;
  joinDate: string | null;
  leftOn: string | null;
  status: string;
};

export type MutualYearExport = {
  year: number;
  orgName: string;
  incomes: ExportEntry[];
  expenses: ExportEntry[];
  carryOver: number; // 전년 이월(장부 계산값)
  balance: number; // 이월 + 세입 − 세출
  members: ExportMember[]; // 활동·일시정지
  leftMembers: ExportMember[]; // 탈퇴(퇴사순)
};

// "2025-01-17" → "2025.01.17" (원본 표기).
function dotDate(d: string | null): string {
  if (!d || d.length < 10) return "";
  return d.slice(0, 10).replaceAll("-", ".");
}
// "1984-02-24" → "02월 24일" (원본 회원명단 표기).
function birthLabel(d: string | null): string {
  if (!d || d.length < 10) return "";
  return `${d.slice(5, 7)}월 ${d.slice(8, 10)}일`;
}
// 근속 일수·개월 — 원본 명단의 "970 일 / 31 개월" 칸.
function tenure(
  joinDate: string | null,
  end: string
): { days: string; months: string } {
  if (!joinDate || joinDate.length < 10) return { days: "", months: "" };
  const a = Date.parse(`${joinDate.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a)
    return { days: "", months: "" };
  const days = Math.round((b - a) / 86_400_000);
  return { days: `${days} 일`, months: `${Math.floor(days / 30.44)} 개월` };
}

export async function buildMutualYearWorkbook(
  d: MutualYearExport
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "동래구청소년센터";
  const ws = wb.addWorksheet(`${d.year}`, {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  // A~E 장부, F 여백, G~L 회원명단.
  const widths = [24, 13, 12, 34, 13, 2.5, 6, 11, 12, 12, 12, 11];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const cell = (r: number, c: number, v: string | number | null) => {
    const x = ws.getCell(r, c);
    x.value = v;
    return x;
  };
  const merged = (
    r1: number,
    c1: number,
    r2: number,
    c2: number,
    v: string | number | null,
    align: Partial<ExcelJS.Alignment> = { horizontal: "center", vertical: "middle" }
  ) => {
    ws.mergeCells(r1, c1, r2, c2);
    const x = cell(r1, c1, v);
    x.alignment = align;
    return x;
  };
  const header = (x: ExcelJS.Cell, bg: string) => {
    x.font = { bold: true, size: 10, color: { argb: NAVY } };
    x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    x.alignment = { horizontal: "center", vertical: "middle" };
    x.border = box;
  };

  // --- 제목 ---
  const title = merged(
    2,
    1,
    2,
    5,
    `${d.year}년 ${d.orgName} 상조회비 지출현황`
  );
  title.font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.getRow(2).height = 26;

  const note = merged(
    3,
    1,
    3,
    5,
    `*근무자 ${d.members.length}명`,
    { horizontal: "left", vertical: "middle" }
  );
  note.font = { size: 10, color: { argb: GRAY } };

  // --- 5행 구획 + 잔액 ---
  header(merged(5, 1, 5, 2, "세 입"), INCOME_BG);
  header(merged(5, 3, 5, 5, "세 출"), EXPENSE_BG);
  header(merged(5, 8, 5, 9, "잔액"), TOTAL_BG);

  // --- 6행 머리글 ---
  header(cell(6, 1, "적요"), INCOME_BG);
  header(cell(6, 2, "금액"), INCOME_BG);
  header(cell(6, 3, "날짜"), EXPENSE_BG);
  header(cell(6, 4, "적요"), EXPENSE_BG);
  header(cell(6, 5, "금액"), EXPENSE_BG);

  const balCell = merged(6, 8, 6, 9, d.balance);
  balCell.numFmt = MONEY;
  balCell.font = { bold: true, size: 12, color: { argb: NAVY } };
  balCell.border = box;

  // --- 7행부터 데이터(세입·세출을 각각 위에서부터 채운다) ---
  //   원본 양식은 이월금을 세입 첫 행에 적고 세입 합계에 포함시킨다. 장부는 이월을
  //   따로 계산해 두므로, 출력할 때 첫 행으로 되살려 원본과 합계가 같아지게 한다.
  const incomeRowsOut: ExportEntry[] =
    d.carryOver !== 0
      ? [
          {
            entry_date: `${d.year}-01-01`,
            description: "이월금",
            amount: d.carryOver,
          },
          ...d.incomes,
        ]
      : d.incomes;

  const first = 7;
  const rowCount = Math.max(incomeRowsOut.length, d.expenses.length, 1);
  for (let i = 0; i < rowCount; i++) {
    const r = first + i;
    const inc = incomeRowsOut[i];
    const exp = d.expenses[i];

    const a = cell(r, 1, inc ? inc.description : null);
    a.border = box;
    a.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    const b = cell(r, 2, inc ? inc.amount : null);
    b.border = box;
    b.numFmt = MONEY;

    const c = cell(r, 3, exp ? dotDate(exp.entry_date) : null);
    c.border = box;
    c.alignment = { horizontal: "center", vertical: "middle" };
    const dd = cell(r, 4, exp ? exp.description : null);
    dd.border = box;
    dd.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    const e = cell(r, 5, exp ? exp.amount : null);
    e.border = box;
    e.numFmt = MONEY;
  }

  // --- 합계 ---
  const totalRow = first + rowCount;
  // 이월금 행을 포함한 합계 — 원본 시트의 "합 계"와 같은 기준.
  const incTotal = incomeRowsOut.reduce((s, x) => s + x.amount, 0);
  const expTotal = d.expenses.reduce((s, x) => s + x.amount, 0);
  header(cell(totalRow, 1, "합 계"), TOTAL_BG);
  const it = cell(totalRow, 2, incTotal);
  it.numFmt = MONEY;
  it.font = { bold: true };
  it.border = box;
  it.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
  header(merged(totalRow, 3, totalRow, 4, "합 계"), TOTAL_BG);
  const et = cell(totalRow, 5, expTotal);
  et.numFmt = MONEY;
  et.font = { bold: true };
  et.border = box;
  et.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };

  // 이월·잔액 안내 — 장부는 이월을 계산값으로 쓰므로 근거를 남긴다.
  const foot = merged(
    totalRow + 1,
    1,
    totalRow + 1,
    5,
    `※ 세입 ${formatKRW(incTotal)}(전년 이월 ${formatKRW(
      d.carryOver
    )} 포함) − 세출 ${formatKRW(expTotal)} = 잔액 ${formatKRW(d.balance)}`,
    { horizontal: "left", vertical: "middle" }
  );
  foot.font = { size: 10, color: { argb: GRAY } };

  // --- 우측 회원명단 ---
  const memoCell = merged(
    8,
    7,
    8,
    12,
    `회비 ${formatKRW(MUTUAL_FEE)} / 매달 25일`,
    { horizontal: "left", vertical: "middle" }
  );
  memoCell.font = { size: 10, color: { argb: GRAY } };

  const end = `${d.year}-12-31`;
  const memberHeaders = ["No.", "직원명", "생일", "입사일", "근무일수", "근무개월"];
  memberHeaders.forEach((h, i) => header(cell(9, 7 + i, h), TOTAL_BG));
  d.members.forEach((m, i) => {
    const r = 10 + i;
    const t = tenure(m.joinDate, end);
    const vals = [
      i + 1,
      m.name + (m.status === "paused" ? " (일시정지)" : ""),
      birthLabel(m.birthDate),
      dotDate(m.joinDate),
      t.days,
      t.months,
    ];
    vals.forEach((v, k) => {
      const x = cell(r, 7 + k, v as string | number);
      x.border = box;
      x.alignment = { horizontal: k === 1 ? "left" : "center", vertical: "middle" };
    });
  });

  // --- 퇴사자(퇴사순) ---
  if (d.leftMembers.length > 0) {
    const base = 10 + d.members.length + 1;
    const cap = merged(base, 7, base, 12, "퇴사자 / 퇴사순 정렬", {
      horizontal: "left",
      vertical: "middle",
    });
    cap.font = { bold: true, size: 10, color: { argb: NAVY } };

    const leftHeaders = ["No.", "직원명", "입사일", "퇴사일", "근무일수", ""];
    leftHeaders.forEach((h, i) => header(cell(base + 1, 7 + i, h), TOTAL_BG));
    d.leftMembers.forEach((m, i) => {
      const r = base + 2 + i;
      const t = tenure(m.joinDate, m.leftOn ?? end);
      const vals = [
        i + 1,
        m.name,
        dotDate(m.joinDate),
        dotDate(m.leftOn),
        t.days,
        "",
      ];
      vals.forEach((v, k) => {
        const x = cell(r, 7 + k, v as string | number);
        x.border = box;
        x.alignment = { horizontal: k === 1 ? "left" : "center", vertical: "middle" };
      });
    });
  }

  ws.views = [{ state: "frozen", ySplit: 6 }];
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
