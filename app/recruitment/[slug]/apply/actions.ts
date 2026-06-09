"use server";

import { cookies } from "next/headers";
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
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// =====================================================================
// 채용 지원 — 외부 지원자가 채용 공고에 직접 접수하는 흐름
//   * 본인 확인 — 카카오 로그인(kakao_id). 이메일은 연락처로만 사용.
//   * 임시저장 → 첨부서류 업로드 → 동의 → 최종 제출 순서.
//   * 첨부서류는 hr-documents Private 버킷의
//     recruitment/{posting_id}/{applicant_id}/ 경로에 저장됩니다.
// =====================================================================

// 카카오 세션 쿠키 — /api/auth/kakao/callback 에서 세팅.
const KAKAO_ID_COOKIE = "kakao_id";
const KAKAO_NICKNAME_COOKIE = "kakao_nickname";

export type KakaoSession = {
  kakaoId: string;
  nickname: string;
};

export async function getKakaoSession(): Promise<KakaoSession | null> {
  const store = await cookies();
  const id = store.get(KAKAO_ID_COOKIE)?.value;
  if (!id) return null;
  return {
    kakaoId: id,
    nickname: store.get(KAKAO_NICKNAME_COOKIE)?.value ?? "",
  };
}

export async function logoutKakao(): Promise<void> {
  const store = await cookies();
  store.delete(KAKAO_ID_COOKIE);
  store.delete(KAKAO_NICKNAME_COOKIE);
}

async function requireKakaoId(): Promise<string> {
  const s = await getKakaoSession();
  if (!s) throw new Error("카카오 로그인이 필요합니다.");
  return s.kakaoId;
}

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
  application_start: string;
  application_end: string;
  status: string;
  // 제출 서류 5종 필수/선택 — recruitment_postings.required_documents jsonb 그대로.
  required_documents: RequiredDoc[];
};

// 외부 지원자
export type RecruitmentApplicant = {
  id: string;
  applicant_number: string;
  kakao_id: string | null;
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
  consent_signature: string | null;
  consent_signature_type: "drawn" | "typed" | null;
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
    kakao_id: (raw.kakao_id as string | null) ?? null,
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
    consent_signature: (raw.consent_signature as string | null) ?? null,
    consent_signature_type:
      raw.consent_signature_type === "drawn" ||
      raw.consent_signature_type === "typed"
        ? raw.consent_signature_type
        : null,
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
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as Record<string, unknown>;

  // 제출 서류 필수/선택은 required_documents jsonb 의 값(목록형)을 그대로 사용.
  const requiredDocuments = normalizeRequiredDocs(r.required_documents);

  return {
    id: String(r.id ?? ""),
    slug: String(r.slug ?? ""),
    title: String(r.title ?? ""),
    field: String(r.field ?? ""),
    application_start: String(r.application_start ?? ""),
    application_end: String(r.application_end ?? ""),
    status: String(r.status ?? ""),
    required_documents: requiredDocuments,
  };
}

// =====================================================================
// 임시저장 지원서 조회 — 카카오 세션의 kakao_id 로 본인 행을 찾습니다.
//   * 같은 사람이 여러 공고에 지원해도 applicant 행은 1개(kakao_id unique).
//   * 공고별 application 행은 별도 — 본 공고와 매칭되는 것만 반환합니다.
//   * application 이 없으면 applicant 만 로드(applicant 만 있어도 폼 자동 채움).
// =====================================================================
export async function getApplicationDraft(
  slug: string
): Promise<
  | { applicant: RecruitmentApplicant; application: RecruitmentApplication | null }
  | null
