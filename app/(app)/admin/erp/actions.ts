"use server";

// =====================================================================
// /admin/erp — ERP 동기화 상태판 액션. 관장·master 전용(isManagerAdmin, 관리자 대시보드와 같은 기준).
//   * service_role 로 읽으므로 이 게이트가 유일한 방어선 — 매 액션 첫 줄에서 확인합니다.
//   * 회계 데이터(거래·결의서)는 건수만 돌려줍니다. 내용(금액·계좌·적요)은 싣지 않습니다.
// =====================================================================

import { revalidatePath } from "next/cache";
import { isManagerAdmin } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { runErpSync, type ErpRunResult } from "@/lib/erp/sync";

async function gate(): Promise<void> {
  if (!(await isManagerAdmin())) throw new Error("관장·master 만 쓸 수 있습니다.");
}

const ERP_APIS = [
  "employees",
  "leaveBalances",
  "codes",
  "duties",
  "schedules",
  "rentals",
  "documents",
  "transactions",
  "expenditures",
] as const;

const TABLE_OF: Record<(typeof ERP_APIS)[number], string> = {
  employees: "erp_employees",
  leaveBalances: "erp_leave_balances",
  codes: "erp_code_snapshots",
  duties: "erp_duties",
  schedules: "erp_schedules",
  rentals: "erp_rentals",
  documents: "erp_documents",
  transactions: "erp_transactions",
  expenditures: "erp_expenditures",
};
const HAS_REMOVED = new Set(["erp_duties", "erp_schedules", "erp_rentals", "erp_documents", "erp_transactions", "erp_expenditures"]);

export type ErpRunRow = {
  api: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  fetched: number;
  upserted: number;
  removed: number;
  error: string | null;
  range_start: string | null;
  range_end: string | null;
};

export type ErpApiStatus = {
  api: string;
  table: string;
  last: ErpRunRow | null;
  lastSuccessAt: string | null;
  rows: number; // 표의 현재 행 수(사라진 건 제외)
};

export type ErpLinkRow = {
  profileId: string;
  driverName: string;
  erpEmployeeId: string | null;
  erpName: string | null;
  erpDepartment: string | null;
  // 연결 필요 사유 — 같은 이름 재직자가 여럿이면 ambiguous, 없으면 none.
  reason: "ambiguous" | "none" | null;
};

export type ErpCandidate = { employeeId: string; name: string; department: string | null; jobTitle: string | null };

export type ErpStatusData = {
  apis: ErpApiStatus[];
  recentErrors: ErpRunRow[];
  links: ErpLinkRow[];
  candidates: ErpCandidate[]; // 재직·아직 누구에게도 연결 안 된 ERP 계정
};

const RUN_COLS = "api, trigger, started_at, finished_at, ok, fetched, upserted, removed, error, range_start, range_end";
const normName = (s: unknown) => String(s ?? "").replace(/\s+/g, "");

