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
  parseFamilyInput,
  parseLicenseInput,
  parseCareerInput,
  parseAwardInput,
  parseTrainingInput,
  parseAppointmentInput,
  signHrDocument,
  type HrAdminRank,
  type Driver,
  type EmployeeRank,
  type EmployeeProfile,
  type EmploymentContract,
  type CertificateIssued,
  type GenderType,
} from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
//   * required_documents jsonb 는 DB 기본값 사용 — 폼에서는 편집하지 않습니다.
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
  process_info: string | null;
  notice: string | null;
  status: "draft" | "published" | "closed";
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
    process_info: (raw.process_info as string | null) ?? null,
    notice: (raw.notice as string | null) ?? null,
    status: safeStatus,
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
    created_by: (raw.created_by as string | null) ?? null,
  };
}

export async function listRecruitmentPostings(): Promise<
  RecruitmentPostingAdmin[]
> {
  await requireHrAdmin();
  const { data, error } = await supabase
    .from("recruitment_postings")
    .select(
      "id,slug,title,field,recruit_count,application_start,application_end,qualifications,preferred,salary_info,process_info,notice,status,created_at,updated_at,created_by"
    )
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
      process_info: trimToNull("process_info"),
      notice: trimToNull("notice"),
      status: safeStatus,
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
