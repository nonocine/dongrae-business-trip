"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { sendSlack, siteBaseUrl, slackLink } from "@/lib/slack";
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
import { verifyPayload } from "@/lib/signedCookie";
import { applicantNumberLast4 } from "@/lib/applicantNumber";
import { sendPlainMail, isMailerConfigured } from "@/lib/mailer";
import {
  APPLICANT_DOC_MAX,
  APPLICANT_DOC_TYPES,
  APPLICANT_PHOTO_MAX,
  APPLICANT_PHOTO_TYPES,
  applicantStoragePath,
  canSignApplicantPath,
  checkApplicantFile,
  isSafeSlot,
  resolveOwnApplicant,
  type ApplicantFileKind,
} from "@/lib/applicantUpload";

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

// 카카오 세션 — kakao_id 쿠키는 HMAC 서명본만 신뢰합니다(SEC-3a 패턴).
//   * 서명이 없거나 어긋나면 미로그인으로 취급합니다. 무서명 폴백은 두지 않습니다
//     — 폴백이 있으면 서명을 떼고 보내는 것만으로 우회되어 의미가 없습니다.
//   * 배포 시점의 기존 카카오 로그인은 무효가 되어 재로그인이 필요합니다.
export async function getKakaoSession(): Promise<KakaoSession | null> {
  const store = await cookies();
  const parsed = verifyPayload<{ kakaoId?: unknown }>(
    store.get(KAKAO_ID_COOKIE)?.value
  );
  const id = typeof parsed?.kakaoId === "string" ? parsed.kakaoId : "";
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
// 접수완료 안내 메일 — 지원자 본인에게. 접수번호(특히 뒷 4자리)를 알려주는 것이
//   주목적입니다. 대외 공고는 뒷 4자리로만 본인을 표기하기 때문입니다.
//   * export 하지 않는 내부 헬퍼("use server" 파일은 async export 만 허용).
//   * 호출처에서 try/catch 로 감싸 실패를 격리합니다.
// =====================================================================
async function sendApplicationReceiptMail(input: {
  to: string | null;
  applicantName: string;
  applicantNumber: string;
  postingTitle: string;
  postingField: string;
  slug: string;
}): Promise<void> {
  const to = (input.to ?? "").trim();
  // 이메일이 없거나 발송 설정이 없으면 조용히 건너뜁니다(에러 아님).
  if (!to || !isMailerConfigured()) return;

  const last4 = applicantNumberLast4(input.applicantNumber);
  const base = siteBaseUrl();
  const applyUrl = base ? `${base}/recruitment/${input.slug}/apply` : "";

  // null = 값이 없어 생략할 줄, "" = 의도한 빈 줄.
  const lines: (string | null)[] = [
    `${input.applicantName}님, 지원서 접수가 정상적으로 완료되었습니다.`,
    "",
    `[지원 공고] ${input.postingTitle}`,
    input.postingField ? `[모집 분야] ${input.postingField}` : null,
    "",
    "────────────────────────",
    `접수번호 뒷 4자리 :  ${last4}`,
    "────────────────────────",
    `전체 접수번호 : ${input.applicantNumber}`,
    "",
    "면접 대상자 공고와 최종 합격자 공고에는 응시자 보호를 위해 성명 일부와",
    `접수번호를 비공개 처리합니다. 본인 여부는 위 접수번호 뒷 4자리(${last4})로`,
    "확인해 주시기 바랍니다.",
    "",
    "접수가 마감된 뒤에도 채용 절차가 끝나기 전까지는, 지원 당시 사용하신",
    "카카오 계정으로 로그인하시면 제출한 지원서를 다시 확인하실 수 있습니다.",
    applyUrl || null,
    "",
    "본 메일은 발신 전용입니다.",
    "동래구청소년센터",
  ];

  await sendPlainMail({
    to,
    subject: `[동래구청소년센터] 지원서 접수 완료 (접수번호 뒷 4자리 ${last4})`,
    text: lines.filter((l): l is string => l !== null).join("\n"),
  });
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

    // 지원자 접수완료 메일(부가기능) — 슬랙 알림과 같은 원칙으로 완전 격리합니다.
    //   * 발송 실패·미설정은 로그만 남기고 제출은 성공 처리합니다.
    //   * 이 지점은 draft → submitted 전이에서만 도달합니다(위에서 이미 제출된
    //     건은 return 으로 차단) → 중복 발송이 발생하지 않습니다.
    try {
      await sendApplicationReceiptMail({
        to: email,
        applicantName: name,
        applicantNumber: applicantNumber ?? "",
        postingTitle: posting.title,
        postingField: posting.field,
        slug,
      });
    } catch (mailErr) {
      console.warn(
        "[mail] 접수완료 안내 발송 실패:",
        mailErr instanceof Error ? mailErr.message : mailErr
      );
    }

    // 관리자 채널 알림(부가기능) — 실패해도 지원 제출에는 절대 영향 없게 완전 격리.
    //   (지원자 입장에서 제출이 막히면 안 됨이 최우선)
    try {
      const { count } = await supabaseAdmin
        .from("recruitment_applications")
        .select("id", { count: "exact", head: true })
        .eq("posting_id", posting.id)
        .neq("status", "draft");
      const base = siteBaseUrl();
      const link = base
        ? `\n${slackLink(`${base}/hr/recruitment/${slug}`, "지원자 목록 보기")}`
        : "";
      await sendSlack(
        "SLACK_WEBHOOK_ADMIN",
        `📥 [${posting.title}] ${name}님 지원 완료 (누적 ${count ?? 0}명)${link}`
      );
    } catch (notifyErr) {
      console.warn(
        "[slack] 지원 완료 알림 실패:",
        notifyErr instanceof Error ? notifyErr.message : notifyErr
      );
    }

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
// 지원자 첨부(사진·서류) — 업로드·삭제·열람
//   * 2026-10: Storage 접근을 service_role 로 옮겼습니다(공개 정책 제거 대비).
//     Storage 가 더 이상 막아 주지 않으므로 모든 액션이 requireOwnDraft 를
//     먼저 통과해야 합니다:
//       · 접수 기간 안의 게시된 공고
//       · 카카오 세션(서명 쿠키) — 지원자 행은 세션의 kakao_id 로만 찾습니다
//       · 폼의 applicant_id 는 세션 지원자와 같은지 대조만(다르면 거부)
//       · 그 공고의 지원서(application)가 실제로 있고 아직 draft
//   * 저장 경로는 서버가 만듭니다 — lib/applicantUpload applicantStoragePath.
//   * 파일은 MIME 과 실제 바이트 시그니처가 모두 맞아야 합니다.
// =====================================================================

type OwnDraft = {
  posting: ApplyPosting;
  applicantId: string;
  photoPath: string | null;
  documents: Record<string, string>;
};

async function requireOwnDraft(
  slug: string | null,
  clientApplicantId: string | null
): Promise<OwnDraft> {
  if (!slug) throw new Error("공고 정보가 누락되었습니다.");
  const posting = await loadOpenPosting(slug);
  const kakaoId = await requireKakaoId();

  const { data: me, error } = await supabaseAdmin
    .from("recruitment_applicants")
    .select("id, photo_url, documents")
    .eq("kakao_id", kakaoId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = me as { id?: unknown; photo_url?: unknown; documents?: unknown } | null;
  const own = resolveOwnApplicant(row?.id ? String(row.id) : null, clientApplicantId);
  if (!own.ok) throw new Error(own.message);

  const application = await findExistingApplication(posting.id, own.applicantId);
  if (!application)
    throw new Error("먼저 임시저장으로 이 공고의 지원서를 만들어주세요.");
  if (application.status !== "draft")
    throw new Error("이미 접수 완료된 지원서는 수정할 수 없습니다.");

  return {
    posting,
    applicantId: own.applicantId,
    photoPath: typeof row?.photo_url === "string" ? row.photo_url : null,
    documents: normalizeDocuments(row?.documents),
  };
}

async function readApplicantFile(
  formData: FormData,
  field: string,
  allowed: Record<string, ApplicantFileKind>,
  maxBytes: number
): Promise<{ bytes: Uint8Array; type: string; ext: ApplicantFileKind }> {
  const file = formData.get(field);
  if (!(file instanceof File) || file.size === 0) throw new Error("업로드할 파일을 선택해주세요.");
  // 크기를 먼저 본 뒤에 읽습니다(큰 파일을 메모리에 올리지 않게).
  if (file.size > maxBytes)
    throw new Error(`파일 용량은 ${Math.round(maxBytes / 1024 / 1024)}MB 이하여야 합니다.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkApplicantFile(
    { type: file.type, size: bytes.byteLength, head: bytes.subarray(0, 16) },
    allowed,
    maxBytes
  );
  if (!checked.ok) throw new Error(checked.message);
  return { bytes, type: file.type, ext: checked.ext };
}

// 증명사진 업로드 — formData: slug, applicant_id(대조용), photo
export async function uploadApplicantPhoto(
  formData: FormData
): Promise<
  { ok: true; photoUrl: string | null } | { ok: false; message: string }
> {
  try {
    const own = await requireOwnDraft(
      strOrNull(formData, "slug"),
      strOrNull(formData, "applicant_id")
    );
    const f = await readApplicantFile(formData, "photo", APPLICANT_PHOTO_TYPES, APPLICANT_PHOTO_MAX);

    const oldPath = own.photoPath;
    const newPath = applicantStoragePath(own.posting.id, own.applicantId, "photo", f.ext);
    const { error: upErr } = await supabaseAdmin.storage
      .from(HR_DOCUMENTS_BUCKET)
      .upload(newPath, f.bytes, { contentType: f.type, upsert: true });
    if (upErr) throw new Error(`사진 업로드 실패: ${upErr.message}`);

    const { error: dbErr } = await supabaseAdmin
      .from("recruitment_applicants")
      .update({
        photo_url: newPath,
        updated_at: new Date().toISOString(),
      })
      .eq("id", own.applicantId);
    if (dbErr) throw new Error(dbErr.message);

    // 옛 파일 정리 — 본인 폴더의 파일일 때만.
    if (oldPath && oldPath !== newPath && canSignApplicantPath(oldPath, own)) {
      await removeHrDocuments([oldPath]);
    }

    revalidatePath(`/recruitment/${own.posting.slug}/apply`);
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
    const own = await requireOwnDraft(slug || null, applicantId || null);
    const oldPath = own.photoPath;

    const { error: dbErr } = await supabaseAdmin
      .from("recruitment_applicants")
      .update({
        photo_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", own.applicantId);
    if (dbErr) throw new Error(dbErr.message);

    if (oldPath && canSignApplicantPath(oldPath, own)) await removeHrDocuments([oldPath]);
    revalidatePath(`/recruitment/${own.posting.slug}/apply`);
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
// 첨부서류 업로드 — formData: slug, applicant_id(대조용), doc_key, file
//   * documents jsonb 의 {doc_key: path} 매핑을 갱신합니다.
// =====================================================================
export async function uploadApplicantDocument(
  formData: FormData
): Promise<
  | { ok: true; docKey: string; signedUrl: string | null }
  | { ok: false; message: string }
> {
  try {
    const own = await requireOwnDraft(
      strOrNull(formData, "slug"),
      strOrNull(formData, "applicant_id")
    );
    const docKey = strOrNull(formData, "doc_key");
    if (!docKey) throw new Error("서류 종류가 지정되지 않았습니다.");
    // 공고의 required_documents 에 정의된 항목이고, 경로에 써도 안전한 글자인지.
    if (!own.posting.required_documents.some((d) => d.key === docKey) || !isSafeSlot(docKey))
      throw new Error("허용되지 않은 서류 종류입니다.");

    const f = await readApplicantFile(formData, "file", APPLICANT_DOC_TYPES, APPLICANT_DOC_MAX);

    const oldPath = own.documents[docKey] ?? null;
    const newPath = applicantStoragePath(own.posting.id, own.applicantId, docKey, f.ext);
    const { error: upErr } = await supabaseAdmin.storage
      .from(HR_DOCUMENTS_BUCKET)
      .upload(newPath, f.bytes, { contentType: f.type, upsert: true });
    if (upErr) throw new Error(`업로드 실패: ${upErr.message}`);

    const nextDocs = { ...own.documents, [docKey]: newPath };
    const { error: dbErr } = await supabaseAdmin
      .from("recruitment_applicants")
      .update({
        documents: nextDocs,
        updated_at: new Date().toISOString(),
      })
      .eq("id", own.applicantId);
    if (dbErr) throw new Error(dbErr.message);

    if (oldPath && oldPath !== newPath && canSignApplicantPath(oldPath, own)) {
      await removeHrDocuments([oldPath]);
    }

    revalidatePath(`/recruitment/${own.posting.slug}/apply`);
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
    if (!docKey) throw new Error("요청 정보가 누락되었습니다.");
    const own = await requireOwnDraft(slug || null, applicantId || null);
    const oldPath = own.documents[docKey] ?? null;
    if (!oldPath) return { ok: true };

    const nextDocs = { ...own.documents };
    delete nextDocs[docKey];

    const { error: dbErr } = await supabaseAdmin
      .from("recruitment_applicants")
      .update({
        documents: nextDocs,
        updated_at: new Date().toISOString(),
      })
      .eq("id", own.applicantId);
    if (dbErr) throw new Error(dbErr.message);

    if (canSignApplicantPath(oldPath, own)) await removeHrDocuments([oldPath]);
    revalidatePath(`/recruitment/${own.posting.slug}/apply`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "서류 삭제 중 오류가 발생했습니다.",
    };
  }
}

// 임시 열람 URL 발급 — 지원 화면의 사진·서류 미리보기용.
//   카카오 세션의 본인 지원자 행에 기록된 경로만 서명합니다(다른 지원자·직원 서류 차단).
//   접수 완료 뒤 다시 열어볼 수 있어야 하므로 기간·draft 조건은 걸지 않습니다.
export async function signApplicantStoragePath(
  path: string | null
): Promise<string | null> {
  if (!path) return null;
  const session = await getKakaoSession();
  if (!session) return null;
  const { data } = await supabaseAdmin
    .from("recruitment_applicants")
    .select("id, photo_url, documents")
    .eq("kakao_id", session.kakaoId)
    .maybeSingle();
  const row = data as { id?: unknown; photo_url?: unknown; documents?: unknown } | null;
  if (!row?.id) return null;
  const own = {
    applicantId: String(row.id),
    photoPath: typeof row.photo_url === "string" ? row.photo_url : null,
    documents: normalizeDocuments(row.documents),
  };
  if (!canSignApplicantPath(path, own)) return null;
  return signHrDocument(path);
}
