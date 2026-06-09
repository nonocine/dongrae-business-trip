"use server";

import { supabase } from "@/lib/supabase";

// 채용 공고 — 조회 페이지가 사용하는 필드만 정의(스코프 최소화).
// 첨부서류(required_documents) 등 지원 단계 필드는 지원 페이지 작업 시
// lib/supabase.ts 로 승격할 예정.
export type RecruitmentPosting = {
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
  notice: string | null;
};

function normalizeRecruitmentPosting(
  raw: Record<string, unknown>
): RecruitmentPosting {
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
    notice: (raw.notice as string | null) ?? null,
  };
}

// 채용 공고 조회 — slug 로 단건 조회.
//   * status='published' 인 공고만 반환합니다.
//   * draft/closed 는 비공개이므로 null 을 반환하고, 페이지에서 404 처리합니다.
export async function getRecruitmentPosting(
  slug: string
): Promise<RecruitmentPosting | null> {
  if (!slug) return null;
  const { data, error } = await supabase
    .from("recruitment_postings")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return normalizeRecruitmentPosting(data as Record<string, unknown>);
}

// 공개 목록/메인 배너용 — "진행 중"(접수중) 공고만 마감 임박순으로.
//   * 진행 중 기준 = status='published' AND application_end >= now.
//     → 마감된 published 공고는 목록/배너에서 제외(헛지원 방지),
//       draft/closed 는 status 조건에서 제외.
//   * 공개 카드에 필요한 요약 필드만 반환. 에러 시 빈 배열(목록/배너 숨김).
//   * 메인 배너(app/page.tsx)는 건수(length)만, 공개 목록(/recruitment)은
//     분야·기간·인원까지 사용합니다.
export type PublishedRecruitmentSummary = {
  slug: string;
  title: string;
  field: string;
  recruit_count: number;
  application_start: string;
  application_end: string;
};

export async function listPublishedRecruitmentSummaries(): Promise<
  PublishedRecruitmentSummary[]
> {
  try {
    const { data, error } = await supabase
      .from("recruitment_postings")
      .select("slug,title,field,recruit_count,application_start,application_end")
      .eq("status", "published")
      .gte("application_end", new Date().toISOString())
      .order("application_end", { ascending: true });
    if (error || !Array.isArray(data)) return [];
    return data.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        slug: String(row.slug ?? ""),
        title: String(row.title ?? ""),
        field: String(row.field ?? ""),
        recruit_count: Number(row.recruit_count ?? 0),
        application_start: String(row.application_start ?? ""),
        application_end: String(row.application_end ?? ""),
      };
    });
  } catch {
    return [];
  }
}
