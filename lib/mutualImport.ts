// =====================================================================
// 과거 상조회 장부(xlsx) 파싱 — MU-4 이관용
//   * 입력: "상조회비 지출현황.xlsx" — 연도별 시트. 두 가지 변형이 섞여 있다.
//       구형(2010·2011): 1행 제목 / 2행 "세 입"·"세 출" / 3행 머리글 / 4행부터 데이터
//                        마지막에 "합 계" 행 + "※ 12/31 잔액" 행
//       신형(2023~)    : 2행 제목 / 3행 근무자 메모 / 5행 "세 입"·"세 출"·"잔액"
//                        6행 머리글 / 7행부터 데이터, H6 에 잔액, 우측 G~N 회원명단
//     → 머리글 행을 "적요·금액·날짜"로 찾아 위치 차이를 흡수한다(행 번호 고정 금지).
//   * 세입은 날짜 열이 없다(적요에 "1월 상조회비"처럼 월만 들어 있음) → 월을 추출해
//     날짜를 만들고, 월 표기가 없으면 직전 행의 월을 물려받는다(추정으로 표시).
//   * 순수 모듈(DB·@/ 의존 없음) — 액션과 테스트가 공유한다.
// =====================================================================

import * as XLSX from "xlsx";
import { mutualCategory, type MutualKind } from "./mutual";

export type ImportedEntry = {
  entry_date: string; // YYYY-MM-DD
  kind: MutualKind;
  category: string; // MUTUAL_RULES 의 key
  description: string; // 원문 적요 그대로(정보 손실 없음)
  amount: number;
  sheet: string;
  row: number; // 원본 행 번호(1-based) — 실패 목록·추적용
  dateInferred: boolean; // 세입처럼 원본에 날짜가 없어 추정한 행
};

export type SkippedRow = {
  sheet: string;
  row: number;
  side: "income" | "expense";
  text: string; // 그 행에서 읽은 내용(적요 등)
  reason: string;
};

export type SheetSummary = {
  sheet: string;
  year: number;
  headerRow: number; // 1-based
  // 시트에 적혀 있던 값(합계 행·잔액 칸).
  sheetIncomeTotal: number | null;
  sheetExpenseTotal: number | null;
  sheetBalance: number | null;
  // 파싱한 행으로 계산한 값.
  parsedIncome: number;
  parsedExpense: number;
  parsedNet: number;
  incomeRows: number;
  expenseRows: number;
  // 이월금 행 — 별도로 떼어 둔다(아래 carryOverPolicy 참조).
  carryOverAmount: number | null;
  carryOverRow: number | null;
  incomeMatches: boolean; // 시트 합계와 일치
  expenseMatches: boolean;
  balanceMatches: boolean;
};

export type ImportParseResult = {
  sheets: SheetSummary[];
  entries: ImportedEntry[]; // 이월금 제외(정책은 호출부가 적용)
  skipped: SkippedRow[];
  warnings: string[];
};

// --- 문자열 헬퍼 -----------------------------------------------------
const txt = (v: unknown): string => (v == null ? "" : String(v).trim());
// 비교용 — 공백·개행 제거.
const squash = (v: unknown): string => txt(v).replace(/\s+/g, "");

