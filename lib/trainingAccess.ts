// =====================================================================
// 의무교육 관리 접근 게이트 — /hr/trainings (담당자 화면)
//   * 접근: M0(관장·부장·master) 또는 hr(인사) 직무 보유자만.
//     - /hr(관장·부장 전용) 와 달리 인사 직무 팀원도 들어와야 하므로 별도 게이트
//       (급여 모듈 lib/salaryAccess 와 동일한 구조, 직무만 hr 로).
//   * mandatory_trainings / training_completions 는 RLS 0개 → service_role 경유.
//     이 게이트가 유일한 방어선이라 조회·변경 액션 모두 진입 시 재검증합니다.
//   * 감사(uploaded_by)·본인 판별을 위해 name·driverId 를 함께 반환합니다.
//   * 서버 전용 모듈("use server" 아님) — 서버 액션 파일들이 import 합니다.
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";
import { listRolesForDriver } from "@/lib/employeeRolesServer";

export type TrainingAccess = {
  name: string;
  driverId: string | null;
  isM0: boolean;
};

// 담당자 접근 컨텍스트 — 권한 없으면 null. (페이지는 redirect, 액션은 throw)
export async function resolveTrainingAccess(): Promise<TrainingAccess | null> {
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

// 액션용 — 미통과면 throw.
export async function requireTrainingAccess(): Promise<TrainingAccess> {
  const ctx = await resolveTrainingAccess();
  if (!ctx) {
    throw new Error(
      "의무교육 관리 권한이 없습니다. (관장·부장 또는 인사 담당자)"
    );
  }
  return ctx;
}
