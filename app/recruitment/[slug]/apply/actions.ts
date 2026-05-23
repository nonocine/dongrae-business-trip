"use server";

import { revalidatePath } from "next/cache";
import {
  supabase,
  parseEducationInput,
  parseLicenseInput,
  parseCareerInput,
  parseAwardInput,
  parseTrainingInput,
  signHrDocument,
  removeHrDocuments,
  HR_DOCUMENTS_BUCKET,
  type EmployeeEducation,
  type EmployeeLicense,
  type EmployeeCareer,
  type EmployeeAward,
  type EmployeeTraining,
} from "@/lib/supabase";

// =====================================================================
// 채용 지원 — 외부 지원자가 채용 공고에 직접 접수하는 흐름
//   * 인증 없음(외부 지원자) — 이메일을 식별자로 사용합니다.
//   * 임시저장 → 첨부서류 업로드 → 동의 → 최종 제출 순서.
//   * 첨부서류는 hr-documents Private 버킷의
//     recruitment/{posting_id}/{applicant_id}/ 경로에 저장됩니다.
// =====================================================================

// 공고가 정의하는 필수/선택 첨부서류 항목
export type RequiredDoc = {
  key: string;
  label: string;
  required: boolean;
};

// 지원 페이지에서 필요한 채용 공고 정보 — 조회 페이지보다 필드가 많습니다.
export type ApplyPosting = {
  id: string;
  slug: string;
  title: string;
  field: string;
  application_end: string;
  status: string;
  required_documents: RequiredDoc[];
};

// 외부 지원자
export type RecruitmentApplicant = {
  id: string;
  applicant_number: string;
  name: string;
  birth_date: string;
  gender: "M" | "F" | null;
  address: string | null;
  email: string;
  phone: string;
  photo_url: string | null;
  education: EmployeeEducation[];
  licenses: EmployeeLicense[];
  career: EmployeeCareer[];
  awards: EmployeeAward[];
  trainings: EmployeeTraining[];
  motivation: string | null;
  self_development: string | null;
  career_summary: string | null;
  philosophy: string | null;
  documents: Record<string, string>;
  agreed_privacy: boolean;
  agreed_criminal_check: boolean;
  agreed_truth: boolean;
};

export type RecruitmentApplicationStatus =
  | "draft"
  | "submitted"
  | "screening_passed"
  | "screening_failed"
  | "interview_passed"
  | "interview_failed"
  | "final_passed"
  | "final_rejected";

export type RecruitmentApplication = {
  id: string;
  posting_id: string;
  applicant_id: string;
  status: RecruitmentApplicationStatus;
  submitted_at: string | null;
};

function normalizeRequiredDocs(raw: unknown): RequiredDoc[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (x): x is Record<string, unknown> =>
        x != null && typeof x === "object" && !Array.isArray(x)
    )
    .map((x) => ({
      key: String(x.key ?? "").trim(),
      label: String(x.label ?? "").trim(),
      required: x.required === true,
    }))
    .filter((d) => d.key.length > 0 && d.label.length > 0);
}

function normalizeDocuments(raw: unknown): Record<string, string> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim().length > 0) out[k] = v;
  }
  return out;
}

function normalizeApplicant(raw: Record<string, unknown>): RecruitmentApplicant {
  return {
    id: String(raw.id ?? ""),
    applicant_number: String(raw.applicant_number ?? ""),
    name: String(raw.name ?? ""),
    birth_date: String(raw.birth_date ?? ""),
    gender: (raw.gender as "M" | "F" | null) ?? null,
    address: (raw.address as string | null) ?? null,
    email: String(raw.email ?? ""),
    phone: String(raw.phone ?? ""),
    photo_url: (raw.photo_url as string | null) ?? null,
    education: parseEducationInput(jsonbToString(raw.education)),
    licenses: parseLicenseInput(jsonbToString(raw.licenses)),
    career: parseCareerInput(jsonbToString(raw.career)),
    awards: parseAwardInput(jsonbToString(raw.awards)),
    trainings: parseTrainingInput(jsonbToString(raw.trainings)),
    motivation: (raw.motivation as string | null) ?? null,
    self_development: (raw.self_development as string | null) ?? null,
    career_summary: (raw.career_summary as string | null) ?? null,
    philosophy: (raw.philosophy as string | null) ?? null,
    documents: normalizeDocuments(raw.documents),
    agreed_privacy: raw.agreed_privacy === true,
    agreed_criminal_check: raw.agreed_criminal_check === true,
    agreed_truth: raw.agreed_truth === true,
  };
}

