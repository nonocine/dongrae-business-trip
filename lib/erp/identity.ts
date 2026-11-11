import "server-only";

// =====================================================================
// ERP 계정 ↔ 동업자씨 직원 — 역방향 조회(서버 전용). 복무 화면·대시보드·촉진·수당이 모두 이것을 씁니다.
//   * 연결된 직원(현재+이전 계정)은 한 사람(key = 현재 계정 id, 현재가 없으면 첫 이전 계정).
//     이름은 동업자씨 직원 이름, 부서는 현재 계정의 ERP 부서.
//   * 연결 안 된 ERP 재직 계정은 계정 하나 = 한 사람(key = 계정 id, 이름·부서는 ERP 값) — 예전 동작 그대로.
//   * '재직자만': 연결된 직원은 동업자씨 재직(drivers.is_active·employment_status), 미연결은 ERP is_employed.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getErpIdsForEmployee, priorErpIds } from "@/lib/erp/ids";

export type ErpIdentity = {
  key: string;
  profileId: string | null;
  driverId: string | null;
  name: string;
  department: string | null;
  currentId: string | null;
  priorIds: string[];
  allIds: string[];
  linked: boolean;
  active: boolean;
};

export type ErpDirectory = {
  byErpId: Map<string, ErpIdentity>;
  people: ErpIdentity[]; // 재직자(중복 없음)
  keyOf: (erpId: string) => string | null; // 재직자의 대표 key, 아니면 null
  resolve: (erpIds: string[]) => { key: string; name: string; department: string | null }[]; // 재직자만, 같은 사람 한 번
};

type EmpRow = { employee_id: string; name: string | null; department_name: string | null; is_employed: boolean | null; deleted: boolean | null };

export async function loadErpDirectory(): Promise<ErpDirectory> {
  const [{ data: profs }, { data: drivers }, { data: emps }] = await Promise.all([
    supabaseAdmin
      .from("employee_profiles")
      .select("id, driver_id, employment_status, erp_employee_id, erp_prior_employee_ids"),
    supabaseAdmin.from("drivers").select("id, name, is_active"),
    supabaseAdmin.from("erp_employees").select("employee_id, name, department_name, is_employed, deleted"),
  ]);
  const drv = new Map(((drivers ?? []) as { id: string; name: string; is_active: boolean | null }[]).map((d) => [d.id, d]));
  const empBy = new Map(((emps ?? []) as EmpRow[]).map((e) => [e.employee_id, e]));
  const byErpId = new Map<string, ErpIdentity>();
  const people: ErpIdentity[] = [];

  for (const p of (profs ?? []) as Record<string, unknown>[]) {
    const all = getErpIdsForEmployee(p as never);
    if (!all.length) continue;
    const d = drv.get(String(p.driver_id));
    const current = typeof p.erp_employee_id === "string" && p.erp_employee_id ? p.erp_employee_id : null;
    const id: ErpIdentity = {
      key: current ?? all[0],
      profileId: String(p.id),
      driverId: d?.id ?? null,
      name: d?.name ?? empBy.get(all[0])?.name ?? all[0],
      department: empBy.get(current ?? all[0])?.department_name ?? null,
      currentId: current,
      priorIds: priorErpIds(p as never).filter((x) => x !== current),
      allIds: all,
      linked: true,
      active: !!d && d.is_active !== false && p.employment_status !== "resigned",
    };
    for (const x of all) byErpId.set(x, id);
    if (id.active) people.push(id);
  }
  for (const e of (emps ?? []) as EmpRow[]) {
    if (byErpId.has(e.employee_id)) continue;
    const id: ErpIdentity = {
      key: e.employee_id,
      profileId: null,
      driverId: null,
      name: e.name ?? e.employee_id,
      department: e.department_name,
      currentId: e.employee_id,
      priorIds: [],
      allIds: [e.employee_id],
      linked: false,
      active: e.is_employed === true && e.deleted !== true && !!e.name,
    };
    byErpId.set(e.employee_id, id);
    if (id.active) people.push(id);
  }

  const keyOf = (erpId: string) => {
    const x = byErpId.get(erpId);
    return x && x.active ? x.key : null;
  };
  const resolve = (erpIds: string[]) => {
    const seen = new Set<string>();
    const out: { key: string; name: string; department: string | null }[] = [];
    for (const id of erpIds) {
      const x = byErpId.get(id);
      if (!x || !x.active || seen.has(x.key)) continue;
      seen.add(x.key);
      out.push({ key: x.key, name: x.name, department: x.department });
    }
    return out;
  };
  return { byErpId, people, keyOf, resolve };
}

// 동업자씨 직원(drivers.id) → ERP 계정들 [현재, ...이전].
export async function erpIdsOfDriver(driverId: string | null): Promise<{ current: string | null; all: string[] }> {
  if (!driverId) return { current: null, all: [] };
  const { data } = await supabaseAdmin
    .from("employee_profiles")
    .select("erp_employee_id, erp_prior_employee_ids")
    .eq("driver_id", driverId)
    .maybeSingle();
  const p = (data ?? null) as { erp_employee_id?: string | null } | null;
  return { current: p?.erp_employee_id ?? null, all: getErpIdsForEmployee(p as never) };
}

// 이전 계정에 남은 연차 잔여 합(현재 계정 제외) — 관리자 화면 경고용. 자동 합산하지 않습니다.
export async function priorRemainingByKey(dir: ErpDirectory): Promise<Map<string, number>> {
  const priors = dir.people.flatMap((p) => p.priorIds);
  const out = new Map<string, number>();
  if (!priors.length) return out;
  const { data } = await supabaseAdmin
    .from("erp_leave_balances")
    .select("employee_id, annual_remaining_days")
    .in("employee_id", priors);
  for (const r of (data ?? []) as { employee_id: string; annual_remaining_days: number | null }[]) {
    const v = Number(r.annual_remaining_days ?? 0);
    if (!(v > 0)) continue;
    const who = dir.byErpId.get(r.employee_id);
    if (!who) continue;
    out.set(who.key, (out.get(who.key) ?? 0) + v);
  }
  return out;
}
