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
  uploadStampImage,
  STAMP_IMAGE_MIME,
  removeHrDocuments,
  normalizeDocMap,
  signHrDocument,
  HR_DOCUMENTS_BUCKET,
  type Driver,
  type EmployeeRank,
  type EmployeeProfile,
  type GenderType,
} from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decodeDataUrl } from "@/lib/recruitmentApplicantDocData";
import { isEmployeeDocKey } from "@/lib/employeeDocs";
import { listRolesForDriver } from "@/lib/employeeRolesServer";

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
    has_password: false,
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

  const { data, error } = await supabaseAdmin
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
  const { data: existing, error: exErr } = await supabaseAdmin
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

  const { error } = await supabaseAdmin
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
  const { data, error } = await supabaseAdmin
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
    const { data: existing, error: exErr } = await supabaseAdmin
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
    const { error: upErr } = await supabaseAdmin
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

    const { data: existing, error: exErr } = await supabaseAdmin
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

    const { error: upErr } = await supabaseAdmin
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

// =====================================================================
// 본인 도장(사인) — 면접 심사표 (인) 자리에 자동 삽입될 손도장.
//   * SignaturePad 로 그린 png data URL 을 받아 hr-documents 에 저장.
//   * path: stamps/employee/{driverId}.png (고정 → 다시 그리면 덮어쓰기).
//   * employee_profiles.stamp_path 에 path 저장. 본인 driver_id 만 가능.
// =====================================================================
export async function getMyStampUrl(): Promise<string | null> {
  const driver = await getMyDriver();
  if (!driver) return null;
  const { data, error } = await supabaseAdmin
    .from("employee_profiles")
    .select("stamp_path")
    .eq("driver_id", driver.id)
    .maybeSingle();
  if (error || !data) return null;
  return signHrDocument(
    ((data as { stamp_path?: unknown }).stamp_path as string | null) ?? null
  );
}

export async function uploadMyStamp(
  formData: FormData
): Promise<
  { ok: true; stampUrl: string | null } | { ok: false; message: string }
> {
  try {
    const driver = await getMyDriver();
    if (!driver) throw new Error("직원 로그인이 필요합니다.");

    const dataUrl = String(formData.get("stamp_data_url") ?? "");
    if (!dataUrl.startsWith("data:image/png;base64,")) {
      return { ok: false, message: "도장(사인) 이미지를 먼저 그려주세요." };
    }
    const bytes = decodeDataUrl(dataUrl);
    if (!bytes || bytes.byteLength === 0) {
      return { ok: false, message: "도장 이미지를 인식하지 못했습니다." };
    }

    const path = `stamps/employee/${driver.id}.png`;
    await uploadStampImage(path, bytes, "image/png");
    const { error } = await supabaseAdmin
      .from("employee_profiles")
      .upsert(
        {
          driver_id: driver.id,
          stamp_path: path,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "driver_id" }
      );
    if (error) throw new Error(error.message);

    revalidatePath("/profile/hr");
    return { ok: true, stampUrl: await signHrDocument(path) };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "도장 저장 중 오류가 발생했습니다.",
    };
  }
}

// 본인 도장 "이미지 파일" 업로드 — 마우스 서명과 같은 stamp_path 슬롯(최신 것이 적용).
//   * png/jpg 만(webp 금지 — 기존 도장 시스템이 webp 를 못 읽어 PDF/워드에 안 찍힘).
//   * 8MB 이하. hr-documents 비공개 버킷, 공개 URL 노출 없음(service_role/서명 URL).
export async function uploadMyStampImage(
  formData: FormData
): Promise<
  { ok: true; stampUrl: string | null } | { ok: false; message: string }
> {
  try {
    const driver = await getMyDriver();
    if (!driver) throw new Error("직원 로그인이 필요합니다.");

    const file = formData.get("stamp_file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, message: "업로드할 도장 이미지를 선택해주세요." };
    }
    if (file.size > 8 * 1024 * 1024) {
      return { ok: false, message: "도장 이미지 용량은 8MB 이하여야 합니다." };
    }
    const ext = STAMP_IMAGE_MIME[file.type];
    if (!ext) {
      return {
        ok: false,
        message: "도장 이미지는 JPG·PNG 만 가능합니다. (WEBP 등은 사용할 수 없습니다)",
      };
    }

    // 기존 stamp_path 확인(확장자 달라지면 옛 파일 정리).
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("employee_profiles")
      .select("stamp_path, is_locked")
      .eq("driver_id", driver.id)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);
    if (existing && (existing as { is_locked?: unknown }).is_locked === true) {
      return { ok: false, message: "잠긴 인사기록카드입니다. 수정할 수 없습니다." };
    }
    const oldPath =
      ((existing as { stamp_path?: unknown } | null)?.stamp_path as
        | string
        | null) ?? null;

    const path = `stamps/employee/${driver.id}.${ext}`;
    await uploadStampImage(path, file, file.type);

    const { error } = await supabaseAdmin
      .from("employee_profiles")
      .upsert(
        {
          driver_id: driver.id,
          stamp_path: path,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "driver_id" }
      );
    if (error) throw new Error(error.message);

    if (oldPath && oldPath !== path) await removeHrDocuments([oldPath]);

    revalidatePath("/profile/hr");
    return { ok: true, stampUrl: await signHrDocument(path) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "도장 업로드 중 오류가 발생했습니다.",
    };
  }
}