// "266,612" / " 140,000 " / "₩50,000" → 숫자. 못 읽으면 null.
export function parseAmount(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  const s = txt(v).replace(/[^\d.-]/g, "");
  if (!s || s === "-" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// 날짜 표기 변형 흡수:
//   "2025.01.17" / "2011. 04. 01" / "2011.12.7" / "10.01.04"(2자리 연도)
//   / "2024-01-04" / Excel 직렬값
export function parseEntryDate(v: unknown, fallbackYear: number): string | null {
  if (v == null) return null;
  // 엑셀이 날짜 셀로 인식한 경우(숫자 직렬값).
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y) return ymd(d.y, d.m, d.d);
    return null;
  }
  const s = txt(v).replace(/\s+/g, "");
  const m = s.match(/^(\d{2,4})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?$/);
  if (!m) return null;
  let y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (m[1].length <= 2) {
    // "10.01.04" → 2010. 세기는 시트 연도로 판단한다.
    const century = Math.floor(fallbackYear / 100) * 100;
    y = century + y;
    if (Math.abs(y - fallbackYear) > 50) y -= 100;
  }
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return ymd(y, mo, da);
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// 적요에서 월 추출 — "1월 상조회비" → 1. 없으면 null.
export function monthFromDescription(desc: string): number | null {
  const m = txt(desc).match(/(\d{1,2})\s*월/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 12 ? n : null;
}

// =====================================================================
// 카테고리 추론 — 적요 문구 → MUTUAL_RULES key.
//   * 확실한 신호만 매핑하고, 애매하면 기타(income_etc/expense_etc)로 둔다.
//     조의금 세부(본인·배우자/부모/자녀/형제자매)를 잘못 붙이면 규정 금액과
//     어긋나 보이므로, 관계가 분명히 적힌 경우만 세분한다.
//   * 적요 원문은 그대로 보존하므로 분류가 보수적이어도 정보는 잃지 않는다.
// =====================================================================
export function inferIncomeCategory(desc: string): string {
  const s = squash(desc);
  if (s.includes("이월")) return "income_etc"; // 이월금(호출부가 별도 처리)
  if (s.includes("상조회비") || s.includes("회비")) return "fee";
  if (s.includes("이자")) return "interest";
  if (s.includes("캐시백") || s.includes("캐쉬백")) return "cashback";
  return "income_etc";
}

export function inferExpenseCategory(desc: string): string {
  const s = squash(desc);
  // 퇴사 관련(지원금·선물·위로) — 금액 구간이 달라도 사유는 하나다.
  if (s.includes("퇴사") || s.includes("퇴직")) return "retirement";
  if (s.includes("출산")) return "childbirth";
  if (s.includes("결혼") || s.includes("축의")) return "marriage";
  // 상·부의·조의 — 관계가 분명한 것만 세분.
  const isCondolence =
    s.includes("조의") || s.includes("부의") || s.includes("근조") || /[^\w]?상$/.test(s) || s.includes("상(");
  if (
    s.includes("부친상") ||
    s.includes("모친상") ||
    s.includes("조모상") ||
    s.includes("조부상") ||
    s.includes("장인상") ||
    s.includes("장모상") ||
    s.includes("부모상")
  )
    return "death_parent";
  if (
    s.includes("형제") ||
    s.includes("자매") ||
    s.includes("누님") ||
    s.includes("동생") ||
    s.includes("언니") ||
    s.includes("오빠")
  )
    return "death_sibling";
  if (isCondolence) return "expense_etc"; // 관계 불명 — 기타로 두고 적요 보존
  // 생일 — 축하금 vs 간식비.
  if (s.includes("생일") || s.includes("생신")) {
    if (
      s.includes("축하금") ||
      s.includes("상품권") ||
      s.includes("선물") ||
      s.includes("축하용품")
    )
      return "birthday_cash";
    if (
      s.includes("간식") ||
      s.includes("케이크") ||
      s.includes("케익") ||
      s.includes("다과") ||
      s.includes("파티") ||
      s.includes("용품")
    )
      return "birthday_snack";
    return "birthday_cash";
  }
  return "expense_etc";
}

// =====================================================================
// 시트 파싱
// =====================================================================
const HEADER_LABELS = { desc: "적요", amount: "금액", date: "날짜" };

// 머리글 행 찾기 — A"적요" B"금액" C"날짜" 가 한 줄에 있는 행.
function findHeaderRow(rows: unknown[][]): number {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const r = rows[i] ?? [];
    if (
      squash(r[0]) === HEADER_LABELS.desc &&
      squash(r[1]) === HEADER_LABELS.amount &&
      squash(r[2]) === HEADER_LABELS.date
    )
      return i;
  }
  return -1;
}

// "합 계" 행 — 데이터의 끝.
function isTotalRow(r: unknown[]): boolean {
  return squash(r?.[0]) === "합계" || squash(r?.[3]) === "합계";
}
// "※ 12/31 잔액" 행(구형 시트의 잔액).
function isBalanceRow(r: unknown[]): boolean {
  const s = squash(r?.[0]);
  return s.includes("잔액");
}

// 시트명 → 연도. "2010년" / "2025" 모두 지원. 실패 시 제목행에서 찾는다.
function yearOfSheet(name: string, rows: unknown[][]): number | null {
  const m = name.match(/(\d{4})/);
  if (m) return Number(m[1]);
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const t = txt((rows[i] ?? [])[0]).match(/(\d{4})\s*년/);
    if (t) return Number(t[1]);
  }
  return null;
}

