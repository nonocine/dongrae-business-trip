import "server-only";

// =====================================================================
// ERP 복제 데이터 읽기(3단계 직원 편의 기능) — erp_* 표만 읽습니다(ERP 호출·쓰기 없음).
//   * removed_at 칸이 있는 표는 removed_at is null 만.
//   * 회계(erp_transactions·erp_expenditures)는 여기서 읽지 않습니다.
//   * 직원 이름은 erp_duties.employee_ids → erp_employees.name(재직자만).
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getGoogleSession, getSession } from "@/app/actions";
import { resolveAuthContext, ctxIsM0 } from "@/lib/authContext";
import {
  VISIBLE_PROCESS_CODES,
  dutyCoversDay,
  dutyDisplayType,
  dutyTimeText,
  eachDay,
  isAbsenceType,
  kstDayEndUtc,
  kstDayStartUtc,
  kstTodayYmd,
  FIELD_TYPES,
  dutyColorKey,
  kstYmdOf,
  monthRange,
  type DutyColorKey,
} from "@/lib/erp/duty";
import { listRolesForDriver } from "@/lib/employeeRolesServer";

// --- 보는 사람 -------------------------------------------------------------
export type ErpViewer = {
  driverId: string | null;
  name: string;
  isM0: boolean;
  erpEmployeeId: string | null;
};

export async function resolveErpViewer(): Promise<ErpViewer | null> {
  const g = await getGoogleSession();
  const ctx = await resolveAuthContext(g, g ? null : await getSession());
  if (!ctx) return null;
  let erpEmployeeId: string | null = null;
  if (ctx.driverId) {
    const { data } = await supabaseAdmin
      .from("employee_profiles")
      .select("erp_employee_id")
      .eq("driver_id", ctx.driverId)
      .maybeSingle();
    erpEmployeeId = (data as { erp_employee_id?: string | null } | null)?.erp_employee_id ?? null;
  }
  return { driverId: ctx.driverId, name: ctx.name, isM0: ctxIsM0(ctx), erpEmployeeId };
}

// --- 마지막 동기화(해당 API 의 최근 성공 finished_at) -----------------------------
export async function erpLastSyncedAt(api: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("erp_sync_runs")
    .select("finished_at")
    .eq("api", api)
    .eq("ok", true)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { finished_at?: string | null } | null)?.finished_at ?? null;
}

// 재직 중 ERP 직원 이름.
export async function employedErpNames(): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin
    .from("erp_employees")
    .select("employee_id, name, is_employed, deleted")
    .eq("is_employed", true);
  const m = new Map<string, string>();
  for (const e of (data ?? []) as { employee_id: string; name: string | null; deleted: boolean | null }[])
    if (e.deleted !== true && e.name) m.set(e.employee_id, e.name);
  return m;
}

// --- 복무 ---------------------------------------------------------------
export type ErpDutyRow = {
  duty_id: number;
  employee_ids: string[];
  type_name: string | null;
  start_at: string | null;
  end_at: string | null;
  declared_amount: number | null;
  location: string | null;
  process_code: number | null;
};

// 기간(한국시간 날짜)에 걸치는 복무 — 진행·완료만, 사라진 건 제외.
export async function loadDutiesOverlapping(
  start: string,
  end: string,
  opts: { employeeId?: string } = {}
): Promise<ErpDutyRow[]> {
  const lo = kstDayStartUtc(start);
  const hi = kstDayEndUtc(end);
  let q = supabaseAdmin
    .from("erp_duties")
    .select("duty_id, employee_ids, type_name, start_at, end_at, declared_amount, location, process_code")
    .is("removed_at", null)
    .in("process_code", [...VISIBLE_PROCESS_CODES])
    .lte("start_at", hi)
    .or(`end_at.gte."${lo}",end_at.is.null`)
    .order("start_at", { ascending: true })
    .limit(2000);
  if (opts.employeeId) q = q.contains("employee_ids", [opts.employeeId]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as ErpDutyRow[]).filter((d) => d.end_at != null || (d.start_at ?? "") >= lo);
}

export type DutyBoardItem = {
  dutyId: number;
  names: string[];
  type: string;
  time: string;
  location: string | null; // 출장·외근만
  inProgress: boolean; // 결재 진행 중(완료 전)
};
export type DutyBoardDay = { date: string; items: DutyBoardItem[] };

