import "server-only";

// =====================================================================
// 관리자용 '직원별 연차·대휴 잔여' 표(복무·연차 대시보드 맨 위, 엑셀 공용) — ERP 복제 데이터 조회 전용.
//   * 대상: 재직 중 ERP 직원(erp_employees.is_employed). 동업자씨 직원과는
//     employee_profiles.erp_employee_id 로 이어 직급(drivers.rank)·입사일(join_date)·카드 이동을 붙입니다.
//   * 연차 부여 = erp_leave_balances.annual_allocation_override_days(ERP 가 따로 지정한 부여일수, 없으면 빈칸),
//     사용 = 올해 ERP 연가(결재 진행·완료) 합계, 잔여 = annual_remaining_days, 대휴 잔여 = compensatory_remaining_days.
//   * ERP 계정이 연결 안 된 재직 직원은 맨 아래 'ERP 연결 필요' 줄.
//   예전 /profile/leave 의 관장용 전체 목록은 복무·연차 대시보드로 옮겨진 뒤 이 표로 대체합니다.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { dutyDashboardData, employedErpEmployees, type DutyDashboard } from "@/lib/erp/view";
import { kstTodayYmd } from "@/lib/erp/duty";
import { isFirstYear } from "@/lib/leavePromotion";
import { loadErpDirectory, priorRemainingByKey } from "@/lib/erp/identity";

export type LeaveTableRow = {
  erpEmployeeId: string;
  driverId: string | null;
  name: string;
  rank: string | null;
  joinDate: string | null;
  firstYear: boolean;
  allocation: number | null;
  used: number;
  remaining: number | null;
  compensatory: number | null;
  syncedAt: string | null;
  priorRemaining: number; // 이전 ERP 계정에 남은 연차 잔여(경고만, 합산 안 함)
};
export type LeaveTableUnlinked = { driverId: string; name: string; rank: string | null; joinDate: string | null };
export type LeaveTable = { year: number; rows: LeaveTableRow[]; unlinked: LeaveTableUnlinked[] };

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// dash 를 넘기면(대시보드 화면) 다시 계산하지 않습니다.
export async function loadLeaveTable(dashIn?: DutyDashboard): Promise<LeaveTable> {
  const year = Number(kstTodayYmd().slice(0, 4));
  const [people, dash, { data: bal }, { data: profs }, { data: drivers }] = await Promise.all([
    employedErpEmployees(),
    dashIn ?? dutyDashboardData(), // 올해 연가 사용 합계(annualUsed)를 같은 계산으로 재사용
    supabaseAdmin
      .from("erp_leave_balances")
      .select("employee_id, annual_remaining_days, compensatory_remaining_days, annual_allocation_override_days, synced_at"),
    supabaseAdmin.from("employee_profiles").select("driver_id, join_date, erp_employee_id, erp_prior_employee_ids, employment_status"),
    supabaseAdmin.from("drivers").select("id, name, rank, is_active"),
  ]);
  const priorRem = await priorRemainingByKey(await loadErpDirectory());
  const balBy = new Map(((bal ?? []) as Record<string, unknown>[]).map((b) => [String(b.employee_id), b]));
  const usedBy = new Map(dash.people.map((p) => [p.id, p.annualUsed]));
  const drvBy = new Map(((drivers ?? []) as { id: string; name: string; rank: string | null; is_active: boolean | null }[]).map((d) => [d.id, d]));
  const profByErp = new Map<string, Record<string, unknown>>();
  for (const p of (profs ?? []) as Record<string, unknown>[]) if (p.erp_employee_id) profByErp.set(String(p.erp_employee_id), p);

  const rows: LeaveTableRow[] = [...people].map(([id, person]) => {
    const prof = profByErp.get(id);
    const drv = prof ? drvBy.get(String(prof.driver_id)) : undefined;
    const joinDate = typeof prof?.join_date === "string" && prof.join_date ? prof.join_date.slice(0, 10) : null;
    const b = balBy.get(id);
    return {
      erpEmployeeId: id,
      driverId: drv?.id ?? null,
      name: drv?.name ?? person.name,
      rank: drv?.rank ?? null,
      joinDate,
      firstYear: isFirstYear(joinDate, year),
      allocation: num(b?.annual_allocation_override_days),
      used: usedBy.get(id) ?? 0,
      remaining: num(b?.annual_remaining_days),
      compensatory: num(b?.compensatory_remaining_days),
      syncedAt: (b?.synced_at as string | null) ?? null,
      priorRemaining: priorRem.get(id) ?? 0,
    };
  });

  // ERP 미연결 — 활성·재직 직원인데 현재·이전 ERP 계정이 하나도 없음.
  const unlinked: LeaveTableUnlinked[] = ((profs ?? []) as Record<string, unknown>[])
    .filter((p) => !p.erp_employee_id && !(Array.isArray(p.erp_prior_employee_ids) && p.erp_prior_employee_ids.length) && p.employment_status !== "resigned")
    .map((p) => drvBy.get(String(p.driver_id)))
    .filter((d): d is { id: string; name: string; rank: string | null; is_active: boolean | null } => !!d && d.is_active !== false)
    .map((d) => {
      const prof = ((profs ?? []) as Record<string, unknown>[]).find((p) => p.driver_id === d.id);
      const jd = typeof prof?.join_date === "string" && prof.join_date ? prof.join_date.slice(0, 10) : null;
      return { driverId: d.id, name: d.name, rank: d.rank, joinDate: jd };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return { year, rows, unlinked };
}
