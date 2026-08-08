// =====================================================================
// 데이터 백업 접근 게이트 — /hr/backup
//   * 접근: M0(관장·부장·master) 전용. 직무(role) 위임 없음 —
//     전 테이블을 통째로 반출하는 기능이라 최고권한만 허용합니다.
//   * 백업 엔진은 service_role 로 모든 테이블을 읽으므로 이 게이트가
//     유일한 방어선입니다. 페이지·액션 양쪽에서 매번 재검증합니다.
//   * 서버 전용 모듈("use server" 아님) — 페이지/서버 액션이 import 합니다.
//   * 구조는 lib/salaryAccess · lib/facilityAccess 와 동일(직무 조건만 제거).
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";

export type BackupAccess = {
  name: string;
  driverId: string | null;
};

// 접근 컨텍스트 — M0 아니면 null. (페이지는 redirect, 액션은 throw)
export async function resolveBackupAccess(): Promise<BackupAccess | null> {
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

  if (!isM0Grant({ rank, email: g?.email, authLevel })) return null;
  return { name: me.name.trim(), driverId };
}

// 액션용 — 미통과면 throw.
export async function requireBackupAccess(): Promise<BackupAccess> {
  const ctx = await resolveBackupAccess();
  if (!ctx) {
    throw new Error("데이터 백업 권한이 없습니다. (관장·부장 전용)");
  }
  return ctx;
}
