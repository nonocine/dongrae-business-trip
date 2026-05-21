"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/app/actions";
import {
  supabase,
  HR_ADMIN_RANKS,
  type HrAdminRank,
  type EmployeeProfile,
  type EmploymentContract,
  type CertificateIssued,
} from "@/lib/supabase";

// =====================================================================
// 인사 모듈 권한 — drivers.rank IN ('관장', '부장') 인 직원 세션만 통과.
//   * 관리자 세션(ADMIN_COOKIE)은 rank 개념이 없어 거부.
//   * 미통과 시 / 로 redirect.
// =====================================================================
export async function requireHrAdmin(): Promise<{
  name: string;
  rank: HrAdminRank;
}> {
  const session = await getSession();
  if (!session || session.kind !== "employee") {
    redirect("/");
  }

  const { data, error } = await supabase
    .from("drivers")
    .select("rank")
    .eq("name", session.name)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) {
    redirect("/");
  }

  const rank = (data.rank as string | null) ?? "";
  if (!(HR_ADMIN_RANKS as readonly string[]).includes(rank)) {
    redirect("/");
  }

  return { name: session.name, rank: rank as HrAdminRank };
}

// =====================================================================
// 데이터 조회 — 오늘은 빈 껍데기. 탭 UI 구현 시 채울 예정.
// =====================================================================
export async function listEmployeeProfiles(): Promise<EmployeeProfile[]> {
  await requireHrAdmin();
  return [];
}

export async function listContracts(): Promise<EmploymentContract[]> {
  await requireHrAdmin();
  return [];
}

export async function listCertificates(): Promise<CertificateIssued[]> {
  await requireHrAdmin();
  return [];
}
