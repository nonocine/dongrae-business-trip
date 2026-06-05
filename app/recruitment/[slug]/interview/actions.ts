"use server";

import { revalidatePath } from "next/cache";
import {
  supabase,
  signHrDocument,
  parseEducationInput,
  parseCareerInput,
  type EmployeeEducation,
  type EmployeeCareer,
} from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireExternalJudge } from "@/app/hr/recruitment/[slug]/actions";

// =====================================================================
// 면접 채점 — /recruitment/[slug]/interview
//   * 공개 접근 (외부 심사위원도 URL 받아서 접속).
//   * 인증 없음 — 심사위원 이름과 서명 이미지로 본인 식별.
//   * 정상 운영 환경에서는 면접관에게 직접 URL 안내하여 사용.
// =====================================================================

export type InterviewPosting = {
  id: string;
  slug: string;
  title: string;
  field: string;
};

export type InterviewCandidate = {
  application_id: string;
  applicant_id: string;
  applicant_number: string;
  name: string;
  birth_date: string;
  scored: boolean; // 동일 reviewer_name 으로 이미 저장된 점수가 있는지
};

// 공고 조회 — published / closed 둘 다 허용 (마감 후에도 면접 진행 가능).
export async function getInterviewPosting(
  slug: string
): Promise<InterviewPosting | null> {
  if (!slug) return null;
  const { data, error } = await supabase
    .from("recruitment_postings")
    .select("id,slug,title,field,status")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const status = String(r.status ?? "");
  if (status !== "published" && status !== "closed") return null;
  return {
    id: String(r.id ?? ""),
    slug: String(r.slug ?? ""),
    title: String(r.title ?? ""),
    field: String(r.field ?? ""),
  };
}

// 면접 대상자 — 서류합격 이후 단계.
//   * reviewerName 이 주어지면 본인이 이미 채점한 지원자 표시(scored=true).
export async function listInterviewCandidates(
  slug: string,
  reviewerName: string
): Promise<InterviewCandidate[]> {
  const p = await getInterviewPosting(slug);
  if (!p) return [];

  const { data: apps, error } = await supabaseAdmin
    .from("recruitment_applications")
    .select(
      "id, applicant_id, status, applicant:recruitment_applicants(applicant_number, name, birth_date)"
    )
    .eq("posting_id", p.id)
    .in("status", [
      "screening_passed",
      "interview_passed",
      "interview_failed",
      "final_passed",
      "final_rejected",
    ]);
  if (error) throw new Error(error.message);
  if (!apps) return [];

  const appIds = apps.map((x) => String((x as { id: unknown }).id));
  let scoredSet = new Set<string>();
  const rn = reviewerName.trim();
  if (rn.length > 0 && appIds.length > 0) {
    const { data: scored } = await supabaseAdmin
      .from("recruitment_scores")
      .select("application_id")
      .eq("stage", "interview")
      .eq("reviewer_name", rn)
      .in("application_id", appIds);
    scoredSet = new Set(
      (scored ?? []).map((x) =>
        String((x as { application_id: unknown }).application_id)
      )
    );
  }

  return apps.map((row) => {
    const r = row as Record<string, unknown>;
    const app = r.applicant as Record<string, unknown> | null;
    const appId = String(r.id ?? "");
    return {
      application_id: appId,
      applicant_id: String(r.applicant_id ?? ""),
      applicant_number: String(app?.applicant_number ?? ""),
      name: String(app?.name ?? ""),
      birth_date: String(app?.birth_date ?? ""),
      scored: scoredSet.has(appId),
    };
  });
}

const ALLOWED_Q1 = [20, 15, 10, 5];
const ALLOWED_OTHER = [15, 12, 9, 6];

