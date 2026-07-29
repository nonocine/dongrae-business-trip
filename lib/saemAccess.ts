// =====================================================================
// 강사·프로그램 관리(동래샘들 연동) 접근 게이트 — /hr/saems
//   * 접근: M0(관장·부장·master) 또는 hr(인사) 직무. (salaryAccess/facilityAccess 패턴)
//   * saem_* 테이블은 RLS 0개 → service_role 경유. 이 게이트가 유일 방어선.
//   * 확정취소 등 M0 전용 동작을 위해 isM0 반환. onlyM0 옵션 지원.
//   * 서버 전용 모듈 — 액션/페이지가 import.
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";
import { listRolesForDriver } from "@/lib/employeeRolesServer";

export type SaemAccess = {
  name: string;
  driverId: string | null;
  isM0: boolean;
};

export async function resolveSaemAccess(): Promise<SaemAccess | null> {
  const me = await getSession();
  if (!me || me.kind !== "employee" || !me.name.trim()) return null;
  const g = await getGoogleSession();

  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("id, rank")
    .eq("name", me.name.trim())
    .maybeSingle();
  const driverId =
    driver && typeof (driver as { id?: unknown }).id === "string"
      ? String((driver as { id: string }).id)
      : null;
  const rank = (driver as { rank?: string | null } | null)?.rank ?? null;

  let authLevel: string | null = null;
  if (driverId) {
    const { data: prof } = await supabaseAdmin
      .from("employee_profiles")
      .select("auth_level")
      .eq("driver_id", driverId)
      .maybeSingle();
    authLevel =
      (prof as { auth_level?: string | null } | null)?.auth_level ?? null;
  }

  const isM0 = isM0Grant({ rank, email: g?.email, authLevel });
  const roles = driverId ? await listRolesForDriver(driverId) : [];
  const canAccess = isM0 || roles.includes("hr");
  if (!canAccess) return null;
  return { name: me.name.trim(), driverId, isM0 };
}

export async function requireSaemAccess(opts?: {
  onlyM0?: boolean;
}): Promise<SaemAccess> {
  const ctx = await resolveSaemAccess();
  if (!ctx) {
    throw new Error("강사·프로그램 관리 권한이 없습니다. (관장·부장 또는 인사 담당자)");
  }
  if (opts?.onlyM0 && !ctx.isM0) {
    throw new Error("이 작업은 관장·부장만 할 수 있습니다.");
  }
  return ctx;
}
