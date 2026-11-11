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
} from "@/lib/erp/duty";

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
