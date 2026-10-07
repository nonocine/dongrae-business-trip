import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { clubBudgetPlansQuery, clubExpensesQuery } from "@/lib/clubData";

// =====================================================================
// 동아리 예산 '집행' 내역 — 조회·수정·삭제 (서버 전용, 김준호 선생님 요청 2026-10-07)
//   * 실제 집행(saem_club_expenses)만 다룹니다. 계획(saem_club_budget_plans)은
//     계획서 편집기 몫이라 여기서 고치지 않습니다(합계 비교용으로 읽기만).
//   * 조회는 lib/clubData 의 같은 쿼리(clubExpensesQuery) — 계획서의 '사용 합계'·
//     대시보드·MCP(club_budget·spending_overview)와 숫자가 같습니다.
//   * created_by(최초 입력자)는 덮어쓰지 않습니다. 수정 시각은 updated_at.
//   * 월간보고가 확정된 달의 집행은 막지 않고 확인을 받습니다. 확정 보고에는
//     그때의 집행 합계(expense_total)가 고정돼 있어 고치면 보고 숫자와 달라지지만,
//     잘못 넣은 건(중복 등)을 바로잡을 길은 열어 둬야 하기 때문입니다.
//   * 권한 확인은 호출부(hr/clubs/actions — requireClubAccess) 책임입니다.
// =====================================================================

export type ClubExpenseRow = {
  id: string;
  sessionId: string | null;
  date: string;
  fundingSource: string;
  budgetCategory: string;
  description: string;
  amount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string | null; // 처음 입력 그대로면 null(화면에 '수정됨' 표시 안 함)
  monthReportConfirmed: boolean;
};

export type ClubExpenseData = {
  programId: string;
  name: string;
  year: number;
  rows: ClubExpenseRow[];
  planTotal: number; // 그 해 계획 합계(saem_club_budget_plans)
  expenseTotal: number; // 그 해 집행 합계
};

async function confirmedMonths(programId: string, year: number): Promise<Set<number>> {
  const { data, error } = await supabaseAdmin
    .from("saem_club_monthly_reports")
    .select("report_month,status")
    .eq("program_id", programId)
    .eq("report_year", year);
  if (error) throw new Error(error.message);
  return new Set(
    ((data ?? []) as { report_month: number; status: string }[])
      .filter((r) => r.status === "confirmed")
      .map((r) => Number(r.report_month))
  );
}

async function isMonthConfirmed(programId: string, ymd: string): Promise<boolean> {
  return (await confirmedMonths(programId, Number(ymd.slice(0, 4)))).has(
    Number(ymd.slice(5, 7))
  );
}

async function requireClubProgramName(programId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("saem_programs")
    .select("name")
    .eq("id", programId)
    .eq("program_type", "club")
    .maybeSingle();
  if (!data) throw new Error("동아리를 찾을 수 없습니다.");
  return String((data as { name?: string }).name ?? "");
}

