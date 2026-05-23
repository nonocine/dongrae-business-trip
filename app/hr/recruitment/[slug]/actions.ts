"use server";

import { revalidatePath } from "next/cache";
import {
  supabase,
  signHrDocument,
  removeHrDocuments,
  parseEducationInput,
  parseLicenseInput,
  parseCareerInput,
  parseAwardInput,
  parseTrainingInput,
  type EmployeeEducation,
  type EmployeeLicense,
  type EmployeeCareer,
  type EmployeeAward,
  type EmployeeTraining,
} from "@/lib/supabase";
import { requireHrAdmin } from "@/app/hr/actions";

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
      "id,slug,title,field,recruit_count,status,application_end,required_documents"
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

  const { data: apps, error: aErr } = await supabase
    .from("recruitment_applications")
    .select(
      "id, applicant_id, status, submitted_at, applicant:recruitment_applicants(*)"
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

  const { data: appRows, error: e1 } = await supabase
    .from("recruitment_applications")
    .select("id")
    .eq("posting_id", adm.posting.id);
  if (e1) throw new Error(e1.message);
  const ids = (appRows ?? []).map((x) => String((x as { id: unknown }).id));
  if (ids.length === 0) return [];

  const { data, error } = await supabase
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
// 서류 채점 저장 — 35점 만점 (15+5+15)
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

    const q1 = Number(formData.get("q1_expertise") ?? NaN);
    const q2 = Number(formData.get("q2_license") ?? NaN);
    const q3 = Number(formData.get("q3_statement") ?? NaN);
    if (!Number.isFinite(q1) || q1 < 0 || q1 > 15)
      return { ok: false, message: "전문성 점수는 0~15 사이여야 합니다." };
    if (!Number.isFinite(q2) || q2 < 0 || q2 > 5)
      return { ok: false, message: "자격증 점수는 0~5 사이여야 합니다." };
    if (!Number.isFinite(q3) || q3 < 0 || q3 > 15)
      return {
        ok: false,
        message: "자기소개서 점수는 0~15 사이여야 합니다.",
      };

    const total = q1 + q2 + q3;
    const memoRaw = formData.get("memo");
    const memo =
      typeof memoRaw === "string" && memoRaw.trim().length > 0
        ? memoRaw.trim()
        : null;

    const { error } = await supabase.from("recruitment_scores").upsert(
      {
        application_id: applicationId,
        stage: "screening",
        reviewer_name: me.name,
        scores: { q1_expertise: q1, q2_license: q2, q3_statement: q3 },
        total_score: total,
        max_score: 35,
        is_absent: false,
        memo,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "application_id,stage,reviewer_name" }
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

    const { error } = await supabase
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
    const { data: rows, error } = await supabase
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
        const { error: upErr } = await supabase
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
