// =====================================================================
// 채용 점수 — 순수 타입·상수·집계/포맷 헬퍼 (DB·서버 의존성 없음)
//   * 이 모듈은 @/ 별칭이나 서버 전용 모듈(supabaseAdmin 등)을 import 하지
//     않습니다. 따라서 문서 빌더와 단독 테스트 스크립트가 자유롭게 재사용할 수
//     있습니다. DB 로딩(loadReportData)은 recruitmentReport.ts 가 담당합니다.
//   * 점수의 진실은 recruitment_scores (stage = 'screening' | 'interview').
//     서류는 관장·부장(reviewer_name), 면접은 외부위원(reviewer_name)이 채점.
// =====================================================================

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
  memo: string | null;
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

// 점수 표시 — null 은 "—", 소수 1자리(정수면 정수).
export function fmtScore(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toFixed(1).replace(/\.0$/, "");
}

// 특정 채점 항목(q1_expertise 등)을 심사위원 평균으로. 없으면 null.
export function avgScoreKey(
  reviewers: Map<string, ReviewerScore>,
  key: string
): number | null {
  const vals: number[] = [];
  for (const r of reviewers.values()) {
    const v = r.scores[key];
    if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// 서류전형 결과 — status 로부터 합격/불합격/미정.
export function screeningResultLabel(status: ReportStatus): string {
  if (status === "screening_failed") return "불합격";
  if (
    status === "screening_passed" ||
    status === "interview_passed" ||
    status === "interview_failed" ||
    status === "final_passed" ||
    status === "final_rejected"
  ) {
    return "합격";
  }
  return "미정";
}

// 사유 — 심사위원 메모를 "이름: 메모" 로 취합. 없으면 빈 문자열.
export function joinMemos(reviewers: Map<string, ReviewerScore>): string {
  const parts: string[] = [];
  for (const r of reviewers.values()) {
    if (r.memo) parts.push(`${r.reviewer_name}: ${r.memo}`);
  }
  return parts.join(" / ");
}