function parseSheet(
  sheetName: string,
  rows: unknown[][],
  out: { entries: ImportedEntry[]; skipped: SkippedRow[]; warnings: string[] }
): SheetSummary | null {
  const year = yearOfSheet(sheetName, rows);
  if (year == null) {
    out.warnings.push(`시트 '${sheetName}': 연도를 알 수 없어 건너뜁니다.`);
    return null;
  }
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    out.warnings.push(
      `시트 '${sheetName}': 머리글(적요·금액·날짜)을 찾지 못해 건너뜁니다.`
    );
    return null;
  }

  let sheetIncomeTotal: number | null = null;
  let sheetExpenseTotal: number | null = null;
  let sheetBalance: number | null = null;
  let parsedIncome = 0;
  let parsedExpense = 0;
  let incomeRows = 0;
  let expenseRows = 0;
  let carryOverAmount: number | null = null;
  let carryOverRow: number | null = null;
  // 세입의 월 추정용 — 직전에 본 월을 물려받는다.
  let lastIncomeMonth: number | null = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const rowNo = i + 1;

    if (isTotalRow(r)) {
      sheetIncomeTotal = parseAmount(r[1]);
      sheetExpenseTotal = parseAmount(r[4]);
      // 잔액은 합계 바로 다음 행(구형)에 있을 수 있다.
      const next = rows[i + 1] ?? [];
      if (isBalanceRow(next)) sheetBalance = parseAmount(next[1]);
      break;
    }

    // --- 세입(A 적요 / B 금액) ---
    const incDesc = txt(r[0]);
    if (incDesc) {
      const amt = parseAmount(r[1]);
      if (amt == null || amt === 0) {
        // 금액이 비어 있는 줄은 그 달에 아직 입금이 없던 칸 — 오류가 아니다.
        if (amt == null && txt(r[1]))
          out.skipped.push({
            sheet: sheetName,
            row: rowNo,
            side: "income",
            text: `${incDesc} / ${txt(r[1])}`,
            reason: "금액을 숫자로 읽을 수 없음",
          });
      } else {
        const isCarry = squash(incDesc).includes("이월");
        const month = monthFromDescription(incDesc);
        if (month != null) lastIncomeMonth = month;
        if (isCarry) {
          // 이월금은 연도 순액에는 넣되(시트 합계와 대조하기 위해) 이관 대상에서는
          // 떼어 둔다 — 앞 연도가 장부에 있으면 이월이 자동 계산되기 때문.
          carryOverAmount = amt;
          carryOverRow = rowNo;
          parsedIncome += amt;
          incomeRows += 1;
        } else {
          const useMonth = month ?? lastIncomeMonth ?? 1;
          // 회비는 매달 25일 납부(시트 메모), 그 외는 그 달 말일로 둔다.
          const isFee = squash(incDesc).includes("상조회비");
          const day = isFee
            ? Math.min(25, lastDayOf(year, useMonth))
            : lastDayOf(year, useMonth);
          out.entries.push({
            entry_date: ymd(year, useMonth, day),
            kind: "income",
            category: inferIncomeCategory(incDesc),
            description: incDesc.replace(/\s+/g, " "),
            amount: amt,
            sheet: sheetName,
            row: rowNo,
            dateInferred: true, // 세입은 원본에 날짜 열이 없다
          });
          parsedIncome += amt;
          incomeRows += 1;
        }
      }
    }

    // --- 세출(C 날짜 / D 적요 / E 금액) ---
    const expDesc = txt(r[3]);
    const expAmt = parseAmount(r[4]);
    if (expDesc || expAmt != null) {
      if (expAmt == null || expAmt === 0) {
        // 이어지는 명단 줄(금액 없이 이름만) — 앞 행의 부속이므로 조용히 건너뛴다.
        if (expDesc && txt(r[4]))
          out.skipped.push({
            sheet: sheetName,
            row: rowNo,
            side: "expense",
            text: `${expDesc} / ${txt(r[4])}`,
            reason: "금액을 숫자로 읽을 수 없음",
          });
        else if (expDesc)
          out.skipped.push({
            sheet: sheetName,
            row: rowNo,
            side: "expense",
            text: expDesc.replace(/\s+/g, " ").slice(0, 60),
            reason: "금액 없음(앞 행에 딸린 설명으로 보임)",
          });
      } else if (!expDesc) {
        out.skipped.push({
          sheet: sheetName,
          row: rowNo,
          side: "expense",
          text: `금액 ${expAmt}`,
          reason: "적요 없음",
        });
      } else {
        const parsed = parseEntryDate(r[2], year);
        let entryDate = parsed;
        let inferred = false;
        if (!entryDate) {
          // 날짜가 비면 같은 연도 말일로 두고 추정 표시(연 합계·이월에는 영향 없음).
          entryDate = ymd(year, 12, 31);
          inferred = true;
        } else if (Number(entryDate.slice(0, 4)) !== year) {
          out.warnings.push(
            `시트 '${sheetName}' ${rowNo}행: 날짜(${entryDate})가 시트 연도와 달라 ${year}년으로 맞췄습니다.`
          );
          entryDate = ymd(year, Number(entryDate.slice(5, 7)), Number(entryDate.slice(8, 10)));
        }
        out.entries.push({
          entry_date: entryDate,
          kind: "expense",
          category: inferExpenseCategory(expDesc),
          description: expDesc.replace(/\s+/g, " "),
          amount: expAmt,
          sheet: sheetName,
          row: rowNo,
          dateInferred: inferred,
        });
        parsedExpense += expAmt;
        expenseRows += 1;
      }
    }
  }

  const parsedNet = parsedIncome - parsedExpense;
  return {
    sheet: sheetName,
    year,
    headerRow: headerIdx + 1,
    sheetIncomeTotal,
    sheetExpenseTotal,
    sheetBalance,
    parsedIncome,
    parsedExpense,
    parsedNet,
    incomeRows,
    expenseRows,
    carryOverAmount,
    carryOverRow,
    incomeMatches:
      sheetIncomeTotal == null ? false : sheetIncomeTotal === parsedIncome,
    expenseMatches:
      sheetExpenseTotal == null ? false : sheetExpenseTotal === parsedExpense,
    balanceMatches: sheetBalance == null ? false : sheetBalance === parsedNet,
  };
}

