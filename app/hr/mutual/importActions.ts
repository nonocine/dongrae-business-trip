"use server";

// =====================================================================
// 상조회 과거 장부 이관 + 연도 엑셀 데이터 — MU-4
//   * 접근: M0 또는 mutual 직무. 진입 시 재검증.
//   * 미리보기 → 적용. 미리보기는 연도별 건수·합계·잔액을 시트값과 대조해 보여
//     주고, 파싱 실패 행은 목록으로 넘긴다(건너뜀 — 수기 입력 유도).
//   * 이월금은 앞 연도가 있으면 기입하지 않는다(장부가 이월을 자동 계산하므로
//     중복 방지). lib/mutualImport.planCarryOvers 참조.
//   * 이미 그 연도 데이터가 장부에 있으면 덮지 않고 막는다 — 담당이 먼저
//     비우도록 안내한다(조용한 이중 기입 방지).
// =====================================================================

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireMutualAccess } from "@/lib/mutualAccess";
import {
  carryOverEntries,
  checkImportRange,
  parseMutualWorkbook,
  planCarryOvers,
  yearRuns,
  type ImportedEntry,
  type SkippedRow,
} from "@/lib/mutualImport";
import { mutualCategoryLabel } from "@/lib/mutual";

const LEDGER = "mutual_ledger";

export type ImportSheetPreview = {
  sheet: string;
  year: number;
  headerRow: number;
  incomeRows: number;
  expenseRows: number;
  sheetIncomeTotal: number | null;
  sheetExpenseTotal: number | null;
  sheetBalance: number | null;
  parsedIncome: number;
  parsedExpense: number;
  parsedNet: number;
  incomeMatches: boolean;
  expenseMatches: boolean;
  balanceMatches: boolean;
  carryOverAmount: number | null;
  carryOverIncluded: boolean;
  carryOverReason: string | null;
  existingRows: number; // 이미 장부에 있는 그 연도 행 수
};

export type ImportPreviewResult =
  | {
      ok: true;
      sheets: ImportSheetPreview[];
      runs: { from: number; to: number }[];
      skipped: SkippedRow[];
      warnings: string[];
      totalRows: number;
      inferredDates: number; // 원본에 날짜가 없어 추정한 행 수
      categoryBreakdown: { label: string; count: number; amount: number }[];
    }
  | { ok: false; message: string };

export async function previewMutualImport(input: {
  base64: string;
}): Promise<ImportPreviewResult> {
  try {
    await requireMutualAccess();
    if (!input.base64) return { ok: false, message: "엑셀 파일을 선택하세요." };

    const parsed = parseMutualWorkbook(Buffer.from(input.base64, "base64"));
    if (parsed.sheets.length === 0)
      return {
        ok: false,
        message:
          parsed.warnings[0] ??
          "읽을 수 있는 연도 시트가 없습니다. (머리글 '적요·금액·날짜'를 찾지 못했습니다)",
      };

    // 이미 장부에 있는 연도 행 수 — 중복 이관 방지 안내용.
    const { data: existing } = await supabaseAdmin
      .from(LEDGER)
      .select("entry_date");
    const existingByYear = new Map<number, number>();
    for (const r of existing ?? []) {
      const y = Number(String((r as { entry_date: string }).entry_date).slice(0, 4));
      existingByYear.set(y, (existingByYear.get(y) ?? 0) + 1);
    }

    const plans = planCarryOvers(parsed.sheets, [...existingByYear.keys()]);
    const planByYear = new Map(plans.map((p) => [p.year, p]));

    const sheets: ImportSheetPreview[] = parsed.sheets.map((s) => {
      const plan = planByYear.get(s.year);
      return {
        sheet: s.sheet,
        year: s.year,
        headerRow: s.headerRow,
        incomeRows: s.incomeRows,
        expenseRows: s.expenseRows,
        sheetIncomeTotal: s.sheetIncomeTotal,
        sheetExpenseTotal: s.sheetExpenseTotal,
        sheetBalance: s.sheetBalance,
        parsedIncome: s.parsedIncome,
        parsedExpense: s.parsedExpense,
        parsedNet: s.parsedNet,
        incomeMatches: s.incomeMatches,
        expenseMatches: s.expenseMatches,
        balanceMatches: s.balanceMatches,
        carryOverAmount: s.carryOverAmount,
        carryOverIncluded: plan?.include ?? false,
        carryOverReason: plan?.reason ?? null,
        existingRows: existingByYear.get(s.year) ?? 0,
      };
    });

    // 사유별 분포 — 카테고리 추론이 엉뚱하지 않은지 담당이 눈으로 확인.
    const byCat = new Map<string, { count: number; amount: number }>();
    for (const e of parsed.entries) {
      const cur = byCat.get(e.category) ?? { count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += e.amount;
      byCat.set(e.category, cur);
    }

    return {
      ok: true,
      sheets,
      runs: yearRuns(parsed.sheets.map((s) => s.year)).map((r) => ({
        from: r.from,
        to: r.to,
      })),
      skipped: parsed.skipped,
      warnings: parsed.warnings,
      totalRows: parsed.entries.length,
      inferredDates: parsed.entries.filter((e) => e.dateInferred).length,
      categoryBreakdown: [...byCat.entries()]
        .map(([key, v]) => ({ label: mutualCategoryLabel(key), ...v }))
        .sort((a, b) => b.amount - a.amount),
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "미리보기 중 오류가 발생했습니다.",
    };
  }
}

export type ImportApplyResult =
  | {
      ok: true;
      years: number[];
      inserted: number;
      carryOversAdded: number;
      skippedRows: number;
      rangeWarning: string | null;
    }
  | { ok: false; message: string };

export async function applyMutualImport(input: {
  base64: string;
  years: number[]; // 이관할 연도(체크박스 선택)
}): Promise<ImportApplyResult> {
  try {
    const ctx = await requireMutualAccess();
    const years = [...new Set((input.years ?? []).map((y) => Math.round(Number(y))))]
      .filter((y) => Number.isFinite(y) && y > 1900)
      .sort((a, b) => a - b);
    if (!years.length) return { ok: false, message: "이관할 연도를 선택하세요." };

    const parsed = parseMutualWorkbook(Buffer.from(input.base64, "base64"));
    const chosen = new Set(years);
    const targetSheets = parsed.sheets.filter((s) => chosen.has(s.year));
    if (!targetSheets.length)
      return { ok: false, message: "선택한 연도의 시트를 찾을 수 없습니다." };

    // 이미 그 연도 데이터가 있으면 막는다(덮어쓰지 않음).
    const { data: existing } = await supabaseAdmin
      .from(LEDGER)
      .select("entry_date");
    const occupied = new Set(
      (existing ?? []).map((r) =>
        Number(String((r as { entry_date: string }).entry_date).slice(0, 4))
      )
    );
    const clash = years.filter((y) => occupied.has(y));
    if (clash.length)
      return {
        ok: false,
        message: `${clash.join(", ")}년 장부에 이미 기입된 행이 있습니다. 그 연도를 선택에서 빼거나 기존 행을 먼저 정리하세요.`,
      };

    // 이월금 정책 — 선택 범위 + 장부에 이미 있는 연도를 함께 본다.
    const plans = planCarryOvers(targetSheets, [...occupied]);
    const rows: ImportedEntry[] = [
      ...parsed.entries.filter((e) =>
        chosen.has(Number(e.entry_date.slice(0, 4)))
      ),
      ...carryOverEntries(plans),
    ];
    if (!rows.length)
      return { ok: false, message: "이관할 행이 없습니다." };

    // 500행 단위로 나눠 넣는다(과거 15년치를 한 번에 보내지 않도록).
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK).map((e) => ({
        entry_date: e.entry_date,
        kind: e.kind,
        category: e.category,
        description: e.description,
        amount: e.amount,
        // 과거 이관분은 대상 직원을 연결하지 않는다 — 적요의 이름이 지금 재직자와
        // 동일인이라는 보장이 없어 잘못 묶일 위험이 있다(적요에 이름은 남는다).
        employee_id: null,
        created_by: `${ctx.name} (과거 이관)`,
      }));
      const { error } = await supabaseAdmin.from(LEDGER).insert(slice);
      if (error) throw new Error(error.message);
      inserted += slice.length;
    }

    const range = checkImportRange(parsed.sheets, years);

    revalidatePath("/hr/mutual/ledger");
    revalidatePath("/hr/mutual/closing");
    return {
      ok: true,
      years,
      inserted,
      carryOversAdded: plans.filter((p) => p.include).length,
      skippedRows: parsed.skipped.filter((s) =>
        targetSheets.some((t) => t.sheet === s.sheet)
      ).length,
      rangeWarning: range.message,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "이관 중 오류가 발생했습니다.",
    };
  }
}

