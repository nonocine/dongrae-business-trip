// 채용 문서 빌더 생성 테스트 — 라이브 DB 없이 엣지케이스 목 데이터로
// 4개 빌더가 throw 없이 유효한(ZIP 시그니처) 파일을 만드는지 검증.
//   실행: npx tsx scripts/test-recruitment-docs.ts
import {
  buildErpWorkbook,
  buildFinalSummaryDoc,
  buildScreeningSummaryDoc,
  buildInterviewNoticeDoc,
} from "../lib/recruitmentDocBuilders";
import type {
  ReportData,
  ReportApplicant,
  ReportStatus,
  ReviewerScore,
} from "../lib/recruitmentScore";

function rs(
  reviewer_name: string,
  total: number | null,
  scores: Record<string, number>,
  opts: { is_absent?: boolean; memo?: string | null } = {}
): ReviewerScore {
  return {
    reviewer_name,
    total,
    is_absent: opts.is_absent ?? false,
    memo: opts.memo ?? null,
    scores,
  };
}

function applicant(
  partial: Partial<ReportApplicant> & {
    name: string;
    applicant_number: string;
    status: ReportStatus;
  }
): ReportApplicant {
  return {
    application_id: partial.application_id ?? "app-" + partial.applicant_number,
    applicant_number: partial.applicant_number,
    name: partial.name,
    phone: partial.phone ?? "01012345678",
    birth_date: partial.birth_date ?? "1998-03-15",
    gender: partial.gender ?? "M",
    status: partial.status,
    submitted_at: partial.submitted_at ?? "2026-06-01T09:00:00Z",
    screeningByReviewer: partial.screeningByReviewer ?? new Map(),
    interviewByReviewer: partial.interviewByReviewer ?? new Map(),
    screeningAvg: partial.screeningAvg ?? null,
    interviewAvg: partial.interviewAvg ?? null,
    total: partial.total ?? null,
    rank: partial.rank ?? 0,
    screeningRejectReason: partial.screeningRejectReason ?? null,
    missingRequiredDocs: partial.missingRequiredDocs ?? false,
  };
}

// 시나리오 1 — 정상: 2서류위원·2면접위원, 결석 1, 이름 2/3/4자.
const normal: ReportData = {
  posting: {
    id: "p1",
    slug: "2026-1",
    title: "동래구청소년센터 직원 채용 (2026년 1차)",
    field: "청소년활동, 청소년상담",
    recruit_count: 2,
    status: "published",
  },
  screeningReviewers: ["관장", "부장"],
  interviewReviewers: ["김외부", "이심사"],
  applicants: [
    applicant({
      name: "남궁민수",
      applicant_number: "2026-0001",
      status: "final_passed",
      // 신 구조(기준표 6종) — 클릭 선택식 데이터.
      screeningByReviewer: new Map([
        ["관장", rs("관장", 33, { degree: 5, gpa: 3, youth_cert: 5, national_cert: 5, statement: 10, qualitative: 5 }, { memo: "전공 적합" })],
        ["부장", rs("부장", 31, { degree: 5, gpa: 3, youth_cert: 4, national_cert: 4, statement: 10, qualitative: 5 })],
      ]),
      interviewByReviewer: new Map([
        ["김외부", rs("김외부", 60, { q1: 20, q2: 15, q3: 12, q4: 13 })],
        ["이심사", rs("이심사", 56, { q1: 15, q2: 15, q3: 12, q4: 14 })],
      ]),
      screeningAvg: 32,
      interviewAvg: 58,
      total: 90,
      rank: 1,
    }),
    applicant({
      name: "이수",
      applicant_number: "2026-0002",
      status: "interview_failed",
      gender: "F",
      screeningByReviewer: new Map([
        ["관장", rs("관장", 28, { degree: 3, gpa: 2, youth_cert: 4, national_cert: 4, statement: 10, qualitative: 5 })],
        ["부장", rs("부장", 30, { degree: 5, gpa: 2, youth_cert: 4, national_cert: 4, statement: 10, qualitative: 5 })],
      ]),
      interviewByReviewer: new Map([
        ["김외부", rs("김외부", 0, { q1: 0, q2: 0, q3: 0, q4: 0 }, { is_absent: true })],
        ["이심사", rs("이심사", 45, { q1: 10, q2: 12, q3: 12, q4: 11 })],
      ]),
      screeningAvg: 29,
      interviewAvg: 22.5,
      total: 51.5,
      rank: 2,
    }),
    applicant({
      name: "박철",
      applicant_number: "2026-0003",
      status: "screening_failed",
      // 불합격 사유 + 증빙서류 미제출 → 요약문장 M 집계·사유열 표시 검증.
      screeningRejectReason: "필수 증빙서류(자격증 사본) 미제출",
      missingRequiredDocs: true,
      // 레거시(2026-1 옛 데이터) — 옛 키로 저장된 데이터가 총괄표에서 깨지지
      // 않고 그룹 합계로 매핑되는지 확인하는 호환 케이스.
      screeningByReviewer: new Map([
        ["관장", rs("관장", 18, { q1_expertise: 8, q2_license: 2, q3_statement: 8 }, { memo: "경력 부족" })],
      ]),
      screeningAvg: 18,
      interviewAvg: null,
      total: 18,
      rank: 3,
    }),
  ],
};