// 신형 시트의 잔액 칸(H6 등) — "잔액" 라벨 아래·옆의 숫자를 찾는다.
function findBalanceCell(rows: unknown[][]): number | null {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const r = rows[i] ?? [];
    for (let c = 5; c < r.length; c++) {
      if (squash(r[c]) !== "잔액") continue;
      // 같은 행 오른쪽 → 다음 행 같은 열 순서로 숫자를 찾는다.
      for (let k = c + 1; k < r.length; k++) {
        const v = parseAmount(r[k]);
        if (v != null) return v;
      }
      const below = rows[i + 1] ?? [];
      for (let k = c; k < below.length; k++) {
        const v = parseAmount(below[k]);
        if (v != null) return v;
      }
    }
  }
  return null;
}

export function parseMutualWorkbook(buffer: Uint8Array): ImportParseResult {
  const wb = XLSX.read(buffer, { type: "array" });
  const out = {
    entries: [] as ImportedEntry[],
    skipped: [] as SkippedRow[],
    warnings: [] as string[],
  };
  const sheets: SheetSummary[] = [];

  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1,
      defval: null,
      raw: false,
      blankrows: true,
    });
    const summary = parseSheet(name, rows, out);
    if (!summary) continue;
    // 구형은 "※ 12/31 잔액" 행에서, 신형은 우측 "잔액" 칸에서 읽는다.
    if (summary.sheetBalance == null) {
      const b = findBalanceCell(rows);
      if (b != null) {
        summary.sheetBalance = b;
        summary.balanceMatches = b === summary.parsedNet;
      }
    }
    sheets.push(summary);
  }

  sheets.sort((a, b) => a.year - b.year);
  return { sheets, entries: out.entries, skipped: out.skipped, warnings: out.warnings };
}

// =====================================================================
// 이월금 정책 — 앞 연도가 (파일 안이든 장부든) 있으면 이월금 행을 만들지 않는다.
//   장부의 잔액은 "그 연도 1/1 이전 전체 순액"으로 계산하므로, 앞 연도가 있으면
//   이월이 자동으로 잡힌다. 앞 연도가 없는 시트(연도 사이 공백)만 이월금을
//   income_etc 1행으로 넣어 시작 잔액을 살린다.
// =====================================================================
export type CarryOverPlan = {
  sheet: string;
  year: number;
  amount: number;
  include: boolean;
  reason: string;
};