export async function saveInterviewScore(
  formData: FormData
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const slug = String(formData.get("slug") ?? "").trim();
    const applicationId = String(
      formData.get("application_id") ?? ""
    ).trim();
    const signature = String(formData.get("signature") ?? "").trim();

    if (!slug) return { ok: false, message: "공고 정보가 누락되었습니다." };
    if (!applicationId)
      return { ok: false, message: "지원자가 선택되지 않았습니다." };
    if (!signature || !signature.startsWith("data:image/")) {
      return { ok: false, message: "서명이 필요합니다." };
    }

    // (1) 외부위원 세션 확인 — dongrae_external_judge 쿠키 파싱 + DB 재검증.
    //     requireExternalJudge 가 위원 is_active·공고 status 까지 재확인하므로
    //     쿠키 없음/위원 비활성/공고 종료면 throw → 명확한 메시지로 거부.
    //     service_role 전환 후 RLS 가 없으므로 이 액션이 유일한 방어선입니다.
    let session: Awaited<ReturnType<typeof requireExternalJudge>>;
    try {
      session = await requireExternalJudge();
    } catch (e) {
      return {
        ok: false,
        message:
          e instanceof Error
            ? e.message
            : "외부위원 로그인이 필요합니다. 다시 로그인해주세요.",
      };
    }

    const p = await getInterviewPosting(slug);
    if (!p) return { ok: false, message: "공고를 찾을 수 없습니다." };

    // (3) 위원 배정 검증 — 로그인 세션의 공고와 제출 대상 공고가 일치해야 함.
    //     (requireExternalJudge 가 session.judgeId 의 is_active=true 를 이미
    //      확인하므로, 공고 일치까지 보장되면 "이 공고에 배정된 활성 위원".)
    if (session.postingId !== p.id) {
      return {
        ok: false,
        message: "현재 로그인한 공고의 지원자만 채점할 수 있습니다.",
      };
    }

    // (2) 지원자 검증 — application_id 가 이 공고에 실제로 속한 지원서인지 확인.
    const { data: appRow, error: appErr } = await supabaseAdmin
      .from("recruitment_applications")
      .select("id, posting_id")
      .eq("id", applicationId)
      .maybeSingle();
    if (appErr) throw new Error(appErr.message);
    if (
      !appRow ||
      String((appRow as { posting_id?: unknown }).posting_id) !== p.id
    ) {
      return { ok: false, message: "이 공고의 지원자가 아닙니다." };
    }

    // 채점 주체는 세션의 위원(클라이언트가 보낸 이름은 신뢰하지 않음).
    const reviewerName = session.name;

    const isAbsent = String(formData.get("is_absent") ?? "") === "true";

    let q1 = 0;
    let q2 = 0;
    let q3 = 0;
    let q4 = 0;
    if (!isAbsent) {
      q1 = Number(formData.get("q1") ?? NaN);
      q2 = Number(formData.get("q2") ?? NaN);
      q3 = Number(formData.get("q3") ?? NaN);
      q4 = Number(formData.get("q4") ?? NaN);
      if (!ALLOWED_Q1.includes(q1))
        return {
          ok: false,
          message: "① 청소년활동 운영 항목의 점수가 유효하지 않습니다.",
        };
      if (!ALLOWED_OTHER.includes(q2))
        return {
          ok: false,
          message: "② 교육자적 자질 항목의 점수가 유효하지 않습니다.",
        };
      if (!ALLOWED_OTHER.includes(q3))
        return {
          ok: false,
          message: "③ 성실성 항목의 점수가 유효하지 않습니다.",
        };
      if (!ALLOWED_OTHER.includes(q4))
        return {
          ok: false,
          message: "④ 적극성 항목의 점수가 유효하지 않습니다.",
        };
    }
    const total = isAbsent ? 0 : q1 + q2 + q3 + q4;
    const memoRaw = String(formData.get("memo") ?? "").trim();
    const memo = memoRaw.length > 0 ? memoRaw : null;

    const { error } = await supabaseAdmin.from("recruitment_scores").upsert(
      {
        application_id: applicationId,
        stage: "interview",
        // (4) 중복 채점 방지 — 충돌 키는 (application_id, stage, reviewer_id).
        //     reviewer_id = judgeId 로 동명이인 위원도 구분(서로 덮어쓰지 않음).
        //     reviewer_name 은 표시용으로 계속 저장(충돌 키에서는 제외).
        reviewer_name: reviewerName,
        reviewer_id: session.judgeId,
        scores: {
          q1,
          q2,
          q3,
          q4,
          signature_data_url: signature,
        },
        total_score: total,
        max_score: 65,
        is_absent: isAbsent,
        memo,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "application_id,stage,reviewer_id" }
    );
    if (error) throw new Error(error.message);

    revalidatePath(`/recruitment/${slug}/interview`);
    revalidatePath(`/hr/recruitment/${slug}`);
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
// 2-D-6) 면접 지원서 상세 — 좌측 패널용
//   * requireExternalJudge 로 인증(로그인한 외부위원만) + 본인 공고 소속 확인.
//   * supabaseAdmin(service_role)로 조회. 외부위원 화면이므로 연락처·이메일·
//     주소·생년월일 등 민감정보는 반환하지 않습니다.
// =====================================================================
export type InterviewDoc = {
  key: string;
  label: string;
  url: string | null;
  kind: "pdf" | "image" | "other";
};

export type InterviewApplicantDetail = {
  name: string;
  field: string;
  education: EmployeeEducation[];
  career: EmployeeCareer[];
  motivation: string | null;
  self_development: string | null;
  career_summary: string | null;
  philosophy: string | null;
  documents: InterviewDoc[];
};

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

type ReqDoc = { key: string; label: string };
function normalizeRequiredDocs(raw: unknown): ReqDoc[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (x): x is Record<string, unknown> =>
        x != null && typeof x === "object" && !Array.isArray(x)
    )
    .map((x) => ({
      key: String(x.key ?? "").trim(),
      label: String(x.label ?? "").trim(),
    }))
    .filter((d) => d.key.length > 0 && d.label.length > 0);
}

