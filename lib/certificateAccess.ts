// =====================================================================
// 증명서 관리 접근 게이트 — /hr/certificates (발급대장·경력증명서 발급)
//   * 접근: M0(관장·부장·master) 또는 hr(인사) 직무. (trainingAccess 와 동일 기준)
//   * certificate_issues 는 RLS 0개 → service_role 경유. 이 게이트가 유일 방어선.
//   * 서버 전용 모듈("use server" 아님) — 액션/페이지가 import.
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";
import { listRolesForDriver } from "@/lib/employeeRolesServer";

export type CertificateAccess = {
  name: string;
  driverId: string | null;
  isM0: boolean;
};

export async function resolveCertificateAccess(): Promise<CertificateAccess | null> {
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

export async function requireCertificateAccess(): Promise<CertificateAccess> {
  const ctx = await resolveCertificateAccess();
  if (!ctx) {
    throw new Error("증명서 관리 권한이 없습니다. (관장·부장 또는 인사 담당자)");
  }
  return ctx;
}
