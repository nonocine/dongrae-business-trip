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

// =====================================================================
// 서류 채점 기준표 — 클릭 선택식(택1) 세부항목 6종, 총 35점.
//   * scores jsonb 키: degree, gpa, youth_cert, national_cert,
//     statement, qualitative. 각 값은 선택된 보기 점수(미선택=0).
//   * UI(ScreeningScoreCard)·서버 검증(saveScreeningScore)·문서 빌더가
//     모두 이 한 곳을 진실로 삼습니다.
// =====================================================================
export type ScreeningGroupKey = "expertise" | "statement" | "qualitative";

export type ScreeningOption = { label: string; value: number };

export type ScreeningItem = {
  key: string; // scores jsonb 키
  group: ScreeningGroupKey;
  title: string; // 예: "학위"
  options: ScreeningOption[]; // 보기(택1). 최대 점수는 options 중 최댓값.
};

export const SCREENING_ITEMS: ScreeningItem[] = [
  {
    key: "degree",
    group: "expertise",
    title: "학위",
    options: [
      { label: "박사", value: 5 },
      { label: "석사", value: 3 },
      { label: "학사", value: 2 },
      { label: "전문학사", value: 1 },
    ],
  },
  {
    key: "gpa",
    group: "expertise",
    title: "최종학위 성적",
    options: [
      { label: "4.5~4.0", value: 5 },
      { label: "3.9~3.5", value: 3 },
      { label: "3.4~3.0", value: 2 },
      { label: "2.9~2.5", value: 1 },
    ],
  },
  {
    key: "youth_cert",
    group: "expertise",
    title: "청소년지도사",
    options: [
      { label: "1급", value: 5 },
      { label: "2급", value: 4 },
      { label: "3급", value: 2 },
    ],
  },
  {
    key: "national_cert",
    group: "expertise",
    title: "국가자격증 보유",
    options: [
      { label: "3개 이상", value: 5 },
      { label: "2개 이상", value: 4 },
      { label: "1개 이상", value: 2 },
    ],
  },
  {
    key: "statement",
    group: "statement",
    title: "자기소개서",
    options: [
      { label: "우수", value: 10 },
      { label: "보통", value: 5 },
      { label: "미흡", value: 3 },
    ],
  },
  {
    key: "qualitative",
    group: "qualitative",
    title: "정성평가",
    options: [
      { label: "우수", value: 5 },
      { label: "보통", value: 3 },
      { label: "미흡", value: 1 },
    ],
  },
];

// 한 항목의 최대 점수(보기 중 최댓값).
export function screeningItemMax(item: ScreeningItem): number {
  return item.options.reduce((m, o) => Math.max(m, o.value), 0);
}

// 그룹(전문성/자기소개서/정성평가) 표시 정보 + 만점.
export const SCREENING_GROUPS: {
  key: ScreeningGroupKey;
  title: string;
  max: number;
}[] = (["expertise", "statement", "qualitative"] as ScreeningGroupKey[]).map(
  (g) => ({
    key: g,
    title:
      g === "expertise"
        ? "전문성"
        : g === "statement"
          ? "자기소개서"
          : "정성평가",
    max: SCREENING_ITEMS.filter((it) => it.group === g).reduce(
      (sum, it) => sum + screeningItemMax(it),
      0
    ),
  })
);

// 한 항목 값이 유효한지(미선택=0 또는 정의된 보기 점수 중 하나).
export function isValidScreeningValue(item: ScreeningItem, v: number): boolean {
  if (!Number.isFinite(v)) return false;
  if (v === 0) return true; // 미선택
  return item.options.some((o) => o.value === v);
}

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
  // 서류 불합격 사유(recruitment_applications.screening_reject_reason).
  screeningRejectReason: string | null;
  // 필수 증빙서류 중 하나라도 미제출이면 true(요약 문장의 M 집계용).
  missingRequiredDocs: boolean;
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

// 서류 점수(scores jsonb)를 신 구조 기준 그룹 합계로 정규화.
//   * 신 구조(degree/gpa/... 키)면 그대로 그룹 합산.
//   * 레거시(q1_expertise/q2_license/q3_statement 키만 있는 옛 데이터)면:
//       전문성 = q1_expertise + q2_license(옛 자격증을 전문성에 흡수),
//       자기소개서 = q3_statement, 정성평가 = 0.
//     → 득점 합계는 옛 총점과 동일하게 보존되고, 총괄표 열도 깨지지 않습니다.
export function normalizeScreeningScores(scores: Record<string, number>): {
  expertise: number;
  statement: number;
  qualitative: number;
  total: number;
  legacy: boolean;
} {
  const num = (k: string) =>
    typeof scores[k] === "number" && Number.isFinite(scores[k])
      ? scores[k]
      : 0;
  const hasNew = SCREENING_ITEMS.some(
    (it) =>
      typeof scores[it.key] === "number" && Number.isFinite(scores[it.key])
  );
  if (hasNew) {
    const expertise =
      num("degree") + num("gpa") + num("youth_cert") + num("national_cert");
    const statement = num("statement");
    const qualitative = num("qualitative");
    return {
      expertise,
      statement,
      qualitative,
      total: expertise + statement + qualitative,
      legacy: false,
    };
  }
  // 레거시 매핑.
  const expertise = num("q1_expertise") + num("q2_license");
  const statement = num("q3_statement");
  return {
    expertise,
    statement,
    qualitative: 0,
    total: expertise + statement,
    legacy: true,
  };
}

// 그룹 점수를 심사위원 평균으로(신·레거시 혼재 모두 처리). 없으면 null.
export function avgScreeningGroup(
  reviewers: Map<string, ReviewerScore>,
  group: ScreeningGroupKey
): number | null {
  const vals: number[] = [];
  for (const r of reviewers.values()) {
    vals.push(normalizeScreeningScores(r.scores)[group]);
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