export async function dutyBoard(start: string, end: string, isM0: boolean): Promise<DutyBoardDay[]> {
  const [duties, names] = await Promise.all([loadDutiesOverlapping(start, end), employedErpNames()]);
  return eachDay(start, end).map((date) => {
    const items: DutyBoardItem[] = [];
    for (const d of duties) {
      if (!dutyCoversDay(d.start_at, d.end_at, date)) continue;
      const type = dutyDisplayType(d.type_name, d.declared_amount, isM0);
      if (!type) continue;
      const who = d.employee_ids.map((id) => names.get(id)).filter((n): n is string => !!n);
      if (!who.length) continue; // 재직자만
      items.push({
        dutyId: d.duty_id,
        names: who,
        type,
        time: dutyTimeText(d.start_at, d.end_at),
        location: FIELD_TYPES.has((d.type_name ?? "").trim()) ? d.location : null,
        inProgress: d.process_code === 1,
      });
    }
    items.sort((a, b) => a.time.localeCompare(b.time) || a.names[0].localeCompare(b.names[0], "ko"));
    return { date, items };
  });
}

// 오늘 부재 인원(재직자, 휴근·초과·야근 제외 유형) — 홈 카드.
export async function countAbsentToday(): Promise<number> {
  const today = kstTodayYmd();
  const [duties, names] = await Promise.all([loadDutiesOverlapping(today, today), employedErpNames()]);
  const who = new Set<string>();
  for (const d of duties) {
    if (!isAbsenceType(d.type_name) || !dutyCoversDay(d.start_at, d.end_at, today)) continue;
    for (const id of d.employee_ids) if (names.has(id)) who.add(id);
  }
  return who.size;
}

// --- 휴가 잔여 ---------------------------------------------------------------
export type LeaveBalance = { annual: number | null; compensatory: number | null };

export async function leaveBalancesOf(employeeIds: string[]): Promise<Map<string, LeaveBalance>> {
  const m = new Map<string, LeaveBalance>();
  if (!employeeIds.length) return m;
  const { data } = await supabaseAdmin
    .from("erp_leave_balances")
    .select("employee_id, annual_remaining_days, compensatory_remaining_days")
    .in("employee_id", employeeIds);
  for (const r of (data ?? []) as {
    employee_id: string;
    annual_remaining_days: number | null;
    compensatory_remaining_days: number | null;
  }[])
    m.set(r.employee_id, {
      annual: r.annual_remaining_days == null ? null : Number(r.annual_remaining_days),
      compensatory: r.compensatory_remaining_days == null ? null : Number(r.compensatory_remaining_days),
    });
  return m;
}

// =====================================================================
// 3단계 개편 — 월간 캘린더·내 연차·대휴·복무 대시보드
// =====================================================================
export type ErpPerson = { name: string; department: string | null };

export async function employedErpEmployees(): Promise<Map<string, ErpPerson>> {
  const { data } = await supabaseAdmin
    .from("erp_employees")
    .select("employee_id, name, department_name, deleted")
    .eq("is_employed", true);
  const m = new Map<string, ErpPerson>();
  for (const e of (data ?? []) as {
    employee_id: string;
    name: string | null;
    department_name: string | null;
    deleted: boolean | null;
  }[])
    if (e.deleted !== true && e.name) m.set(e.employee_id, { name: e.name, department: e.department_name });
  return m;
}

export type CalendarDuty = {
  id: number;
  people: ErpPerson[]; // 재직자만
  type: string; // 보는 사람 기준 표시 유형
  color: DutyColorKey;
  start: string; // YYYY-MM-DD(한국시간)
  end: string;
  time: string;
  location: string | null; // 출장·외근만
  inProgress: boolean;
};

function toCalendarDuty(d: ErpDutyRow, type: string, people: ErpPerson[]): CalendarDuty {
  const s = kstYmdOf(d.start_at!);
  const e0 = d.end_at ? kstYmdOf(d.end_at) : s;
  return {
    id: d.duty_id,
    people,
    type,
    color: dutyColorKey(d.type_name),
    start: s,
    end: e0 < s ? s : e0,
    time: dutyTimeText(d.start_at, d.end_at),
    location: FIELD_TYPES.has((d.type_name ?? "").trim()) ? d.location : null,
    inProgress: d.process_code === 1,
  };
}

