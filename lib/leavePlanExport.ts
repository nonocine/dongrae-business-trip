// =====================================================================
// 미사용 연차유급휴가 사용계획서 서식 엑셀 — exceljs. LP-3
//   * 원본 서식("미사용 연차유급휴가 계획.xls", 시트 '연차계획서')의 인쇄영역
//     A~G열 레이아웃을 그대로 재현한다. 원본의 H열 이후 주석("이 부분은 인쇄
//     안되는 참조 페이지 입니다" 등)은 서식이 아니므로 옮기지 않는다.
//   * 직원당 1시트. 보관·인쇄용이므로 PDF 가 아닌 xlsx.
//   * 가드 없음(라우트가 requireSalaryAccess 후 호출) — settlementExport 와 동일.
//
//   원본 행 구성(1-indexed):
//     1  [붙임서식 1]
//     2  미사용 연차유급휴가 사용계획서            (A2:G2)
//     3  [ 관련 : 근로기준법 제61조의 2항 ]        (A3:G3)
//     5  성 명 | (B5:C5) | 부 서 | (F5:G5)
//     7  미사용 연차유급휴가일 (A7:C7) | 미사용 연차유급휴가 잔여기간 (E7:G7)
//     8  (A8:B8) 일수 | C8 "일" | E8 시작 | F8 "~" | G8 종료
//     10 날 짜 (A10:B10) | 기간(일) C10 | 날 짜 (E10:F10) | 기간(일) G10
//     11~18 계획 2단 × 8행 = 16칸
//     20 합 계 (E20) | G20 일수
//     22 사용촉진 통보 확인 문구 (A22:G22)
//     24 년 월 일 (A24:G24)
//     26 제출자 : ... (서명 또는 인) (A26:G26)
//     28 동래구청소년센터장귀중 (A28:G28)
// =====================================================================

import ExcelJS from "exceljs";
import {
  formatDays,
  sumLeavePlan,
  LEAVE_PLAN_MAX_ROWS,
  type LeavePlanEntry,
} from "@/lib/leavePlan";

const NAVY = "FF1F3A5F";
const LABEL_BG = "FFF3F4F6";

// 계획 표 = 2단 × 8행.
const PLAN_ROWS = LEAVE_PLAN_MAX_ROWS / 2; // 8
const FIRST_PLAN_ROW = 11;

export type LeavePlanSheetData = {
  name: string;
  department: string | null;
  year: number;
  unused_days: number;
  period_start: string | null;
  period_end: string | null;
  plan: LeavePlanEntry[];
  total_days: number | null;
  submitted_at: string | null;
};

const thin = { style: "thin" as const, color: { argb: "FF9CA3AF" } };
const box = { top: thin, bottom: thin, left: thin, right: thin };

// 제출 시각(UTC ISO) → KST 날짜. 서식의 "년 월 일" 칸에 찍힌다.
//   ⚠ ISO 문자열의 앞 10자를 그대로 쓰면 안 된다 — 예: 오전 8시(KST) 제출은
//     UTC 로 전날 23시이므로 하루 밀린 날짜가 인쇄된다. lib/datetime 과 같은
//     방식(UTC+9 고정)으로 변환한다.
function kstYmd(iso: string | null): { y: number; m: number; d: number } | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const kst = new Date(t.getTime() + 9 * 60 * 60 * 1000);
  return {
    y: kst.getUTCFullYear(),
    m: kst.getUTCMonth() + 1,
    d: kst.getUTCDate(),
  };
}

