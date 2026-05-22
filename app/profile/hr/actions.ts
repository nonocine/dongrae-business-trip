"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/app/actions";
import {
  supabase,
  normalizeEmployeeProfile,
  parseResidentNumber,
  parseEducationInput,
  parseFamilyInput,
  parseLicenseInput,
  parseCareerInput,
  parseAwardInput,
  parseTrainingInput,
  parseAppointmentInput,
  type Driver,
  type EmployeeRank,
  type EmployeeProfile,
  type GenderType,
} from "@/lib/supabase";

// 세션의 직원 이름으로 drivers row 를 조회합니다.
// 타 직원 카드 접근을 막기 위해 driver_id 는 항상 세션에서만 도출합니다.
async function getMyDriver(): Promise<Driver | null> {
  const session = await getSession();
  if (!session || session.kind !== "employee") return null;

  const { data, error } = await supabase
    .from("drivers")
    .select("id,name,rank,is_active,created_at")
    .eq("name", session.name)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    id: String((data as { id: unknown }).id ?? ""),
    name: String((data as { name: unknown }).name ?? ""),
    rank: ((data as { rank: unknown }).rank as EmployeeRank | null) ?? null,
    // 비밀번호는 클라이언트로 내려보내지 않습니다.
    password: null,
    is_active: (data as { is_active: unknown }).is_active !== false,
    created_at: String((data as { created_at: unknown }).created_at ?? ""),
  };
}

// 본인 인사기록카드 조회 — 세션에서 직원을 도출. 없으면 null.
export async function getMyProfile(): Promise<{
  driver: Driver;
  profile: EmployeeProfile | null;
} | null> {
  const driver = await getMyDriver();
  if (!driver) return null;

  const { data, error } = await supabase
    .from("employee_profiles")
    .select("*")
    .eq("driver_id", driver.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  return {
    driver,
    profile: data
      ? normalizeEmployeeProfile(data as Record<string, unknown>)
      : null,
  };
}

// 본인 인사기록카드 저장 — driver_id 는 세션에서만 도출(폼 값 신뢰 안 함).
export async function saveMyProfile(formData: FormData) {
  const driver = await getMyDriver();
  if (!driver) throw new Error("직원 로그인이 필요합니다.");
  const driver_id = driver.id;

  // 잠금 확인 — 잠긴 카드는 본인도 수정 불가 (클라이언트 readOnly 우회 차단).
  const { data: existing, error: exErr } = await supabase
    .from("employee_profiles")
    .select("is_locked")
    .eq("driver_id", driver_id)
    .maybeSingle();
  if (exErr) throw new Error(exErr.message);
  if (existing && (existing as { is_locked?: unknown }).is_locked === true) {
    throw new Error("잠긴 인사기록카드입니다. 수정할 수 없습니다.");
  }

  const str = (key: string): string | null => {
    const v = formData.get(key);
    if (v == null) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  };

  // 주민등록번호에서 생년월일·성별 자동 계산 (Phase A 헬퍼 재사용).
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
  const family = parseFamilyInput(str("family"));
  const licenses = parseLicenseInput(str("licenses"));
  const career = parseCareerInput(str("career"));
  const awards = parseAwardInput(str("awards"));
  const trainings = parseTrainingInput(str("trainings"));
  const appointments = parseAppointmentInput(str("appointments"));

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
    family,
    licenses,
    career,
    awards,
    trainings,
    appointments,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("employee_profiles")
    .upsert(row, { onConflict: "driver_id" });
  if (error) throw new Error(error.message);

  revalidatePath("/profile/hr");
}
