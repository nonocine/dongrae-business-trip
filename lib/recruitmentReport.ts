// =====================================================================
// 채용 문서 자동생성 — 공유 데이터 로더 + 집계
//   * ERP용 xlsx, 최종 심사 총괄표 docx 등 모든 문서가 동일한 점수 집계를
//     사용하므로 한 곳에 모읍니다.
//   * 점수의 진실은 recruitment_scores (stage = 'screening' | 'interview').
//     서류는 관장·부장(reviewer_name), 면접은 외부위원(reviewer_name)이 채점.
//   * 집계 규칙은 ScreeningDashboard 의 aggregateScores 와 동일:
//       - 단계별 평균 = total_score(null 제외)의 산술평균
//       - 총점 = 서류평균 + 면접평균 (한쪽만 있으면 그쪽 값)
//       - 순위 = 총점 내림차순
//   * service_role(supabaseAdmin) + requireHrAdmin 게이트. 서버 전용 모듈.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireHrAdmin } from "@/app/hr/actions";

export const SCREENING_MAX = 35;
export const INTERVIEW_MAX = 65;
export const TOTAL_MAX = SCREENING_MAX + INTERVIEW_MAX;

export type ReportStatus =
  | "draft"
  | "submitted"
  | "screening_passed"
  | "screening_failed"
  | "interview_passed"
  | "interview_failed"
  | "final_passed"
  | "final_rejected";

export const STATUS_LABEL: Record<ReportStatus, string> = {
  draft: "임시저장",
  submitted: "접수완료",
  screening_passed: "서류합격",
  screening_failed: "서류불합격",
  interview_passed: "면접합격",
  interview_failed: "면접불합격",
  final_passed: "최종합격",
  final_rejected: "최종불합격",
};

// 한 심사위원의 한 지원자에 대한 채점 1건.
export type ReviewerScore = {
  reviewer_name: string;
  total: number | null;
  is_absent: boolean;
  scores: Record<string, number>;
};

export type ReportApplicant = {
  application_id: string;
  applicant_number: string;
  name: string;
  phone: string;
  birth_date: string;
  gender: "M" | "F" | null;
  status: ReportStatus;
  submitted_at: string | null;
  // reviewer_name -> 채점
  screeningByReviewer: Map<string, ReviewerScore>;
  interviewByReviewer: Map<string, ReviewerScore>;
  screeningAvg: number | null;
  interviewAvg: number | null;
  total: number | null;
  rank: number; // 1-based, 총점 내림차순
};

export type ReportPosting = {
  id: string;
  slug: string;
  title: string;
  field: string;
  recruit_count: number;
  status: string;
};

export type ReportData = {
  posting: ReportPosting;
  applicants: ReportApplicant[]; // 총점 내림차순 정렬 + rank 부여
  screeningReviewers: string[]; // distinct, 이름순
  interviewReviewers: string[]; // distinct, 이름순
};