// jsonb 컬럼은 객체/배열로 내려올 수도, 문자열로 내려올 수도 있어
// 기존 parseXxxInput(string|null) 헬퍼에 맞춰 문자열로 정규화합니다.
function jsonbToString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

function normalizeApplication(
  raw: Record<string, unknown>
): RecruitmentApplication {
  return {
    id: String(raw.id ?? ""),
    posting_id: String(raw.posting_id ?? ""),
    applicant_id: String(raw.applicant_id ?? ""),
    status: (raw.status as RecruitmentApplicationStatus) ?? "draft",
    submitted_at: (raw.submitted_at as string | null) ?? null,
  };
}

// =====================================================================
// 공고 조회 — 지원 페이지 진입 시 사용
// =====================================================================
export async function getApplyPosting(
  slug: string
): Promise<ApplyPosting | null> {
  if (!slug) return null;
  const { data, error } = await supabase
    .from("recruitment_postings")
    .select(
      "id,slug,title,field,application_end,status,required_documents"
    )
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id ?? ""),
    slug: String(r.slug ?? ""),
    title: String(r.title ?? ""),
    field: String(r.field ?? ""),
    application_end: String(r.application_end ?? ""),
    status: String(r.status ?? ""),
    required_documents: normalizeRequiredDocs(r.required_documents),
  };
}

// =====================================================================
// 임시저장 지원서 조회 — 이메일로 본인 확인 후 불러옵니다.
// =====================================================================
export async function getApplicationDraft(
  slug: string,
  applicantEmail: string
): Promise<
  | { applicant: RecruitmentApplicant; application: RecruitmentApplication }
  | null
> {
  const email = (applicantEmail ?? "").trim();
  if (!slug || !email) return null;

  const posting = await getApplyPosting(slug);
  if (!posting) return null;

  // 이메일로 지원자 행 조회. 동일 이메일이 여러 행이면 가장 최근(updated_at) 선택.
  const { data: appRaw, error: aErr } = await supabase
    .from("recruitment_applicants")
    .select("*")
    .eq("email", email)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (aErr) throw new Error(aErr.message);
  if (!appRaw) return null;

  const applicant = normalizeApplicant(appRaw as Record<string, unknown>);

  const { data: rowRaw, error: rErr } = await supabase
    .from("recruitment_applications")
    .select("*")
    .eq("posting_id", posting.id)
    .eq("applicant_id", applicant.id)
    .maybeSingle();
  if (rErr) throw new Error(rErr.message);
  if (!rowRaw) return null;

  return {
    applicant,
    application: normalizeApplication(rowRaw as Record<string, unknown>),
  };
}

// =====================================================================
// 공통 헬퍼
// =====================================================================
type SaveOk = {
  ok: true;
  applicantId: string;
  applicationId: string;
  applicantNumber: string;
};
type SaveErr = { ok: false; message: string };

// 폼 → 행 변환에 쓰는 헬퍼
function strOrNull(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function strOrEmpty(formData: FormData, key: string): string {
  const v = formData.get(key);
  return v == null ? "" : String(v).trim();
}

function boolOn(formData: FormData, key: string): boolean {
  const v = formData.get(key);
  return v === "on" || v === "true";
}

// 지원자 번호 — 전역 unique. 충돌 가능성 매우 낮음(타임스탬프 base36 + 4자리 난수).
function generateApplicantNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0");
  return `A-${ts}-${rnd}`;
}

