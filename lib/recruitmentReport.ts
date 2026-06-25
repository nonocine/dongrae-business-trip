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
import type {
  ReportStatus,
  ReviewerScore,
  ReportApplicant,
  ReportPosting,
  ReportData,
} from "@/lib/recruitmentScore";
import { STATUS_LABEL } from "@/lib/recruitmentScore";
import {
  decodeDataUrl,
  downloadHrImage,
} from "@/lib/recruitmentApplicantDocData";

// 순수 점수 모듈의 타입·상수·헬퍼를 그대로 re-export — 기존 import 경로
// (@/lib/recruitmentReport) 를 유지하기 위함. 신규 코드는 둘 중 어느 쪽에서
// 가져와도 됩니다.
export {
  SCREENING_MAX,
  INTERVIEW_MAX,
  TOTAL_MAX,
  STATUS_LABEL,
  fmtScore,
  avgScoreKey,
  screeningResultLabel,
  joinMemos,
} from "@/lib/recruitmentScore";
export type {
  ReportStatus,
  ReviewerScore,
  ReportApplicant,
  ReportPosting,
  ReportData,
} from "@/lib/recruitmentScore";

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

  // 1) 공고. select("*") — salary_grade 등 스키마에 없을 수도 있는 컬럼을
  //   안전하게 흡수(공고문 빌더와 동일 방식). 필요한 필드만 매핑합니다.
  const { data: postRow, error: pErr } = await supabaseAdmin
    .from("recruitment_postings")
    .select("*")
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
    appointment_date: (pr.appointment_date as string | null) ?? null,
    salary_grade: (pr.salary_grade as string | null) ?? null,
  };

  // 필수 증빙서류 key 목록 — 지원자별 미제출 판정에 사용.
  const requiredDocKeys: string[] = Array.isArray(pr.required_documents)
    ? (pr.required_documents as unknown[])
        .filter(
          (x): x is Record<string, unknown> =>
            x != null && typeof x === "object" && !Array.isArray(x)
        )
        .filter((x) => x.required === true)
        .map((x) => String(x.key ?? "").trim())
        .filter((k) => k.length > 0)
    : [];

  // 2) 지원자(접수완료 이상). draft 제외.
  const { data: apps, error: aErr } = await supabaseAdmin
    .from("recruitment_applications")
    .select(
      "id, status, submitted_at, screening_reject_reason, applicant:recruitment_applicants(applicant_number, name, phone, birth_date, gender, documents)"
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
    // 필수서류 미제출 판정 — documents jsonb 에 필수 key 값이 비어있으면 미제출.
    const docMap =
      app.documents != null &&
      typeof app.documents === "object" &&
      !Array.isArray(app.documents)
        ? (app.documents as Record<string, unknown>)
        : {};
    const missingRequiredDocs = requiredDocKeys.some((k) => {
      const v = docMap[k];
      return !(typeof v === "string" && v.trim().length > 0);
    });
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
      screeningRejectReason:
        typeof r.screening_reject_reason === "string" &&
        r.screening_reject_reason.trim().length > 0
          ? r.screening_reject_reason.trim()
          : null,
      missingRequiredDocs,
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
      "application_id, stage, reviewer_name, reviewer_id, total_score, is_absent, memo, scores"
    )
    .in("application_id", appIds);
  if (sErr) throw new Error(sErr.message);

  // 3-b) 면접 위원 식별정보 — 도장(서명) 결정에 필요(internal/external·조회키).
  //   reviewer_id(=recruitment_judges.id) → 위원 종류·driver_id·external_pool_id.
  const judgeById = new Map<
    string,
    {
      judge_type: "internal" | "external" | null;
      driver_id: string | null;
      external_pool_id: string | null;
    }
  >();
  const { data: judgeRows } = await supabaseAdmin
    .from("recruitment_judges")
    .select("id, judge_type, driver_id, external_pool_id")
    .eq("posting_id", posting.id);
  for (const jr of (judgeRows ?? []) as Record<string, unknown>[]) {
    const jt = String(jr.judge_type ?? "");
    judgeById.set(String(jr.id ?? ""), {
      judge_type:
        jt === "internal" || jt === "external"
          ? (jt as "internal" | "external")
          : null,
      driver_id: (jr.driver_id as string | null) ?? null,
      external_pool_id: (jr.external_pool_id as string | null) ?? null,
    });
  }

  const screeningReviewers = new Set<string>();
  const interviewReviewers = new Set<string>();

  for (const row of (scoreRows ?? []) as unknown[]) {
    const r = row as Record<string, unknown>;
    const a = appIndex.get(String(r.application_id ?? ""));
    if (!a) continue;
    const reviewer = String(r.reviewer_name ?? "").trim();
    if (!reviewer) continue;
    const memoRaw = r.memo;
    const entry: ReviewerScore = {
      reviewer_name: reviewer,
      total: numOrNull(r.total_score),
      is_absent: r.is_absent === true,
      memo:
        typeof memoRaw === "string" && memoRaw.trim().length > 0
          ? memoRaw.trim()
          : null,
      scores: normScores(r.scores),
    };
    const stage = String(r.stage ?? "");
    if (stage === "interview") {
      // 도장 결정용 — 손서명(base64) + 위원 식별정보를 entry 에 부착.
      const rawScores =
        r.scores != null && typeof r.scores === "object"
          ? (r.scores as Record<string, unknown>)
          : {};
      const sig = rawScores.signature_data_url;
      entry.signature_data_url = typeof sig === "string" ? sig : null;
      const judge = judgeById.get(String(r.reviewer_id ?? ""));
      entry.judge_type = judge?.judge_type ?? null;
      entry.driver_id = judge?.driver_id ?? null;
      entry.external_pool_id = judge?.external_pool_id ?? null;
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

// =====================================================================
// loadInterviewStamps — 면접 위원별 도장(서명) 바이트를 결정해 반환.
//   key = reviewer_name, value = 이미지 바이트(png/jpg 등). 우선순위:
//     · 내부위원: employee_profiles.stamp_path → downloadHrImage
//     · 외부위원: external_judges_pool.stamp_path → downloadHrImage,
//                없으면 채점 시 그린 signature_data_url(base64) → decodeDataUrl
//     · 그 외/없음: 미포함(빌더가 "(인)" 텍스트로 폴백)
//   * 빌더는 순수 — 바이트 다운로드/디코딩은 이 로더에서 수행 후 주입.
//   * loadReportData(미인증 시 redirect) 결과를 입력으로 받으므로 별도 게이트 불필요.
// =====================================================================
export async function loadInterviewStamps(
  data: ReportData
): Promise<Map<string, Uint8Array>> {
  // 위원별 식별정보 1건씩 수집(이름 기준). 서명은 처음 발견된 비어있지 않은 값.
  type Ident = {
    judge_type: "internal" | "external" | null;
    driver_id: string | null;
    external_pool_id: string | null;
    signature_data_url: string | null;
  };
  const byReviewer = new Map<string, Ident>();
  for (const a of data.applicants) {
    for (const [nm, e] of a.interviewByReviewer) {
      const prev = byReviewer.get(nm);
      if (!prev) {
        byReviewer.set(nm, {
          judge_type: e.judge_type ?? null,
          driver_id: e.driver_id ?? null,
          external_pool_id: e.external_pool_id ?? null,
          signature_data_url: e.signature_data_url ?? null,
        });
      } else if (!prev.signature_data_url && e.signature_data_url) {
        prev.signature_data_url = e.signature_data_url;
      }
    }
  }
  if (byReviewer.size === 0) return new Map();

  // 조회 키 모으기.
  const driverIds = new Set<string>();
  const poolIds = new Set<string>();
  for (const id of byReviewer.values()) {
    if (id.driver_id) driverIds.add(id.driver_id);
    if (id.external_pool_id) poolIds.add(id.external_pool_id);
  }

  // stamp_path 조회(내부=employee_profiles, 외부=external_judges_pool).
  const profileStamp = new Map<string, string>();
  if (driverIds.size > 0) {
    const { data: rows } = await supabaseAdmin
      .from("employee_profiles")
      .select("driver_id, stamp_path")
      .in("driver_id", [...driverIds]);
    for (const r of (rows ?? []) as Record<string, unknown>[]) {
      const p = r.stamp_path;
      if (typeof p === "string" && p.trim())
        profileStamp.set(String(r.driver_id ?? ""), p);
    }
  }
  const poolStamp = new Map<string, string>();
  if (poolIds.size > 0) {
    const { data: rows } = await supabaseAdmin
      .from("external_judges_pool")
      .select("id, stamp_path")
      .in("id", [...poolIds]);
    for (const r of (rows ?? []) as Record<string, unknown>[]) {
      const p = r.stamp_path;
      if (typeof p === "string" && p.trim())
        poolStamp.set(String(r.id ?? ""), p);
    }
  }

  // 위원별 바이트 결정.
  const out = new Map<string, Uint8Array>();
  for (const [nm, id] of byReviewer) {
    let bytes: Uint8Array | null = null;
    if (id.judge_type === "internal" && id.driver_id) {
      bytes = await downloadHrImage(profileStamp.get(id.driver_id) ?? null);
    } else if (id.judge_type === "external" && id.external_pool_id) {
      const path = poolStamp.get(id.external_pool_id) ?? null;
      bytes = path
        ? await downloadHrImage(path)
        : decodeDataUrl(id.signature_data_url);
    } else {
      // 위원 식별 실패 시에도 손서명이 있으면 사용(외부위원 폴백과 동일).
      bytes = decodeDataUrl(id.signature_data_url);
    }
    if (bytes) out.set(nm, bytes);
  }
  return out;
}
