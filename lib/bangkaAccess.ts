// =====================================================================
// 방과후아카데미(동래방카) 관리 접근 게이트 — /bangka/members
//   * 접근: M0(관장·부장·master) 또는 bangka(방과후아카데미) 직무 보유자만.
//   * bk_students / bk_guardians / bk_guardian_students 는 service_role 전용
//     (RLS on, 정책 0개) → 이 게이트가 유일한 방어선이라 조회·변경 액션 모두
//     진입 시 재검증합니다.
//   * 서버 전용 모듈("use server" 아님) — 서버 액션/페이지가 import 합니다.
//   * 시설관리 lib/facilityAccess 와 동일 구조(직무만 bangka 로).
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";
import { listRolesForDriver } from "@/lib/employeeRolesServer";

export type BangkaAccess = {
  name: string;
  driverId: string | null;
  isM0: boolean;
  rank: string | null; // 직급(관장·부장·팀장·팀원) — 공결 팀장 결재 판정용
  hasBangkaRole: boolean; // bangka 직무 보유 — M0 는 직무 없이도 들어오므로 따로 둡니다.
};

// 접근 컨텍스트 — 권한 없으면 null. (페이지는 redirect, 액션은 throw)
export async function resolveBangkaAccess(): Promise<BangkaAccess | null> {
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
  const hasBangkaRole = roles.includes("bangka");
  if (!isM0 && !hasBangkaRole) return null;
  return { name: me.name.trim(), driverId, isM0, rank, hasBangkaRole };
}

// 액션용 — 미통과면 throw.
export async function requireBangkaAccess(): Promise<BangkaAccess> {
  const ctx = await resolveBangkaAccess();
  if (!ctx) {
    throw new Error(
      "방과후아카데미 관리 권한이 없습니다. (관장·부장 또는 방과후아카데미 담당자)"
    );
  }
  return ctx;
}

// 공결 팀장 결재·반려(결재 단계) — 관장·부장(M0), 또는 bangka 직무 보유자 중 직급 팀장.
//   ★ 2026-10 관장 결정: 다른 팀 팀장은 결재 불가. 지금은 직무 없는 사람이 이 함수까지
//     못 오지만(resolveBangkaAccess 가 null), 게이트가 넓어져도 결재가 따라 넓어지지
//     않게 직무를 여기서 한 번 더 봅니다.
//   담임 확인은 접근 권한(bangka 직무 + M0)이면 됩니다 — 별도 함수 없음.
export function canApproveAbsence(ctx: BangkaAccess): boolean {
  return ctx.isM0 || (ctx.hasBangkaRole && ctx.rank === "팀장");
}