// 연마감 화면 요약 — 연도별 건수·잔액(엑셀 다운로드 대상 파악용).
export type ClosingYear = {
  year: number;
  rows: number;
  income: number;
  expense: number;
  carryOver: number;
  balance: number;
};

export async function getClosingSummary(): Promise<{
  years: ClosingYear[];
  isM0: boolean;
}> {
  const ctx = await requireMutualAccess();
  const { data, error } = await supabaseAdmin
    .from(LEDGER)
    .select("entry_date, kind, amount")
    .order("entry_date", { ascending: true });
  if (error) throw new Error(error.message);

  const byYear = new Map<number, { income: number; expense: number; rows: number }>();
  for (const r of data ?? []) {
    const row = r as Record<string, unknown>;
    const y = Number(String(row.entry_date ?? "").slice(0, 4));
    if (!Number.isFinite(y)) continue;
    const cur = byYear.get(y) ?? { income: 0, expense: 0, rows: 0 };
    const amt = Math.round(Number(row.amount) || 0);
    if (row.kind === "expense") cur.expense += amt;
    else cur.income += amt;
    cur.rows += 1;
    byYear.set(y, cur);
  }

  const years: ClosingYear[] = [];
  let running = 0;
  for (const y of [...byYear.keys()].sort((a, b) => a - b)) {
    const v = byYear.get(y)!;
    const carryOver = running;
    running = carryOver + v.income - v.expense;
    years.push({
      year: y,
      rows: v.rows,
      income: v.income,
      expense: v.expense,
      carryOver,
      balance: running,
    });
  }
  return { years: years.reverse(), isM0: ctx.isM0 };
}

// 연도 전체 행 삭제 — 이관을 잘못했을 때 되돌리는 수단(M0 전용).
export async function clearMutualYear(
  year: number
): Promise<{ ok: true; deleted: number } | { ok: false; message: string }> {
  try {
    await requireMutualAccess({ onlyM0: true });
    const y = Math.round(Number(year));
    if (!Number.isFinite(y) || y <= 1900)
      return { ok: false, message: "연도를 확인하세요." };
    const { data, error } = await supabaseAdmin
      .from(LEDGER)
      .delete()
      .gte("entry_date", `${y}-01-01`)
      .lte("entry_date", `${y}-12-31`)
      .select("id");
    if (error) throw new Error(error.message);
    revalidatePath("/hr/mutual/ledger");
    revalidatePath("/hr/mutual/closing");
    return { ok: true, deleted: (data ?? []).length };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.",
    };
  }
}
