// =====================================================================
// 증명서 관리 접근 게이트 — /hr/certificates (발급대장·경력증명서 발급)
//   * 접근: 인사 파일 열람(personnel) 보유자 — 관장·부장·master 자동 + 관장이 지정한 사람.
//     ★ 2026-10 관장 결정: 증명서 발급·발급대장·재발급·신청 목록은 인사 파일이라
//       hr 직무·권한등급 M0 만으로는 열지 않습니다. 승인·반려는 그중 M0(isM0).
//     본인 신청·본인 발급분 조회는 이 게이트가 아니라 세션 본인 판정(actions)입니다.
//   * certificate_issues 는 RLS 0개 → service_role 경유. 이 게이트가 유일 방어선.
//   * 서버 전용 모듈("use server" 아님) — 액션/페이지가 import.
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";
import { resolvePersonnelViewer } from "@/lib/personnelAccess";

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
  if (!(await resolvePersonnelViewer())?.isPersonnel) return null;
  return { name: me.name.trim(), driverId, isM0 };
}

export async function requireCertificateAccess(): Promise<CertificateAccess> {
  const ctx = await resolveCertificateAccess();
  if (!ctx) {
    throw new Error("증명서 관리 권한이 없습니다. (관장·부장 또는 관장이 지정한 인사 파일 열람 권한자)");
  }
  return ctx;
}
