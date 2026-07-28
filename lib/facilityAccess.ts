// =====================================================================
// 시설관리 모듈 접근 게이트 — /hr/facility (비품관리·장소관리 공용)
//   * 접근: M0(관장·부장·master) 또는 facility(시설관리) 직무 보유자만.
//   * facility_assets / facility_locations 는 RLS 0개 → service_role 경유.
//     이 게이트가 유일한 방어선이라 조회·변경 액션 모두 진입 시 재검증합니다.
//   * '삭제' 등 M0 전용 동작을 위해 isM0 를 함께 반환합니다.
//   * 서버 전용 모듈("use server" 아님) — 서버 액션/페이지가 import 합니다.
//   * 급여 lib/salaryAccess 와 동일 구조(직무만 facility 로).
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";
import { listRolesForDriver } from "@/lib/employeeRolesServer";

export type FacilityAccess = {
  name: string;
  driverId: string | null;
  isM0: boolean;
};

// 접근 컨텍스트 — 권한 없으면 null. (페이지는 redirect, 액션은 throw)
export async function resolveFacilityAccess(): Promise<FacilityAccess | null> {
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
  const canAccess = isM0 || roles.includes("facility");
  if (!canAccess) return null;
  return { name: me.name.trim(), driverId, isM0 };
}

// 액션용 — 미통과면 throw. onlyM0 면 시설 직무는 통과시키지 않습니다(삭제 전용).
export async function requireFacilityAccess(opts?: {
  onlyM0?: boolean;
}): Promise<FacilityAccess> {
  const ctx = await resolveFacilityAccess();
  if (!ctx) {
    throw new Error("시설관리 권한이 없습니다. (관장·부장 또는 시설 담당자)");
  }
  if (opts?.onlyM0 && !ctx.isM0) {
    throw new Error("이 작업은 관장·부장만 할 수 있습니다.");
  }
  return ctx;
}