// 시트명 정리 — 엑셀 금칙문자 제거·31자 제한. 중복은 호출부에서 번호를 붙인다.
function safeSheetName(raw: string): string {
  const s = (raw || "계획서").replace(/[\\/*?:[\]]/g, " ").trim();
  return (s.length ? s : "계획서").slice(0, 31);
}

function addSheet(wb: ExcelJS.Workbook, d: LeavePlanSheetData, sheetName: string) {
  const ws = wb.addWorksheet(sheetName, {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: {
        left: 0.6,
        right: 0.6,
        top: 0.7,
        bottom: 0.6,
        header: 0.3,
        footer: 0.3,
      },
    },
  });

  // 인쇄영역 A~G. D열은 원본의 좌우 단 구분용 여백.
  const widths = [13, 11, 11, 2.6, 15, 11, 11];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  ws.pageSetup.printArea = "A1:G28";

  const set = (row: number, col: number, value: string | number | null) => {
    const cell = ws.getCell(row, col);
    cell.value = value === null ? null : value;
    return cell;
  };
  // 병합 + 값 + 정렬을 한 번에.
  const merged = (
    r1: number,
    c1: number,
    r2: number,
    c2: number,
    value: string | number | null,
    align: Partial<ExcelJS.Alignment> = { horizontal: "center", vertical: "middle" }
  ) => {
    ws.mergeCells(r1, c1, r2, c2);
    const cell = set(r1, c1, value);
    cell.alignment = align;
    return cell;
  };
  const bordered = (row: number, cols: number[]) => {
    for (const c of cols) ws.getCell(row, c).border = box;
  };
  // 라벨 칸 — 회색 배경 + 굵게 + 가운데.
  const labelCell = (cell: ExcelJS.Cell) => {
    cell.font = { bold: true, size: 10, color: { argb: NAVY } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LABEL_BG } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = box;
  };

  // --- 1~3행 머리 ---
  const tag = set(1, 1, "[붙임서식 1]");
  tag.font = { size: 9, color: { argb: "FF6B7280" } };

  const title = merged(2, 1, 2, 7, "미사용 연차유급휴가 사용계획서");
  title.font = { bold: true, size: 16, color: { argb: NAVY } };
  ws.getRow(2).height = 30;

  const law = merged(3, 1, 3, 7, "[ 관련 : 근로기준법 제61조의 2항 ]");
  law.font = { size: 10, color: { argb: "FF6B7280" } };
  ws.getRow(4).height = 8;

  // --- 5행 성명·부서 ---
  labelCell(set(5, 1, "성  명"));
  const nameCell = merged(5, 2, 5, 3, d.name);
  nameCell.border = box;
  nameCell.font = { size: 11 };
  labelCell(set(5, 5, "부  서"));
  const deptCell = merged(5, 6, 5, 7, d.department ?? "");
  deptCell.border = box;
  deptCell.font = { size: 11 };
  ws.getRow(5).height = 24;
  ws.getRow(6).height = 8;

  // --- 7~8행 미사용 일수 / 잔여기간 ---
  labelCell(merged(7, 1, 7, 3, "미사용 연차유급휴가일"));
  labelCell(merged(7, 5, 7, 7, "미사용 연차유급휴가 잔여기간"));

  const unusedCell = merged(8, 1, 8, 2, formatDays(d.unused_days), {
    horizontal: "right",
    vertical: "middle",
  });
  unusedCell.border = box;
  unusedCell.font = { size: 11, bold: true };
  const unusedUnit = set(8, 3, "일");
  unusedUnit.alignment = { horizontal: "center", vertical: "middle" };
  unusedUnit.border = box;

  const startCell = set(8, 5, d.period_start ?? "");
  startCell.alignment = { horizontal: "center", vertical: "middle" };
  startCell.border = box;
  const tilde = set(8, 6, "~");
  tilde.alignment = { horizontal: "center", vertical: "middle" };
  tilde.border = box;
  const endCell = set(8, 7, d.period_end ?? "");
  endCell.alignment = { horizontal: "center", vertical: "middle" };
  endCell.border = box;
  ws.getRow(8).height = 22;
  ws.getRow(9).height = 8;

  // --- 10행 계획 표 머리(2단) ---
  labelCell(merged(10, 1, 10, 2, "날 짜"));
  labelCell(set(10, 3, "기간(일)"));
  labelCell(merged(10, 5, 10, 6, "날 짜"));
  labelCell(set(10, 7, "기간(일)"));

  // --- 11~18행 계획 칸 — 왼쪽 단 0~7, 오른쪽 단 8~15 ---
  for (let i = 0; i < PLAN_ROWS; i++) {
    const row = FIRST_PLAN_ROW + i;
    const left = d.plan[i];
    const right = d.plan[i + PLAN_ROWS];

    const l = merged(row, 1, row, 2, left?.date ?? "");
    l.border = box;
    const lDays = set(row, 3, left ? `${formatDays(left.days)}일` : "일");
    lDays.alignment = { horizontal: "center", vertical: "middle" };
    lDays.border = box;
    if (!left) lDays.font = { color: { argb: "FF9CA3AF" } };

    const r = merged(row, 5, row, 6, right?.date ?? "");
    r.border = box;
    const rDays = set(row, 7, right ? `${formatDays(right.days)}일` : "일");
    rDays.alignment = { horizontal: "center", vertical: "middle" };
    rDays.border = box;
    if (!right) rDays.font = { color: { argb: "FF9CA3AF" } };

    ws.getRow(row).height = 20;
  }
  ws.getRow(19).height = 8;

  // --- 20행 합계 ---
  const total = d.total_days ?? sumLeavePlan(d.plan);
  labelCell(merged(20, 5, 20, 6, "합  계"));
  const totalCell = set(20, 7, `${formatDays(total)}일`);
  totalCell.alignment = { horizontal: "center", vertical: "middle" };
  totalCell.border = box;
  totalCell.font = { bold: true, size: 11 };
  ws.getRow(20).height = 22;
  ws.getRow(21).height = 10;

  // --- 22행 사용촉진 통보 확인 문구(원본 2줄) ---
  const note = merged(
    22,
    1,
    22,
    7,
    "** 회사의 연차휴가 사용촉진을 통보 받았으며 연차휴가를 사용하지 않을 경우,\n 잔여 연차휴가는 자동소멸됨을 인지하였습니다.",
    { horizontal: "left", vertical: "middle", wrapText: true }
  );
  note.font = { size: 10 };
  ws.getRow(22).height = 36;
  ws.getRow(23).height = 14;

  // --- 24행 제출일 — 제출 전이면 원본처럼 빈 서식으로 둔다(손으로 기입) ---
  const p = kstYmd(d.submitted_at);
  const dateLine = merged(
    24,
    1,
    24,
    7,
    p
      ? `    ${p.y}년        ${p.m}월        ${p.d}일`
      : "    년           월           일",
    { horizontal: "center", vertical: "middle" }
  );
  dateLine.font = { size: 11 };
  ws.getRow(24).height = 22;
  ws.getRow(25).height = 10;

  // --- 26행 제출자 ---
  const signer = merged(
    26,
    1,
    26,
    7,
    `      제출자 :  ${d.name}                          (서명  또는  인)`,
    { horizontal: "left", vertical: "middle" }
  );
  signer.font = { size: 11 };
  ws.getRow(26).height = 26;
  ws.getRow(27).height = 10;

  // --- 28행 수신 ---
  const to = merged(28, 1, 28, 7, "동래구청소년센터장귀중", {
    horizontal: "center",
    vertical: "middle",
  });
  to.font = { bold: true, size: 13, color: { argb: NAVY } };
  ws.getRow(28).height = 26;

  // 계획이 16칸을 넘으면(정책상 막았지만) 잘린 사실을 시트에 남긴다.
  if (d.plan.length > LEAVE_PLAN_MAX_ROWS) {
    const over = merged(
      30,
      1,
      30,
      7,
      `※ 계획 ${d.plan.length}건 중 서식 칸수(${LEAVE_PLAN_MAX_ROWS})를 초과한 ${
        d.plan.length - LEAVE_PLAN_MAX_ROWS
      }건은 표에 표시되지 않았습니다.`,
      { horizontal: "left", vertical: "middle" }
    );
    over.font = { size: 9, color: { argb: "FFB91C1C" } };
  }

  bordered(5, [1, 5]);
  return ws;
}

// 직원 여러 명 → 워크북(직원당 1시트).
export async function buildLeavePlanWorkbook(
  rows: LeavePlanSheetData[]
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "동래구청소년센터";

  if (rows.length === 0) {
    const ws = wb.addWorksheet("계획서");
    ws.getCell(1, 1).value = "출력할 계획서가 없습니다.";
    return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  }

  // 동명이인·시트명 중복 방어 — 뒤에 (2), (3) 을 붙인다.
  const used = new Set<string>();
  for (const d of rows) {
    const base = safeSheetName(d.name);
    let name = base;
    let n = 2;
    while (used.has(name)) {
      const suffix = `(${n++})`;
      name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    }
    used.add(name);
    addSheet(wb, d, name);
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
