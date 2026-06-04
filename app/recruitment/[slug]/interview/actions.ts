"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
    const reviewerName = String(formData.get("reviewer_name") ?? "").trim();
    const signature = String(formData.get("signature") ?? "").trim();

    if (!slug) return { ok: false, message: "공고 정보가 누락되었습니다." };
    if (!applicationId)
      return { ok: false, message: "지원자가 선택되지 않았습니다." };
    if (!reviewerName)
      return { ok: false, message: "심사위원 이름이 필요합니다." };
    if (!signature || !signature.startsWith("data:image/")) {
      return { ok: false, message: "서명이 필요합니다." };
    }

    const p = await getInterviewPosting(slug);
    if (!p) return { ok: false, message: "공고를 찾을 수 없습니다." };

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
        reviewer_name: reviewerName,
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
      { onConflict: "application_id,stage,reviewer_name" }
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