> {
  const session = await getKakaoSession();
  if (!session || !slug) return null;

  const posting = await getApplyPosting(slug);
  if (!posting) return null;

  const { data: appRaw, error: aErr } = await supabaseAdmin
    .from("recruitment_applicants")
    .select("*")
    .eq("kakao_id", session.kakaoId)
    .maybeSingle();
  if (aErr) throw new Error(aErr.message);
  if (!appRaw) return null;

  const applicant = normalizeApplicant(appRaw as Record<string, unknown>);

  const { data: rowRaw, error: rErr } = await supabaseAdmin
    .from("recruitment_applications")
    .select("*")
    .eq("posting_id", posting.id)
    .eq("applicant_id", applicant.id)
    .maybeSingle();
  if (rErr) throw new Error(rErr.message);

  return {
    applicant,
    application: rowRaw
      ? normalizeApplication(rowRaw as Record<string, unknown>)
      : null,
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

// 동의 스냅샷(consent_snapshot) 파싱 — 클라이언트가 만든 JSON 을 그대로 받아
//   kakao_id 만 서버 세션 값으로 덮어씁니다(클라이언트는 kakao_id 를 모름).
//   형식이 깨졌으면 null 로 떨어뜨려 저장하지 않습니다.
function parseConsentSnapshot(
  raw: string | null,
  kakaoId: string | null
): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const applicant =
      obj.applicant != null &&
      typeof obj.applicant === "object" &&
      !Array.isArray(obj.applicant)
        ? (obj.applicant as Record<string, unknown>)
        : {};
    return { ...obj, applicant: { ...applicant, kakao_id: kakaoId } };
  } catch {
    return null;
  }
}

