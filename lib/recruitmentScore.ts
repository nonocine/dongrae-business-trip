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
//     statement, career_years. 각 값은 선택된 보기 점수.
//   * 2026-2 이전 채용은 6번째 항목이 정성평가(qualitative)였습니다. 이번
//     개편부터 경력평가(career_years, 0~5년)로 교체. 과거 qualitative 기록은
//     정규화·문서에서 옛 라벨("정성평가")로 그대로 표시합니다(감사 대비, 불변).
//   * UI(ScreeningScoreCard)·서버 검증(saveScreeningScore)·문서 빌더가
//     모두 이 한 곳을 진실로 삼습니다.
// =====================================================================
export type ScreeningGroupKey = "expertise" | "statement" | "career";

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
    // 2026-2 이전에는 정성평가(qualitative, 우수5/보통3/미흡1)였던 슬롯.
    // 이번 개편부터 경력평가로 교체. 과거 qualitative 기록은 하위호환 표시.
    key: "career_years",
    group: "career",
    title: "경력평가",
    options: [
      { label: "5년 이상", value: 5 },
      { label: "4년 이상", value: 4 },
      { label: "3년 이상", value: 3 },
      { label: "2년 이상", value: 2 },
      { label: "1년 이상", value: 1 },
      { label: "0년(경력 없음)", value: 0 },
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
}[] = (["expertise", "statement", "career"] as ScreeningGroupKey[]).map(
  (g) => ({
    key: g,
    title:
      g === "expertise"
        ? "전문성"
        : g === "statement"
          ? "자기소개서"
          : "경력평가",
    max: SCREENING_ITEMS.filter((it) => it.group === g).reduce(
      (sum, it) => sum + screeningItemMax(it),
      0
    ),
  })
);

// 한 항목 값이 유효한지 — 미선택(0) 또는 정의된 보기 점수 중 하나.
//   * 경력평가(career_years)는 "0년(경력 없음)=0"이 정식 보기이므로 0도 정상
//     선택값입니다. 미선택과 0점 선택은 UI 상태(number|null)로 구분하고, 저장
//     시에는 둘 다 득점 0으로 동일하게 합산됩니다(jsonb 스키마 불변 제약).
export function isValidScreeningValue(item: ScreeningItem, v: number): boolean {
  if (!Number.isFinite(v)) return false;
  if (v === 0) return true; // 미선택, 또는 경력평가 0년 선택
  return item.options.some((o) => o.value === v);
}

// =====================================================================
// 면접 채점 기준표 — 항목 4종(q1~q4), 총 65점. 보기 택1(미선택 없음).
//   * recruitment_scores(stage='interview') 의 scores jsonb 키: q1, q2, q3, q4.
//   * UI(InterviewFlow)·서버 검증(saveInterviewScore)·집계 표·문서 빌더가
//     모두 이 한 곳을 진실로 삼습니다. (배점 20/15/15/15 = 65)
//   * options 는 PDF 원본 면접 심사표 척도(매우적합/적합/양호/보통)와 동일.
// =====================================================================
export type InterviewOption = { label: string; value: number };

export type InterviewItem = {
  key: string; // scores jsonb 키 (q1~q4)
  title: string; // 화면 표시용 전체 제목
  shortTitle: string; // 표 헤더용 축약 제목
  sub: string; // 세부 평가요소(부제)
  max: number; // 배점(=options 중 최댓값)
  options: InterviewOption[]; // 보기(택1)
};

const INTERVIEW_OPTIONS_20: InterviewOption[] = [
  { label: "매우적합", value: 20 },
  { label: "적합", value: 15 },
  { label: "양호", value: 10 },
  { label: "보통", value: 5 },
];
const INTERVIEW_OPTIONS_15: InterviewOption[] = [
  { label: "매우적합", value: 15 },
  { label: "적합", value: 12 },
  { label: "양호", value: 9 },
  { label: "보통", value: 6 },
];