// 시나리오 2 — 빈 공고(지원자 0).
const empty: ReportData = {
  posting: {
    id: "p2",
    slug: "2026-empty",
    title: "지원자 없는 공고",
    field: "행정",
    recruit_count: 1,
    status: "published",
  },
  screeningReviewers: [],
  interviewReviewers: [],
  applicants: [],
};

// 시나리오 3 — 면접 위원 없음(서류만 진행).
const screeningOnly: ReportData = {
  posting: {
    id: "p3",
    slug: "2026-screen",
    title: "서류전형만 진행 중",
    field: "",
    recruit_count: 3,
    status: "published",
  },
  screeningReviewers: ["관장"],
  interviewReviewers: [],
  applicants: [
    applicant({
      name: "홍길동",
      applicant_number: "2026-1001",
      status: "submitted",
      screeningByReviewer: new Map([
        ["관장", rs("관장", 25, { q1_expertise: 10, q2_license: 5, q3_statement: 10 })],
      ]),
      screeningAvg: 25,
      total: 25,
      rank: 1,
    }),
    // 채점 전혀 없는 지원자(모든 평균 null).
    applicant({
      name: "무점수",
      applicant_number: "2026-1002",
      status: "submitted",
      rank: 2,
    }),
  ],
};

const SIG = [0x50, 0x4b, 0x03, 0x04]; // ZIP/OOXML 'PK\x03\x04'

function checkZip(name: string, buf: ArrayBuffer | Buffer): boolean {
  const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  if (u8.byteLength < 100) {
    console.log(`  ✗ ${name}: 너무 작음 (${u8.byteLength} bytes)`);
    return false;
  }
  const ok = SIG.every((b, i) => u8[i] === b);
  console.log(
    `  ${ok ? "✓" : "✗"} ${name}: ${u8.byteLength} bytes, ZIP 시그니처 ${ok ? "정상" : "불일치"}`
  );
  return ok;
}

async function run() {
  const scenarios: [string, ReportData][] = [
    ["정상(2x2,결석,혼합상태)", normal],
    ["빈 공고(0명)", empty],
    ["면접위원0+무점수자", screeningOnly],
  ];
  let pass = 0;
  let fail = 0;

  for (const [label, data] of scenarios) {
    console.log(`\n[시나리오] ${label}`);
    try {
      const xlsx = await buildErpWorkbook(data);
      const d1 = await buildFinalSummaryDoc(data);
      const d2 = await buildScreeningSummaryDoc(data);
      const d3 = await buildInterviewNoticeDoc(data, {
        date: "2026. 6. 20.(금)",
        time: "14:00",
        place: "본관 3층 회의실",
      });
      const results = [
        checkZip("ERP xlsx", xlsx),
        checkZip("최종 총괄표 docx", d1),
        checkZip("서류 총괄표 docx", d2),
        checkZip("면접 공고 docx", d3),
      ];
      results.forEach((r) => (r ? pass++ : fail++));
    } catch (e) {
      fail += 4;
      console.log(`  ✗ throw: ${e instanceof Error ? e.stack : String(e)}`);
    }
  }

  // 마스킹 단독 확인(공고문 핵심 안전장치).
  const { maskName } = await import("../lib/recruitmentDocx");
  const maskCases: [string, string][] = [
    ["김민호", "김○호"],
    ["이수", "이○"],
    ["남궁민수", "남○○수"],
    ["김", "김"],
  ];
  console.log("\n[단위] 이름 마스킹");
  for (const [input, expected] of maskCases) {
    const got = maskName(input);
    const ok = got === expected;
    console.log(`  ${ok ? "✓" : "✗"} ${input} → ${got} (기대 ${expected})`);
    if (ok) pass++;
    else fail++;
  }

  // 심사항목 파싱 — 번호 제목은 왼쪽 열, "·" 줄은 직전 항목 세부로.
  const { parseCriteria } = await import("../lib/recruitmentDocBuilders");
  console.log("\n[단위] 심사항목 파싱");
  const parsed = parseCriteria(
    "1. 사업에 대한 이해\n· 센터 사업에 대한 이해\n2. 전문성\n· 경력 · 자격증"
  );
  const pcOk =
    parsed.length === 2 &&
    parsed[0].item === "1. 사업에 대한 이해" &&
    parsed[1].item === "2. 전문성" &&
    parsed[0].details.length === 1;
  console.log(`  ${pcOk ? "✓" : "✗"} 번호 항목 2개 분리 + 세부 묶음`);
  if (pcOk) pass++;
  else fail++;
  // "·"만(면접) → 빈 item 1행으로 병합.
  const ivParsed = parseCriteria("· 직무 능력\n· 인성");
  const ivOk = ivParsed.length === 1 && ivParsed[0].item === "";
  console.log(`  ${ivOk ? "✓" : "✗"} 번호 없는 "·"만 → 빈 항목 1행`);
  if (ivOk) pass++;
  else fail++;

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  if (fail > 0) process.exit(1);
}

run();