// 폼에서 지원자 입력값을 뽑아 row 모양으로 만듭니다.
//   * draft 단계는 필수값을 최소화(이메일만 강제).
//   * submitted 단계는 호출 쪽에서 별도 검증.
function buildApplicantRow(formData: FormData): Record<string, unknown> {
  const genderRaw = strOrNull(formData, "gender");
  const gender =
    genderRaw === "M" || genderRaw === "F" ? genderRaw : null;

  const education = parseEducationInput(strOrNull(formData, "education"));
  const licenses = parseLicenseInput(strOrNull(formData, "licenses"));
  const career = parseCareerInput(strOrNull(formData, "career"));
  const awards = parseAwardInput(strOrNull(formData, "awards"));
  const trainings = parseTrainingInput(strOrNull(formData, "trainings"));

  return {
    name: strOrNull(formData, "name") ?? "",
    birth_date: strOrNull(formData, "birth_date"),
    gender,
    address: strOrNull(formData, "address"),
    email: strOrNull(formData, "email") ?? "",
    phone: strOrNull(formData, "phone") ?? "",
    education,
    licenses,
    career,
    awards,
    trainings,
    motivation: strOrNull(formData, "motivation"),
    self_development: strOrNull(formData, "self_development"),
    career_summary: strOrNull(formData, "career_summary"),
    philosophy: strOrNull(formData, "philosophy"),
    agreed_privacy: boolOn(formData, "agreed_privacy"),
    agreed_criminal_check: boolOn(formData, "agreed_criminal_check"),
    agreed_truth: boolOn(formData, "agreed_truth"),
    updated_at: new Date().toISOString(),
  };
}

// posting 조회 + 마감/제출 상태 검증. 통과하면 posting 반환.
async function loadOpenPosting(slug: string): Promise<ApplyPosting> {
  const posting = await getApplyPosting(slug);
  if (!posting) throw new Error("공고를 찾을 수 없습니다.");
  if (new Date(posting.application_end).getTime() < Date.now()) {
    throw new Error("접수가 마감된 공고입니다.");
  }
  return posting;
}

