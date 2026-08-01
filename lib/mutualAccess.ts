// =====================================================================
// 상조회 모듈 접근 게이트 — /hr/mutual
//   * 접근: M0(관장·부장·master) 또는 mutual(상조회) 직무 보유자.
//     상조회는 직원 자치 조직이고 회장이 교체되므로 회계(accounting)와
//     분리한 전용 직무를 쓴다(강사관리 saem 분리와 같은 절차).
//   * mutual_* 테이블은 RLS 정책 0개 → service_role 경유. 이 게이트가 유일한
//     방어선이므로 조회·변경 액션 모두 진입 시 권한을 재검증한다.
//   * 행 삭제 등 되돌리기 어려운 동작을 위해 isM0 를 함께 반환한다.
//   * 서버 전용 모듈("use server" 아님) — 서버 액션·페이지가 import.
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";
import { listRolesForDriver } from "@/lib/employeeRolesServer";

export const MUTUAL_ROLE_KEY = "mutual";

export type MutualAccess = {
  name: string;
  driverId: string | null;
  isM0: boolean;
};

export async function resolveMutualAccess(): Promise<MutualAccess | null> {
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
  const canAccess = isM0 || roles.includes(MUTUAL_ROLE_KEY);
  if (!canAccess) return null;
  return { name: me.name.trim(), driverId, isM0 };
}

// 액션용 — 미통과면 throw. onlyM0 면 상조회 직무는 통과시키지 않는다.
export async function requireMutualAccess(opts?: {
  onlyM0?: boolean;
}): Promise<MutualAccess> {
  const ctx = await resolveMutualAccess();
  if (!ctx) {
    throw new Error("상조회 관리 권한이 없습니다. (관장·부장 또는 상조회 담당자)");
  }
  if (opts?.onlyM0 && !ctx.isM0) {
    throw new Error("이 작업은 관장·부장만 할 수 있습니다.");
  }
  return ctx;
}