function docKind(path: string | null | undefined): InterviewDoc["kind"] {
  if (!path) return "other";
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(jpe?g|png|webp|gif)$/.test(lower)) return "image";
  return "other";
}

export async function getInterviewApplicantDetail(
  applicationId: string
): Promise<
  | { ok: true; detail: InterviewApplicantDetail }
  | { ok: false; message: string }
> {
  try {
    // 인증 — 로그인한 외부위원만(2-D-5 세션). 본인 공고 소속 확인에도 사용.
    const session = await requireExternalJudge();
    const appId = applicationId?.trim() ?? "";
    if (!appId) return { ok: false, message: "지원서 정보가 누락되었습니다." };

    const { data: appRow, error: aErr } = await supabaseAdmin
      .from("recruitment_applications")
      .select(
        "id, posting_id, applicant:recruitment_applicants(name, education, career, motivation, self_development, career_summary, philosophy, documents)"
      )
      .eq("id", appId)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!appRow) return { ok: false, message: "지원서를 찾을 수 없습니다." };
    const row = appRow as Record<string, unknown>;
    if (String(row.posting_id ?? "") !== session.postingId) {
      return { ok: false, message: "이 공고의 지원자가 아닙니다." };
    }
    const applicant = row.applicant as Record<string, unknown> | null;
    if (!applicant) return { ok: false, message: "지원자 정보가 없습니다." };

    // 공고 분야 + 첨부서류 정의(라벨/순서).
    const { data: posting } = await supabaseAdmin
      .from("recruitment_postings")
      .select("field, required_documents")
      .eq("id", session.postingId)
      .maybeSingle();
    const field = String((posting as { field?: unknown } | null)?.field ?? "");
    const requiredDocs = normalizeRequiredDocs(
      (posting as { required_documents?: unknown } | null)?.required_documents
    );

    // 첨부 — 정의된 항목 순서로 1시간 signed URL 발급. 정의 외 키는 뒤에 추가.
    const docMap = normalizeDocuments(applicant.documents);
    const documents: InterviewDoc[] = [];
    for (const rd of requiredDocs) {
      const path = docMap[rd.key];
      documents.push({
        key: rd.key,
        label: rd.label,
        url: path ? await signHrDocument(path) : null,
        kind: docKind(path),
      });
    }
    for (const [k, p] of Object.entries(docMap)) {
      if (!requiredDocs.find((d) => d.key === k)) {
        documents.push({
          key: k,
          label: k,
          url: await signHrDocument(p),
          kind: docKind(p),
        });
      }
    }

    return {
      ok: true,
      detail: {
        name: String(applicant.name ?? ""),
        field,
        education: parseEducationInput(jsonbToString(applicant.education)),
        career: parseCareerInput(jsonbToString(applicant.career)),
        motivation: (applicant.motivation as string | null) ?? null,
        self_development: (applicant.self_development as string | null) ?? null,
        career_summary: (applicant.career_summary as string | null) ?? null,
        philosophy: (applicant.philosophy as string | null) ?? null,
        documents,
      },
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "지원서를 불러오지 못했습니다.",
    };
  }
}