export const INTERVIEW_ITEMS: InterviewItem[] = [
  {
    key: "q1",
    title: "① 청소년활동 운영의 이해도 및 업무수행 능력",
    shortTitle: "①운영이해도",
    sub: "업무관련 지식 · 의사소통 능력 · 관계형성 능력 · 운영계획",
    max: 20,
    options: INTERVIEW_OPTIONS_20,
  },
  {
    key: "q2",
    title: "② 교육자적 자질과 인생·직업·사회관",
    shortTitle: "②교육자적자질",
    sub: "교육자적 소양 · 용모·표정·인상 · 사고방식·성품",
    max: 15,
    options: INTERVIEW_OPTIONS_15,
  },
  {
    key: "q3",
    title: "③ 성실성",
    shortTitle: "③성실성",
    sub: "근로의식 · 책임의식 · 성취욕구",
    max: 15,
    options: INTERVIEW_OPTIONS_15,
  },
  {
    key: "q4",
    title: "④ 업무에 대한 적극성",
    shortTitle: "④적극성",
    sub: "입사 후 목표 · 달성의지 · 고난극복 경험",
    max: 15,
    options: INTERVIEW_OPTIONS_15,
  },
];

// 한 항목 값이 유효한지(정의된 보기 점수 중 하나). 면접은 미선택(0)을 허용하지
// 않습니다(불참 처리는 별도 플래그). 저장 검증·UI 가 공유.
export function isValidInterviewValue(item: InterviewItem, v: number): boolean {
  if (!Number.isFinite(v)) return false;
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
//   * scores 는 항목 숫자(q1~q4 등)만 보존. 서명(base64)·도장 식별정보는
//     별도 선택 필드로 둡니다(면접 심사표 도장 자동삽입용, 읽기 전용 확장).
export type ReviewerScore = {
  reviewer_name: string;
  total: number | null;
  is_absent: boolean;
  memo: string | null;
  scores: Record<string, number>;
  // 면접 위원 도장(서명) 결정용 — loadReportData 가 면접 채점에 한해 채웁니다.
  signature_data_url?: string | null; // 채점 시 그린 손서명(base64 png)
  judge_type?: "internal" | "external" | null;
  driver_id?: string | null; // 내부위원 → employee_profiles 조회 키
  external_pool_id?: string | null; // 외부위원 → external_judges_pool 조회 키
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
  // 임용(예정)일 — 최종합격자 공고의 임용일·출근예정일 등에 사용. 없으면 null.
  appointment_date: string | null;
  // 기준급수(직위/직급) — 공고문 빌더와 동일한 salary_grade 컬럼. 없으면 null.
  //   면접 심사표 "모집분야 / 직위" 표기에 사용. (컬럼 자체가 없을 수도 있음)
  salary_grade?: string | null;
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

// 서류 점수(scores jsonb)를 3개 그룹(전문성·자기소개서·경력) 합계로 정규화.
//   * 현행 구조(degree/gpa/youth_cert/national_cert/statement + career_years).
//   * 3번째 그룹(career)은 career_years(신) + qualitative(2026-2 이전 정성평가)
//     를 합산 — 한 기록에는 둘 중 하나만 존재하므로 옛 정성평가 점수가 그대로
//     경력 그룹 열에 보존됩니다(총괄표 표시 라벨은 screeningThirdGroupTitle 로
//     기록의 key 에 따라 "경력평가"/"정성평가"로 분기).
//   * 최고참 레거시(q1_expertise/q2_license/q3_statement 만 있는 옛 데이터)면:
//       전문성 = q1_expertise + q2_license, 자기소개서 = q3_statement, 경력 = 0.
export function normalizeScreeningScores(scores: Record<string, number>): {
  expertise: number;
  statement: number;
  career: number;
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
    // career_years(신) 또는 qualitative(옛 정성평가) 중 존재하는 값이 그대로 반영.
    const career = num("career_years") + num("qualitative");
    return {
      expertise,
      statement,
      career,
      total: expertise + statement + career,
      legacy: false,
    };
  }
  // 최고참 레거시 매핑.
  const expertise = num("q1_expertise") + num("q2_license");
  const statement = num("q3_statement");
  return {
    expertise,
    statement,
    career: 0,
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

// 서류 3번째 그룹의 표시 라벨 — 기록의 scores key 로 판별.
//   * 이번 개편 이후 채점(career_years) → "경력평가".
//   * 개편 이전 기록(qualitative) → "정성평가" (감사 대비, 기록 불변 표시).
//   * 한 공고의 기록은 동질적(전역 기준 교체)이므로 첫 판별값을 사용.
//     기록이 전혀 없으면 현행 기준("경력평가")을 기본값으로 반환.
export function screeningThirdGroupTitle(applicants: ReportApplicant[]): string {
  for (const a of applicants) {
    for (const r of a.screeningByReviewer.values()) {
      if (typeof r.scores["career_years"] === "number") return "경력평가";
      if (typeof r.scores["qualitative"] === "number") return "정성평가";
    }
  }
  return "경력평가";
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
