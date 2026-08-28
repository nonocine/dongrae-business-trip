import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";

export type ClubAccess = {
  name: string;
  driverId: string | null;
  isM0: boolean;
};

// 로그인한 직원이면 누구나 통과. (동아리 = 협업 자산, 거래처관리와 동일 정책)
// 반환값의 isM0로 삭제 등 민감 작업만 따로 제한한다.
export async function resolveClubAccess(): Promise<ClubAccess | null> {
  const me = await getSession();
  if (!me || me.kind !== "employee" || !me.name.trim()) return null;

  const google = await getGoogleSession();
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
    const { data: profile } = await supabaseAdmin
      .from("employee_profiles")
      .select("auth_level")
      .eq("driver_id", driverId)
      .maybeSingle();
    authLevel =
      (profile as { auth_level?: string | null } | null)?.auth_level ?? null;
  }
  const isM0 = isM0Grant({ rank, email: google?.email, authLevel });

  return { name: me.name.trim(), driverId, isM0 };
}

export async function requireClubAccess(): Promise<ClubAccess> {
  const access = await resolveClubAccess();
  if (!access) {
    throw new Error("동아리 관리 권한이 없습니다. (로그인이 필요합니다)");
  }
  return access;
}
