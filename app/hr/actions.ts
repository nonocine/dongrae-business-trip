"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, isAdmin } from "@/app/actions";
import {
  supabase,
  HR_ADMIN_RANKS,
  normalizeEmployeeProfile,
  parseResidentNumber,
  parseEducationInput,
  type HrAdminRank,
  type Driver,
  type EmployeeRank,
  type EmployeeProfile,
  type EmploymentContract,
  type CertificateIssued,
  type GenderType,
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

// 인사기록카드 삭제 권한 — ADMIN 또는 관장·부장만 통과.
//   * requireHrAdmin 과 달리 redirect 가 아니라 throw 합니다
//     (클라이언트에서 에러 메시지를 표시할 수 있도록).
async function requireHrManagerOrAdmin(): Promise<void> {
  if (await isAdmin()) return;

  const session = await getSession();
  if (!session || session.kind !== "employee") {
    throw new Error("삭제 권한이 없습니다.");
  }
  const { data } = await supabase
    .from("drivers")
    .select("rank")
    .eq("name", session.name)
    .eq("is_active", true)
    .maybeSingle();
  const rank = (data?.rank as string | null) ?? "";
  if (!(HR_ADMIN_RANKS as readonly string[]).includes(rank)) {
    throw new Error(
      "삭제 권한이 없습니다. 관리자 또는 관장·부장만 삭제할 수 있습니다."
    );
  }
}

// =====================================================================
// 인사기록카드 (employee_profiles)
// =====================================================================

// 인사기록카드 입력 대상 후보 — drivers 전체(활성/비활성).
export async function listDriversForHrProfile(): Promise<Driver[]> {
  await requireHrAdmin();
  const { data, error } = await supabase
    .from("drivers")
    .select("id,name,rank,is_active,created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String((row as { id: unknown }).id ?? ""),
    name: String((row as { name: unknown }).name ?? ""),
    rank: ((row as { rank: unknown }).rank as EmployeeRank | null) ?? null,
    // 비밀번호는 인사 UI에 불필요 — 클라이언트로 내려보내지 않습니다.
    password: null,
    is_active: (row as { is_active: unknown }).is_active !== false,
    created_at: String((row as { created_at: unknown }).created_at ?? ""),
  }));
}

// 전체 인사기록카드 목록 (직원명은 drivers 목록으로 매칭).
export async function listEmployeeProfiles(): Promise<EmployeeProfile[]> {
  await requireHrAdmin();
  const { data, error } = await supabase.from("employee_profiles").select("*");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) =>
    normalizeEmployeeProfile(row as Record<string, unknown>)
  );
}

// 특정 직원의 인사기록카드 — 없으면 null.
export async function getEmployeeProfile(
  driverId: string
): Promise<EmployeeProfile | null> {
  await requireHrAdmin();
  if (!driverId) return null;
  const { data, error } = await supabase
    .from("employee_profiles")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return normalizeEmployeeProfile(data as Record<string, unknown>);
}

// 인사기록카드 저장 — driver_id 기준 upsert (있으면 update, 없으면 insert).
export async function saveEmployeeProfile(formData: FormData) {
  await requireHrAdmin();

  const driver_id = String(formData.get("driver_id") ?? "").trim();
  if (!driver_id) throw new Error("직원을 선택해주세요.");

  // 잠긴 카드는 수정 불가 (관장도 잠금 해제 전에는 수정 불가).
  const { data: existing, error: exErr } = await supabase
    .from("employee_profiles")
    .select("is_locked")
    .eq("driver_id", driver_id)
    .maybeSingle();
  if (exErr) throw new Error(exErr.message);
  if (existing && (existing as { is_locked?: unknown }).is_locked === true) {
    throw new Error("잠긴 인사기록카드입니다. 먼저 잠금을 해제하세요.");
  }

  const str = (key: string): string | null => {
    const v = formData.get(key);
    if (v == null) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  };

  // 주민등록번호에서 생년월일·성별 자동 계산.
  // 비어있으면(외국인 등) birth_date·gender 모두 null 저장.
  const resident_number = str("resident_number");
  let birth_date: string | null = null;
  let gender: GenderType | null = null;
  if (resident_number) {
    const parsed = parseResidentNumber(resident_number);
    if (!parsed) {
      throw new Error("주민등록번호 형식이 올바르지 않습니다.");
    }
    birth_date = parsed.birthDate;
    gender = parsed.gender;
  }

  // 재직 중이면 퇴사일을 null 로 강제 저장.
  const employed = formData.get("employed") === "on";
  const leave_date = employed ? null : str("leave_date");

  const education = parseEducationInput(str("education"));

  const row = {
    driver_id,
    name_chinese: str("name_chinese"),
    resident_number,
    gender,
    birth_date,
    address: str("address"),
    email: str("email"),
    phone: str("phone"),
    join_date: str("join_date"),
    leave_date,
    military_service: str("military_service"),
    education,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("employee_profiles")
    .upsert(row, { onConflict: "driver_id" });
  if (error) throw new Error(error.message);

  revalidatePath("/hr");
}

// 인사기록카드 삭제 — ADMIN 또는 관장·부장만. 잠긴 카드는 삭제 불가.
export async function deleteEmployeeProfile(driverId: string) {
  await requireHrManagerOrAdmin();
  if (!driverId) throw new Error("직원 ID가 없습니다.");

  const { data, error } = await supabase
    .from("employee_profiles")
    .select("is_locked")
    .eq("driver_id", driverId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("삭제할 인사기록카드가 없습니다.");
  if ((data as { is_locked?: unknown }).is_locked === true) {
    throw new Error(
      "잠긴 인사기록카드입니다. 먼저 잠금을 해제하세요."
    );
  }

  const { error: delErr } = await supabase
    .from("employee_profiles")
    .delete()
    .eq("driver_id", driverId);
  if (delErr) throw new Error(delErr.message);

  revalidatePath("/hr");
}

// =====================================================================
// 계약서 / 증명서 — 오늘은 빈 껍데기. 탭 UI 구현 시 채울 예정.
// =====================================================================
export async function listContracts(): Promise<EmploymentContract[]> {
  await requireHrAdmin();
  return [];
}

export async function listCertificates(): Promise<CertificateIssued[]> {
  await requireHrAdmin();
  return [];
}