// 한 동아리의 한 해 집행 내역(집행일 → 입력 순).
export async function loadClubExpenses(
  programId: string,
  year: number
): Promise<ClubExpenseData> {
  const name = await requireClubProgramName(programId);
  const [expenseQuery, planQuery, months] = await Promise.all([
    clubExpensesQuery([programId], `${year}-01-01`, `${year + 1}-01-01`),
    clubBudgetPlansQuery([programId], year),
    confirmedMonths(programId, year),
  ]);
  if (expenseQuery.error) throw new Error(expenseQuery.error.message);
  if (planQuery.error) throw new Error(planQuery.error.message);

  const rows = ((expenseQuery.data ?? []) as unknown as Record<string, unknown>[])
    .map((r): ClubExpenseRow => {
      const date = String(r.expense_date ?? "");
      const createdAt = String(r.created_at ?? "");
      const updatedAt = (r.updated_at as string | null) ?? null;
      return {
        id: String(r.id),
        sessionId: (r.session_id as string | null) ?? null,
        date,
        fundingSource: String(r.funding_source ?? ""),
        budgetCategory: String(r.budget_category ?? ""),
        description: String(r.description ?? ""),
        amount: Number(r.amount ?? 0),
        createdBy: String(r.created_by ?? ""),
        createdAt,
        // insert 때 updated_at = created_at 이라, 같으면 수정 안 된 건입니다.
        updatedAt: updatedAt && updatedAt !== createdAt ? updatedAt : null,
        monthReportConfirmed: months.has(Number(date.slice(5, 7))),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

  return {
    programId,
    name,
    year,
    rows,
    planTotal: ((planQuery.data ?? []) as { amount: number | null }[]).reduce(
      (sum, p) => sum + Number(p.amount ?? 0),
      0
    ),
    expenseTotal: rows.reduce((sum, r) => sum + r.amount, 0),
  };
}

type Result = { ok: true } | { ok: false; message: string };

async function loadExpense(id: string) {
  const { data, error } = await supabaseAdmin
    .from("saem_club_expenses")
    .select("id,program_id,expense_date")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("집행 내역을 찾을 수 없습니다. (이미 삭제됐을 수 있습니다)");
  const row = data as { id: string; program_id: string; expense_date: string };
  await requireClubProgramName(row.program_id);
  return row;
}

const REPORT_WARNING =
  "월간보고가 확정된 달의 집행입니다. 고치면 확정된 보고의 집행 합계와 달라집니다. 확인란에 체크한 뒤 진행하세요.";

export type ClubExpenseInput = {
  id: string;
  date: string;
  fundingSource: string;
  budgetCategory: string;
  description: string;
  amount: number;
  confirmReport?: boolean;
};

// 집행 1건 수정 — created_by 는 건드리지 않고 updated_at 만 새로 찍습니다.
export async function updateClubExpenseRow(input: ClubExpenseInput): Promise<Result> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !input.description.trim()) {
    return { ok: false, message: "집행일과 내역을 입력하세요." };
  }
  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, message: "금액은 0원 이상 숫자로 입력하세요." };
  }
  const row = await loadExpense(input.id);
  const touchesConfirmed =
    (await isMonthConfirmed(row.program_id, row.expense_date)) ||
    (input.date.slice(0, 7) !== row.expense_date.slice(0, 7) &&
      (await isMonthConfirmed(row.program_id, input.date)));
  if (touchesConfirmed && !input.confirmReport) return { ok: false, message: REPORT_WARNING };

  const { error, count } = await supabaseAdmin
    .from("saem_club_expenses")
    .update(
      {
        expense_date: input.date,
        funding_source: input.fundingSource.trim() || "동래구동아리지원사업비",
        budget_category: input.budgetCategory.trim() || "사업비",
        description: input.description.trim(),
        amount,
        updated_at: new Date().toISOString(),
      },
      { count: "exact" }
    )
    .eq("id", input.id);
  if (error) throw new Error(error.message);
  if (!count) return { ok: false, message: "집행 내역을 찾을 수 없습니다. (이미 삭제됐을 수 있습니다)" };
  return { ok: true };
}

// 집행 1건 삭제. 화면에서 한 번 확인을 받은 뒤 호출합니다.
export async function deleteClubExpenseRow(input: {
  id: string;
  confirmReport?: boolean;
}): Promise<Result> {
  const row = await loadExpense(input.id);
  if ((await isMonthConfirmed(row.program_id, row.expense_date)) && !input.confirmReport) {
    return { ok: false, message: REPORT_WARNING };
  }
  const { error, count } = await supabaseAdmin
    .from("saem_club_expenses")
    .delete({ count: "exact" })
    .eq("id", input.id);
  if (error) throw new Error(error.message);
  if (!count) return { ok: false, message: "집행 내역을 찾을 수 없습니다. (이미 삭제됐을 수 있습니다)" };
  return { ok: true };
}