export async function dutyCalendarItems(start: string, end: string, isM0: boolean): Promise<CalendarDuty[]> {
  const [duties, people] = await Promise.all([loadDutiesOverlapping(start, end), employedErpEmployees()]);
  const out: CalendarDuty[] = [];
  for (const d of duties) {
    if (!d.start_at) continue;
    const type = dutyDisplayType(d.type_name, d.declared_amount, isM0);
    if (!type) continue;
    const who = d.employee_ids.map((id) => people.get(id)).filter((p): p is ErpPerson => !!p);
    if (!who.length) continue; // 재직자만
    out.push(toCalendarDuty(d, type, who));
  }
  return out;
}

// 올해 연가 사용(일) — ERP 사용 기록(진행·완료) 기준, 시작일의 달로 묶음.
async function annualUsedByMonth(year: number, employeeId?: string): Promise<Map<string, number[]>> {
  const duties = await loadDutiesOverlapping(`${year}-01-01`, `${year}-12-31`, employeeId ? { employeeId } : {});
  const m = new Map<string, number[]>();
  for (const d of duties) {
    if ((d.type_name ?? "").trim() !== "연가" || !d.start_at) continue;
    const ymd = kstYmdOf(d.start_at);
    if (ymd.slice(0, 4) !== String(year)) continue;
    const month = Number(ymd.slice(5, 7)) - 1;
    const amt = d.declared_amount == null ? 1 : Number(d.declared_amount);
    for (const id of d.employee_ids) {
      if (employeeId && id !== employeeId) continue;
      const arr = m.get(id) ?? Array<number>(12).fill(0);
      arr[month] += amt;
      m.set(id, arr);
    }
  }
  return m;
}

export type MyErpLeave = {
  linked: boolean;
  year: number;
  annualRemaining: number | null;
  compensatoryRemaining: number | null;
  annualUsed: number; // 올해 연가 사용 합계(ERP 사용 기록 기준)
  monthlyUsed: number[]; // 1~12월
  month: string; // YYYY-MM
  monthDuties: CalendarDuty[]; // 이번 달 내 복무(본인 기록이라 원래 유형)
  syncedLeave: string | null;
  syncedDuties: string | null;
};

export async function myErpLeave(erpEmployeeId: string | null): Promise<MyErpLeave> {
  const today = kstTodayYmd();
  const year = Number(today.slice(0, 4));
  const [syncedLeave, syncedDuties] = await Promise.all([erpLastSyncedAt("leaveBalances"), erpLastSyncedAt("duties")]);
  const base: MyErpLeave = {
    linked: !!erpEmployeeId,
    year,
    annualRemaining: null,
    compensatoryRemaining: null,
    annualUsed: 0,
    monthlyUsed: Array<number>(12).fill(0),
    month: today.slice(0, 7),
    monthDuties: [],
    syncedLeave,
    syncedDuties,
  };
  if (!erpEmployeeId) return base;
  const mr = monthRange(today);
  const [bal, used, duties] = await Promise.all([
    leaveBalancesOf([erpEmployeeId]),
    annualUsedByMonth(year, erpEmployeeId),
    loadDutiesOverlapping(mr.start, mr.end, { employeeId: erpEmployeeId }),
  ]);
  const b = bal.get(erpEmployeeId);
  const monthly = used.get(erpEmployeeId) ?? Array<number>(12).fill(0);
  return {
    ...base,
    annualRemaining: b?.annual ?? null,
    compensatoryRemaining: b?.compensatory ?? null,
    annualUsed: monthly.reduce((a, n) => a + n, 0),
    monthlyUsed: monthly,
    monthDuties: duties
      .filter((d) => d.start_at)
      .map((d) => toCalendarDuty(d, dutyDisplayType(d.type_name, d.declared_amount, true) ?? (d.type_name ?? ""), [])),
  };
}

