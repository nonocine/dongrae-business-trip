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

export type ErpAccountInfo = {
  id: string;
  name: string | null;
  department: string | null;
  employeeNo: number | null;
  employed: boolean;
  firstDuty: string | null; // 그 계정 복무 첫 날(YYYY-MM-DD)
  lastDuty: string | null; // 마지막 날
};
export type ErpLinkRow = {
  profileId: string;
  driverName: string;
  erpEmployeeId: string | null; // 현재 계정
  erpName: string | null;
  erpDepartment: string | null;
  // 직원 1명 = ERP 계정 여러 개(팀 이동 발령) — 현재 + 이전 계정 정보.
  current: ErpAccountInfo | null;
  priors: ErpAccountInfo[];
  // 연결 필요 사유 — 같은 이름 재직자가 여럿이면 ambiguous, 없으면 none.
  reason: "ambiguous" | "none" | null;
  // 동기화로 새로 생긴, 아직 누구에게도 연결 안 된 같은 이름의 ERP 계정.
  newAccounts: ErpAccountInfo[];
  // 자동 제안(저장은 관장이 눌러야) — 같은 이름 계정 2개 이상·복무 날짜가 겹치지 않음 → 팀 이동으로 보임.
  suggestion: { currentId: string; priorIds: string[]; reason: string } | null;
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

  // 직원 연결 현황 — 활성 직원의 인사카드(employee_profiles) 기준. 현재 + 이전 계정.
  const { data: profs } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, driver_id, erp_employee_id, erp_prior_employee_ids");
  const profRows = (
    (profs ?? []) as { id: string; driver_id: string | null; erp_employee_id: string | null; erp_prior_employee_ids: string[] | null }[]
  ).filter((p) => p.driver_id);
  const { data: drv } = profRows.length
    ? await supabaseAdmin.from("drivers").select("id, name, is_active").in("id", profRows.map((p) => p.driver_id!))
    : { data: [] };
  const drvMap = new Map(((drv ?? []) as { id: string; name: string; is_active: boolean | null }[]).map((d) => [d.id, d]));
  const { data: emps } = await supabaseAdmin
    .from("erp_employees")
    .select("employee_id, employee_no, name, department_name, job_title, is_employed, deleted");
  const empRows = (emps ?? []) as {
    employee_id: string;
    employee_no: number | null;
    name: string | null;
    department_name: string | null;
    job_title: string | null;
    is_employed: boolean | null;
    deleted: boolean | null;
  }[];
  const empMap = new Map(empRows.map((e) => [e.employee_id, e]));
  const employed = empRows.filter((e) => e.is_employed === true && e.deleted !== true);
  const priorsOf = (p: { erp_prior_employee_ids: string[] | null }) =>
    Array.isArray(p.erp_prior_employee_ids) ? p.erp_prior_employee_ids.filter(Boolean) : [];
  const takenSet = new Set(profRows.flatMap((p) => [...(p.erp_employee_id ? [p.erp_employee_id] : []), ...priorsOf(p)]));

  // 계정별 복무 날짜 범위(첫 날~마지막 날) — 팀 이동 판단용.
  const span = new Map<string, { first: string; last: string }>();
  for (let from = 0; ; from += 1000) {
    const { data: ds } = await supabaseAdmin
      .from("erp_duties")
      .select("employee_ids, start_at, end_at")
      .is("removed_at", null)
      .order("duty_id")
      .range(from, from + 999);
    for (const d of (ds ?? []) as { employee_ids: string[]; start_at: string | null; end_at: string | null }[]) {
      if (!d.start_at) continue;
      const s0 = d.start_at.slice(0, 10);
      const e0 = (d.end_at ?? d.start_at).slice(0, 10);
      for (const id of d.employee_ids) {
        const cur = span.get(id);
        span.set(id, cur ? { first: s0 < cur.first ? s0 : cur.first, last: e0 > cur.last ? e0 : cur.last } : { first: s0, last: e0 });
      }
    }
    if (!ds || ds.length < 1000) break;
  }
  const info = (id: string): ErpAccountInfo => {
    const e = empMap.get(id);
    return {
      id,
      name: e?.name ?? null,
      department: e?.department_name ?? null,
      employeeNo: e?.employee_no ?? null,
      employed: e?.is_employed === true && e?.deleted !== true,
      firstDuty: span.get(id)?.first ?? null,
      lastDuty: span.get(id)?.last ?? null,
    };
  };

  const links: ErpLinkRow[] = profRows
    .filter((p) => p.erp_employee_id || priorsOf(p).length || drvMap.get(p.driver_id!)?.is_active !== false)
    .map((p): ErpLinkRow => {
      const d = drvMap.get(p.driver_id!);
      const mine = new Set([...(p.erp_employee_id ? [p.erp_employee_id] : []), ...priorsOf(p)]);
      const e = p.erp_employee_id ? empMap.get(p.erp_employee_id) : undefined;
      const sameNameEmployed = employed.filter((x) => normName(x.name) === normName(d?.name));
      // 같은 이름의 ERP 계정(삭제 제외) — 이 직원 것이거나 아직 아무에게도 연결 안 된 것만.
      const sameName = empRows.filter(
        (x) => x.deleted !== true && normName(x.name) === normName(d?.name) && (mine.has(x.employee_id) || !takenSet.has(x.employee_id))
      );
      const newAccounts = mine.size
        ? sameNameEmployed.filter((x) => !takenSet.has(x.employee_id)).map((x) => info(x.employee_id))
        : [];
      // 제안 — 2개 이상이고 복무 날짜가 서로 겹치지 않으면 팀 이동으로 봅니다.
      let suggestion: ErpLinkRow["suggestion"] = null;
      if (sameName.length >= 2) {
        const accts = sameName.map((x) => info(x.employee_id));
        const withSpan = accts.filter((a) => a.firstDuty && a.lastDuty).sort((a, b) => a.firstDuty!.localeCompare(b.firstDuty!));
        const overlap = withSpan.some((a, i) => i > 0 && a.firstDuty! <= withSpan[i - 1].lastDuty!);
        if (!overlap) {
          const pick = [...accts].sort(
            (a, b) => (b.lastDuty ?? "").localeCompare(a.lastDuty ?? "") || (b.employeeNo ?? 0) - (a.employeeNo ?? 0)
          )[0];
          const priorIds = accts.filter((a) => a.id !== pick.id).map((a) => a.id).sort();
          const same = p.erp_employee_id === pick.id && [...priorsOf(p)].sort().join(",") === priorIds.join(",");
          if (!same)
            suggestion = {
              currentId: pick.id,
              priorIds,
              reason: pick.lastDuty ? "최근 복무가 있는 계정을 현재 계정으로" : "employee_no 가 큰 계정을 현재 계정으로",
            };
        }
      }
      return {
        profileId: p.id,
        driverName: d?.name ?? "(이름 없음)",
        erpEmployeeId: p.erp_employee_id,
        erpName: e?.name ?? null,
        erpDepartment: e?.department_name ?? null,
        current: p.erp_employee_id ? info(p.erp_employee_id) : null,
        priors: priorsOf(p).map(info),
        reason: mine.size ? null : sameNameEmployed.length > 1 ? "ambiguous" : "none",
        newAccounts,
        suggestion,
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

// =====================================================================
// 대관 차이 대조 — erp_rentals(사라진 건 제외) ↔ rental_reservations 시설대관(reservation_type='rental').
//   rental_id = reservation_no. 기간은 예약일 기준.
//   세 목록: ERP에만 / 동업자씨에만 / 양쪽 다 있는데 날짜·시간·상태·인원이 다름.
// =====================================================================
export type RentalSide = {
  date: string | null;
  start: string | null;
  end: string | null;
  status: string | null;
  persons: number | null;
  space: string | null;
  program: string | null;
  team: string | null;
};
export type RentalDiffRow = { id: string; erp: RentalSide | null; ours: RentalSide | null; diffs: string[] };
export type RentalDiffResult = {
  start: string;
  end: string;
  erpCount: number;
  oursCount: number;
  bothSame: number;
  erpOnly: RentalDiffRow[];
  oursOnly: RentalDiffRow[];
  different: RentalDiffRow[];
  erpSyncedAt: string | null;
};

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function compareErpRentals(start: string, end: string): Promise<RentalDiffResult> {
  await gate();
  if (!isYmd(start) || !isYmd(end) || start > end) throw new Error("기간이 올바르지 않습니다.");
  const page = async <T,>(fn: (from: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) => {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await fn(from);
      if (error) throw new Error(error.message);
      out.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return out;
  };
  const [erpRows, ourRows, syncedRun] = await Promise.all([
    page((from) =>
      supabaseAdmin
        .from("erp_rentals")
        .select("rental_id, reservation_date, start_time, end_time, status, person_total, space_name, program_name, team_name")
        .is("removed_at", null)
        .gte("reservation_date", start)
        .lte("reservation_date", end)
        .order("rental_id")
        .range(from, from + 999)
    ),
    page((from) =>
      supabaseAdmin
        .from("rental_reservations")
        .select("reservation_no, reservation_date, start_time, end_time, status, person_total, space_name, program_name, team_name")
        .eq("reservation_type", "rental")
        .gte("reservation_date", start)
        .lte("reservation_date", end)
        .order("reservation_no")
        .range(from, from + 999)
    ),
    supabaseAdmin
      .from("erp_sync_runs")
      .select("finished_at")
      .eq("api", "rentals")
      .eq("ok", true)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const side = (r: Record<string, unknown>): RentalSide => ({
    date: (r.reservation_date as string | null) ?? null,
    start: (r.start_time as string | null) ?? null,
    end: (r.end_time as string | null) ?? null,
    status: r.status == null ? null : String(r.status).trim().toUpperCase(),
    persons: r.person_total == null ? null : Number(r.person_total),
    space: (r.space_name as string | null) ?? null,
    program: (r.program_name as string | null) ?? null,
    team: (r.team_name as string | null) ?? null,
  });
  const erp = new Map((erpRows as Record<string, unknown>[]).map((r) => [String(r.rental_id), side(r)]));
  const ours = new Map((ourRows as Record<string, unknown>[]).map((r) => [String(r.reservation_no), side(r)]));
  const hm = (v: string | null) => (v ?? "").slice(0, 5);

  const erpOnly: RentalDiffRow[] = [];
  const different: RentalDiffRow[] = [];
  let bothSame = 0;
  for (const [id, e] of erp) {
    const o = ours.get(id);
    if (!o) {
      erpOnly.push({ id, erp: e, ours: null, diffs: [] });
      continue;
    }
    const diffs: string[] = [];
    if (e.date !== o.date) diffs.push("날짜");
    if (hm(e.start) !== hm(o.start) || hm(e.end) !== hm(o.end)) diffs.push("시간");
    if ((e.status ?? "") !== (o.status ?? "")) diffs.push("상태");
    if ((e.persons ?? null) !== (o.persons ?? null)) diffs.push("인원");
    if (diffs.length) different.push({ id, erp: e, ours: o, diffs });
    else bothSame++;
  }
  const oursOnly: RentalDiffRow[] = [...ours]
    .filter(([id]) => !erp.has(id))
    .map(([id, o]) => ({ id, erp: null, ours: o, diffs: [] }));
  const byDate = (a: RentalDiffRow, b: RentalDiffRow) =>
    ((a.erp ?? a.ours)?.date ?? "").localeCompare((b.erp ?? b.ours)?.date ?? "") || a.id.localeCompare(b.id);
  return {
    start,
    end,
    erpCount: erp.size,
    oursCount: ours.size,
    bothSame,
    erpOnly: erpOnly.sort(byDate),
    oursOnly: oursOnly.sort(byDate),
    different: different.sort(byDate),
    erpSyncedAt: (syncedRun.data as { finished_at?: string } | null)?.finished_at ?? null,
  };
}

// =====================================================================
// 직원 1명 = ERP 계정 여러 개 — 이전 계정 추가·빼기, 현재 계정 바꾸기, 제안 묶기. 관장·master 만(gate).
//   한 ERP 계정은 한 직원에게만(현재든 이전이든). 자동 적용은 없습니다.
// =====================================================================
type LinkResult = { ok: true } | { ok: false; message: string };

async function loadLink(profileId: string): Promise<{ current: string | null; priors: string[] } | null> {
  const { data } = await supabaseAdmin
    .from("employee_profiles")
    .select("erp_employee_id, erp_prior_employee_ids")
    .eq("id", profileId)
    .maybeSingle();
  if (!data) return null;
  const d = data as { erp_employee_id: string | null; erp_prior_employee_ids: string[] | null };
  return { current: d.erp_employee_id, priors: Array.isArray(d.erp_prior_employee_ids) ? d.erp_prior_employee_ids.filter(Boolean) : [] };
}

// 다른 직원이 이미 쓰는 계정인지.
async function usedByOther(profileId: string, ids: string[]): Promise<string | null> {
  const { data } = await supabaseAdmin.from("employee_profiles").select("id, erp_employee_id, erp_prior_employee_ids").neq("id", profileId);
  for (const p of (data ?? []) as { erp_employee_id: string | null; erp_prior_employee_ids: string[] | null }[]) {
    const all = [...(p.erp_employee_id ? [p.erp_employee_id] : []), ...(Array.isArray(p.erp_prior_employee_ids) ? p.erp_prior_employee_ids : [])];
    const hit = ids.find((x) => all.includes(x));
    if (hit) return hit;
  }
  return null;
}

async function erpExists(ids: string[]): Promise<boolean> {
  if (!ids.length) return true;
  const { data } = await supabaseAdmin.from("erp_employees").select("employee_id").in("employee_id", ids);
  return ((data ?? []) as unknown[]).length === new Set(ids).size;
}

async function saveLink(profileId: string, current: string | null, priors: string[]): Promise<LinkResult> {
  const cleanPriors = [...new Set(priors.filter((x) => x && x !== current))];
  const { error } = await supabaseAdmin
    .from("employee_profiles")
    .update({ erp_employee_id: current, erp_prior_employee_ids: cleanPriors })
    .eq("id", profileId);
  if (error?.code === "23505") return { ok: false, message: "이미 다른 직원의 현재 계정입니다." };
  if (error) throw new Error(error.message);
  revalidatePath("/admin/erp");
  return { ok: true };
}

export async function addPriorErpAccount(profileId: string, erpId: string): Promise<LinkResult> {
  try {
    await gate();
    const cur = await loadLink(profileId);
    if (!cur) return { ok: false, message: "직원을 찾을 수 없습니다." };
    if (!erpId || erpId === cur.current || cur.priors.includes(erpId)) return { ok: false, message: "이미 이 직원의 계정입니다." };
    if (!(await erpExists([erpId]))) return { ok: false, message: "ERP 계정을 찾을 수 없습니다. 동기화 뒤 다시 시도하세요." };
    const other = await usedByOther(profileId, [erpId]);
    if (other) return { ok: false, message: "다른 직원에게 연결된 ERP 계정입니다." };
    return await saveLink(profileId, cur.current, [...cur.priors, erpId]);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "저장하지 못했습니다." };
  }
}

export async function removePriorErpAccount(profileId: string, erpId: string): Promise<LinkResult> {
  try {
    await gate();
    const cur = await loadLink(profileId);
    if (!cur) return { ok: false, message: "직원을 찾을 수 없습니다." };
    if (!cur.priors.includes(erpId)) return { ok: false, message: "이전 계정 목록에 없습니다." };
    return await saveLink(profileId, cur.current, cur.priors.filter((x) => x !== erpId));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "저장하지 못했습니다." };
  }
}

// [현재 계정으로 바꾸기] — 이전 계정 하나를 현재로, 원래 현재는 이전으로(교체).
export async function promoteErpAccount(profileId: string, erpId: string): Promise<LinkResult> {
  try {
    await gate();
    const cur = await loadLink(profileId);
    if (!cur) return { ok: false, message: "직원을 찾을 수 없습니다." };
    if (!cur.priors.includes(erpId)) return { ok: false, message: "이전 계정 목록에 없는 계정입니다." };
    const priors = [...cur.priors.filter((x) => x !== erpId), ...(cur.current ? [cur.current] : [])];
    return await saveLink(profileId, erpId, priors);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "저장하지 못했습니다." };
  }
}

// 제안 [묶기] — 관장이 눌러야 저장. 현재 계정 + 이전 계정들.
export async function applyErpMerge(profileId: string, currentId: string, priorIds: string[]): Promise<LinkResult> {
  try {
    await gate();
    const all = [...new Set([currentId, ...priorIds].filter(Boolean))];
    if (!currentId || all.length < 2) return { ok: false, message: "묶을 계정이 2개 이상이어야 합니다." };
    if (!(await erpExists(all))) return { ok: false, message: "ERP 계정을 찾을 수 없습니다. 동기화 뒤 다시 시도하세요." };
    const other = await usedByOther(profileId, all);
    if (other) return { ok: false, message: `다른 직원에게 연결된 ERP 계정이 있습니다(${other}).` };
    return await saveLink(profileId, currentId, priorIds);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "저장하지 못했습니다." };
  }
}
