"use server";

// 인사기록카드 '복무 기록' — 본인 것, 또는 관장(M0)·hr 직무가 직원 카드를 볼 때만.
//   그 밖의 직원이 다른 사람 것을 부르면 거절합니다(화면도 탭을 그리지 않음). ERP 복제 데이터 조회 전용.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { dutyRecordOf, resolveErpViewer, type DutyRecord } from "@/lib/erp/view";
import { listRolesForDriver } from "@/lib/employeeRolesServer";

export async function getDutyRecord(input: { driverId?: string | null; year: number }): Promise<
  { ok: true; record: DutyRecord } | { ok: false; message: string }
> {
  try {
    const viewer = await resolveErpViewer();
    if (!viewer) return { ok: false, message: "로그인이 필요합니다." };
    const year = Number.isFinite(input.year) && input.year > 2000 ? Math.round(input.year) : new Date().getFullYear();
    const target = input.driverId && input.driverId !== viewer.driverId ? input.driverId : null;
    if (!target) return { ok: true, record: await dutyRecordOf(viewer.erpEmployeeId, year) };
    // 다른 직원 — 관장(M0) 또는 hr 직무만.
    const roles = viewer.driverId ? await listRolesForDriver(viewer.driverId) : [];
    if (!viewer.isM0 && !roles.includes("hr"))
      return { ok: false, message: "복무 기록은 본인·관장·인사 담당만 볼 수 있습니다." };
    const { data } = await supabaseAdmin
      .from("employee_profiles")
      .select("erp_employee_id")
      .eq("driver_id", target)
      .maybeSingle();
    const erpId = (data as { erp_employee_id?: string | null } | null)?.erp_employee_id ?? null;
    return { ok: true, record: await dutyRecordOf(erpId, year) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "불러오지 못했습니다." };
  }
}

// 직원 카드에 탭을 그릴지 — 관장(M0) 또는 hr 직무.
export async function canViewOthersDutyRecord(): Promise<boolean> {
  const v = await resolveErpViewer();
  if (!v) return false;
  if (v.isM0) return true;
  const roles = v.driverId ? await listRolesForDriver(v.driverId) : [];
  return roles.includes("hr");
}