export async function deleteMyStamp(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  try {
    const driver = await getMyDriver();
    if (!driver) throw new Error("직원 로그인이 필요합니다.");
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("employee_profiles")
      .select("stamp_path")
      .eq("driver_id", driver.id)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);
    const old =
      ((existing as { stamp_path?: unknown } | null)?.stamp_path as
        | string
        | null) ?? null;
    const { error: upErr } = await supabaseAdmin
      .from("employee_profiles")
      .update({ stamp_path: null, updated_at: new Date().toISOString() })
      .eq("driver_id", driver.id);
    if (upErr) throw new Error(upErr.message);
    if (old) await removeHrDocuments([old]);
    revalidatePath("/profile/hr");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "도장 삭제 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 본인 인사기록 첨부서류 (employee_profiles.documents jsonb)
//   * HR 관리자용 uploadEmployeeDocument 의 본인(self) 버전.
//   * driver_id 는 항상 세션에서만 도출(폼 값 신뢰 안 함).
//   * 경로: employees/{driverId}/docs/{docKey}.{ext} (hr-documents Private 버킷)
//   * 잠긴 카드는 본인도 수정 불가. 종류는 lib/employeeDocs.ts 슬롯.
// =====================================================================
const MY_DOC_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export async function uploadMyDocument(
  formData: FormData
): Promise<
  | { ok: true; docKey: string; signedUrl: string | null }
  | { ok: false; message: string }
> {
  try {
    const driver = await getMyDriver();
    if (!driver) return { ok: false, message: "직원 로그인이 필요합니다." };

    const docKey = String(formData.get("doc_key") ?? "").trim();
    if (!docKey || !isEmployeeDocKey(docKey)) {
      return { ok: false, message: "허용되지 않은 서류 종류입니다." };
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, message: "업로드할 파일을 선택해주세요." };
    }
    if (file.size > 16 * 1024 * 1024) {
      return { ok: false, message: "파일 용량은 16MB 이하여야 합니다." };
    }
    const ext = MY_DOC_EXT[file.type];
    if (!ext) {
      return {
        ok: false,
        message: "PDF, JPG, PNG, WEBP 형식만 업로드할 수 있습니다.",
      };
    }

    const { data: prev, error: pErr } = await supabaseAdmin
      .from("employee_profiles")
      .select("documents, is_locked")
      .eq("driver_id", driver.id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (prev && (prev as { is_locked?: unknown }).is_locked === true) {
      return { ok: false, message: "잠긴 인사기록카드입니다. 수정할 수 없습니다." };
    }
    const prevDocs = normalizeDocMap(
      (prev as { documents?: unknown } | null)?.documents
    );
    const oldPath = prevDocs[docKey] ?? null;

    const newPath = `employees/${driver.id}/docs/${docKey}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(HR_DOCUMENTS_BUCKET)
      .upload(newPath, file, { contentType: file.type, upsert: true });
    if (upErr) return { ok: false, message: `업로드 실패: ${upErr.message}` };

    const nextDocs = { ...prevDocs, [docKey]: newPath };
    const { error: dbErr } = await supabaseAdmin
      .from("employee_profiles")
      .upsert(
        {
          driver_id: driver.id,
          documents: nextDocs,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "driver_id" }
      );
    if (dbErr) throw new Error(dbErr.message);

    if (oldPath && oldPath !== newPath) {
      await removeHrDocuments([oldPath]);
    }

    revalidatePath("/profile/hr");
    return { ok: true, docKey, signedUrl: await signHrDocument(newPath) };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "업로드 중 오류가 발생했습니다.",
    };
  }
}

export async function deleteMyDocument(
  docKey: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const driver = await getMyDriver();
    if (!driver) return { ok: false, message: "직원 로그인이 필요합니다." };
    if (!docKey) return { ok: false, message: "서류 종류가 누락되었습니다." };

    const { data: prev, error: pErr } = await supabaseAdmin
      .from("employee_profiles")
      .select("documents, is_locked")
      .eq("driver_id", driver.id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prev) return { ok: true };
    if ((prev as { is_locked?: unknown }).is_locked === true) {
      return { ok: false, message: "잠긴 인사기록카드입니다. 수정할 수 없습니다." };
    }
    const prevDocs = normalizeDocMap(
      (prev as { documents?: unknown }).documents
    );
    const oldPath = prevDocs[docKey] ?? null;
    if (!oldPath) return { ok: true };
    const nextDocs = { ...prevDocs };
    delete nextDocs[docKey];

    const { error: dbErr } = await supabaseAdmin
      .from("employee_profiles")
      .update({ documents: nextDocs, updated_at: new Date().toISOString() })
      .eq("driver_id", driver.id);
    if (dbErr) throw new Error(dbErr.message);

    await removeHrDocuments([oldPath]);
    revalidatePath("/profile/hr");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.",
    };
  }
}

// 본인 첨부서류 임시 열람 URL — 1시간. 세션에서 직원 도출.
export async function getMyDocumentUrl(
  docKey: string
): Promise<string | null> {
  const driver = await getMyDriver();
  if (!driver || !docKey) return null;
  const { data, error } = await supabaseAdmin
    .from("employee_profiles")
    .select("documents")
    .eq("driver_id", driver.id)
    .maybeSingle();
  if (error || !data) return null;
  const docs = normalizeDocMap((data as { documents?: unknown }).documents);
  return signHrDocument(docs[docKey] ?? null);
}

// 본인 담당 직무 목록(읽기전용) — 세션에서 직원 도출. 마이페이지 표시용.
export async function getMyEmployeeRoles(): Promise<string[]> {
  const driver = await getMyDriver();
  if (!driver) return [];
  return listRolesForDriver(driver.id);
}
