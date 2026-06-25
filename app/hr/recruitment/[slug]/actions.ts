"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  supabase,
  signHrDocument,
  removeHrDocuments,
  uploadStampImage,
  STAMP_IMAGE_MIME,
  parseEducationInput,
  parseLicenseInput,
  parseCareerInput,
  parseAwardInput,
  parseTrainingInput,
  normalizeJudge,
  normalizeExternalJudge,
  normalizeRecruitmentPosting,
  type EmployeeEducation,
  type EmployeeLicense,
  type EmployeeCareer,
  type EmployeeAward,
  type EmployeeTraining,
  type Judge,
  type ExternalJudge,
  type RecruitmentPosting,
} from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireHrAdmin } from "@/app/hr/actions";
import {
  SCREENING_ITEMS,
  SCREENING_MAX,
  isValidScreeningValue,
} from "@/lib/recruitmentScore";
import { getSession } from "@/app/actions";

// =====================================================================
// 채용 심사 관리 — /hr/recruitment/[slug]
//   * 관장·부장 권한자만 접근.
//   * 지원자 목록 / 서류 채점 / 최종 집계의 데이터 소스.
// =====================================================================

export type AppStatus =
  | "draft"
  | "submitted"
  | "screening_passed"
  | "screening_failed"
  | "interview_passed"
  | "interview_failed"
  | "final_passed"
  | "final_rejected";

// 주의: "use server" 파일에서는 async 함수만 export 가능합니다.
// 상태 라벨 매핑(APPLICATION_STATUS_LABEL)은 클라이언트 컴포넌트 측에서 정의합니다.

export type AdminPosting = {
  id: string;
  slug: string;
  title: string;
  field: string;
  recruit_count: number;
  status: string;
  application_end: string;
  view_count: number;
};

export type RequiredDoc = {
  key: string;
  label: string;
  required: boolean;
};

export type AdminDocLink = {
  key: string;
  label: string;
  url: string | null;
  required: boolean;
};

export type AdminApplicant = {
  application_id: string;
  applicant_id: string;
  applicant_number: string;
  name: string;
  email: string;
  phone: string;
  birth_date: string;
  gender: "M" | "F" | null;
  address: string | null;
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
  documents: AdminDocLink[];
  status: AppStatus;
  submitted_at: string | null;
  screening_reject_reason: string | null;
};

export type ScoreEntry = {
  id: string;
  application_id: string;
  reviewer_name: string;
  stage: "screening" | "interview";
  total_score: number | null;
  max_score: number;
  is_absent: boolean;
  memo: string | null;
  submitted_at: string | null;
  // 채점 항목 — 단계별 형태가 다릅니다.
  //   screening: { q1_expertise, q2_license, q3_statement }
  //   interview: { q1, q2, q3, q4, signature_data_url }
  scores: Record<string, unknown>;
};

// ---------------------------------------------------------------------
// 정규화 헬퍼
// ---------------------------------------------------------------------
function jsonbToString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

function normalizeDocuments(raw: unknown): Record<string, string> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim().length > 0) out[k] = v;
  }
  return out;
}

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

function asAppStatus(raw: unknown): AppStatus {
  const s = String(raw ?? "");
  switch (s) {
    case "draft":
    case "submitted":
    case "screening_passed":
    case "screening_failed":
    case "interview_passed":
    case "interview_failed":
    case "final_passed":
    case "final_rejected":
      return s;
    default:
      return "submitted";
  }
}

// =====================================================================
// 공고 조회 — published 외 상태도 허용 (관리자)
// =====================================================================
export async function getPostingForAdmin(slug: string): Promise<
  | {
      posting: AdminPosting;
      requiredDocs: RequiredDoc[];
    }
  | null
> {
  await requireHrAdmin();
  if (!slug) return null;
  const { data, error } = await supabase
    .from("recruitment_postings")
    .select(
      "id,slug,title,field,recruit_count,status,application_end,view_count,required_documents"
    )
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    posting: {
      id: String(r.id ?? ""),
      slug: String(r.slug ?? ""),
      title: String(r.title ?? ""),
      field: String(r.field ?? ""),
      recruit_count: Number(r.recruit_count ?? 0),
      status: String(r.status ?? ""),
      application_end: String(r.application_end ?? ""),
      view_count: Number(r.view_count ?? 0),
    },
    requiredDocs: normalizeRequiredDocs(r.required_documents),
  };
}

// =====================================================================
// 지원자 목록 — 사진/문서 URL 사전 서명 (1시간 유효)
// =====================================================================
export async function listApplicantsForAdmin(
  slug: string
): Promise<AdminApplicant[]> {
  const adm = await getPostingForAdmin(slug);
  if (!adm) return [];
  const { posting, requiredDocs } = adm;

  const { data: apps, error: aErr } = await supabaseAdmin
    .from("recruitment_applications")
    .select(
      "id, applicant_id, status, submitted_at, screening_reject_reason, applicant:recruitment_applicants(*)"
    )
    .eq("posting_id", posting.id)
    // 임시저장(draft) 상태는 노출하지 않음 — 접수 완료된 지원서만.
    .neq("status", "draft")
    .order("submitted_at", { ascending: true });
  if (aErr) throw new Error(aErr.message);
  if (!apps) return [];

  const result: AdminApplicant[] = [];
  for (const row of apps as unknown[]) {
    const r = row as Record<string, unknown>;
    const app = r.applicant as Record<string, unknown> | null;
    if (!app) continue;

    const docMap = normalizeDocuments(app.documents);
    const photoUrl = await signHrDocument(
      (app.photo_url as string | null) ?? null
    );

    // 공고에 정의된 항목 순서로 표시. 정의되지 않은 키가 더 있을 수도 있어 뒤에 추가.
    const documents: AdminDocLink[] = [];
    for (const rd of requiredDocs) {
      documents.push({
        key: rd.key,
        label: rd.label,
        required: rd.required,
        url: docMap[rd.key]
          ? await signHrDocument(docMap[rd.key])
          : null,
      });
    }
    for (const [k, p] of Object.entries(docMap)) {
      if (!requiredDocs.find((d) => d.key === k)) {
        documents.push({
          key: k,
          label: k,
          required: false,
          url: await signHrDocument(p),
        });
      }
    }

    result.push({
      application_id: String(r.id ?? ""),
      applicant_id: String(r.applicant_id ?? ""),
      applicant_number: String(app.applicant_number ?? ""),
      name: String(app.name ?? ""),
      email: String(app.email ?? ""),
      phone: String(app.phone ?? ""),
      birth_date: String(app.birth_date ?? ""),
      gender: (app.gender as "M" | "F" | null) ?? null,
      address: (app.address as string | null) ?? null,
      photo_url: photoUrl,
      education: parseEducationInput(jsonbToString(app.education)),
      licenses: parseLicenseInput(jsonbToString(app.licenses)),
      career: parseCareerInput(jsonbToString(app.career)),
      awards: parseAwardInput(jsonbToString(app.awards)),
      trainings: parseTrainingInput(jsonbToString(app.trainings)),
      motivation: (app.motivation as string | null) ?? null,
      self_development: (app.self_development as string | null) ?? null,
      career_summary: (app.career_summary as string | null) ?? null,
      philosophy: (app.philosophy as string | null) ?? null,
      documents,
      status: asAppStatus(r.status),
      submitted_at: (r.submitted_at as string | null) ?? null,
      screening_reject_reason:
        (r.screening_reject_reason as string | null) ?? null,
    });
  }
  return result;
}