// 폼에서 지원자 입력값을 뽑아 row 모양으로 만듭니다.
//   * draft / submit 공통 사용. 미입력 텍스트 필드는 null 로 둡니다.
//   * draft 는 어떤 필드도 필수 아님 — 호출 쪽에서 별도 검증 없음.
//   * submit 은 호출 쪽에서 필수값(이름·생년월일·이메일·전화·동의 3종) 사전 검증.
//   * 따라서 컬럼 NOT NULL 제약은 DB 에서 해제되어 있어야 합니다.
//   * 동의 서명/스냅샷은 입력돼 있을 때만 채웁니다(서명 시각 = 저장 시각).
function buildApplicantRow(
  formData: FormData,
  kakaoId: string | null
): Record<string, unknown> {
  const genderRaw = strOrNull(formData, "gender");
  const gender =
    genderRaw === "M" || genderRaw === "F" ? genderRaw : null;

  const education = parseEducationInput(strOrNull(formData, "education"));
  const licenses = parseLicenseInput(strOrNull(formData, "licenses"));
  const career = parseCareerInput(strOrNull(formData, "career"));
  const awards = parseAwardInput(strOrNull(formData, "awards"));
  const trainings = parseTrainingInput(strOrNull(formData, "trainings"));

  const consentSignature = strOrNull(formData, "consent_signature");
  const consentTypeRaw = strOrNull(formData, "consent_signature_type");
  const consentSignatureType =
    consentTypeRaw === "drawn" || consentTypeRaw === "typed"
      ? consentTypeRaw
      : null;
  const consentSnapshot = parseConsentSnapshot(
    strOrNull(formData, "consent_snapshot"),
    kakaoId
  );

  return {
    name: strOrNull(formData, "name"),
    birth_date: strOrNull(formData, "birth_date"),
    gender,
    address: strOrNull(formData, "address"),
    email: strOrNull(formData, "email"),
    phone: strOrNull(formData, "phone"),
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
    consent_signature: consentSignature,
    consent_signature_type: consentSignatureType,
    consent_snapshot: consentSnapshot,
    // 서명이 들어온 경우에만 동의 시각을 기록(제출 시 = 제출 시각).
    consent_at: consentSignature ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
}

// posting 조회 + 접수 기간(시작 전/마감) 검증. 통과하면 posting 반환.
//   * 클라이언트 우회로 기간 밖 지원·임시저장·업로드가 들어와도 서버에서 차단.
async function loadOpenPosting(slug: string): Promise<ApplyPosting> {
  const posting = await getApplyPosting(slug);
  if (!posting) throw new Error("공고를 찾을 수 없습니다.");
  const now = Date.now();
  if (new Date(posting.application_start).getTime() > now) {
    throw new Error("아직 접수 기간이 아닙니다.");
  }
  if (new Date(posting.application_end).getTime() < now) {
    throw new Error("접수가 마감된 공고입니다.");
  }
  return posting;
}

// 기존에 같은 공고로 제출 완료된 지원서가 있는지 확인.
async function findExistingApplication(
  postingId: string,
  applicantId: string
): Promise<RecruitmentApplication | null> {
  const { data, error } = await supabaseAdmin
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
// 임시저장 — 어느 탭에서든 호출 가능. 어떤 필드도 필수 아님.
//   * 본인 확인은 카카오 세션으로만 강제(인증 게이트).
//   * 입력값 검증은 submit 에서만. 여기서는 들어온 값 그대로 저장.
// =====================================================================
export async function saveApplicationDraft(
  slug: string,
  formData: FormData
): Promise<SaveOk | SaveErr> {
  try {
    const posting = await loadOpenPosting(slug);
    const kakaoId = await requireKakaoId();

    // applicant 행 식별 — kakao_id 로만 조회(폼의 applicant_id 는 신뢰하지 않음).
    let applicantId: string | null = null;
    let applicantNumber: string | null = null;

    const { data: found, error: fErr } = await supabaseAdmin
      .from("recruitment_applicants")
      .select("id, applicant_number")
      .eq("kakao_id", kakaoId)
      .maybeSingle();
    if (fErr) throw new Error(fErr.message);
    if (found) {
      applicantId = String((found as { id: unknown }).id);
      applicantNumber = String(
        (found as { applicant_number: unknown }).applicant_number
      );
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

    const row = buildApplicantRow(formData, kakaoId);

    if (applicantId) {
      const { error: upErr } = await supabaseAdmin
        .from("recruitment_applicants")
        .update(row)
        .eq("id", applicantId);
      if (upErr) throw new Error(upErr.message);
    } else {
      applicantNumber = generateApplicantNumber();
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("recruitment_applicants")
        .insert({
          ...row,
          applicant_number: applicantNumber,
          kakao_id: kakaoId,
        })
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);
      applicantId = String((inserted as { id: unknown }).id);
    }

    // recruitment_applications upsert(draft).
    const { data: appRow, error: appErr } = await supabaseAdmin
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
    const kakaoId = await requireKakaoId();

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

    // applicant 식별 — kakao_id 로만 조회.
    let applicantId: string | null = null;
    let applicantNumber: string | null = null;

    const { data: found, error: fErr } = await supabaseAdmin
      .from("recruitment_applicants")
      .select("id, applicant_number")
      .eq("kakao_id", kakaoId)
      .maybeSingle();
    if (fErr) throw new Error(fErr.message);
    if (found) {
      applicantId = String((found as { id: unknown }).id);
      applicantNumber = String(
        (found as { applicant_number: unknown }).applicant_number
      );
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

    const row = buildApplicantRow(formData, kakaoId);

    if (applicantId) {
      const { error: upErr } = await supabaseAdmin
        .from("recruitment_applicants")
        .update(row)
        .eq("id", applicantId);
      if (upErr) throw new Error(upErr.message);
    } else {
      applicantNumber = generateApplicantNumber();
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("recruitment_applicants")
        .insert({
          ...row,
          applicant_number: applicantNumber,
          kakao_id: kakaoId,
        })
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);
      applicantId = String((inserted as { id: unknown }).id);
    }

    // 필수 첨부서류 검증 — 저장된 documents 확인.
    const { data: docRow, error: dErr } = await supabaseAdmin
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
    const { data: appRow, error: appErr } = await supabaseAdmin
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
    const { data: prev, error: pErr } = await supabaseAdmin
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

    const { error: dbErr } = await supabaseAdmin
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

    const { data: prev, error: pErr } = await supabaseAdmin
      .from("recruitment_applicants")
      .select("photo_url")
      .eq("id", applicantId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    const oldPath =
      ((prev as { photo_url?: unknown } | null)?.photo_url as
        | string
        | null) ?? null;

    const { error: dbErr } = await supabaseAdmin
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
    const { data: prev, error: pErr } = await supabaseAdmin
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
    const { error: dbErr } = await supabaseAdmin
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

    const { data: prev, error: pErr } = await supabaseAdmin
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

    const { error: dbErr } = await supabaseAdmin
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
