"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, getGoogleSession } from "@/app/actions";
import {
  supabase,
  HR_ADMIN_RANKS,
  normalizeEmployeeProfile,
  parseResidentNumber,
  parseEducationInput,
  parseFamilyInput,
  parseLicenseInput,
  parseCareerInput,
  parseAwardInput,
  parseTrainingInput,
  parseAppointmentInput,
  signHrDocument,
  removeHrDocuments,
  normalizeDocMap,
  HR_DOCUMENTS_BUCKET,
  type HrAdminRank,
  type Driver,
  type EmployeeRank,
  type EmployeeProfile,
  type EmploymentContract,
  type CertificateIssued,
  type GenderType,
} from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  RECRUITMENT_DOC_SLOTS,
  buildRequiredDocuments,
  requiredMapFromDocuments,
  type RecruitmentDocItem,
} from "@/lib/recruitmentDocs";
import { isEmployeeDocKey } from "@/lib/employeeDocs";
import { AUTH_LEVELS, isM0Grant } from "@/lib/authLevels";

// =====================================================================
// 인사 모듈 권한 — drivers.rank IN ('관장', '부장') 인 직원 세션만 통과.
//   * 관리자 세션(ADMIN_COOKIE)은 rank 개념이 없어 거부.
//   * 미통과 시 / 로 redirect.
// =====================================================================
// HR 영역 접근 게이트 — 다음 중 하나라도 통과하면 허용:
//   1) Google Workspace 세션 — master 또는 rank ∈ (관장·부장)
//   2) 직원 비번 로그인 + drivers.rank ∈ (관장·부장)
// 반환의 name 은 감사/작성자(reviewer_name·created_by) 식별에 쓰입니다.
// (rank 는 게이트 식별용이며 호출처에서 소비하지 않습니다.)
//   * 공유비번(ADMIN_PASSWORD) 경로는 제거되었습니다.
export async function requireHrAdmin(): Promise<{
  name: string;
  rank: HrAdminRank;
}> {
  // 1) Google Workspace — 비번 로그인 경로와 대칭으로 rank 게이팅.
  //    · 마스터 → 관장으로 통과.
  //    · rank ∈ (관장·부장) → 그 rank 로 통과.
  //    · 그 외(팀장·팀원·rank null) → HR 접근 거부, "/" 로 redirect.
  const g = await getGoogleSession();
  if (g) {
    if (g.isMaster) {
      return { name: g.driverName ?? g.name, rank: "관장" };
    }
    if (g.rank && (HR_ADMIN_RANKS as readonly string[]).includes(g.rank)) {
      return { name: g.driverName ?? g.name, rank: g.rank as HrAdminRank };
    }
    redirect("/");
  }

  // 2) 직원 비번 로그인 + 관장·부장 rank
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

// 인사기록카드 삭제 권한 — master/관장·부장만 통과.
//   * requireHrAdmin 과 달리 redirect 가 아니라 throw 합니다
//     (클라이언트에서 에러 메시지를 표시할 수 있도록).
//   * 공유비번 경로 제거. master 는 employee_profiles 매핑이 없어도 관장으로 통과.
async function requireHrManagerOrAdmin(): Promise<void> {
  // 1) Google Workspace — master 또는 rank ∈ (관장·부장).
  const g = await getGoogleSession();
  if (g) {
    if (
      g.isMaster ||
      (g.rank && (HR_ADMIN_RANKS as readonly string[]).includes(g.rank))
    ) {
      return;
    }
    throw new Error(
      "삭제 권한이 없습니다. 관리자 또는 관장·부장만 삭제할 수 있습니다."
    );
  }

  // 2) 직원 비번 로그인 + 관장·부장 rank.
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
  const { data, error } = await supabaseAdmin.from("employee_profiles").select("*");
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
  const { data, error } = await supabaseAdmin
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
  const { data: existing, error: exErr } = await supabaseAdmin
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

  revalidatePath("/hr");
}

// 인사기록카드 삭제 — ADMIN 또는 관장·부장만. 잠긴 카드는 삭제 불가.
export async function deleteEmployeeProfile(driverId: string) {
  await requireHrManagerOrAdmin();
  if (!driverId) throw new Error("직원 ID가 없습니다.");

  const { data, error } = await supabaseAdmin
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

  const { error: delErr } = await supabaseAdmin
    .from("employee_profiles")
    .delete()
    .eq("driver_id", driverId);
  if (delErr) throw new Error(delErr.message);

  revalidatePath("/hr");
}

// 직원 증명사진 조회 — 1시간 임시 URL. 관장·부장만 호출 가능.
export async function getEmployeePhotoUrl(
  driverId: string
): Promise<string | null> {
  await requireHrAdmin();
  if (!driverId) return null;
  const { data, error } = await supabaseAdmin
    .from("employee_profiles")
    .select("photo_url")
    .eq("driver_id", driverId)
    .maybeSingle();
  if (error || !data) return null;
  return signHrDocument(
    ((data as { photo_url?: unknown }).photo_url as string | null) ?? null
  );
}

// =====================================================================
// 인사기록 첨부서류 (employee_profiles.documents jsonb)
//   * 채용 첨부서류(uploadApplicantDocument) 패턴을 직원용으로 복제.
//   * 경로: employees/{driverId}/docs/{docKey}.{ext} (hr-documents Private 버킷)
//   * DB 엔 path 만 저장(공개 URL 금지) — 열람은 signHrDocument 임시 URL.
//   * 잠긴 카드는 수정 불가. 종류는 lib/employeeDocs.ts 의 EMPLOYEE_DOC_SLOTS.
// =====================================================================
const EMPLOYEE_DOC_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export async function uploadEmployeeDocument(
  formData: FormData
): Promise<
  | { ok: true; docKey: string; signedUrl: string | null }
  | { ok: false; message: string }
> {
  try {
    await requireHrAdmin();
    const driverId = String(formData.get("driver_id") ?? "").trim();
    const docKey = String(formData.get("doc_key") ?? "").trim();
    if (!driverId) return { ok: false, message: "직원이 지정되지 않았습니다." };
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
    const ext = EMPLOYEE_DOC_EXT[file.type];
    if (!ext) {
      return {
        ok: false,
        message: "PDF, JPG, PNG, WEBP 형식만 업로드할 수 있습니다.",
      };
    }

    // 잠금 확인 + 기존 path 확보(확장자 교체 시 옛 파일 정리).
    const { data: prev, error: pErr } = await supabaseAdmin
      .from("employee_profiles")
      .select("documents, is_locked")
      .eq("driver_id", driverId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (prev && (prev as { is_locked?: unknown }).is_locked === true) {
      return {
        ok: false,
        message: "잠긴 인사기록카드입니다. 먼저 잠금을 해제하세요.",
      };
    }
    const prevDocs = normalizeDocMap(
      (prev as { documents?: unknown } | null)?.documents
    );
    const oldPath = prevDocs[docKey] ?? null;

    const newPath = `employees/${driverId}/docs/${docKey}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(HR_DOCUMENTS_BUCKET)
      .upload(newPath, file, { contentType: file.type, upsert: true });
    if (upErr) return { ok: false, message: `업로드 실패: ${upErr.message}` };

    const nextDocs = { ...prevDocs, [docKey]: newPath };
    const { error: dbErr } = await supabaseAdmin
      .from("employee_profiles")
      .upsert(
        {
          driver_id: driverId,
          documents: nextDocs,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "driver_id" }
      );
    if (dbErr) throw new Error(dbErr.message);

    if (oldPath && oldPath !== newPath) {
      await removeHrDocuments([oldPath]);
    }

    revalidatePath("/hr");
    return { ok: true, docKey, signedUrl: await signHrDocument(newPath) };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "업로드 중 오류가 발생했습니다.",
    };
  }
}

export async function deleteEmployeeDocument(
  driverId: string,
  docKey: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireHrAdmin();
    if (!driverId || !docKey) {
      return { ok: false, message: "요청 정보가 누락되었습니다." };
    }
    const { data: prev, error: pErr } = await supabaseAdmin
      .from("employee_profiles")
      .select("documents, is_locked")
      .eq("driver_id", driverId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prev) return { ok: true };
    if ((prev as { is_locked?: unknown }).is_locked === true) {
      return {
        ok: false,
        message: "잠긴 인사기록카드입니다. 먼저 잠금을 해제하세요.",
      };
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
      .eq("driver_id", driverId);
    if (dbErr) throw new Error(dbErr.message);

    await removeHrDocuments([oldPath]);
    revalidatePath("/hr");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.",
    };
  }
}

// 직원 첨부서류 임시 열람 URL — 1시간. HR 관리자만 호출 가능.
export async function getEmployeeDocumentUrl(
  driverId: string,
  docKey: string
): Promise<string | null> {
  await requireHrAdmin();
  if (!driverId || !docKey) return null;
  const { data, error } = await supabaseAdmin
    .from("employee_profiles")
    .select("documents")
    .eq("driver_id", driverId)
    .maybeSingle();
  if (error || !data) return null;
  const docs = normalizeDocMap((data as { documents?: unknown }).documents);
  return signHrDocument(docs[docKey] ?? null);
}

// =====================================================================
// 권한등급(auth_level) — ERP 호환 시스템 권한.
//   * 변경은 M0(관장·부장·master) 공유 권한 — 셋 중 누구나 가능.
//     requireHrAdmin 통과자(관장·부장·master) 가 곧 M0 이므로 isM0Grant 로 확인.
//   * 빈 값이면 NULL(미지정), 그 외엔 허용 코드(M0/M1/M3)만 저장.
// =====================================================================
export async function saveEmployeeAuthLevel(
  driverId: string,
  authLevel: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const me = await requireHrAdmin();
    if (!isM0Grant({ rank: me.rank })) {
      return { ok: false, message: "권한등급 변경은 관장·부장만 가능합니다." };
    }
    if (!driverId) return { ok: false, message: "직원이 지정되지 않았습니다." };

    const trimmed = authLevel.trim();
    const value =
      trimmed.length === 0
        ? null
        : (AUTH_LEVELS as readonly string[]).includes(trimmed)
          ? trimmed
          : undefined;
    if (value === undefined) {
      return { ok: false, message: "허용되지 않은 권한등급입니다." };
    }

    const { error } = await supabaseAdmin
      .from("employee_profiles")
      .upsert(
        {
          driver_id: driverId,
          auth_level: value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "driver_id" }
      );
    if (error) throw new Error(error.message);

    revalidatePath("/hr");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "권한등급 저장 중 오류가 발생했습니다.",
    };
  }
}

// 직원 권한등급 조회 — 게이트 토대 헬퍼. HR 관리자만 호출 가능.
export async function getEmployeeAuthLevel(
  driverId: string
): Promise<string | null> {
  await requireHrAdmin();
  if (!driverId) return null;
  const { data, error } = await supabaseAdmin
    .from("employee_profiles")
    .select("auth_level")
    .eq("driver_id", driverId)
    .maybeSingle();
  if (error || !data) return null;
  return (
    ((data as { auth_level?: unknown }).auth_level as string | null) ?? null
  );
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

// =====================================================================
// 채용공고 관리 (recruitment_postings)
//   * HR 권한자(관장·부장)만 사용 가능.
//   * 상태 (draft / published / closed) 는 HR 가 직접 토글합니다.
//   * required_documents jsonb(제출 서류 5종 필수/선택)는 폼에서 편집·저장합니다.
// =====================================================================
export type RecruitmentPostingAdmin = {
  id: string;
  slug: string;
  title: string;
  field: string;
  recruit_count: number;
  application_start: string;
  application_end: string;
  qualifications: string | null;
  preferred: string | null;
  salary_info: string | null;
  work_contract_period: string | null;
  work_location: string | null;
  work_hours: string | null;
  work_duties: string | null;
  process_info: string | null;
  screening_criteria: string | null;
  interview_criteria: string | null;
  interview_candidate_announce_date: string | null;
  interview_datetime: string | null;
  interview_location: string | null;
  final_result_announce_date: string | null;
  appointment_date: string | null;
  notice: string | null;
  status: "draft" | "published" | "closed";
  required_documents: RecruitmentDocItem[];
  view_count: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

function normalizeRecruitmentPostingAdmin(
  raw: Record<string, unknown>
): RecruitmentPostingAdmin {
  const status = String(raw.status ?? "draft");
  const safeStatus: RecruitmentPostingAdmin["status"] =
    status === "published" || status === "closed" ? status : "draft";
  return {
    id: String(raw.id ?? ""),
    slug: String(raw.slug ?? ""),
    title: String(raw.title ?? ""),
    field: String(raw.field ?? ""),
    recruit_count: Number(raw.recruit_count ?? 0),
    application_start: String(raw.application_start ?? ""),
    application_end: String(raw.application_end ?? ""),
    qualifications: (raw.qualifications as string | null) ?? null,
    preferred: (raw.preferred as string | null) ?? null,
    salary_info: (raw.salary_info as string | null) ?? null,
    work_contract_period: (raw.work_contract_period as string | null) ?? null,
    work_location: (raw.work_location as string | null) ?? null,
    work_hours: (raw.work_hours as string | null) ?? null,
    work_duties: (raw.work_duties as string | null) ?? null,
    process_info: (raw.process_info as string | null) ?? null,
    screening_criteria: (raw.screening_criteria as string | null) ?? null,
    interview_criteria: (raw.interview_criteria as string | null) ?? null,
    interview_candidate_announce_date:
      (raw.interview_candidate_announce_date as string | null) ?? null,
    interview_datetime: (raw.interview_datetime as string | null) ?? null,
    interview_location: (raw.interview_location as string | null) ?? null,
    final_result_announce_date:
      (raw.final_result_announce_date as string | null) ?? null,
    appointment_date: (raw.appointment_date as string | null) ?? null,
    notice: (raw.notice as string | null) ?? null,
    status: safeStatus,
    // 제출 서류 5종 — 저장된 jsonb 의 required 를 반영(누락 슬롯은 기본값).
    required_documents: buildRequiredDocuments(
      requiredMapFromDocuments(raw.required_documents)
    ),
    view_count: Number(raw.view_count ?? 0),
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
    created_by: (raw.created_by as string | null) ?? null,
  };
}

export async function listRecruitmentPostings(): Promise<
  RecruitmentPostingAdmin[]
> {
  await requireHrAdmin();
  // select("*") — require_certificate_copy 등 신규 컬럼이 없어도 안전.
  const { data, error } = await supabase
    .from("recruitment_postings")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) =>
    normalizeRecruitmentPostingAdmin(row as Record<string, unknown>)
  );
}

// 폼 → DB 행. id 가 있으면 update, 없으면 insert.
//   * 입력 datetime-local 값은 KST 로 해석하여 +09:00 오프셋 ISO 로 저장.
//   * slug 는 unique. 충돌 시 명시 에러 반환.
export async function saveRecruitmentPosting(
  formData: FormData
): Promise<
  | { ok: true; id: string; slug: string }
  | { ok: false; message: string }
> {
  try {
    const me = await requireHrAdmin();

    const id = String(formData.get("id") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim();
    const title = String(formData.get("title") ?? "").trim();
    const field = String(formData.get("field") ?? "").trim();
    const recruitCountRaw = String(formData.get("recruit_count") ?? "").trim();
    const startLocal = String(formData.get("application_start") ?? "").trim();
    const endLocal = String(formData.get("application_end") ?? "").trim();
    const status = String(formData.get("status") ?? "draft").trim();

    if (!slug) return { ok: false, message: "공고 URL(slug)을 입력해주세요." };
    if (!/^[A-Za-z0-9-]+$/.test(slug)) {
      return {
        ok: false,
        message: "공고 URL은 영문/숫자/하이픈(-)만 사용할 수 있습니다.",
      };
    }
    if (!title) return { ok: false, message: "제목을 입력해주세요." };
    if (!field) return { ok: false, message: "채용분야를 입력해주세요." };

    const recruitCount = Number(recruitCountRaw);
    if (!Number.isFinite(recruitCount) || recruitCount < 1) {
      return { ok: false, message: "모집인원은 1 이상의 숫자여야 합니다." };
    }
    if (!startLocal || !endLocal) {
      return { ok: false, message: "접수 시작/마감 일시를 입력해주세요." };
    }
    // KST(+09:00) 로 해석.
    const startIso = `${startLocal}:00+09:00`;
    const endIso = `${endLocal}:00+09:00`;
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      return { ok: false, message: "마감 일시는 시작 일시보다 뒤여야 합니다." };
    }

    const safeStatus =
      status === "published" || status === "closed" ? status : "draft";

    // 제출 서류 5종 — 각 슬롯의 필수/선택을 폼에서 받아 jsonb 배열로 저장.
    //   필드가 없으면(구버전 클라이언트) 슬롯 기본값을 사용.
    const requiredByKey: Record<string, boolean> = {};
    for (const s of RECRUITMENT_DOC_SLOTS) {
      const v = formData.get(`doc_required_${s.key}`);
      requiredByKey[s.key] = v == null ? s.defaultRequired : v === "true";
    }
    const requiredDocuments = buildRequiredDocuments(requiredByKey);

    const trimToNull = (k: string): string | null => {
      const v = formData.get(k);
      if (v == null) return null;
      const s = String(v).trim();
      return s.length > 0 ? s : null;
    };

    const row = {
      slug,
      title,
      field,
      recruit_count: recruitCount,
      application_start: startIso,
      application_end: endIso,
      qualifications: trimToNull("qualifications"),
      preferred: trimToNull("preferred"),
      salary_info: trimToNull("salary_info"),
      work_contract_period: trimToNull("work_contract_period"),
      work_location: trimToNull("work_location"),
      work_hours: trimToNull("work_hours"),
      work_duties: trimToNull("work_duties"),
      process_info: trimToNull("process_info"),
      screening_criteria: trimToNull("screening_criteria"),
      interview_criteria: trimToNull("interview_criteria"),
      interview_candidate_announce_date: trimToNull(
        "interview_candidate_announce_date"
      ),
      interview_datetime: trimToNull("interview_datetime"),
      interview_location: trimToNull("interview_location"),
      final_result_announce_date: trimToNull("final_result_announce_date"),
      appointment_date: trimToNull("appointment_date"),
      notice: trimToNull("notice"),
      status: safeStatus,
      // 제출 서류 5종 필수/선택 — 목록형 jsonb 로 일원화 저장.
      required_documents: requiredDocuments,
      updated_at: new Date().toISOString(),
    };

    // slug unique 충돌 사전 체크 (서로 다른 id 가 같은 slug 를 가지려 할 때).
    const { data: dupe, error: dupeErr } = await supabase
      .from("recruitment_postings")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (dupeErr) throw new Error(dupeErr.message);
    if (dupe && String((dupe as { id: unknown }).id) !== id) {
      return {
        ok: false,
        message: "이미 사용 중인 공고 URL입니다. 다른 값으로 변경해주세요.",
      };
    }

    let savedId = id;
    if (id) {
      const { error } = await supabase
        .from("recruitment_postings")
        .update(row)
        .eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data: inserted, error } = await supabase
        .from("recruitment_postings")
        .insert({ ...row, created_by: me.name })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      savedId = String((inserted as { id: unknown }).id);
    }

    revalidatePath("/hr");
    revalidatePath(`/recruitment/${slug}`);
    return { ok: true, id: savedId, slug };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "공고 저장 중 오류가 발생했습니다.",
    };
  }
}

export async function deleteRecruitmentPosting(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireHrAdmin();
    if (!id) return { ok: false, message: "삭제할 공고 ID가 없습니다." };

    // 지원자가 한 명이라도 있으면 onDelete restrict 로 막힙니다.
    // 미리 검사해서 친절한 메시지를 반환합니다.
    const { count, error: cErr } = await supabaseAdmin
      .from("recruitment_applications")
      .select("id", { count: "exact", head: true })
      .eq("posting_id", id);
    if (cErr) throw new Error(cErr.message);
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        message:
          "지원서가 접수된 공고는 삭제할 수 없습니다. 비공개(draft) 로 전환하세요.",
      };
    }

    const { error } = await supabase
      .from("recruitment_postings")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);

    revalidatePath("/hr");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "공고 삭제 중 오류가 발생했습니다.",
    };
  }
}

// 공고 공개/비공개 전환 — 삭제 불가(지원서 접수)인 공고도 공개에서 뺄 수 있게.
//   * published → closed("비공개 전환"): 공개 목록/배너/상세에서 빠지고 지원서는 보존.
//   * draft|closed → published("공개 전환"): 다시 공개.
export async function setRecruitmentPostingStatus(
  id: string,
  status: "published" | "closed"
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireHrAdmin();
    if (!id) return { ok: false, message: "공고 ID가 없습니다." };
    if (status !== "published" && status !== "closed") {
      return { ok: false, message: "허용되지 않는 상태입니다." };
    }

    const { data, error } = await supabase
      .from("recruitment_postings")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("slug")
      .single();
    if (error) throw new Error(error.message);

    revalidatePath("/hr");
    revalidatePath("/recruitment");
    const slug = String((data as { slug: unknown }).slug ?? "");
    if (slug) revalidatePath(`/recruitment/${slug}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "상태 전환 중 오류가 발생했습니다.",
    };
  }
}