// 기존에 같은 공고로 제출 완료된 지원서가 있는지 확인.
async function findExistingApplication(
  postingId: string,
  applicantId: string
): Promise<RecruitmentApplication | null> {
  const { data, error } = await supabase
    .from("recruitment_applications")
    .select("*")
    .eq("posting_id", postingId)
    .eq("applicant_id", applicantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return normalizeApplication(data as Record<string, unknown>);
}

// =====================================================================
// 임시저장 — 어느 탭에서든 호출 가능. 필수값은 이메일만 강제합니다.
// =====================================================================
export async function saveApplicationDraft(
  slug: string,
  formData: FormData
): Promise<SaveOk | SaveErr> {
  try {
    const posting = await loadOpenPosting(slug);

    const email = strOrNull(formData, "email");
    if (!email) {
      return { ok: false, message: "이메일을 먼저 입력해주세요." };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, message: "이메일 형식이 올바르지 않습니다." };
    }

    // 기존 applicant 식별 — 폼의 hidden applicant_id 우선, 없으면 이메일로 조회.
    const givenApplicantId = strOrNull(formData, "applicant_id");
    let applicantId = givenApplicantId;
    let applicantNumber: string | null = null;

    if (!applicantId) {
      const { data: found, error: fErr } = await supabase
        .from("recruitment_applicants")
        .select("id, applicant_number")
        .eq("email", email)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (fErr) throw new Error(fErr.message);
      if (found) {
        applicantId = String((found as { id: unknown }).id);
        applicantNumber = String(
          (found as { applicant_number: unknown }).applicant_number
        );
      }
    } else {
      const { data: existing, error: exErr } = await supabase
        .from("recruitment_applicants")
        .select("applicant_number")
        .eq("id", applicantId)
        .maybeSingle();
      if (exErr) throw new Error(exErr.message);
      if (existing) {
        applicantNumber = String(
          (existing as { applicant_number: unknown }).applicant_number
        );
      }
    }

    // 이미 같은 공고에 제출 완료된 상태면 임시저장 불가.
    if (applicantId) {
      const existing = await findExistingApplication(posting.id, applicantId);
      if (existing && existing.status !== "draft") {
        return {
          ok: false,
          message: "이미 접수 완료된 지원서는 수정할 수 없습니다.",
        };
      }
    }

    const row = buildApplicantRow(formData);

    if (applicantId) {
      const { error: upErr } = await supabase
        .from("recruitment_applicants")
        .update(row)
        .eq("id", applicantId);
      if (upErr) throw new Error(upErr.message);
    } else {
      applicantNumber = generateApplicantNumber();
      const { data: inserted, error: insErr } = await supabase
        .from("recruitment_applicants")
        .insert({ ...row, applicant_number: applicantNumber })
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);
      applicantId = String((inserted as { id: unknown }).id);
    }

    // recruitment_applications upsert(draft).
    const { data: appRow, error: appErr } = await supabase
      .from("recruitment_applications")
      .upsert(
        {
          posting_id: posting.id,
          applicant_id: applicantId,
          status: "draft",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "posting_id,applicant_id" }
      )
      .select("id")
      .single();
    if (appErr) throw new Error(appErr.message);
    const applicationId = String((appRow as { id: unknown }).id);

    revalidatePath(`/recruitment/${slug}/apply`);
    return {
      ok: true,
      applicantId,
      applicationId,
      applicantNumber: applicantNumber ?? "",
    };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 최종 제출 — 탭 9 동의 확인 후 호출.
//   * 필수 입력값(이름/생년월일/연락처/이메일) 및 필수 첨부서류 검증.
//   * 동의 3종 모두 true 여야 통과.
//   * 마감 시각 지났으면 거부.
// =====================================================================
export async function submitApplication(
  slug: string,
  formData: FormData
): Promise<SaveOk | SaveErr> {
  try {
    const posting = await loadOpenPosting(slug);

    const email = strOrNull(formData, "email");
    const name = strOrNull(formData, "name");
    const birth_date = strOrNull(formData, "birth_date");
    const phone = strOrNull(formData, "phone");

    if (!email) return { ok: false, message: "이메일을 입력해주세요." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, message: "이메일 형식이 올바르지 않습니다." };
    }
    if (!name) return { ok: false, message: "이름을 입력해주세요." };
    if (!birth_date)
      return { ok: false, message: "생년월일을 입력해주세요." };
    if (!phone) return { ok: false, message: "연락처를 입력해주세요." };

    const agreedPrivacy = boolOn(formData, "agreed_privacy");
    const agreedCriminal = boolOn(formData, "agreed_criminal_check");
    const agreedTruth = boolOn(formData, "agreed_truth");
    if (!agreedPrivacy || !agreedCriminal || !agreedTruth) {
      return { ok: false, message: "모든 동의 항목에 체크해주세요." };
    }

    // 임시저장과 동일한 흐름으로 applicant upsert.
    const givenApplicantId = strOrNull(formData, "applicant_id");
    let applicantId = givenApplicantId;
    let applicantNumber: string | null = null;

    if (!applicantId) {
      const { data: found, error: fErr } = await supabase
        .from("recruitment_applicants")
        .select("id, applicant_number")
        .eq("email", email)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (fErr) throw new Error(fErr.message);
      if (found) {
        applicantId = String((found as { id: unknown }).id);
        applicantNumber = String(
          (found as { applicant_number: unknown }).applicant_number
        );
      }
    } else {
      const { data: existing, error: exErr } = await supabase
        .from("recruitment_applicants")
        .select("applicant_number, documents")
        .eq("id", applicantId)
        .maybeSingle();
      if (exErr) throw new Error(exErr.message);
      if (existing) {
        applicantNumber = String(
          (existing as { applicant_number: unknown }).applicant_number
        );
      }
    }

    // 이미 제출 완료 상태면 거부.
    if (applicantId) {
      const existing = await findExistingApplication(posting.id, applicantId);
      if (existing && existing.status !== "draft") {
        return {
          ok: false,
          message: "이미 접수 완료된 지원서입니다.",
        };
      }
    }

    const row = buildApplicantRow(formData);

    if (applicantId) {
      const { error: upErr } = await supabase
        .from("recruitment_applicants")
        .update(row)
        .eq("id", applicantId);
      if (upErr) throw new Error(upErr.message);
    } else {
      applicantNumber = generateApplicantNumber();
      const { data: inserted, error: insErr } = await supabase
        .from("recruitment_applicants")
        .insert({ ...row, applicant_number: applicantNumber })
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);
      applicantId = String((inserted as { id: unknown }).id);
    }

    // 필수 첨부서류 검증 — 저장된 documents 확인.
    const { data: docRow, error: dErr } = await supabase
      .from("recruitment_applicants")
      .select("documents")
      .eq("id", applicantId)
      .maybeSingle();
    if (dErr) throw new Error(dErr.message);
    const documents = normalizeDocuments(
      (docRow as { documents?: unknown } | null)?.documents
    );

    const missingDocs = posting.required_documents
      .filter((d) => d.required && !documents[d.key])
      .map((d) => d.label);
    if (missingDocs.length > 0) {
      return {
        ok: false,
        message: `필수 첨부서류가 누락되었습니다: ${missingDocs.join(", ")}`,
      };
    }

    // applications 행을 submitted 로 업데이트.
    const { data: appRow, error: appErr } = await supabase
      .from("recruitment_applications")
      .upsert(
        {
          posting_id: posting.id,
          applicant_id: applicantId,
          status: "submitted",
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "posting_id,applicant_id" }
      )
      .select("id")
      .single();
    if (appErr) throw new Error(appErr.message);
    const applicationId = String((appRow as { id: unknown }).id);

    revalidatePath(`/recruitment/${slug}/apply`);
    return {
      ok: true,
      applicantId,
      applicationId,
      applicantNumber: applicantNumber ?? "",
    };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "제출 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 증명사진 업로드 — 첫 임시저장 이후(applicant_id 확보 후) 사용.
//   * formData: slug, applicant_id, photo
// =====================================================================
const APPLICANT_PHOTO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const APPLICANT_DOC_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export async function uploadApplicantPhoto(
  formData: FormData
): Promise<
  { ok: true; photoUrl: string | null } | { ok: false; message: string }
> {
  try {
    const slug = strOrNull(formData, "slug");
    const applicantId = strOrNull(formData, "applicant_id");
    if (!slug) throw new Error("공고 정보가 누락되었습니다.");
    if (!applicantId)
      throw new Error(
        "사진을 업로드하려면 먼저 임시저장으로 지원자 정보를 등록해주세요."
      );

    const posting = await loadOpenPosting(slug);

    const file = formData.get("photo");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("업로드할 사진을 선택해주세요.");
    }
    if (file.size > 8 * 1024 * 1024) {
      throw new Error("사진 용량은 8MB 이하여야 합니다.");
    }
    const ext = APPLICANT_PHOTO_EXT[file.type];
    if (!ext) throw new Error("JPG, PNG, WEBP 이미지만 업로드할 수 있습니다.");

    // 이미 제출 완료된 지원서는 수정 불가.
    const existing = await findExistingApplication(posting.id, applicantId);
    if (existing && existing.status !== "draft") {
      throw new Error("이미 접수 완료된 지원서는 수정할 수 없습니다.");
    }

    // 기존 사진 경로 보관(삭제용).
    const { data: prev, error: pErr } = await supabase
      .from("recruitment_applicants")
      .select("photo_url")
      .eq("id", applicantId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    const oldPath =
      ((prev as { photo_url?: unknown } | null)?.photo_url as
        | string
        | null) ?? null;

    const newPath = `recruitment/${posting.id}/${applicantId}/photo.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(HR_DOCUMENTS_BUCKET)
      .upload(newPath, file, { contentType: file.type, upsert: true });
    if (upErr) throw new Error(`사진 업로드 실패: ${upErr.message}`);

    const { error: dbErr } = await supabase
      .from("recruitment_applicants")
      .update({
        photo_url: newPath,
        updated_at: new Date().toISOString(),
      })
      .eq("id", applicantId);
    if (dbErr) throw new Error(dbErr.message);

    if (oldPath && oldPath !== newPath) {
      await removeHrDocuments([oldPath]);
    }

    revalidatePath(`/recruitment/${slug}/apply`);
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

export async function deleteApplicantPhoto(
  slug: string,
  applicantId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    if (!slug || !applicantId) throw new Error("요청 정보가 누락되었습니다.");
    const posting = await loadOpenPosting(slug);
    const existing = await findExistingApplication(posting.id, applicantId);
    if (existing && existing.status !== "draft") {
      throw new Error("이미 접수 완료된 지원서는 수정할 수 없습니다.");
    }

    const { data: prev, error: pErr } = await supabase
      .from("recruitment_applicants")
      .select("photo_url")
      .eq("id", applicantId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    const oldPath =
      ((prev as { photo_url?: unknown } | null)?.photo_url as
        | string
        | null) ?? null;

    const { error: dbErr } = await supabase
      .from("recruitment_applicants")
      .update({
        photo_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", applicantId);
    if (dbErr) throw new Error(dbErr.message);

    if (oldPath) await removeHrDocuments([oldPath]);
    revalidatePath(`/recruitment/${slug}/apply`);
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
// 첨부서류 업로드 — formData: slug, applicant_id, doc_key, file
//   * documents jsonb 의 {doc_key: path} 매핑을 갱신합니다.
// =====================================================================
export async function uploadApplicantDocument(
  formData: FormData
): Promise<
  | { ok: true; docKey: string; signedUrl: string | null }
  | { ok: false; message: string }
> {
  try {
    const slug = strOrNull(formData, "slug");
    const applicantId = strOrNull(formData, "applicant_id");
    const docKey = strOrNull(formData, "doc_key");
    if (!slug) throw new Error("공고 정보가 누락되었습니다.");
    if (!applicantId)
      throw new Error(
        "서류를 업로드하려면 먼저 임시저장으로 지원자 정보를 등록해주세요."
      );
    if (!docKey) throw new Error("서류 종류가 지정되지 않았습니다.");

    const posting = await loadOpenPosting(slug);

    // docKey 가 공고의 required_documents 에 정의된 항목인지 확인.
    const validKey = posting.required_documents.some((d) => d.key === docKey);
    if (!validKey) throw new Error("허용되지 않은 서류 종류입니다.");

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("업로드할 파일을 선택해주세요.");
    }
    if (file.size > 16 * 1024 * 1024) {
      throw new Error("파일 용량은 16MB 이하여야 합니다.");
    }
    const ext = APPLICANT_DOC_EXT[file.type];
    if (!ext)
      throw new Error("PDF, JPG, PNG, WEBP 형식만 업로드할 수 있습니다.");

    const existing = await findExistingApplication(posting.id, applicantId);
    if (existing && existing.status !== "draft") {
      throw new Error("이미 접수 완료된 지원서는 수정할 수 없습니다.");
    }

    // 기존 path 확보(확장자가 다르면 새 경로로 교체되므로 옛 파일 정리).
    const { data: prev, error: pErr } = await supabase
      .from("recruitment_applicants")
      .select("documents")
      .eq("id", applicantId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    const prevDocs = normalizeDocuments(
      (prev as { documents?: unknown } | null)?.documents
    );
    const oldPath = prevDocs[docKey] ?? null;

    const newPath = `recruitment/${posting.id}/${applicantId}/${docKey}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(HR_DOCUMENTS_BUCKET)
      .upload(newPath, file, { contentType: file.type, upsert: true });
    if (upErr) throw new Error(`업로드 실패: ${upErr.message}`);

    const nextDocs = { ...prevDocs, [docKey]: newPath };
    const { error: dbErr } = await supabase
      .from("recruitment_applicants")
      .update({
        documents: nextDocs,
        updated_at: new Date().toISOString(),
      })
      .eq("id", applicantId);
    if (dbErr) throw new Error(dbErr.message);

    if (oldPath && oldPath !== newPath) {
      await removeHrDocuments([oldPath]);
    }

    revalidatePath(`/recruitment/${slug}/apply`);
    return {
      ok: true,
      docKey,
      signedUrl: await signHrDocument(newPath),
    };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "업로드 중 오류가 발생했습니다.",
    };
  }
}

