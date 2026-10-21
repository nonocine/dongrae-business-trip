// =====================================================================
// 급여 모듈 접근 게이트 — /hr/salary (기준관리·월별관리 공용)
//   * 접근: M0(관장·부장·master) · accounting(회계) 직무 · 인사 파일 열람(personnel).
//   * ★ 2026-10 관장 결정: 개인별 급여(직원별 급여설정·월별 급여·EDI·명세서·급여대장)와
//     연가사용계획서는 인사 파일 열람 보유자만 — requireSalaryAccess({ personnel: true }).
//     회계 직무·M0 권한등급만으로는 호봉표·급여 기준값·강사비 지출표 같은 직원 정보가
//     없는 일까지만 합니다.
//   * 모든 급여 테이블은 RLS 0개 → service_role 경유. 이 게이트가 유일한
//     방어선이므로 조회·변경 액션 모두 진입 시 권한을 재검증합니다.
//   * '확정 취소' 등 M0 전용 동작을 위해 isM0 를 함께 반환합니다.
//   * 서버 전용 모듈(“use server” 아님) — 서버 액션 파일들이 import 합니다.
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";
import { listRolesForDriver } from "@/lib/employeeRolesServer";
import { PERSONNEL_DENIED, resolvePersonnelViewer } from "@/lib/personnelAccess";

export type SalaryAccess = {
  name: string;
  driverId: string | null;
  isM0: boolean;
  isPersonnel: boolean; // 인사 파일 열람 — 개인별 급여·연가
};

// 급여 접근 컨텍스트 — 권한 없으면 null. (페이지는 redirect, 액션은 throw)
export async function resolveSalaryAccess(): Promise<SalaryAccess | null> {
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
  const isPersonnel = !!(await resolvePersonnelViewer())?.isPersonnel;
  const canAccess = isM0 || roles.includes("accounting") || isPersonnel;
  if (!canAccess) return null;
  return { name: me.name.trim(), driverId, isM0, isPersonnel };
}

// 액션용 — 미통과면 throw. onlyM0 면 회계 직무는 통과시키지 않습니다.
//   personnel 이면 인사 파일 열람 보유자만(개인별 급여·연가).
export async function requireSalaryAccess(opts?: {
  onlyM0?: boolean;
  personnel?: boolean;
}): Promise<SalaryAccess> {
  const ctx = await resolveSalaryAccess();
  if (!ctx) {
    throw new Error("급여 관리 권한이 없습니다. (관장·부장 또는 회계 담당자)");
  }
  if (opts?.personnel && !ctx.isPersonnel) throw new Error(PERSONNEL_DENIED);
  if (opts?.onlyM0 && !ctx.isM0) {
    throw new Error("이 작업은 관장·부장만 할 수 있습니다.");
  }
  return ctx;
}