// =====================================================================
// 공고 전체 점수 — 클라이언트에서 집계/평균 계산.
// =====================================================================
export async function listScoresForPosting(
  slug: string
): Promise<ScoreEntry[]> {
  const adm = await getPostingForAdmin(slug);
  if (!adm) return [];

  const { data: appRows, error: e1 } = await supabaseAdmin
    .from("recruitment_applications")
    .select("id")
    .eq("posting_id", adm.posting.id);
  if (e1) throw new Error(e1.message);
  const ids = (appRows ?? []).map((x) => String((x as { id: unknown }).id));
  if (ids.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("recruitment_scores")
    .select("*")
    .in("application_id", ids);
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const stageRaw = String(r.stage ?? "");
    const stage: ScoreEntry["stage"] =
      stageRaw === "interview" ? "interview" : "screening";
    return {
      id: String(r.id ?? ""),
      application_id: String(r.application_id ?? ""),
      reviewer_name: String(r.reviewer_name ?? ""),
      stage,
      total_score: r.total_score == null ? null : Number(r.total_score),
      max_score: Number(r.max_score ?? 0),
      is_absent: r.is_absent === true,
      memo: (r.memo as string | null) ?? null,
      submitted_at: (r.submitted_at as string | null) ?? null,
      scores: (r.scores as Record<string, unknown>) ?? {},
    };
  });
}