export async function deleteApplicantDocument(
  slug: string,
  applicantId: string,
  docKey: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    if (!slug || !applicantId || !docKey)
      throw new Error("요청 정보가 누락되었습니다.");
    const posting = await loadOpenPosting(slug);

    const existing = await findExistingApplication(posting.id, applicantId);
    if (existing && existing.status !== "draft") {
      throw new Error("이미 접수 완료된 지원서는 수정할 수 없습니다.");
    }

    const { data: prev, error: pErr } = await supabase
      .from("recruitment_applicants")
      .select("documents")
      .eq("id", applicantId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    const prevDocs = normalizeDocuments(
      (prev as { documents?: unknown } | null)?.documents
    );
    const oldPath = prevDocs[docKey] ?? null;
    if (!oldPath) return { ok: true };

    const nextDocs = { ...prevDocs };
    delete nextDocs[docKey];

    const { error: dbErr } = await supabase
      .from("recruitment_applicants")
      .update({
        documents: nextDocs,
        updated_at: new Date().toISOString(),
      })
      .eq("id", applicantId);
    if (dbErr) throw new Error(dbErr.message);

    await removeHrDocuments([oldPath]);
    revalidatePath(`/recruitment/${slug}/apply`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "서류 삭제 중 오류가 발생했습니다.",
    };
  }
}

// 임시 열람 URL 발급 — 클라이언트에서 photo/documents 미리보기에 사용.
export async function signApplicantStoragePath(
  path: string | null
): Promise<string | null> {
  return signHrDocument(path);
}