// --- 복무·연차 대시보드(관장·hr) ---------------------------------------------------
export type DutyDashboardPerson = {
  id: string;
  name: string;
  department: string | null;
  annual: number | null;
  compensatory: number | null;
  annualUsed: number;
  overtimeMonth: number;
  overtimeYear: number;
};
export type DutyDashboard = {
  year: number;
  month: string;
  todayAbsent: number;
  monthTrips: number;
  monthOvertimeHours: number;
  avgAnnualRemaining: number | null;
  monthlyByType: Record<string, number | string>[]; // { month: "1월", 연가: 3, ... }
  types: string[];
  people: DutyDashboardPerson[];
  syncedLeave: string | null;
  syncedDuties: string | null;
};

export async function dutyDashboardData(): Promise<DutyDashboard> {
  const today = kstTodayYmd();
  const year = Number(today.slice(0, 4));
  const month = today.slice(0, 7);
  const [duties, people, todayAbsent, syncedLeave, syncedDuties, used] = await Promise.all([
    loadDutiesOverlapping(`${year}-01-01`, `${year}-12-31`),
    employedErpEmployees(),
    countAbsentToday(),
    erpLastSyncedAt("leaveBalances"),
    erpLastSyncedAt("duties"),
    annualUsedByMonth(year),
  ]);
  const bal = await leaveBalancesOf([...people.keys()]);
  const mr = monthRange(today);

  let monthTrips = 0;
  let monthOvertimeHours = 0;
  const otMonth = new Map<string, number>();
  const otYear = new Map<string, number>();
  const byMonth: Record<string, number>[] = Array.from({ length: 12 }, () => ({}));
  const typeSet = new Set<string>();
  for (const d of duties) {
    if (!d.start_at) continue;
    const s = kstYmdOf(d.start_at);
    const e = d.end_at ? kstYmdOf(d.end_at) : s;
    const t = (d.type_name ?? "").trim() || "기타";
    if (t === "출장" && s <= mr.end && e >= mr.start) monthTrips++;
    if (s.slice(0, 4) !== String(year)) continue;
    const mi = Number(s.slice(5, 7)) - 1;
    byMonth[mi][t] = (byMonth[mi][t] ?? 0) + 1;
    typeSet.add(t);
    if (t === "초과") {
      const h = Number(d.declared_amount ?? 0) || 0;
      const inMonth = s.slice(0, 7) === month;
      if (inMonth) monthOvertimeHours += h;
      for (const id of d.employee_ids) {
        if (!people.has(id)) continue;
        otYear.set(id, (otYear.get(id) ?? 0) + h);
        if (inMonth) otMonth.set(id, (otMonth.get(id) ?? 0) + h);
      }
    }
  }
  const types = [...typeSet].sort((a, b) => a.localeCompare(b, "ko"));
  const monthlyByType = byMonth.map((m, i) => ({
    month: `${i + 1}월`,
    ...Object.fromEntries(types.map((t) => [t, m[t] ?? 0])),
  }));

  const list: DutyDashboardPerson[] = [...people].map(([id, p]) => ({
    id,
    name: p.name,
    department: p.department,
    annual: bal.get(id)?.annual ?? null,
    compensatory: bal.get(id)?.compensatory ?? null,
    annualUsed: (used.get(id) ?? []).reduce((a, n) => a + n, 0),
    overtimeMonth: otMonth.get(id) ?? 0,
    overtimeYear: otYear.get(id) ?? 0,
  }));
  const withAnnual = list.filter((p) => p.annual != null);
  return {
    year,
    month,
    todayAbsent,
    monthTrips,
    monthOvertimeHours,
    avgAnnualRemaining: withAnnual.length
      ? Math.round((withAnnual.reduce((a, p) => a + (p.annual ?? 0), 0) / withAnnual.length) * 10) / 10
      : null,
    monthlyByType,
    types,
    people: list.sort((a, b) => a.name.localeCompare(b.name, "ko")),
    syncedLeave,
    syncedDuties,
  };
}

// 대시보드 접근 — 관장(M0) 또는 hr 직무.
export async function resolveDutyDashboardViewer(): Promise<ErpViewer | null> {
  const v = await resolveErpViewer();
  if (!v) return null;
  if (v.isM0) return v;
  const roles = v.driverId ? await listRolesForDriver(v.driverId) : [];
  return roles.includes("hr") ? v : null;
}