// =====================================================================
// 서류 채점 저장 — 35점 만점, 기준표 클릭 선택식 세부항목 6종.
//   * 항목 키: degree, gpa, youth_cert, national_cert, statement,
//     qualitative (정의는 lib/recruitmentScore SCREENING_ITEMS).
//   * 각 항목은 미선택(0) 또는 정의된 보기 점수만 허용. 합계는 클라이언트
//     값을 신뢰하지 않고 서버에서 6개 합으로 재계산.
//   * 로그인한 관장/부장 이름을 reviewer_name 으로 자동 채움.
// =====================================================================
export async function saveScreeningScore(
  formData: FormData
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const me = await requireHrAdmin();
    const slug = String(formData.get("slug") ?? "").trim();
    const applicationId = String(formData.get("application_id") ?? "").trim();
    if (!applicationId)
      return { ok: false, message: "application_id가 누락되었습니다." };

    // 지원자-공고 소속 검증 — application_id 가 이 공고(slug)의 지원서인지 확인.
    //   requireHrAdmin 직후·저장 전. (saveInterviewScore 와 동일 패턴)
    const adm = await getPostingForAdmin(slug);
    if (!adm) return { ok: false, message: "공고를 찾을 수 없습니다." };
    const { data: appRow, error: appErr } = await supabaseAdmin
      .from("recruitment_applications")
      .select("id, posting_id")
      .eq("id", applicationId)
      .maybeSingle();
    if (appErr) throw new Error(appErr.message);
    if (
      !appRow ||
      String((appRow as { posting_id?: unknown }).posting_id) !==
        adm.posting.id
    ) {
      return { ok: false, message: "이 공고의 지원자가 아닙니다." };
    }

    // 6개 세부항목을 각각 검증(미선택=0 또는 정의된 보기 점수) 후 합산.
    const scores: Record<string, number> = {};
    let total = 0;
    for (const item of SCREENING_ITEMS) {
      const raw = formData.get(item.key);
      const v = raw == null || raw === "" ? 0 : Number(raw);
      if (!isValidScreeningValue(item, v)) {
        return {
          ok: false,
          message: `'${item.title}' 항목의 점수 값이 올바르지 않습니다.`,
        };
      }
      scores[item.key] = v;
      total += v;
    }

    const memoRaw = formData.get("memo");
    const memo =
      typeof memoRaw === "string" && memoRaw.trim().length > 0
        ? memoRaw.trim()
        : null;

    const { error } = await supabaseAdmin.from("recruitment_scores").upsert(
      {
        application_id: applicationId,
        stage: "screening",
        // 충돌 키는 (application_id, stage, reviewer_id). 서류 채점자는 관장/부장
        // 이므로 reviewer_id = me.name(안정적 식별자). reviewer_name 은 표시용.
        reviewer_name: me.name,
        reviewer_id: me.name,
        scores,
        total_score: total,
        max_score: SCREENING_MAX,
        is_absent: false,
        memo,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "application_id,stage,reviewer_id" }
    );
    if (error) throw new Error(error.message);

    if (slug) revalidatePath(`/hr/recruitment/${slug}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "채점 저장 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 지원자 상태 변경 (서류·면접·최종 합격/불합격)
// =====================================================================
export async function updateApplicationStatus(
  applicationId: string,
  status: AppStatus,
  slug: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireHrAdmin();
    if (!applicationId)
      return { ok: false, message: "application_id가 누락되었습니다." };

    const patch: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (status === "final_passed") {
      patch.hired_at = new Date().toISOString().slice(0, 10);
    }

    const { error } = await supabaseAdmin
      .from("recruitment_applications")
      .update(patch)
      .eq("id", applicationId);
    if (error) throw new Error(error.message);

    if (slug) revalidatePath(`/hr/recruitment/${slug}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "상태 변경 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 서류 불합격 사유 저장 (recruitment_applications.screening_reject_reason)
//   * 상태와 독립적으로 보존 — 합격으로 되돌려도 값은 남기고 화면 표시만 숨김
//     (다시 불합격하면 그대로 복원). 빈 값이면 null 로 정리.
// =====================================================================
export async function saveScreeningRejectReason(
  applicationId: string,
  reason: string,
  slug: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireHrAdmin();
    if (!applicationId)
      return { ok: false, message: "application_id가 누락되었습니다." };

    const trimmed = reason.trim();
    const { error } = await supabaseAdmin
      .from("recruitment_applications")
      .update({
        screening_reject_reason: trimmed.length > 0 ? trimmed : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", applicationId);
    if (error) throw new Error(error.message);

    if (slug) revalidatePath(`/hr/recruitment/${slug}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "사유 저장 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 지원자 개인정보 일괄 익명화 (채용 종료 후 PII 정리)
//   * recruitment_applicants 의 PII 필드를 익명화 합니다.
//     (실제 row 삭제는 applications/scores FK 제약으로 불가 — 동등한 효과를
//     얻기 위해 필수 필드는 placeholder, 그 외는 null/[]/{} 로 비웁니다.)
//   * applications.converted_to_employee_id 가 설정된 합격자는 제외.
//   * hr-documents/recruitment/{posting_id}/{applicant_id}/ 의 사진/문서 삭제.
//   * recruitment_applications / recruitment_scores 행 자체는 보존
//     (감사 기록 + 집계 목적).
// =====================================================================
export async function bulkAnonymizeApplicants(slug: string): Promise<
  | { ok: true; anonymized: number; preserved: number; filesRemoved: number }
  | { ok: false; message: string }
> {
  try {
    await requireHrAdmin();
    if (!slug)
      return { ok: false, message: "공고 정보가 누락되었습니다." };

    const adm = await getPostingForAdmin(slug);
    if (!adm) return { ok: false, message: "공고를 찾을 수 없습니다." };
    const postingId = adm.posting.id;

    // 본 공고의 applications + applicants 조회.
    const { data: rows, error } = await supabaseAdmin
      .from("recruitment_applications")
      .select(
        "id, applicant_id, converted_to_employee_id, applicant:recruitment_applicants(id, photo_url, documents)"
      )
      .eq("posting_id", postingId);
    if (error) throw new Error(error.message);

    let anonymized = 0;
    let preserved = 0;
    const pathsToRemove: string[] = [];
    const applicantIds: string[] = [];

    for (const row of (rows ?? []) as unknown[]) {
      const r = row as Record<string, unknown>;
      const converted = r.converted_to_employee_id;
      const app = r.applicant as Record<string, unknown> | null;
      if (!app) continue;
      if (converted != null) {
        preserved += 1;
        continue;
      }
      const id = String(app.id ?? "");
      if (!id) continue;
      applicantIds.push(id);

      // 삭제할 Storage 파일 경로 수집.
      const photoUrl = (app.photo_url as string | null) ?? null;
      if (photoUrl) pathsToRemove.push(photoUrl);
      const docs = normalizeDocuments(app.documents);
      for (const p of Object.values(docs)) {
        if (p) pathsToRemove.push(p);
      }
      anonymized += 1;
    }

    // Storage 파일 일괄 제거 (실패해도 익명화는 계속 진행).
    let filesRemoved = 0;
    if (pathsToRemove.length > 0) {
      try {
        await removeHrDocuments(pathsToRemove);
        filesRemoved = pathsToRemove.length;
      } catch {
        // 파일 제거 실패는 무시 — DB 익명화는 진행되어야 함.
      }
    }

    // 익명화 — UNIQUE 제약 없는 필드들. NOT NULL 필드는 placeholder.
    if (applicantIds.length > 0) {
      // 행마다 다른 placeholder(email) 필요해서 한 줄씩 업데이트.
      for (const id of applicantIds) {
        const placeholderEmail = `deleted-${id.slice(0, 8)}@deleted.local`;
        const { error: upErr } = await supabaseAdmin
          .from("recruitment_applicants")
          .update({
            name: "[개인정보 삭제됨]",
            name_hanja: null,
            birth_date: "1900-01-01",
            gender: null,
            address: null,
            email: placeholderEmail,
            phone: "[삭제됨]",
            photo_url: null,
            education: [],
            licenses: [],
            career: [],
            awards: [],
            trainings: [],
            motivation: null,
            self_development: null,
            career_summary: null,
            philosophy: null,
            documents: {},
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);
        if (upErr) throw new Error(upErr.message);
      }
    }

    revalidatePath(`/hr/recruitment/${slug}`);
    return { ok: true, anonymized, preserved, filesRemoved };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? e.message
          : "지원자 개인정보 삭제 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 심사위원 관리 (recruitment_judges) — 관장·부장만
//   * 내부위원: drivers 의 직원을 driver_id 로 연결
//   * 외부위원: external_judges_pool 의 풀 항목을 external_pool_id 로 연결
//     로그인은 풀의 (name, phone) 으로 인증 — authenticateExternalJudge 참고
// =====================================================================

// 휴대전화 입력 정규화 — 하이픈/공백/점 등 모두 제거하고 숫자만 남김.
function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

async function slugFromPostingId(postingId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("recruitment_postings")
    .select("slug")
    .eq("id", postingId)
    .maybeSingle();
  if (error) return null;
  return (data as { slug?: string } | null)?.slug ?? null;
}

async function judgePostingId(judgeId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("recruitment_judges")
    .select("posting_id")
    .eq("id", judgeId)
    .maybeSingle();
  if (error) return null;
  return (data as { posting_id?: string } | null)?.posting_id ?? null;
}

async function nextDisplayOrder(postingId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("recruitment_judges")
    .select("display_order")
    .eq("posting_id", postingId)
    .order("display_order", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { display_order?: number }[];
  if (rows.length === 0) return 0;
  return Number(rows[0]?.display_order ?? 0) + 1;
}

// ---------------------------------------------------------------------
// 1) 목록 조회 — 누구나 (채점 페이지에서도 필요).
// ---------------------------------------------------------------------
export async function listJudges(postingId: string): Promise<Judge[]> {
  if (!postingId) return [];
  const { data, error } = await supabaseAdmin
    .from("recruitment_judges")
    .select("*")
    .eq("posting_id", postingId)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => normalizeJudge(row as Record<string, unknown>));
}

// ---------------------------------------------------------------------
// 2) 내부위원 등록 — drivers 에서 직원 정보를 끌어와 name 자동 채움.
// ---------------------------------------------------------------------
export async function addInternalJudge(input: {
  postingId: string;
  driverId: string;
  role: string;
}): Promise<Judge> {
  const me = await requireHrAdmin();
  const postingId = input.postingId?.trim() ?? "";
  const driverId = input.driverId?.trim() ?? "";
  const role = input.role?.trim() ?? "";
  if (!postingId) throw new Error("공고 정보가 누락되었습니다.");
  if (!driverId) throw new Error("직원을 선택해주세요.");
  if (!role) throw new Error("직급/역할을 입력해주세요.");

  // 직원 정보 조회.
  const { data: driver, error: dErr } = await supabase
    .from("drivers")
    .select("id, name")
    .eq("id", driverId)
    .maybeSingle();
  if (dErr) throw new Error(dErr.message);
  if (!driver) throw new Error("존재하지 않는 직원입니다.");

  // 같은 공고에 같은 driver_id 가 이미 등록돼 있는지 체크.
  const { data: dup, error: dupErr } = await supabaseAdmin
    .from("recruitment_judges")
    .select("id")
    .eq("posting_id", postingId)
    .eq("driver_id", driverId)
    .maybeSingle();
  if (dupErr) throw new Error(dupErr.message);
  if (dup) throw new Error("이미 등록된 심사위원입니다.");

  const order = await nextDisplayOrder(postingId);

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("recruitment_judges")
    .insert({
      posting_id: postingId,
      name: String((driver as { name?: string }).name ?? "").trim(),
      role,
      affiliation: null,
      judge_type: "internal",
      driver_id: driverId,
      is_active: true,
      display_order: order,
      created_by: me.name,
    })
    .select("*")
    .single();
  if (insErr) throw new Error(insErr.message);

  const slug = await slugFromPostingId(postingId);
  if (slug) revalidatePath(`/hr/recruitment/${slug}`);
  return normalizeJudge(inserted as Record<string, unknown>);
}

// ---------------------------------------------------------------------
// 3) 외부위원 배정 — external_judges_pool 의 풀 항목을 본 공고에 연결.
//    name/affiliation 은 스냅샷으로 복사 (이후 풀에서 바뀌어도 본 공고 고정).
// ---------------------------------------------------------------------
export async function addExternalJudge(input: {
  postingId: string;
  externalPoolId: string;
  role: string;
}): Promise<Judge> {
  const me = await requireHrAdmin();
  const postingId = input.postingId?.trim() ?? "";
  const externalPoolId = input.externalPoolId?.trim() ?? "";
  const roleInput = input.role?.trim() ?? "";
  if (!postingId) throw new Error("공고 정보가 누락되었습니다.");
  if (!externalPoolId) throw new Error("외부위원을 선택해주세요.");

  // 풀 정보 조회 — name/affiliation 스냅샷, default_role 폴백.
  const { data: pool, error: pErr } = await supabaseAdmin
    .from("external_judges_pool")
    .select("id, name, affiliation, default_role, is_active")
    .eq("id", externalPoolId)
    .maybeSingle();
  if (pErr) throw new Error(pErr.message);
  if (!pool) throw new Error("존재하지 않는 외부위원입니다.");
  const poolRow = pool as {
    name?: string;
    affiliation?: string;
    default_role?: string;
    is_active?: boolean;
  };
  if (poolRow.is_active === false) {
    throw new Error("비활성화된 외부위원입니다.");
  }

  // 같은 공고에 같은 풀 항목이 이미 등록돼 있는지 체크.
  const { data: dup, error: dupErr } = await supabaseAdmin
    .from("recruitment_judges")
    .select("id")
    .eq("posting_id", postingId)
    .eq("external_pool_id", externalPoolId)
    .maybeSingle();
  if (dupErr) throw new Error(dupErr.message);
  if (dup) throw new Error("이미 이 공고에 등록된 외부위원입니다.");

  const role = roleInput || poolRow.default_role || "외부위원";
  const order = await nextDisplayOrder(postingId);

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("recruitment_judges")
    .insert({
      posting_id: postingId,
      name: String(poolRow.name ?? "").trim(),
      role,
      affiliation: poolRow.affiliation
        ? String(poolRow.affiliation).trim()
        : null,
      judge_type: "external",
      driver_id: null,
      external_pool_id: externalPoolId,
      is_active: true,
      display_order: order,
      created_by: me.name,
    })
    .select("*")
    .single();
  if (insErr) throw new Error(insErr.message);

  const slug = await slugFromPostingId(postingId);
  if (slug) revalidatePath(`/hr/recruitment/${slug}`);
  return normalizeJudge(inserted as Record<string, unknown>);
}

// ---------------------------------------------------------------------
// 4) 위원 정보 수정 — judge_type / driver_id / login_code 는 불변.
// ---------------------------------------------------------------------
export async function updateJudge(
  judgeId: string,
  patch: { name?: string; role?: string; affiliation?: string }
): Promise<void> {
  await requireHrAdmin();
  if (!judgeId) throw new Error("심사위원 정보가 누락되었습니다.");

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const v = patch.name.trim();
    if (!v) throw new Error("이름을 입력해주세요.");
    update.name = v;
  }
  if (patch.role !== undefined) {
    const v = patch.role.trim();
    if (!v) throw new Error("직급/역할을 입력해주세요.");
    update.role = v;
  }
  if (patch.affiliation !== undefined) {
    const v = patch.affiliation.trim();
    update.affiliation = v.length > 0 ? v : null;
  }
  if (Object.keys(update).length === 0) return;

  const { error } = await supabaseAdmin
    .from("recruitment_judges")
    .update(update)
    .eq("id", judgeId);
  if (error) throw new Error(error.message);

  const postingId = await judgePostingId(judgeId);
  const slug = postingId ? await slugFromPostingId(postingId) : null;
  if (slug) revalidatePath(`/hr/recruitment/${slug}`);
}

// ---------------------------------------------------------------------
// 채점 이력 카운트 — 배정 행 id(들)를 실제로 채점한 기록이 있는지 확인.
//   권위 소스: recruitment_scores (단일 테이블). 서류/면접 모두 여기 저장되며,
//     면접 stage 의 reviewer_id 에 recruitment_judges.id(=judgeId)가 들어간다.
//     (서류 stage 의 reviewer_id 는 관리자 이름이라 UUID 와 매칭 안 됨 — 오탐 없음.)
//   recruitment_document_scores / recruitment_interview_scores 는 분리 테이블
//     계획이 폐기된 미사용 잔재(쓰기 코드 없음). 만약을 위한 보조 확인만 하되,
//     테이블이 없거나 조회 실패하면 0 으로 간주(권위 소스는 recruitment_scores).
// ---------------------------------------------------------------------
async function legacyJudgeScoreCount(
  table: string,
  ids: string[]
): Promise<number> {
  try {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select("id", { count: "exact", head: true })
      .in("judge_id", ids);
    if (error) return 0; // 잔재 테이블 부재/오류는 무시.
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function countJudgeScores(judgeIds: string[]): Promise<number> {
  const ids = judgeIds.filter(Boolean);
  if (ids.length === 0) return 0;

  const { count, error } = await supabaseAdmin
    .from("recruitment_scores")
    .select("id", { count: "exact", head: true })
    .in("reviewer_id", ids);
  if (error) throw new Error(error.message);

  const [doc, intv] = await Promise.all([
    legacyJudgeScoreCount("recruitment_document_scores", ids),
    legacyJudgeScoreCount("recruitment_interview_scores", ids),
  ]);
  return (count ?? 0) + doc + intv;
}

// ---------------------------------------------------------------------
// 5) 위원 삭제 — 채점 이력이 있으면 차단 (비활성화 권장).
// ---------------------------------------------------------------------
export async function deleteJudge(judgeId: string): Promise<void> {
  await requireHrAdmin();
  if (!judgeId) throw new Error("심사위원 정보가 누락되었습니다.");

  // 채점 이력 확인 — 서류·면접·점수 테이블 전부.
  const total = await countJudgeScores([judgeId]);
  if (total > 0) {
    throw new Error(
      `이 심사위원은 이미 ${total}건의 채점을 했습니다. 비활성화를 권장합니다.`
    );
  }

  // 삭제 전에 slug 확보 (삭제 후엔 lookup 불가).
  const postingId = await judgePostingId(judgeId);

  const { error } = await supabaseAdmin
    .from("recruitment_judges")
    .delete()
    .eq("id", judgeId);
  if (error) throw new Error(error.message);

  const slug = postingId ? await slugFromPostingId(postingId) : null;
  if (slug) revalidatePath(`/hr/recruitment/${slug}`);
}

// ---------------------------------------------------------------------
// 6) 활성/비활성 토글 — 기존 점수는 보존.
// ---------------------------------------------------------------------
export async function toggleJudgeActive(judgeId: string): Promise<void> {
  await requireHrAdmin();
  if (!judgeId) throw new Error("심사위원 정보가 누락되었습니다.");

  const { data, error } = await supabaseAdmin
    .from("recruitment_judges")
    .select("is_active, posting_id")
    .eq("id", judgeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("존재하지 않는 심사위원입니다.");
  const current = (data as { is_active?: boolean }).is_active === true;
  const postingId =
    (data as { posting_id?: string }).posting_id ?? null;

  const { error: upErr } = await supabaseAdmin
    .from("recruitment_judges")
    .update({ is_active: !current })
    .eq("id", judgeId);
  if (upErr) throw new Error(upErr.message);

  const slug = postingId ? await slugFromPostingId(postingId) : null;
  if (slug) revalidatePath(`/hr/recruitment/${slug}`);
}

// ---------------------------------------------------------------------
// 7) 표시 순서 일괄 변경 — 배열 순서대로 display_order = 0,1,2,...
// ---------------------------------------------------------------------
export async function reorderJudges(
  postingId: string,
  judgeIds: string[]
): Promise<void> {
  await requireHrAdmin();
  if (!postingId) throw new Error("공고 정보가 누락되었습니다.");
  if (!Array.isArray(judgeIds) || judgeIds.length === 0) return;

  for (let i = 0; i < judgeIds.length; i++) {
    const id = judgeIds[i];
    if (!id) continue;
    const { error } = await supabaseAdmin
      .from("recruitment_judges")
      .update({ display_order: i })
      .eq("id", id)
      .eq("posting_id", postingId); // 안전망: 다른 공고 위원이 섞여있어도 무시.
    if (error) throw new Error(error.message);
  }

  const slug = await slugFromPostingId(postingId);
  if (slug) revalidatePath(`/hr/recruitment/${slug}`);
}

// =====================================================================
// 외부위원 풀 (external_judges_pool) — 마스터 데이터 관리
//   * 공고 무관하게 1회 등록, 여러 공고에 재사용
//   * 로그인: (name, phone) + 공고측 recruitment_judges.is_active 다층 체크
// =====================================================================

// ---------------------------------------------------------------------
// E1) 풀 조회 — phone/소속 등 PII 포함이므로 관장·부장만.
// ---------------------------------------------------------------------
export async function listExternalJudges(): Promise<ExternalJudge[]> {
  await requireHrAdmin();
  const { data, error } = await supabaseAdmin
    .from("external_judges_pool")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) =>
    normalizeExternalJudge(row as Record<string, unknown>)
  );
}

// ---------------------------------------------------------------------
// E2) 풀에 외부위원 신규 등록.
// ---------------------------------------------------------------------
export async function createExternalJudge(input: {
  name: string;
  phone: string;
  affiliation: string;
  default_role?: string;
  notes?: string;
  privacy_agreed: boolean;
}): Promise<ExternalJudge> {
  const me = await requireHrAdmin();
  const name = input.name?.trim() ?? "";
  const phone = normalizePhone(input.phone ?? "");
  const affiliation = input.affiliation?.trim() ?? "";
  const default_role =
    (input.default_role?.trim() ?? "") || "외부위원";
  const notes = input.notes?.trim() ? input.notes.trim() : null;

  if (!name) throw new Error("이름을 입력해주세요.");
  if (!affiliation) throw new Error("소속을 입력해주세요.");
  if (!/^010\d{8}$/.test(phone)) {
    throw new Error("휴대전화는 010 으로 시작하는 11자리 숫자여야 합니다.");
  }
  if (input.privacy_agreed !== true) {
    throw new Error("개인정보 수집 동의가 필요합니다.");
  }

  // (name, phone) UNIQUE — DB 제약이 있지만 친절한 메시지 위해 선체크.
  const { data: dup, error: dupErr } = await supabaseAdmin
    .from("external_judges_pool")
    .select("id")
    .eq("name", name)
    .eq("phone", phone)
    .maybeSingle();
  if (dupErr) throw new Error(dupErr.message);
  if (dup) {
    throw new Error("이미 등록된 외부위원입니다 (이름·휴대전화 중복).");
  }

  const now = new Date().toISOString();
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("external_judges_pool")
    .insert({
      name,
      phone,
      affiliation,
      default_role,
      notes,
      privacy_agreed_at: now,
      privacy_agreed_by: me.name,
      is_active: true,
      created_by: me.name,
    })
    .select("*")
    .single();
  if (insErr) throw new Error(insErr.message);

  revalidatePath("/hr/recruitment");
  return normalizeExternalJudge(inserted as Record<string, unknown>);
}

// ---------------------------------------------------------------------
// E3) 풀 정보 수정 — is_active 는 toggle 액션으로 분리.
// ---------------------------------------------------------------------
export async function updateExternalJudge(
  id: string,
  patch: {
    name?: string;
    phone?: string;
    affiliation?: string;
    default_role?: string;
    notes?: string;
  }
): Promise<void> {
  await requireHrAdmin();
  if (!id) throw new Error("외부위원 정보가 누락되었습니다.");

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const v = patch.name.trim();
    if (!v) throw new Error("이름을 입력해주세요.");
    update.name = v;
  }
  if (patch.phone !== undefined) {
    const v = normalizePhone(patch.phone);
    if (!/^010\d{8}$/.test(v)) {
      throw new Error("휴대전화는 010 으로 시작하는 11자리 숫자여야 합니다.");
    }
    update.phone = v;
  }
  if (patch.affiliation !== undefined) {
    const v = patch.affiliation.trim();
    if (!v) throw new Error("소속을 입력해주세요.");
    update.affiliation = v;
  }
  if (patch.default_role !== undefined) {
    const v = patch.default_role.trim();
    update.default_role = v || "외부위원";
  }
  if (patch.notes !== undefined) {
    const v = patch.notes.trim();
    update.notes = v || null;
  }
  if (Object.keys(update).length === 0) return;

  const { error } = await supabaseAdmin
    .from("external_judges_pool")
    .update(update)
    .eq("id", id);
  if (error) {
    // (name, phone) UNIQUE 위반을 친절한 메시지로 변환.
    const code = (error as { code?: string }).code ?? "";
    if (code === "23505" || /unique/i.test(error.message)) {
      throw new Error("동일한 이름·휴대전화 조합이 이미 존재합니다.");
    }
    throw new Error(error.message);
  }

  // 풀의 name/affiliation 이 바뀌면, 이 풀을 참조하는 recruitment_judges 의
  // 스냅샷(배정 시점 복사값)도 현재 값으로 동기화한다.
  //   * is_active 무관 — 과거(비활성) 배정까지 정정해 드리프트를 완전히 제거.
  //   * 이게 없으면 "배정 후 풀에서 이름 수정" 시 공고/QR/리포트에 옛 이름이 남음.
  const snapshot: Record<string, unknown> = {};
  if (update.name !== undefined) snapshot.name = update.name;
  if (update.affiliation !== undefined) snapshot.affiliation = update.affiliation;
  if (Object.keys(snapshot).length > 0) {
    const { data: affected, error: syncErr } = await supabaseAdmin
      .from("recruitment_judges")
      .update(snapshot)
      .eq("external_pool_id", id)
      .select("posting_id");
    if (syncErr) throw new Error(syncErr.message);

    // 영향받은 공고 페이지(목록·위원 화면)를 재검증해 즉시 반영.
    const postingIds = [
      ...new Set(
        (affected ?? [])
          .map((r) => String((r as { posting_id?: string }).posting_id ?? ""))
          .filter(Boolean)
      ),
    ];
    if (postingIds.length > 0) {
      const { data: posts } = await supabaseAdmin
        .from("recruitment_postings")
        .select("slug")
        .in("id", postingIds);
      for (const p of posts ?? []) {
        const slug = String((p as { slug?: string }).slug ?? "");
        if (slug) {
          revalidatePath(`/hr/recruitment/${slug}`);
          revalidatePath(`/hr/recruitment/${slug}/judges`);
        }
      }
    }
  }

  revalidatePath("/hr/recruitment");
}

// ---------------------------------------------------------------------
// E4) 풀 활성/비활성 토글.
//    비활성화 시: 어떤 공고에라도 활성 위원으로 배정돼 있으면 차단.
//    (공고측 위원을 먼저 비활성화하라고 안내)
// ---------------------------------------------------------------------
// 결과를 {ok,message} 데이터로 반환합니다(throw 아님).
//   * 서버 액션이 throw 하면 프로덕션에서 메시지가 마스킹되어 클라이언트는
//     "참여 중 채용..." 같은 안내 대신 일반 오류만 받습니다.
//   * 데이터로 반환하면 메시지가 그대로 클라이언트에 전달되어 인라인 표시 가능.
export async function toggleExternalJudgeActive(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireHrAdmin();
    if (!id) return { ok: false, message: "외부위원 정보가 누락되었습니다." };

    const { data, error } = await supabaseAdmin
      .from("external_judges_pool")
      .select("is_active")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, message: "존재하지 않는 외부위원입니다." };
    const current = (data as { is_active?: boolean }).is_active === true;

    // 활성 → 비활성으로 가는 경우에만 참여 중 채용 체크.
    // 단, 이미 종료(closed/archived)된 공고는 카운트에서 제외 — 풀 정리를 막을 이유 없음.
    if (current) {
      const { data: rows, error: cErr } = await supabaseAdmin
        .from("recruitment_judges")
        .select("id, posting:recruitment_postings!inner(status)")
        .eq("external_pool_id", id)
        .eq("is_active", true);
      if (cErr) throw new Error(cErr.message);
      const activeRows = (rows ?? []).filter((r) => {
        const p = (
          r as { posting?: { status?: string } | { status?: string }[] }
        ).posting;
        const status = Array.isArray(p) ? p[0]?.status : p?.status;
        return status !== "closed" && status !== "archived";
      });
      const n = activeRows.length;
      if (n > 0) {
        return {
          ok: false,
          message: `현재 ${n}건의 진행 중 채용에 참여 중입니다. 먼저 공고측 위원을 비활성화하세요.`,
        };
      }
    }

    const { error: upErr } = await supabaseAdmin
      .from("external_judges_pool")
      .update({ is_active: !current })
      .eq("id", id);
    if (upErr) throw new Error(upErr.message);

    revalidatePath("/hr/recruitment");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? e.message
          : "외부위원 상태 변경 중 오류가 발생했습니다.",
    };
  }
}

// ---------------------------------------------------------------------
// E5) 풀에서 외부위원 삭제.
//   * 실제 채점 이력(3개 채점 테이블)이 1건이라도 있으면 차단 → 비활성화 안내.
//   * 채점이 0건이면 배정(recruitment_judges)만 한 테스트성 위원으로 보고,
//     배정 행까지 함께 정리한 뒤 풀에서 삭제 허용.
// ---------------------------------------------------------------------
export async function deleteExternalJudge(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireHrAdmin();
    if (!id) return { ok: false, message: "외부위원 정보가 누락되었습니다." };

    // 1) 이 풀 위원의 모든 배정 행(공고 무관) id 수집.
    const { data: judgeRows, error: jErr } = await supabaseAdmin
      .from("recruitment_judges")
      .select("id")
      .eq("external_pool_id", id);
    if (jErr) throw new Error(jErr.message);
    const judgeIds = (judgeRows ?? [])
      .map((r) => String((r as { id?: string }).id ?? ""))
      .filter(Boolean);

    // 2) 실제 채점 이력 확인 — 배정만 했는지, 채점까지 했는지 구분.
    //    채점이 1건이라도 있으면 데이터 무결성을 위해 삭제 금지(의도된 보호).
    const scoreCount = await countJudgeScores(judgeIds);
    if (scoreCount > 0) {
      return {
        ok: false,
        message: `이 위원은 ${scoreCount}건의 실제 채점 이력이 있어 삭제할 수 없습니다. 비활성화를 이용하세요.`,
      };
    }

    // 3) 채점 0건 → 배정만 한(테스트성) 위원. 배정 행을 먼저 정리한 뒤 풀에서 삭제.
    if (judgeIds.length > 0) {
      const { error: delJErr } = await supabaseAdmin
        .from("recruitment_judges")
        .delete()
        .in("id", judgeIds);
      if (delJErr) throw new Error(delJErr.message);
    }

    const { error } = await supabaseAdmin
      .from("external_judges_pool")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);

    revalidatePath("/hr/recruitment");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "외부위원 삭제 중 오류가 발생했습니다.",
    };
  }
}

// ---------------------------------------------------------------------
// E5) 외부위원 도장(서명) 이미지 — 업로드/삭제/미리보기.
//   * path 컨벤션: stamps/external/{external_pool_id}.png (고정 → 재업로드 덮어쓰기).
//   * png/jpg 만 허용(webp 금지 — docx 삽입 불가). DB엔 path 만 저장.
// ---------------------------------------------------------------------
export async function uploadExternalJudgeStamp(
  formData: FormData
): Promise<{ ok: true; stampUrl: string | null } | { ok: false; message: string }> {
  try {
    await requireHrAdmin();
    const id = String(formData.get("id") ?? "").trim();
    const file = formData.get("stamp");
    if (!id) return { ok: false, message: "외부위원 정보가 누락되었습니다." };
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, message: "업로드할 도장 이미지를 선택해주세요." };
    }
    if (!STAMP_IMAGE_MIME[file.type]) {
      return {
        ok: false,
        message: "PNG 또는 JPG 이미지만 업로드할 수 있습니다. (WEBP 불가)",
      };
    }
    if (file.size > 4 * 1024 * 1024) {
      return { ok: false, message: "도장 이미지는 4MB 이하여야 합니다." };
    }

    const { data: ej, error: exErr } = await supabaseAdmin
      .from("external_judges_pool")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);
    if (!ej) return { ok: false, message: "외부위원을 찾을 수 없습니다." };

    const path = `stamps/external/${id}.png`;
    await uploadStampImage(path, file, file.type);
    const { error } = await supabaseAdmin
      .from("external_judges_pool")
      .update({ stamp_path: path })
      .eq("id", id);
    if (error) throw new Error(error.message);

    revalidatePath("/hr/external-judges");
    return { ok: true, stampUrl: await signHrDocument(path) };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "도장 업로드 중 오류가 발생했습니다.",
    };
  }
}

export async function deleteExternalJudgeStamp(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireHrAdmin();
    if (!id) return { ok: false, message: "외부위원 정보가 누락되었습니다." };
    const { data: ej, error: exErr } = await supabaseAdmin
      .from("external_judges_pool")
      .select("stamp_path")
      .eq("id", id)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);
    const old =
      ((ej as { stamp_path?: unknown } | null)?.stamp_path as string | null) ??
      null;
    const { error } = await supabaseAdmin
      .from("external_judges_pool")
      .update({ stamp_path: null })
      .eq("id", id);
    if (error) throw new Error(error.message);
    if (old) await removeHrDocuments([old]);
    revalidatePath("/hr/external-judges");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "도장 삭제 중 오류가 발생했습니다.",
    };
  }
}

// 외부위원 도장 미리보기 URL(1시간). 없으면 null.
export async function getExternalJudgeStampUrl(
  id: string
): Promise<string | null> {
  await requireHrAdmin();
  if (!id) return null;
  const { data } = await supabaseAdmin
    .from("external_judges_pool")
    .select("stamp_path")
    .eq("id", id)
    .maybeSingle();
  return signHrDocument(
    ((data as { stamp_path?: unknown } | null)?.stamp_path as string | null) ??
      null
  );
}

// =====================================================================
// 외부위원 로그인 인증 — 누구나 호출 가능 (외부위원 로그인 페이지에서 사용)
//   다층 체크:
//     1) phone 정규화 (하이픈/공백 제거 → 11자리)
//     2) 풀에서 (name, phone, is_active=true) 일치 행 확인
//     3) 공고 slug 존재 확인
//     4) 공고 status 가 closed/archived 가 아닌지 확인 (종료된 채용 차단)
//     5) 해당 공고의 recruitment_judges 에 풀ID 가 is_active=true 로 등록돼 있는지 확인
//   어느 한 단계라도 실패하면 null 반환 (어느 단계에서 실패했는지 노출 안 함)
// =====================================================================
export async function authenticateExternalJudge(input: {
  postingSlug: string;
  name: string;
  phone: string;
}): Promise<{ judge: Judge; posting: RecruitmentPosting } | null> {
  const slug = input.postingSlug?.trim() ?? "";
  const name = input.name?.trim() ?? "";
  const phone = normalizePhone(input.phone ?? "");
  if (!slug || !name || !phone) return null;

  // 1) 풀 인증 — 활성 외부위원만. name/affiliation 도 함께 읽어 표시에 사용.
  const { data: pool, error: pErr } = await supabaseAdmin
    .from("external_judges_pool")
    .select("id, name, affiliation")
    .eq("name", name)
    .eq("phone", phone)
    .eq("is_active", true)
    .maybeSingle();
  if (pErr || !pool) return null;
  const poolRow = pool as { id?: string; name?: string; affiliation?: string };
  const poolId = String(poolRow.id ?? "");
  if (!poolId) return null;

  // 2) 공고 조회.
  const { data: posting, error: postErr } = await supabase
    .from("recruitment_postings")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (postErr || !posting) return null;
  const postingId = String((posting as { id?: string }).id ?? "");
  if (!postingId) return null;

  // 3) 공고 status 차단 — 종료된 채용은 위원도 더 이상 접근 불가.
  //    관장이 위원측 토글을 안 껐어도 status 만 closed/archived 면 자동 차단.
  const postingStatus = String(
    (posting as { status?: string }).status ?? ""
  );
  if (postingStatus === "closed" || postingStatus === "archived") {
    return null;
  }

  // 4) 본 공고에 풀ID 가 활성 위원으로 등록돼 있는지 확인.
  const { data: judge, error: jErr } = await supabaseAdmin
    .from("recruitment_judges")
    .select("*")
    .eq("posting_id", postingId)
    .eq("external_pool_id", poolId)
    .eq("is_active", true)
    .maybeSingle();
  if (jErr || !judge) return null;

  // 표시 이름/소속은 항상 풀의 현재 값으로 덮어쓴다(스냅샷이 어쩌다 어긋나도
  // 위원 화면·QR 에는 최신 이름이 뜨도록 — 수정1의 동기화와 별개의 이중 안전장치).
  const liveJudge = normalizeJudge(judge as Record<string, unknown>);
  if (poolRow.name != null && String(poolRow.name).trim()) {
    liveJudge.name = String(poolRow.name).trim();
  }
  if (poolRow.affiliation != null) {
    liveJudge.affiliation = String(poolRow.affiliation).trim() || null;
  }

  return {
    judge: liveJudge,
    posting: normalizeRecruitmentPosting(posting as Record<string, unknown>),
  };
}

// =====================================================================
// 외부위원 세션 (쿠키 'dongrae_external_judge')
//   * 기존 직원/관리자 세션(Session in app/actions.ts)과 완전 분리.
//     getSession() 은 외부위원을 인식하지 못함 — 의도된 격리.
//   * 쿠키 값: ExternalJudgeSession 객체의 JSON 문자열.
//   * 유효기간 8시간 — 면접 당일 단위로 만료.
//   * 매 요청마다 requireExternalJudge() 가 DB 재검증을 수행하므로,
//     쿠키 발급 후 관리자가 위원/공고를 비활성화해도 즉시 차단됨.
// =====================================================================

const EXTERNAL_JUDGE_COOKIE = "dongrae_external_judge";
const EXTERNAL_JUDGE_MAX_AGE = 60 * 60 * 8; // 8시간

export type ExternalJudgeSession = {
  judgeId: string;
  externalPoolId: string;
  name: string;
  postingId: string;
  postingSlug: string;
};

// ---------------------------------------------------------------------
// loginExternalJudge — authenticateExternalJudge 결과를 쿠키에 봉인.
//   실패 시 어디서 실패했는지 노출하지 않고 일반적 메시지 반환.
// ---------------------------------------------------------------------
export async function loginExternalJudge(input: {
  postingSlug: string;
  name: string;
  phone: string;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await authenticateExternalJudge(input);
  if (!auth) {
    return {
      success: false,
      error: "이름 또는 연락처가 일치하지 않습니다.",
    };
  }

  const session: ExternalJudgeSession = {
    judgeId: auth.judge.id,
    externalPoolId: auth.judge.external_pool_id ?? "",
    name: auth.judge.name,
    postingId: auth.posting.id,
    postingSlug: auth.posting.slug,
  };

  const store = await cookies();
  store.set(EXTERNAL_JUDGE_COOKIE, JSON.stringify(session), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: EXTERNAL_JUDGE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
  return { success: true };
}

// ---------------------------------------------------------------------
// logoutExternalJudge — 쿠키 삭제. 실패해도 조용히 통과.
// ---------------------------------------------------------------------
export async function logoutExternalJudge(): Promise<void> {
  const store = await cookies();
  store.delete(EXTERNAL_JUDGE_COOKIE);
}

// ---------------------------------------------------------------------
// getExternalJudgeSession — 쿠키만 신뢰. DB 조회 없음 (가벼움).
//   파싱 실패·필수 필드 누락 시 null. 페이지가 단순 분기에 사용.
// ---------------------------------------------------------------------
export async function getExternalJudgeSession(): Promise<ExternalJudgeSession | null> {
  const store = await cookies();
  const raw = store.get(EXTERNAL_JUDGE_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ExternalJudgeSession>;
    if (
      typeof parsed?.judgeId === "string" &&
      parsed.judgeId.length > 0 &&
      typeof parsed?.externalPoolId === "string" &&
      typeof parsed?.name === "string" &&
      typeof parsed?.postingId === "string" &&
      parsed.postingId.length > 0 &&
      typeof parsed?.postingSlug === "string" &&
      parsed.postingSlug.length > 0
    ) {
      return parsed as ExternalJudgeSession;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// requireExternalJudge — 쿠키 + DB 다층 재검증. 보호된 페이지/액션에서 사용.
//   1) 쿠키 존재
//   2) recruitment_judges.is_active=true 인지 DB 재확인
//   3) 공고 status 가 closed/archived 가 아닌지 DB 재확인
//   어느 단계라도 실패하면 throw — 호출 측에서 catch 후 로그인 페이지로 redirect 권장.
// ---------------------------------------------------------------------
export async function requireExternalJudge(): Promise<ExternalJudgeSession> {
  const session = await getExternalJudgeSession();
  if (!session) throw new Error("외부위원 로그인이 필요합니다.");

  // 2) 위원 재검증.
  const { data: judge, error: jErr } = await supabaseAdmin
    .from("recruitment_judges")
    .select("is_active")
    .eq("id", session.judgeId)
    .maybeSingle();
  if (jErr) throw new Error("세션 검증 실패: " + jErr.message);
  if (!judge || (judge as { is_active?: boolean }).is_active !== true) {
    throw new Error("외부위원 자격이 종료되었습니다. 다시 로그인해주세요.");
  }

  // 3) 공고 status 재검증.
  const { data: posting, error: pErr } = await supabase
    .from("recruitment_postings")
    .select("status")
    .eq("id", session.postingId)
    .maybeSingle();
  if (pErr) throw new Error("세션 검증 실패: " + pErr.message);
  if (!posting) {
    throw new Error("공고가 존재하지 않습니다.");
  }
  const status = String((posting as { status?: string }).status ?? "");
  if (status === "closed" || status === "archived") {
    throw new Error("이 채용은 종료되었습니다.");
  }

  return session;
}

// =====================================================================
// requireInterviewJudge — 면접 채점 권한 일반화(외부위원 OR 내부위원).
//   채점 화면의 서버 게이트(지원서 조회·점수 저장)에서 공용으로 사용합니다.
//   * 통과 조건 (둘 중 하나):
//     (A) 외부위원 쿠키(dongrae_external_judge)가 유효하고 이 공고에 배정됨.
//         → 기존 requireExternalJudge 검증을 그대로 재사용(회귀 없음).
//     (B) 구글/직원 로그인 세션(getSession)의 직원이 이 공고의
//         recruitment_judges 에 judge_type='internal', is_active=true 로 배정됨.
//   * 반환: 채점 주체 식별값(judgeId=recruitment_judges.id) + 표시명.
//     외부·내부 모두 reviewer_id 에 judgeId(UUID)가 들어가 1인1채점이 됩니다.
//   * 실패 시 throw — 메시지에 "로그인" 포함 여부로 화면이 외부위원 로그인
//     버튼 노출을 결정하므로(아래 (C) 분기), 메시지 문구를 의도적으로 구분합니다.
// =====================================================================
export type InterviewJudgeAuth = {
  judgeId: string;
  name: string;
  judgeType: "external" | "internal";
  postingId: string;
};

export async function requireInterviewJudge(
  postingId: string
): Promise<InterviewJudgeAuth> {
  const pid = postingId?.trim() ?? "";
  if (!pid) throw new Error("공고 정보가 누락되었습니다.");

  // (A) 내부위원 우선 — 로그인 직원이 이 공고의 활성 내부위원이면 그 신원으로 인정.
  //     같은 브라우저에 외부위원 쿠키가 남아 있어도 로그인 직원이 우선됩니다(혼선 방지).
  const me = await getSession();
  const isEmployee =
    !!me && me.kind === "employee" && me.name.trim().length > 0;
  if (isEmployee) {
    const empName = (me as { name: string }).name.trim();
    // drivers.name 은 UNIQUE 이므로 이름으로 직원을 안전하게 식별합니다.
    const { data: driver, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("name", empName)
      .maybeSingle();
    if (dErr) throw new Error("세션 검증 실패: " + dErr.message);

    if (driver) {
      const driverId = String((driver as { id?: unknown }).id ?? "");
      const { data: judge, error: jErr } = await supabaseAdmin
        .from("recruitment_judges")
        .select("id")
        .eq("posting_id", pid)
        .eq("driver_id", driverId)
        .eq("judge_type", "internal")
        .eq("is_active", true)
        .maybeSingle();
      if (jErr) throw new Error("세션 검증 실패: " + jErr.message);

      if (judge) {
        // 공고 status 재검증 — 보관(archived) 공고는 차단(면접은 published/closed 허용).
        const { data: posting, error: pErr } = await supabase
          .from("recruitment_postings")
          .select("status")
          .eq("id", pid)
          .maybeSingle();
        if (pErr) throw new Error("세션 검증 실패: " + pErr.message);
        const status = String(
          (posting as { status?: string } | null)?.status ?? ""
        );
        if (status === "archived") {
          throw new Error("이 채용은 종료되었습니다.");
        }
        return {
          judgeId: String((judge as { id?: unknown }).id ?? ""),
          name: empName,
          judgeType: "internal",
          postingId: pid,
        };
      }
    }
    // 직원이지만 이 공고 내부위원으로 미배정 → 외부위원 쿠키도 확인(아래) 후 최종 판단.
  }

  // (B) 외부위원 쿠키 경로 — 기존 검증을 그대로 재사용(회귀 없음).
  const extCookie = await getExternalJudgeSession();
  if (extCookie) {
    const session = await requireExternalJudge(); // is_active·공고 status 재검증
    if (session.postingId !== pid) {
      throw new Error("현재 로그인한 공고의 지원자만 채점할 수 있습니다.");
    }
    return {
      judgeId: session.judgeId,
      name: session.name,
      judgeType: "external",
      postingId: pid,
    };
  }

  // (C) 어느 경로도 아님 — 직원이면 미배정 안내, 아니면 외부위원 로그인 안내.
  //     (메시지의 "로그인" 포함 여부로 화면이 외부위원 로그인 버튼 노출을 결정함)
  if (isEmployee) {
    throw new Error(
      "이 공고의 심사위원으로 배정되어 있지 않습니다. 채용 담당자에게 문의하세요."
    );
  }
  throw new Error("외부위원 로그인이 필요합니다.");
}

// requireInterviewJudge 의 비예외 버전 — 화면/목록에서 현재 위원 신원을 조용히 조회.
//   인증 안 됨/미배정이면 null 반환(throw 하지 않음). 진입 분기·집계에 사용.
export async function getInterviewJudgeContext(
  postingId: string
): Promise<InterviewJudgeAuth | null> {
  try {
    return await requireInterviewJudge(postingId);
  } catch {
    return null;
  }
}

// =====================================================================
// 2-D-4) 공고별 외부위원 배정 토글 — /hr/recruitment/[slug]/judges
//   * external_judges_pool 의 위원을 본 공고에 켜고(배정)/끄는(해제) 토글.
//   * 배정 = recruitment_judges 에 is_active=true 스냅샷 행 생성/재활성화
//     (addExternalJudge 와 달리 중복이면 throw 하지 않고 멱등 재활성화).
//   * 해제 = 행을 is_active=false 로 소프트 비활성화. 채점 이력·스냅샷을
//     보존하고, 재배정 시 같은 행을 되살립니다(삭제하지 않음).
//   * 모두 service_role(supabaseAdmin) + requireHrAdmin 게이트.
// =====================================================================
export async function assignJudgeToPosting(
  slug: string,
  poolId: string
): Promise<{ ok: true; judge: Judge } | { ok: false; message: string }> {
  try {
    const me = await requireHrAdmin();
    const s = slug?.trim() ?? "";
    const externalPoolId = poolId?.trim() ?? "";
    if (!s) return { ok: false, message: "공고 정보가 누락되었습니다." };
    if (!externalPoolId)
      return { ok: false, message: "외부위원을 선택해주세요." };

    // getPostingForAdmin 이 requireHrAdmin 재검증 + postingId 해석을 겸함.
    const adm = await getPostingForAdmin(s);
    if (!adm) return { ok: false, message: "공고를 찾을 수 없습니다." };
    const postingId = adm.posting.id;

    // 풀 정보 — name/affiliation/default_role 스냅샷 + 활성 확인.
    const { data: pool, error: pErr } = await supabaseAdmin
      .from("external_judges_pool")
      .select("id, name, affiliation, default_role, is_active")
      .eq("id", externalPoolId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!pool) return { ok: false, message: "존재하지 않는 외부위원입니다." };
    const poolRow = pool as {
      name?: string;
      affiliation?: string;
      default_role?: string;
      is_active?: boolean;
    };
    if (poolRow.is_active === false) {
      return { ok: false, message: "비활성화된 외부위원입니다." };
    }

    // 기존 배정 행이 있으면 재활성화, 없으면 새 스냅샷 insert.
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("recruitment_judges")
      .select("*")
      .eq("posting_id", postingId)
      .eq("external_pool_id", externalPoolId)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);

    let judgeRow: Record<string, unknown>;
    if (existing) {
      const { data: updated, error: upErr } = await supabaseAdmin
        .from("recruitment_judges")
        .update({ is_active: true })
        .eq("id", (existing as { id: unknown }).id)
        .select("*")
        .single();
      if (upErr) throw new Error(upErr.message);
      judgeRow = updated as Record<string, unknown>;
    } else {
      const order = await nextDisplayOrder(postingId);
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("recruitment_judges")
        .insert({
          posting_id: postingId,
          name: String(poolRow.name ?? "").trim(),
          role: poolRow.default_role || "외부위원",
          affiliation: poolRow.affiliation
            ? String(poolRow.affiliation).trim()
            : null,
          judge_type: "external",
          driver_id: null,
          external_pool_id: externalPoolId,
          is_active: true,
          display_order: order,
          created_by: me.name,
        })
        .select("*")
        .single();
      if (insErr) throw new Error(insErr.message);
      judgeRow = inserted as Record<string, unknown>;
    }

    revalidatePath(`/hr/recruitment/${s}/judges`);
    revalidatePath(`/hr/recruitment/${s}`);
    return { ok: true, judge: normalizeJudge(judgeRow) };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "위원 배정 중 오류가 발생했습니다.",
    };
  }
}

export async function unassignJudgeFromPosting(
  slug: string,
  judgeId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireHrAdmin();
    const s = slug?.trim() ?? "";
    const jid = judgeId?.trim() ?? "";
    if (!jid) return { ok: false, message: "심사위원 정보가 누락되었습니다." };

    // 소프트 비활성화 — 채점 이력/스냅샷 보존, 재배정 시 되살림.
    const { error } = await supabaseAdmin
      .from("recruitment_judges")
      .update({ is_active: false })
      .eq("id", jid);
    if (error) throw new Error(error.message);

    if (s) {
      revalidatePath(`/hr/recruitment/${s}/judges`);
      revalidatePath(`/hr/recruitment/${s}`);
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? e.message
          : "위원 배정 해제 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 내부위원(직원) 배정 토글 — /hr/recruitment/[slug]/judges
//   * 외부위원 assignJudgeToPosting 과 동일한 멱등 패턴(재활성화/insert).
//   * 배정 = recruitment_judges 에 judge_type='internal', driver_id 로 행 생성/재활성화.
//   * 해제 = 기존 unassignJudgeFromPosting(slug, judgeId) 로 소프트 비활성화(공용).
//   * name 은 직원명 스냅샷, role 기본값은 직급(rank) 또는 "내부위원".
//   * requireHrAdmin 게이트 + service_role(supabaseAdmin).
// =====================================================================
export async function assignInternalJudgeToPosting(
  slug: string,
  driverId: string
): Promise<{ ok: true; judge: Judge } | { ok: false; message: string }> {
  try {
    const me = await requireHrAdmin();
    const s = slug?.trim() ?? "";
    const dId = driverId?.trim() ?? "";
    if (!s) return { ok: false, message: "공고 정보가 누락되었습니다." };
    if (!dId) return { ok: false, message: "직원을 선택해주세요." };

    const adm = await getPostingForAdmin(s);
    if (!adm) return { ok: false, message: "공고를 찾을 수 없습니다." };
    const postingId = adm.posting.id;

    // 직원 정보 — name 스냅샷 + rank → role 기본값.
    const { data: driver, error: dErr } = await supabase
      .from("drivers")
      .select("id, name, rank")
      .eq("id", dId)
      .maybeSingle();
    if (dErr) throw new Error(dErr.message);
    if (!driver) return { ok: false, message: "존재하지 않는 직원입니다." };
    const dRow = driver as { name?: string; rank?: string | null };
    const role = (dRow.rank && String(dRow.rank).trim()) || "내부위원";

    // 기존 (posting_id, driver_id) 행이 있으면 재활성화, 없으면 새로 insert.
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("recruitment_judges")
      .select("*")
      .eq("posting_id", postingId)
      .eq("driver_id", dId)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);

    let judgeRow: Record<string, unknown>;
    if (existing) {
      const { data: updated, error: upErr } = await supabaseAdmin
        .from("recruitment_judges")
        .update({ is_active: true })
        .eq("id", (existing as { id: unknown }).id)
        .select("*")
        .single();
      if (upErr) throw new Error(upErr.message);
      judgeRow = updated as Record<string, unknown>;
    } else {
      const order = await nextDisplayOrder(postingId);
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("recruitment_judges")
        .insert({
          posting_id: postingId,
          name: String(dRow.name ?? "").trim(),
          role,
          affiliation: null,
          judge_type: "internal",
          driver_id: dId,
          external_pool_id: null,
          is_active: true,
          display_order: order,
          created_by: me.name,
        })
        .select("*")
        .single();
      if (insErr) throw new Error(insErr.message);
      judgeRow = inserted as Record<string, unknown>;
    }

    revalidatePath(`/hr/recruitment/${s}/judges`);
    revalidatePath(`/hr/recruitment/${s}`);
    return { ok: true, judge: normalizeJudge(judgeRow) };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "위원 배정 중 오류가 발생했습니다.",
    };
  }
}