export function planCarryOvers(
  sheets: SheetSummary[],
  yearsAlreadyInLedger: number[] = []
): CarryOverPlan[] {
  const known = new Set<number>([
    ...sheets.map((s) => s.year),
    ...yearsAlreadyInLedger,
  ]);
  const plans: CarryOverPlan[] = [];
  for (const s of sheets) {
    if (s.carryOverAmount == null) continue;
    const prevPresent = known.has(s.year - 1);
    plans.push({
      sheet: s.sheet,
      year: s.year,
      amount: s.carryOverAmount,
      include: !prevPresent,
      reason: prevPresent
        ? `${s.year - 1}년 장부가 있어 이월이 자동 계산됩니다(중복 방지).`
        : `${s.year - 1}년 장부가 없어 시작 잔액으로 1행 기입합니다.`,
    });
  }
  return plans;
}

// 이월금 계획을 실제 기입 행으로.
export function carryOverEntries(plans: CarryOverPlan[]): ImportedEntry[] {
  return plans
    .filter((p) => p.include)
    .map((p) => ({
      entry_date: `${p.year}-01-01`,
      kind: "income" as const,
      category: "income_etc",
      description: `${p.year}년 이월금`,
      amount: p.amount,
      sheet: p.sheet,
      row: 0,
      dateInferred: true,
    }));
}

// 카테고리 라벨이 실제 규정표에 있는지 검증(오타 방지용 — 테스트가 쓴다).
export function unknownCategories(entries: ImportedEntry[]): string[] {
  const bad = new Set<string>();
  for (const e of entries) if (!mutualCategory(e.category)) bad.add(e.category);
  return [...bad];
}

// =====================================================================
// 연도 공백 탐지 — 이 파일은 2010·2011 다음이 2023 으로 뛴다(2012~2022 없음).
//   장부 잔액은 "이전 전체 순액"으로 계산하므로, 끊긴 구간을 한꺼번에 이관하면
//   앞 구간의 잔액이 뒤 구간에 그대로 얹혀 시트에 적힌 잔액과 달라진다.
//   → 화면이 구간을 보여 주고 담당이 이관 범위를 고르게 한다.
// =====================================================================
export type YearRun = { years: number[]; from: number; to: number };

export function yearRuns(years: number[]): YearRun[] {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  const runs: YearRun[] = [];
  for (const y of sorted) {
    const last = runs[runs.length - 1];
    if (last && y === last.to + 1) {
      last.years.push(y);
      last.to = y;
    } else {
      runs.push({ years: [y], from: y, to: y });
    }
  }
  return runs;
}

// 선택한 연도들로 이관할 때 시트 잔액과 어긋나는지 판정.
//   같은 연속 구간만 고르면 각 연도 누적 잔액이 시트 잔액과 일치한다.
export type ImportRangeCheck = {
  runs: YearRun[];
  selectedRuns: number; // 선택이 걸친 구간 수
  contiguous: boolean; // 한 구간 안에서만 골랐는지
  offset: number; // 여러 구간을 고를 때 뒤 구간에 얹히는 금액
  message: string | null;
};

export function checkImportRange(
  sheets: SheetSummary[],
  selectedYears: number[]
): ImportRangeCheck {
  const runs = yearRuns(sheets.map((s) => s.year));
  const chosen = new Set(selectedYears);
  const touched = runs.filter((r) => r.years.some((y) => chosen.has(y)));
  const contiguous = touched.length <= 1;
  // 뒤 구간에 얹히는 금액 = 앞 구간들의 마지막 연도 잔액 합.
  let offset = 0;
  if (!contiguous) {
    for (const r of touched.slice(0, -1)) {
      const last = sheets.find((s) => s.year === r.to);
      offset += last?.parsedNet ?? 0;
    }
  }
  return {
    runs,
    selectedRuns: touched.length,
    contiguous,
    offset,
    message: contiguous
      ? null
      : `선택한 연도가 ${touched.length}개 구간(${touched
          .map((r) => (r.from === r.to ? `${r.from}` : `${r.from}~${r.to}`))
          .join(", ")})으로 끊겨 있습니다. 사이 연도 자료가 없어 앞 구간 잔액 ${offset.toLocaleString(
          "ko-KR"
        )}원이 뒤 구간 잔액에 더해집니다. 시트에 적힌 잔액과 맞추려면 한 구간만 고르세요.`,
  };
}
