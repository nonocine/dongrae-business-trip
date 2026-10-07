import { supabaseAdmin } from "@/lib/supabaseAdmin";

// =====================================================================
// 동아리 예산·집행 조회 — 화면(hr/clubs/actions: getClubDashboard·getClubPlan)과
//   MCP 가 같은 쿼리를 씁니다. 권한 확인은 호출부 책임입니다.
//   * 쿼리 빌더를 돌려주므로 오류 처리는 호출부가 지금까지 하던 대로 합니다
//     (대시보드는 계획 조회 실패를 비워 표시, 지출 조회 실패는 throw 등).
//   * 계획(saem_club_budget_plans)은 연 단위(plan_year), 집행(saem_club_expenses)은
//     지출일(expense_date) 범위로 읽습니다.
// =====================================================================

export const CLUB_PROGRAM_COLUMNS =
  "id,name,instructor_id,target,capacity,room,goal,plan_submitted_at,status";

// 운영 중인 동아리 프로그램(이름순).
export function clubProgramsQuery() {
  return supabaseAdmin
    .from("saem_programs")
    .select(CLUB_PROGRAM_COLUMNS)
    .eq("program_type", "club")
    .eq("status", "active")
    .order("name");
}

// 집행 내역 목록(수정·삭제 화면)까지 같은 쿼리를 쓰도록 열을 넉넉히 둡니다.
export const CLUB_EXPENSE_COLUMNS =
  "id,program_id,session_id,expense_date,funding_source,budget_category,description,amount,created_by,created_at,updated_at";

// 동아리 지출 — [start, endExclusive) 지출일 범위.
export function clubExpensesQuery(
  programIds: string[],
  start: string,
  endExclusive: string
) {
  return supabaseAdmin
    .from("saem_club_expenses")
    .select(CLUB_EXPENSE_COLUMNS)
    .in("program_id", programIds)
    .gte("expense_date", start)
    .lt("expense_date", endExclusive);
}

// 동아리 예산계획 — 한 해(plan_year) 분.
export function clubBudgetPlansQuery(programIds: string[], year: number) {
  return supabaseAdmin
    .from("saem_club_budget_plans")
    .select("id,program_id,budget_category,description,amount,sort_order,created_at")
    .in("program_id", programIds)
    .eq("plan_year", year)
    .order("sort_order")
    .order("created_at");
}

// --- MCP 용 연간 요약 -------------------------------------------------
export type ClubBudgetSummary = {
  programId: string;
  name: string;
  planSubmittedAt: string | null;
  planTotal: number;
  expenseTotal: number;
};

// 한 해의 동아리별 계획 합계·집행 합계(1/1~12/31). 조회 실패는 사유와 함께 throw.
export async function loadClubBudgetSummaries(
  year: number
): Promise<ClubBudgetSummary[]> {
  const programQuery = await clubProgramsQuery();
  if (programQuery.error) throw new Error(programQuery.error.message);
  const programs = (programQuery.data ?? []) as unknown as Array<{
    id: string;
    name: string;
    plan_submitted_at: string | null;
  }>;
  if (programs.length === 0) return [];
  const ids = programs.map((p) => p.id);

  const [planQuery, expenseQuery] = await Promise.all([
    clubBudgetPlansQuery(ids, year),
    clubExpensesQuery(ids, `${year}-01-01`, `${year + 1}-01-01`),
  ]);
  if (planQuery.error) throw new Error(planQuery.error.message);
  if (expenseQuery.error) throw new Error(expenseQuery.error.message);

  const planBy = new Map<string, number>();
  for (const r of (planQuery.data ?? []) as { program_id: string; amount: number | null }[]) {
    planBy.set(r.program_id, (planBy.get(r.program_id) ?? 0) + Number(r.amount ?? 0));
  }
  const expenseBy = new Map<string, number>();
  for (const r of (expenseQuery.data ?? []) as { program_id: string; amount: number | null }[]) {
    expenseBy.set(r.program_id, (expenseBy.get(r.program_id) ?? 0) + Number(r.amount ?? 0));
  }

  return programs.map((p) => ({
    programId: p.id,
    name: p.name,
    planSubmittedAt: p.plan_submitted_at,
    planTotal: planBy.get(p.id) ?? 0,
    expenseTotal: expenseBy.get(p.id) ?? 0,
  }));
}

// 기간 안의 동아리 지출 — 동아리별·재원별 합계.
export type ClubExpenseInRange = {
  byClub: Map<string, { name: string; amount: number }>;
  byFunding: Map<string, number>;
  total: number;
};
export async function loadClubExpensesInRange(
  start: string,
  endExclusive: string
): Promise<ClubExpenseInRange> {
  const programQuery = await clubProgramsQuery();
  if (programQuery.error) throw new Error(programQuery.error.message);
  const programs = (programQuery.data ?? []) as unknown as Array<{ id: string; name: string }>;
  const out: ClubExpenseInRange = { byClub: new Map(), byFunding: new Map(), total: 0 };
  if (programs.length === 0) return out;
  const nameById = new Map(programs.map((p) => [p.id, p.name]));

  const { data, error } = await clubExpensesQuery([...nameById.keys()], start, endExclusive);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as {
    program_id: string;
    amount: number | null;
    funding_source: string | null;
  }[]) {
    const amount = Number(r.amount ?? 0);
    const club = out.byClub.get(r.program_id) ?? {
      name: nameById.get(r.program_id) ?? "(이름 없음)",
      amount: 0,
    };
    club.amount += amount;
    out.byClub.set(r.program_id, club);
    const fund = (r.funding_source ?? "").trim() || "미기재";
    out.byFunding.set(fund, (out.byFunding.get(fund) ?? 0) + amount);
    out.total += amount;
  }
  return out;
}
