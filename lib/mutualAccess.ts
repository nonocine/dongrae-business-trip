// =====================================================================
// 상조회 모듈 접근 게이트 — /hr/mutual  (MU-5: 2층 구조)
//   * 열람(view)  : 로그인한 직원 전원. 상조회는 직원 자치 조직이고 회비를 전원이
//     내므로 장부·회원 명단은 회원 누구나 볼 수 있어야 한다.
//   * 관리(manage): M0(관장·부장·master) 또는 mutual(상조회) 직무.
//     기입·수정·삭제·월회비·연마감·과거 이관이 모두 여기에 속한다.
//   * mutual_* 테이블은 RLS 정책 0개 → service_role 경유. 이 게이트가 유일한
//     방어선이므로 조회 액션은 requireMutualView, 변경 액션은 requireMutualManage
//     로 진입 시마다 재검증한다(화면에서 버튼을 숨기는 것만으로는 방어가 아니다).
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
  /** 기입·수정·삭제 권한 — mutual 직무 또는 M0. */
  canManage: boolean;
};

// 로그인한 직원이면 열람 컨텍스트를 돌려준다(권한 판정 포함). 아니면 null.
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
  return {
    name: me.name.trim(),
    driverId,
    isM0,
    canManage: isM0 || roles.includes(MUTUAL_ROLE_KEY),
  };
}

// 조회 액션·열람 페이지용 — 로그인 직원이면 통과.
export async function requireMutualView(): Promise<MutualAccess> {
  const ctx = await resolveMutualAccess();
  if (!ctx) throw new Error("직원 로그인이 필요합니다.");
  return ctx;
}

// 변경 액션·관리 페이지용 — mutual 직무 또는 M0 만. onlyM0 면 M0 만.
export async function requireMutualManage(opts?: {
  onlyM0?: boolean;
}): Promise<MutualAccess> {
  const ctx = await requireMutualView();
  if (!ctx.canManage)
    throw new Error(
      "상조회 기입·수정 권한이 없습니다. (관장·부장 또는 상조회 담당자)"
    );
  if (opts?.onlyM0 && !ctx.isM0)
    throw new Error("이 작업은 관장·부장만 할 수 있습니다.");
  return ctx;
}
