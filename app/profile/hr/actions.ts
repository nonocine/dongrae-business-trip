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
  uploadProfilePhoto,
  removeHrDocuments,
  signHrDocument,
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

// =====================================================================
// 본인 증명사진 (hr-documents 버킷)
// =====================================================================

// 본인 증명사진 조회 — 1시간 임시 URL. 세션에서 직원을 도출.
export async function getMyPhotoUrl(): Promise<string | null> {
  const driver = await getMyDriver();
  if (!driver) return null;
  const { data, error } = await supabase
    .from("employee_profiles")
    .select("photo_url")
    .eq("driver_id", driver.id)
    .maybeSingle();
  if (error || !data) return null;
  return signHrDocument(
    ((data as { photo_url?: unknown }).photo_url as string | null) ?? null
  );
}

// 본인 증명사진 업로드 — 새 파일 업로드 → DB 갱신 → 옛 파일 삭제 순서.
export async function uploadMyProfilePhoto(
  formData: FormData
): Promise<
  { ok: true; photoUrl: string | null } | { ok: false; message: string }
> {
  try {
    const driver = await getMyDriver();
    if (!driver) throw new Error("직원 로그인이 필요합니다.");

    const file = formData.get("photo");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("업로드할 사진을 선택해주세요.");
    }
    if (file.size > 8 * 1024 * 1024) {
      throw new Error("사진 용량은 8MB 이하여야 합니다.");
    }

    // 기존 row 의 잠금/사진 경로 확인
    const { data: existing, error: exErr } = await supabase
      .from("employee_profiles")
      .select("photo_url, is_locked")
      .eq("driver_id", driver.id)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);
    if (existing && (existing as { is_locked?: unknown }).is_locked === true) {
      throw new Error("잠긴 인사기록카드입니다. 수정할 수 없습니다.");
    }
    const oldPath =
      ((existing as { photo_url?: unknown } | null)?.photo_url as
        | string
        | null) ?? null;

    // 1) 새 파일 업로드
    const newPath = await uploadProfilePhoto(driver.id, file);

    // 2) DB 갱신 (photo_url 컬럼만 — 다른 입력값과 간섭 없음)
    const { error: upErr } = await supabase
      .from("employee_profiles")
      .upsert(
        {
          driver_id: driver.id,
          photo_url: newPath,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "driver_id" }
      );
    if (upErr) throw new Error(upErr.message);

    // 3) 옛 파일 삭제 (확장자가 달라 경로가 바뀐 경우만)
    if (oldPath && oldPath !== newPath) {
      await removeHrDocuments([oldPath]);
    }

    revalidatePath("/profile/hr");
    return { ok: true, photoUrl: await signHrDocument(newPath) };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? e.message
          : "사진 업로드 중 오류가 발생했습니다.",
    };
  }
}

// 본인 증명사진 삭제 — DB 비우고 → Storage 삭제.
export async function deleteMyProfilePhoto(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  try {
    const driver = await getMyDriver();
    if (!driver) throw new Error("직원 로그인이 필요합니다.");

    const { data: existing, error: exErr } = await supabase
      .from("employee_profiles")
      .select("photo_url, is_locked")
      .eq("driver_id", driver.id)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);
    if (!existing) return { ok: true };
    if ((existing as { is_locked?: unknown }).is_locked === true) {
      throw new Error("잠긴 인사기록카드입니다. 수정할 수 없습니다.");
    }
    const oldPath =
      ((existing as { photo_url?: unknown }).photo_url as string | null) ??
      null;

    const { error: upErr } = await supabase
      .from("employee_profiles")
      .update({ photo_url: null, updated_at: new Date().toISOString() })
      .eq("driver_id", driver.id);
    if (upErr) throw new Error(upErr.message);

    if (oldPath) await removeHrDocuments([oldPath]);

    revalidatePath("/profile/hr");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "사진 삭제 중 오류가 발생했습니다.",
    };
  }
}