export async function getErpStatus(): Promise<ErpStatusData> {
  await gate();
  const { data: runs } = await supabaseAdmin
    .from("erp_sync_runs")
    .select(RUN_COLS)
    .order("started_at", { ascending: false })
    .limit(400);
  const runRows = (runs ?? []) as ErpRunRow[];

  const apis: ErpApiStatus[] = await Promise.all(
    ERP_APIS.map(async (api) => {
      const table = TABLE_OF[api];
      let q = supabaseAdmin.from(table).select("*", { count: "exact", head: true });
      if (HAS_REMOVED.has(table)) q = q.is("removed_at", null);
      const { count } = await q;
      const mine = runRows.filter((r) => r.api === api);
      let lastSuccessAt = mine.find((r) => r.ok === true)?.finished_at ?? null;
      if (!lastSuccessAt) {
        const { data: s } = await supabaseAdmin
          .from("erp_sync_runs")
          .select("finished_at")
          .eq("api", api)
          .eq("ok", true)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        lastSuccessAt = (s as { finished_at?: string } | null)?.finished_at ?? null;
      }
      return { api, table, last: mine[0] ?? null, lastSuccessAt, rows: count ?? 0 };
    })
  );

  const { data: errs } = await supabaseAdmin
    .from("erp_sync_runs")
    .select(RUN_COLS)
    .eq("ok", false)
    .order("started_at", { ascending: false })
    .limit(10);

  // 직원 연결 현황 — 활성 직원의 인사카드(employee_profiles) 기준.
  const { data: profs } = await supabaseAdmin.from("employee_profiles").select("id, driver_id, erp_employee_id");
  const profRows = ((profs ?? []) as { id: string; driver_id: string | null; erp_employee_id: string | null }[]).filter(
    (p) => p.driver_id
  );
  const { data: drv } = profRows.length
    ? await supabaseAdmin.from("drivers").select("id, name, is_active").in("id", profRows.map((p) => p.driver_id!))
    : { data: [] };
  const drvMap = new Map(((drv ?? []) as { id: string; name: string; is_active: boolean | null }[]).map((d) => [d.id, d]));
  const { data: emps } = await supabaseAdmin
    .from("erp_employees")
    .select("employee_id, name, department_name, job_title, is_employed, deleted");
  const empRows = (emps ?? []) as {
    employee_id: string;
    name: string | null;
    department_name: string | null;
    job_title: string | null;
    is_employed: boolean | null;
    deleted: boolean | null;
  }[];
  const empMap = new Map(empRows.map((e) => [e.employee_id, e]));
  const employed = empRows.filter((e) => e.is_employed === true && e.deleted !== true);
  const takenSet = new Set(profRows.map((p) => p.erp_employee_id).filter(Boolean) as string[]);

  const links: ErpLinkRow[] = profRows
    .filter((p) => p.erp_employee_id || drvMap.get(p.driver_id!)?.is_active !== false)
    .map((p): ErpLinkRow => {
      const d = drvMap.get(p.driver_id!);
      const e = p.erp_employee_id ? empMap.get(p.erp_employee_id) : undefined;
      const sameName = employed.filter((x) => normName(x.name) === normName(d?.name));
      return {
        profileId: p.id,
        driverName: d?.name ?? "(이름 없음)",
        erpEmployeeId: p.erp_employee_id,
        erpName: e?.name ?? null,
        erpDepartment: e?.department_name ?? null,
        reason: p.erp_employee_id ? null : sameName.length > 1 ? "ambiguous" : "none",
      };
    })
    .sort((a, b) => Number(!!a.erpEmployeeId) - Number(!!b.erpEmployeeId) || a.driverName.localeCompare(b.driverName, "ko"));

  const candidates: ErpCandidate[] = employed
    .filter((e) => !takenSet.has(e.employee_id))
    .map((e) => ({ employeeId: e.employee_id, name: e.name ?? "", department: e.department_name, jobTitle: e.job_title }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return { apis, recentErrors: (errs ?? []) as ErpRunRow[], links, candidates };
}

// [지금 동기화] — trigger=manual.
export async function syncErpNow(): Promise<
  { ok: true; results: Pick<ErpRunResult, "api" | "ok" | "fetched" | "upserted" | "removed" | "error">[]; linked: number } | { ok: false; message: string }
> {
  try {
    await gate();
    const s = await runErpSync("manual");
    revalidatePath("/admin/erp");
    return {
      ok: true,
      results: s.results.map(({ api, ok, fetched, upserted, removed, error }) => ({ api, ok, fetched, upserted, removed, error })),
      linked: s.link?.linked ?? 0,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "동기화하지 못했습니다." };
  }
}

// [ERP 계정 고르기] — 연결 필요(빈 칸)인 사람만. 이미 연결된 값은 바꾸지 않습니다.
export async function linkErpEmployee(profileId: string, erpEmployeeId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await gate();
    if (!profileId || !erpEmployeeId) return { ok: false, message: "직원과 ERP 계정을 고르세요." };
    const { data: e } = await supabaseAdmin
      .from("erp_employees")
      .select("employee_id")
      .eq("employee_id", erpEmployeeId)
      .maybeSingle();
    if (!e) return { ok: false, message: "ERP 계정을 찾을 수 없습니다. 동기화 뒤 다시 시도하세요." };
    const { error, count } = await supabaseAdmin
      .from("employee_profiles")
      .update({ erp_employee_id: erpEmployeeId }, { count: "exact" })
      .eq("id", profileId)
      .is("erp_employee_id", null);
    if (error?.code === "23505") return { ok: false, message: "이미 다른 직원에게 연결된 ERP 계정입니다." };
    if (error) throw new Error(error.message);
    if (!count) return { ok: false, message: "이미 연결된 직원입니다(덮어쓰지 않습니다)." };
    revalidatePath("/admin/erp");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "연결하지 못했습니다." };
  }
}