function asStatus(raw: unknown): ReportStatus {
  const s = String(raw ?? "");
  return (s in STATUS_LABEL ? s : "submitted") as ReportStatus;
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normScores(raw: unknown): Record<string, number> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

// 평균 — total_score 가 null 이 아닌 채점만 대상. 없으면 null.
function avg(scores: ReviewerScore[]): number | null {
  const vals = scores
    .map((s) => s.total)
    .filter((t): t is number => t != null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// =====================================================================
// loadReportData — 공고 1건의 전체 채점 데이터를 집계해 반환.
//   * requireHrAdmin: 미통과 시 '/' 로 redirect (Route Handler 에서도 동작).
//   * 문서엔 첨부서류 signed URL 이 필요 없으므로 URL 서명은 하지 않습니다.
// =====================================================================
export async function loadReportData(
  slug: string
): Promise<ReportData | null> {
  await requireHrAdmin();
  const s = slug?.trim() ?? "";
  if (!s) return null;

  // 1) 공고.
  const { data: postRow, error: pErr } = await supabaseAdmin
    .from("recruitment_postings")
    .select("id, slug, title, field, recruit_count, status")
    .eq("slug", s)
    .maybeSingle();
  if (pErr) throw new Error(pErr.message);
  if (!postRow) return null;
  const pr = postRow as Record<string, unknown>;
  const posting: ReportPosting = {
    id: String(pr.id ?? ""),
    slug: String(pr.slug ?? ""),
    title: String(pr.title ?? ""),
    field: String(pr.field ?? ""),
    recruit_count: Number(pr.recruit_count ?? 0),
    status: String(pr.status ?? ""),
  };

  // 2) 지원자(접수완료 이상). draft 제외.
  const { data: apps, error: aErr } = await supabaseAdmin
    .from("recruitment_applications")
    .select(
      "id, status, submitted_at, applicant:recruitment_applicants(applicant_number, name, phone, birth_date, gender)"
    )
    .eq("posting_id", posting.id)
    .neq("status", "draft")
    .order("submitted_at", { ascending: true });
  if (aErr) throw new Error(aErr.message);

  const applicants: ReportApplicant[] = [];
  const appIndex = new Map<string, ReportApplicant>();
  for (const row of (apps ?? []) as unknown[]) {
    const r = row as Record<string, unknown>;
    const app = r.applicant as Record<string, unknown> | null;
    if (!app) continue;
    const a: ReportApplicant = {
      application_id: String(r.id ?? ""),
      applicant_number: String(app.applicant_number ?? ""),
      name: String(app.name ?? ""),
      phone: String(app.phone ?? ""),
      birth_date: String(app.birth_date ?? ""),
      gender: (app.gender as "M" | "F" | null) ?? null,
      status: asStatus(r.status),
      submitted_at: (r.submitted_at as string | null) ?? null,
      screeningByReviewer: new Map(),
      interviewByReviewer: new Map(),
      screeningAvg: null,
      interviewAvg: null,
      total: null,
      rank: 0,
    };
    applicants.push(a);
    appIndex.set(a.application_id, a);
  }

  if (applicants.length === 0) {
    return {
      posting,
      applicants: [],
      screeningReviewers: [],
      interviewReviewers: [],
    };
  }

  // 3) 점수 — 본 공고 application_id 전체.
  const appIds = applicants.map((a) => a.application_id);
  const { data: scoreRows, error: sErr } = await supabaseAdmin
    .from("recruitment_scores")
    .select(
      "application_id, stage, reviewer_name, total_score, is_absent, scores"
    )
    .in("application_id", appIds);
  if (sErr) throw new Error(sErr.message);

  const screeningReviewers = new Set<string>();
  const interviewReviewers = new Set<string>();

  for (const row of (scoreRows ?? []) as unknown[]) {
    const r = row as Record<string, unknown>;
    const a = appIndex.get(String(r.application_id ?? ""));
    if (!a) continue;
    const reviewer = String(r.reviewer_name ?? "").trim();
    if (!reviewer) continue;
    const entry: ReviewerScore = {
      reviewer_name: reviewer,
      total: numOrNull(r.total_score),
      is_absent: r.is_absent === true,
      scores: normScores(r.scores),
    };
    const stage = String(r.stage ?? "");
    if (stage === "interview") {
      a.interviewByReviewer.set(reviewer, entry);
      interviewReviewers.add(reviewer);
    } else {
      a.screeningByReviewer.set(reviewer, entry);
      screeningReviewers.add(reviewer);
    }
  }

  // 4) 평균/총점.
  for (const a of applicants) {
    a.screeningAvg = avg([...a.screeningByReviewer.values()]);
    a.interviewAvg = avg([...a.interviewByReviewer.values()]);
    a.total =
      a.screeningAvg != null && a.interviewAvg != null
        ? a.screeningAvg + a.interviewAvg
        : a.screeningAvg != null
          ? a.screeningAvg
          : a.interviewAvg;
  }

  // 5) 총점 내림차순 정렬 + 순위(동점은 입력 순서 유지).
  applicants.sort((x, y) => (y.total ?? -1) - (x.total ?? -1));
  applicants.forEach((a, i) => {
    a.rank = i + 1;
  });

  return {
    posting,
    applicants,
    screeningReviewers: [...screeningReviewers].sort((a, b) =>
      a.localeCompare(b, "ko")
    ),
    interviewReviewers: [...interviewReviewers].sort((a, b) =>
      a.localeCompare(b, "ko")
    ),
  };
}

// 점수 표시 — null 은 "—", 소수 1자리(정수면 정수).
export function fmtScore(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toFixed(1).replace(/\.0$/, "");
}
