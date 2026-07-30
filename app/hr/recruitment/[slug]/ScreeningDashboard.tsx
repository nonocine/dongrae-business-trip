"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  cardCls,
  inputCls,
  labelCls,
  btnPrimary,
  btnSecondary,
  badgeSuccess,
  badgeNeutral,
  badgeWarning,
  noticeError,
  noticeSuccess,
  tabBarCls,
  tabNavCls,
  tabItemCls,
  splitRecruitmentFields,
  fieldBadgeCls,
} from "@/lib/ui";
import { fmtKstDateTime, fmtKstDate } from "@/lib/datetime";
import {
  SCREENING_ITEMS,
  SCREENING_GROUPS,
  INTERVIEW_ITEMS,
  screeningItemMax,
} from "@/lib/recruitmentScore";
import {
  saveScreeningScore,
  saveScreeningRejectReason,
  updateApplicationStatus,
  convertApplicantToEmployee,
  bulkAnonymizeApplicants,
  type AdminApplicant,
  type AdminPosting,
  type AppStatus,
  type ScoreEntry,
} from "./actions";

// 상태 라벨 — actions.ts(use server) 에서 값(객체) export 가 금지되므로
// 유일한 소비자인 이 파일에 정의합니다.
const APPLICATION_STATUS_LABEL: Record<AppStatus, string> = {
  draft: "임시저장",
  submitted: "접수완료",
  screening_passed: "서류합격",
  screening_failed: "서류불합격",
  interview_passed: "면접합격",
  interview_failed: "면접불합격",
  final_passed: "최종합격",
  final_rejected: "최종불합격",
};

const SCREENING_MAX = 35;
const INTERVIEW_MAX = 65;

type TabKey = "list" | "detail" | "final";

export default function ScreeningDashboard({
  posting,
  applicants,
  scores,
  myReviewerName,
  canManageAuth,
}: {
  posting: AdminPosting;
  applicants: AdminApplicant[];
  scores: ScoreEntry[];
  myReviewerName: string;
  // M0(관장·부장·master) 여부 — 합격자 직원 전환 버튼 노출 게이트.
  canManageAuth: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 지원자별 점수 집계 — 한 번만 계산해서 모든 탭에서 재사용.
  const aggregated = useMemo(
    () => aggregateScores(applicants, scores),
    [applicants, scores]
  );

  // 공고에 등장한 심사위원 명단(단계별) — 위원별 분리 표시의 컬럼/순서.
  const reviewers = useMemo(() => collectReviewers(scores), [scores]);

  function openDetail(applicationId: string) {
    setSelectedId(applicationId);
    setTab("detail");
  }

  const selected =
    applicants.find((a) => a.application_id === selectedId) ?? null;

  return (
    <div className="space-y-5">
      <header className="rounded-xl border border-line bg-card p-4 sm:p-5">
        <p className="text-xs font-semibold tracking-wide text-brand-blue sm:text-sm">
          채용 심사
        </p>
        <h2 className="mt-0.5 text-lg font-bold text-ink sm:text-xl">
          {posting.title}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
          {splitRecruitmentFields(posting.field).map((f, i) => (
            <span key={`${f}-${i}`} className={fieldBadgeCls(i)}>
              {f}
            </span>
          ))}
          <span>모집 {posting.recruit_count}명</span>
          <span>· 접수 {applicants.length}건</span>
          <span className="font-medium text-navy">
            · 👁 조회 {posting.view_count.toLocaleString()}회
          </span>
        </div>
      </header>

      <div className={tabBarCls}>
        <nav className={tabNavCls}>
          <button
            type="button"
            onClick={() => setTab("list")}
            className={tabItemCls(tab === "list")}
          >
            지원자 목록
          </button>
          <button
            type="button"
            onClick={() => setTab("detail")}
            className={tabItemCls(tab === "detail")}
          >
            지원자 상세·채점
          </button>
          <button
            type="button"
            onClick={() => setTab("final")}
            className={tabItemCls(tab === "final")}
          >
            최종 집계
          </button>
        </nav>
      </div>

      {tab === "list" && (
        <ApplicantListView
          applicants={applicants}
          aggregated={aggregated}
          reviewers={reviewers}
          onOpen={openDetail}
          canManageAuth={canManageAuth}
        />
      )}

      {tab === "detail" &&
        (selected ? (
          <ApplicantDetailView
            posting={posting}
            applicant={selected}
            scoresForApp={scores.filter(
              (s) => s.application_id === selected.application_id
            )}
            myReviewerName={myReviewerName}
            canManageAuth={canManageAuth}
          />
        ) : (
          <EmptyDetail onGoList={() => setTab("list")} />
        ))}

      {tab === "final" && (
        <FinalSummaryView
          posting={posting}
          applicants={applicants}
          aggregated={aggregated}
          reviewers={reviewers}
          scores={scores}
          canManageAuth={canManageAuth}
        />
      )}

      {/* 위험 구역 — 채용 종료 후 PII 일괄 삭제 */}
      <DangerZone slug={posting.slug} applicantCount={applicants.length} />
    </div>
  );
}

// =====================================================================
// 점수 집계
// =====================================================================
// 심사위원 1명의 한 지원자에 대한 점수(표시용). 채점·저장 로직과 무관.
type ReviewerScore = {
  reviewer_name: string;
  total: number | null;
  is_absent: boolean;
  max: number;
};

type Aggregate = {
  application_id: string;
  screeningAvg: number | null;
  screeningCount: number;
  interviewAvg: number | null;
  interviewCount: number;
  totalAvg: number | null; // 평균 합산
  // 심사위원별 점수(표시용) — reviewer_name → 점수.
  screeningByReviewer: Map<string, ReviewerScore>;
  interviewByReviewer: Map<string, ReviewerScore>;
};

function aggregateScores(
  applicants: AdminApplicant[],
  scores: ScoreEntry[]
): Map<string, Aggregate> {
  const result = new Map<string, Aggregate>();
  for (const a of applicants) {
    const mine = scores.filter((s) => s.application_id === a.application_id);
    const screening = mine.filter(
      (s) => s.stage === "screening" && s.total_score != null
    );
    const interview = mine.filter(
      (s) => s.stage === "interview" && s.total_score != null
    );
    const sAvg =
      screening.length > 0
        ? screening.reduce((sum, s) => sum + Number(s.total_score), 0) /
          screening.length
        : null;
    const iAvg =
      interview.length > 0
        ? interview.reduce((sum, s) => sum + Number(s.total_score), 0) /
          interview.length
        : null;
    const tAvg =
      sAvg != null && iAvg != null
        ? sAvg + iAvg
        : sAvg != null
          ? sAvg
          : iAvg;

    // 위원별 점수 맵 — 불참 포함 모든 행. 동일 위원 중복 시 마지막 행 사용.
    const screeningByReviewer = new Map<string, ReviewerScore>();
    const interviewByReviewer = new Map<string, ReviewerScore>();
    for (const s of mine) {
      const nm = s.reviewer_name.trim();
      if (!nm) continue;
      const entry: ReviewerScore = {
        reviewer_name: nm,
        total: s.total_score,
        is_absent: s.is_absent,
        max: s.max_score,
      };
      if (s.stage === "interview") interviewByReviewer.set(nm, entry);
      else screeningByReviewer.set(nm, entry);
    }

    result.set(a.application_id, {
      application_id: a.application_id,
      screeningAvg: sAvg,
      screeningCount: screening.length,
      interviewAvg: iAvg,
      interviewCount: interview.length,
      totalAvg: tAvg,
      screeningByReviewer,
      interviewByReviewer,
    });
  }
  return result;
}

// 공고 전체에서 등장한 심사위원 이름을 단계별로 수집(가나다순) — 표 컬럼/표시 순서용.
function collectReviewers(scores: ScoreEntry[]): {
  screening: string[];
  interview: string[];
} {
  const s = new Set<string>();
  const i = new Set<string>();
  for (const sc of scores) {
    const nm = sc.reviewer_name.trim();
    if (!nm) continue;
    if (sc.stage === "interview") i.add(nm);
    else s.add(nm);
  }
  const sorted = (set: Set<string>) =>
    [...set].sort((a, b) => a.localeCompare(b, "ko"));
  return { screening: sorted(s), interview: sorted(i) };
}

// 위원별 셀 표시값 — 미채점 "—", 불참 "불참", 그 외 점수.
function reviewerScoreText(rs: ReviewerScore | undefined): string {
  if (!rs) return "—";
  if (rs.is_absent) return "불참";
  return String(rs.total ?? 0);
}

// 위원별 점수 인라인(목록 셀용) — "관장 29 · 부장 27 · 박용하 31".
function ReviewerInline({
  names,
  byReviewer,
  scoreCls,
}: {
  names: string[];
  byReviewer: Map<string, ReviewerScore> | undefined;
  scoreCls: string;
}) {
  if (names.length === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap justify-end gap-x-1.5 text-[10px] font-normal leading-tight text-ink-hint">
      {names.map((nm) => (
        <span key={nm} className="whitespace-nowrap">
          {nm}{" "}
          <span className={`font-semibold ${scoreCls}`}>
            {reviewerScoreText(byReviewer?.get(nm))}
          </span>
        </span>
      ))}
    </div>
  );
}

function fmtScore(n: number | null): string {
  if (n == null) return "—";
  return n.toFixed(1).replace(/\.0$/, "");
}

// 접수일시 — 결정적 KST 포맷(SSR↔CSR 하이드레이션 불일치 방지). "MM.DD HH:mm"
function fmtKstShort(iso: string | null): string {
  return fmtKstDateTime(iso, { year: false });
}

function statusBadgeOf(status: AppStatus): string {
  switch (status) {
    case "screening_passed":
    case "interview_passed":
    case "final_passed":
      return badgeSuccess;
    case "screening_failed":
    case "interview_failed":
    case "final_rejected":
      return badgeWarning;
    default:
      return badgeNeutral;
  }
}

// =====================================================================
// 1) 지원자 목록 탭
// =====================================================================
function ApplicantListView({
  applicants,
  aggregated,
  reviewers,
  onOpen,
  canManageAuth,
}: {
  applicants: AdminApplicant[];
  aggregated: Map<string, Aggregate>;
  reviewers: { screening: string[]; interview: string[] };
  onOpen: (applicationId: string) => void;
  canManageAuth: boolean;
}) {
  type SortKey = "name" | "submitted" | "screening" | "interview" | "total";
  // 기본은 이름 가나다순(한글 오름차순) — 총괄표와 동일한 순서로 통일.
  const [sort, setSort] = useState<SortKey>("name");

  const sorted = useMemo(() => {
    const arr = [...applicants];
    const ag = (id: string) => aggregated.get(id);
    if (sort === "name") {
      arr.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    } else if (sort === "screening") {
      arr.sort((a, b) => {
        const av = ag(a.application_id)?.screeningAvg ?? -1;
        const bv = ag(b.application_id)?.screeningAvg ?? -1;
        return bv - av;
      });
    } else if (sort === "interview") {
      arr.sort((a, b) => {
        const av = ag(a.application_id)?.interviewAvg ?? -1;
        const bv = ag(b.application_id)?.interviewAvg ?? -1;
        return bv - av;
      });
    } else if (sort === "total") {
      arr.sort((a, b) => {
        const av = ag(a.application_id)?.totalAvg ?? -1;
        const bv = ag(b.application_id)?.totalAvg ?? -1;
        return bv - av;
      });
    } else {
      arr.sort((a, b) =>
        (a.submitted_at ?? "").localeCompare(b.submitted_at ?? "")
      );
    }
    return arr;
  }, [applicants, aggregated, sort]);

  if (applicants.length === 0) {
    return (
      <section className={cardCls}>
        <p className="rounded-lg border border-dashed border-line bg-surface p-6 text-center text-sm text-ink-muted">
          아직 접수된 지원서가 없습니다.
        </p>
      </section>
    );
  }

  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          지원자{" "}
          <span className="ml-1 text-xs font-medium text-ink-hint">
            {applicants.length}명
          </span>
        </h3>
        <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
          정렬
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md border border-line bg-card px-2 py-1 text-xs"
          >
            <option value="name">이름(가나다순)</option>
            <option value="submitted">접수일시</option>
            <option value="screening">서류점수</option>
            <option value="interview">면접평균</option>
            <option value="total">총점</option>
          </select>
        </label>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full divide-y divide-line text-sm">
          <thead className="bg-surface text-xs uppercase text-ink-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">이름</th>
              <th className="px-3 py-2 text-left font-medium">접수번호</th>
              <th className="px-3 py-2 text-left font-medium">접수일시</th>
              <th className="px-3 py-2 text-left font-medium">상태</th>
              <th className="px-3 py-2 text-right font-medium">서류 (/35)</th>
              <th className="px-3 py-2 text-right font-medium">면접 (/65)</th>
              <th className="px-3 py-2 text-right font-medium">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((a, idx) => {
              const ag = aggregated.get(a.application_id);
              return (
                <tr key={a.application_id} className="hover:bg-surface">
                  <td className="px-3 py-2 text-ink-muted">{idx + 1}</td>
                  <td className="px-3 py-2 font-semibold text-ink">{a.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-body">
                    {a.applicant_number}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-muted">
                    {fmtKstShort(a.submitted_at)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={statusBadgeOf(a.status)}>
                      {APPLICATION_STATUS_LABEL[a.status]}
                    </span>
                    {/* 최종합격 + 미전환 + M0 → 목록에서도 눈에 띄게 "전환 대기" 배지. */}
                    {canManageAuth &&
                      a.status === "final_passed" &&
                      a.converted_to_employee_id == null && (
                        <span className={`${badgeWarning} ml-1.5`}>
                          전환 대기
                        </span>
                      )}
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <div className="font-semibold text-brand-blue">
                      {fmtScore(ag?.screeningAvg ?? null)}
                    </div>
                    <ReviewerInline
                      names={reviewers.screening}
                      byReviewer={ag?.screeningByReviewer}
                      scoreCls="text-brand-blue"
                    />
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <div className="font-semibold text-brand-green">
                      {fmtScore(ag?.interviewAvg ?? null)}
                    </div>
                    <ReviewerInline
                      names={reviewers.interview}
                      byReviewer={ag?.interviewByReviewer}
                      scoreCls="text-brand-green"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onOpen(a.application_id)}
                      className="rounded-md border border-brand-blue bg-card px-2.5 py-1 text-xs font-semibold text-brand-blue hover:bg-brand-blue-soft"
                    >
                      보기
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EmptyDetail({ onGoList }: { onGoList: () => void }) {
  return (
    <section className={cardCls}>
      <p className="rounded-lg border border-dashed border-line bg-surface p-6 text-center text-sm text-ink-muted">
        지원자 목록에서 한 명을 선택해주세요.
      </p>
      <div className="mt-3 flex justify-center">
        <button type="button" onClick={onGoList} className={btnSecondary}>
          ← 목록으로
        </button>
      </div>
    </section>
  );
}

// =====================================================================
// 2) 지원자 상세 + 서류 채점 탭
// =====================================================================
function ApplicantDetailView({
  posting,
  applicant,
  scoresForApp,
  myReviewerName,
  canManageAuth,
}: {
  posting: AdminPosting;
  applicant: AdminApplicant;
  scoresForApp: ScoreEntry[];
  myReviewerName: string;
  canManageAuth: boolean;
}) {
  // 내 서류 채점 — 없으면 빈 선택으로 시작.
  const myScreening =
    scoresForApp.find(
      (s) => s.stage === "screening" && s.reviewer_name === myReviewerName
    ) ?? null;

  const initialScores =
    (myScreening?.scores as Record<string, number> | undefined) ?? {};

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_400px]">
      {/* 좌측: 지원서 전체 */}
      <ApplicantSummary applicant={applicant} slug={posting.slug} />
      {/* 우측: 서류 채점 + 상태 변경 */}
      <div className="space-y-4">
        <ScreeningScoreCard
          slug={posting.slug}
          applicationId={applicant.application_id}
          initialScores={initialScores}
          memoInitial={myScreening?.memo ?? ""}
          submittedAt={myScreening?.submitted_at ?? null}
        />
        <StatusActionsCard
          slug={posting.slug}
          applicationId={applicant.application_id}
          currentStatus={applicant.status}
          rejectReasonInitial={applicant.screening_reject_reason ?? ""}
          applicantName={applicant.name}
          convertedEmployeeId={applicant.converted_to_employee_id}
          convertedAt={applicant.converted_at}
          canManageAuth={canManageAuth}
        />
        <OtherReviewersCard
          scoresForApp={scoresForApp}
          myReviewerName={myReviewerName}
        />
      </div>
    </div>
  );
}

function ApplicantSummary({
  applicant: a,
  slug,
}: {
  applicant: AdminApplicant;
  slug: string;
}) {
  return (
    <section className={cardCls}>
      <div className="flex items-start gap-4">
        <div className="h-32 w-24 shrink-0 overflow-hidden rounded-md border border-line bg-card">
          {a.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={a.photo_url}
              alt="증명사진"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-3xl text-ink-hint">
              👤
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-ink">{a.name}</h3>
              <p className="mt-0.5 font-mono text-xs text-ink-muted">
                접수번호 {a.applicant_number}
              </p>
            </div>
            <a
              href={`/hr/recruitment/${slug}/applicant/${a.applicant_id}/document`}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-navy bg-card px-3 py-1.5 text-xs font-semibold text-navy hover:bg-navy-soft"
            >
              📄 지원서 다운로드
            </a>
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-1 text-xs text-ink-body sm:grid-cols-2">
            <Field label="생년월일" value={a.birth_date || "-"} />
            <Field
              label="성별"
              value={
                a.gender === "M" ? "남자" : a.gender === "F" ? "여자" : "-"
              }
            />
            <Field label="이메일" value={a.email || "-"} />
            <Field label="연락처" value={a.phone || "-"} />
            <Field
              label="주소"
              value={a.address || "-"}
              className="sm:col-span-2"
            />
          </dl>
        </div>
      </div>

      <SubSection title="자기소개서">
        <StatementBlock label="지원 동기 및 입사 후 포부" body={a.motivation} />
        <StatementBlock label="자기개발 계획" body={a.self_development} />
        <StatementBlock label="직무 관련 경력 및 활동 결과" body={a.career_summary} />
        <StatementBlock label="청소년관 · 직업관 · 삶의 철학" body={a.philosophy} />
      </SubSection>

      <SubSection title="학력">
        {a.education.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-1.5 text-xs">
            {a.education.map((e, i) => (
              <li key={i} className="text-ink-body">
                <span className="font-semibold text-ink">{e.school}</span>{" "}
                {e.major && <span>· {e.major}</span>} ({e.degree})
                {(e.enter_date || e.graduate_date) && (
                  <span className="ml-1 text-ink-muted">
                    {e.enter_date} ~ {e.graduate_date}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </SubSection>

      <SubSection title="자격증">
        {a.licenses.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-1.5 text-xs">
            {a.licenses.map((l, i) => (
              <li key={i} className="text-ink-body">
                <span className="font-semibold text-ink">{l.name}</span>{" "}
                {l.issuer && <span>· {l.issuer}</span>}{" "}
                {l.acquired_date && (
                  <span className="text-ink-muted">({l.acquired_date})</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </SubSection>

      <SubSection title="경력">
        {a.career.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-1.5 text-xs">
            {a.career.map((c, i) => (
              <li key={i} className="text-ink-body">
                <span className="font-semibold text-ink">{c.company}</span>{" "}
                {c.department && <span>· {c.department}</span>}{" "}
                <span className="text-ink-muted">
                  ({c.start_date} ~ {c.current ? "현재" : c.end_date})
                </span>
                {c.duties && (
                  <p className="mt-0.5 text-ink-muted">{c.duties}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </SubSection>

      <SubSection title="수상">
        {a.awards.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-1.5 text-xs">
            {a.awards.map((w, i) => (
              <li key={i} className="text-ink-body">
                <span className="font-semibold text-ink">{w.name}</span>{" "}
                {w.issuer && <span>· {w.issuer}</span>}{" "}
                {w.date && <span className="text-ink-muted">({w.date})</span>}
              </li>
            ))}
          </ul>
        )}
      </SubSection>

      <SubSection title="교육이수">
        {a.trainings.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-1.5 text-xs">
            {a.trainings.map((t, i) => (
              <li key={i} className="text-ink-body">
                <span className="font-semibold text-ink">{t.name}</span>{" "}
                {t.institution && <span>· {t.institution}</span>}{" "}
                {(t.start_date || t.end_date) && (
                  <span className="text-ink-muted">
                    ({t.start_date} ~ {t.end_date})
                  </span>
                )}
                {t.hours && <span className="ml-1">· {t.hours}</span>}
              </li>
            ))}
          </ul>
        )}
      </SubSection>

      <SubSection title="첨부서류">
        <ul className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
          {a.documents.map((d) => (
            <li
              key={d.key}
              className="flex items-center justify-between rounded-md border border-line bg-card px-2.5 py-1.5"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-ink-body">{d.label}</span>
                {d.required && (
                  <span className="rounded-full bg-stamp-soft px-1.5 text-[10px] font-semibold text-stamp">
                    필수
                  </span>
                )}
              </span>
              {d.url ? (
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-md border border-brand-blue px-2 py-0.5 text-[11px] font-semibold text-brand-blue hover:bg-brand-blue-soft"
                >
                  열기 ↗
                </a>
              ) : (
                <span className="text-[11px] text-ink-hint">미제출</span>
              )}
            </li>
          ))}
        </ul>
      </SubSection>
    </section>
  );
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`flex gap-2 ${className ?? ""}`}>
      <dt className="w-16 shrink-0 text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink-body">{value}</dd>
    </div>
  );
}

function SubSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <h4 className="mb-2 text-xs font-bold text-brand-blue">{title}</h4>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-xs text-ink-hint">— 작성된 내용이 없습니다 —</p>;
}

function StatementBlock({
  label,
  body,
}: {
  label: string;
  body: string | null;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="text-[11px] font-semibold text-ink-muted">{label}</p>
      <p className="mt-1 whitespace-pre-wrap rounded-md border border-line bg-card px-2.5 py-2 text-xs leading-relaxed text-ink-body">
        {body && body.trim().length > 0 ? body : "— 작성하지 않음 —"}
      </p>
    </div>
  );
}

// =====================================================================
// 서류 채점 카드 (35점 만점) — 기준표 클릭 선택식.
//   세부항목별 보기를 클릭해 점수 택1. 다시 누르면 해제(0점).
//   심사위원이 한글 기준표 파일 없이 화면만 보고 채점할 수 있게 기준을 녹임.
// =====================================================================
function ScreeningScoreCard({
  slug,
  applicationId,
  initialScores,
  memoInitial,
  submittedAt,
}: {
  slug: string;
  applicationId: string;
  initialScores: Record<string, number>;
  memoInitial: string;
  submittedAt: string | null;
}) {
  // 항목 키 -> 선택 점수(null = 미선택). 0 은 유효한 선택값일 수 있음
  // (경력평가의 "0년(경력 없음)=0"). 그래서 미선택은 0 이 아니라 null 로 구분.
  const [selected, setSelected] = useState<Record<string, number | null>>(() => {
    const init: Record<string, number | null> = {};
    for (const item of SCREENING_ITEMS) {
      const v = initialScores[item.key];
      const hasNum = typeof v === "number" && Number.isFinite(v);
      // 0 값 보기가 있는 항목(경력평가)만 저장된 0 을 "선택된 0"으로 복원하고,
      // 그 외 항목은 0 = 미선택(null) 로 본다.
      const hasZeroOption = item.options.some((o) => o.value === 0);
      init[item.key] = hasNum && (v !== 0 || hasZeroOption) ? v : null;
    }
    return init;
  });
  const [memo, setMemo] = useState(memoInitial);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = useMemo(
    () => SCREENING_ITEMS.reduce((sum, it) => sum + (selected[it.key] ?? 0), 0),
    [selected]
  );

  function pick(key: string, value: number) {
    setOk(null);
    setSelected((prev) => ({
      ...prev,
      // 같은 보기를 다시 누르면 해제(null = 미선택).
      [key]: prev[key] === value ? null : value,
    }));
  }

  function handleSave() {
    setError(null);
    setOk(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("slug", slug);
        fd.set("application_id", applicationId);
        for (const item of SCREENING_ITEMS) {
          const v = selected[item.key];
          // 미선택은 빈 값으로 전송(서버에서 0 으로 합산). 0년 선택은 "0" 전송.
          fd.set(item.key, v == null ? "" : String(v));
        }
        fd.set("memo", memo);
        const res = await saveScreeningScore(fd);
        if (res.ok) setOk("저장되었습니다.");
        else setError(res.message);
      } catch (e) {
        setError(
          e instanceof Error
            ? `저장 실패: ${e.message}`
            : "채점 저장 중 알 수 없는 오류가 발생했습니다."
        );
      }
    });
  }

  return (
    <section className="rounded-xl border-2 border-brand-blue bg-hr-bg p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-2 border-b border-brand-blue/30 pb-2">
        <h3 className="text-sm font-bold tracking-wide text-brand-blue">
          서류 채점
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-brand-blue">
            합계 {total} <span className="text-xs font-normal">/ {SCREENING_MAX}</span>
          </span>
          {submittedAt && (
            <span className="text-[11px] text-ink-muted">
              저장 {fmtKstShort(submittedAt)}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-4">
        {SCREENING_GROUPS.map((group) => {
          const items = SCREENING_ITEMS.filter((it) => it.group === group.key);
          const groupTotal = items.reduce(
            (sum, it) => sum + (selected[it.key] ?? 0),
            0
          );
          return (
            <div key={group.key}>
              <div className="flex items-baseline justify-between">
                <h4 className="text-xs font-bold text-ink">
                  {group.title}
                  <span className="ml-1 font-normal text-ink-muted">
                    ({group.max}점)
                  </span>
                </h4>
                <span className="text-xs font-semibold text-brand-blue">
                  {groupTotal} / {group.max}
                </span>
              </div>
              <div className="mt-1.5 space-y-2">
                {items.map((item) => (
                  <ScreeningItemRow
                    key={item.key}
                    title={item.title}
                    max={screeningItemMax(item)}
                    options={item.options}
                    value={selected[item.key] ?? null}
                    onPick={(v) => pick(item.key, v)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        <div>
          <label className={labelCls}>메모</label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={3}
            placeholder="채점 메모 (선택)"
            className={`${inputCls} resize-y`}
          />
        </div>

        {error && <p className={noticeError}>{error}</p>}
        {ok && <p className={noticeSuccess}>{ok}</p>}

        <div className="rounded-lg bg-brand-blue-soft px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-brand-blue">합계</span>
            <span className="text-lg font-bold text-brand-blue">
              {total} <span className="text-xs">/ {SCREENING_MAX}</span>
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className={`${btnPrimary} w-full`}
        >
          {pending ? "저장 중…" : "채점 저장"}
        </button>
      </div>
    </section>
  );
}

// 한 세부항목 = 제목/배점 + 보기 버튼 그룹(택1, 토글).
function ScreeningItemRow({
  title,
  max,
  options,
  value,
  onPick,
}: {
  title: string;
  max: number;
  options: { label: string; value: number }[];
  // null = 미선택. 0 은 유효한 선택값(경력평가 0년)일 수 있어 number 와 구분.
  value: number | null;
  onPick: (v: number) => void;
}) {
  return (
    <div className="rounded-lg border border-line bg-card px-2.5 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold text-ink-body">{title}</span>
        <span className="text-[11px] text-ink-hint">최대 {max}점</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((opt) => {
          // 미선택(null)일 때는 0점 보기도 활성으로 보이지 않게 한다.
          const active = value !== null && value === opt.value;
          return (
            <button
              key={opt.label}
              type="button"
              onClick={() => onPick(opt.value)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
                active
                  ? "border-brand-blue bg-brand-blue text-white shadow-sm"
                  : "border-line bg-card text-ink-body hover:border-brand-blue/50 hover:bg-brand-blue-soft"
              }`}
            >
              {active && <span aria-hidden>✓</span>}
              <span>{opt.label}</span>
              <span className={active ? "text-white/90" : "text-ink-hint"}>
                {opt.value}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================================
// 상태 변경 카드 (서류·면접·최종 합/불합)
// =====================================================================
function StatusActionsCard({
  slug,
  applicationId,
  currentStatus,
  rejectReasonInitial,
  applicantName,
  convertedEmployeeId,
  convertedAt,
  canManageAuth,
}: {
  slug: string;
  applicationId: string;
  currentStatus: AppStatus;
  rejectReasonInitial: string;
  applicantName: string;
  convertedEmployeeId: string | null;
  convertedAt: string | null;
  canManageAuth: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 직원 전환 — 최종 집계 탭의 로직을 그대로 재사용(convertApplicantToEmployee).
  const [converting, startConvert] = useTransition();
  const [convertError, setConvertError] = useState<string | null>(null);
  const converted = convertedEmployeeId != null;

  function handleConvert() {
    if (
      !confirm(
        `${applicantName} 님을 직원으로 전환합니다.\n이메일은 전환 후 인사기록카드에서 입력하세요.`
      )
    )
      return;
    setConvertError(null);
    startConvert(async () => {
      try {
        const res = await convertApplicantToEmployee(applicationId);
        if (!res.ok) setConvertError(res.message);
        // 성공 시 revalidate 로 상태가 갱신되어 "전환됨" 배지로 바뀜.
      } catch (e) {
        setConvertError(
          e instanceof Error
            ? `전환 실패: ${e.message}`
            : "직원 전환 중 오류가 발생했습니다."
        );
      }
    });
  }

  // 불합격 사유 — 상태와 독립. 합격으로 바꿔도 입력값은 state 에 보존되어
  // 다시 불합격하면 그대로 복원됩니다(DB 에도 별도 컬럼으로 보존).
  const [reason, setReason] = useState(rejectReasonInitial);
  const [reasonPending, startReasonTransition] = useTransition();
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [reasonOk, setReasonOk] = useState<string | null>(null);

  function setStatus(next: AppStatus, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await updateApplicationStatus(
          applicationId,
          next,
          slug
        );
        if (!res.ok) setError(res.message);
      } catch (e) {
        setError(
          e instanceof Error
            ? `상태 변경 실패: ${e.message}`
            : "알 수 없는 오류가 발생했습니다."
        );
      }
    });
  }

  function saveReason() {
    setReasonError(null);
    setReasonOk(null);
    startReasonTransition(async () => {
      try {
        const res = await saveScreeningRejectReason(applicationId, reason, slug);
        if (res.ok) setReasonOk("사유가 저장되었습니다.");
        else setReasonError(res.message);
      } catch (e) {
        setReasonError(
          e instanceof Error
            ? `사유 저장 실패: ${e.message}`
            : "알 수 없는 오류가 발생했습니다."
        );
      }
    });
  }

  return (
    <section className={cardCls}>
      <h3 className="text-sm font-semibold text-ink">상태 변경</h3>
      <p className="mt-1 text-xs text-ink-muted">
        현재:{" "}
        <span className={statusBadgeOf(currentStatus)}>
          {APPLICATION_STATUS_LABEL[currentStatus]}
        </span>
      </p>

      {/* 직원 전환 강조 블록 — 최종합격자에게만 카드 최상단에 노출.
          공고 상태(종결/archived)와 무관하게 동작(전환 로직·서버 액션에 공고 status 가드 없음). */}
      {currentStatus === "final_passed" && (converted || canManageAuth) && (
        <div className="mt-3 rounded-lg border border-navy/40 bg-navy-soft/40 p-3">
          {converted ? (
            <>
              <p className="text-sm font-semibold text-navy">
                ✓ 직원으로 전환됨
                {convertedAt ? ` (${fmtKstDate(convertedAt)})` : ""}
              </p>
              <Link
                href="/hr?tab=records"
                className="mt-1 inline-block text-xs font-semibold text-navy underline hover:opacity-80"
              >
                인사기록카드로 이동 →
              </Link>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold text-navy">
                최종합격자입니다. 직원으로 전환하세요.
              </p>
              <button
                type="button"
                onClick={handleConvert}
                disabled={converting}
                className={`${btnPrimary} mt-2 w-full`}
              >
                {converting ? "전환 중…" : "직원으로 전환"}
              </button>
              {convertError && (
                <p className={`mt-2 ${noticeError}`}>{convertError}</p>
              )}
            </>
          )}
        </div>
      )}

      <div className="mt-3 space-y-2">
        <div>
          <p className="text-[11px] font-semibold text-ink-muted">서류전형</p>
          <div className="mt-1 flex gap-1.5">
            <button
              type="button"
              onClick={() => setStatus("screening_passed")}
              disabled={pending}
              className="flex-1 rounded-md border border-success bg-card px-2 py-1.5 text-xs font-semibold text-success hover:bg-success-soft disabled:opacity-60"
            >
              서류 합격
            </button>
            <button
              type="button"
              onClick={() => setStatus("screening_failed")}
              disabled={pending}
              className="flex-1 rounded-md border border-stamp bg-card px-2 py-1.5 text-xs font-semibold text-stamp hover:bg-stamp-soft disabled:opacity-60"
            >
              서류 불합격
            </button>
          </div>
          {/* 불합격일 때만 사유 입력란 노출. */}
          {currentStatus === "screening_failed" && (
            <div className="mt-2 rounded-lg border border-stamp/40 bg-stamp-soft/40 p-2.5">
              <label className="text-[11px] font-semibold text-stamp">
                불합격 사유
              </label>
              <textarea
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setReasonOk(null);
                }}
                rows={2}
                placeholder="예: 필수 증빙서류 미제출, 자격요건 미달 등"
                className={`${inputCls} mt-1 resize-y`}
              />
              {reasonError && (
                <p className={`mt-1 ${noticeError}`}>{reasonError}</p>
              )}
              {reasonOk && <p className={`mt-1 ${noticeSuccess}`}>{reasonOk}</p>}
              <button
                type="button"
                onClick={saveReason}
                disabled={reasonPending}
                className={`${btnSecondary} mt-2 w-full`}
              >
                {reasonPending ? "저장 중…" : "사유 저장"}
              </button>
            </div>
          )}
        </div>

        <div>
          <p className="text-[11px] font-semibold text-ink-muted">면접전형</p>
          <div className="mt-1 flex gap-1.5">
            <button
              type="button"
              onClick={() => setStatus("interview_passed")}
              disabled={pending}
              className="flex-1 rounded-md border border-success bg-card px-2 py-1.5 text-xs font-semibold text-success hover:bg-success-soft disabled:opacity-60"
            >
              면접 합격
            </button>
            <button
              type="button"
              onClick={() => setStatus("interview_failed")}
              disabled={pending}
              className="flex-1 rounded-md border border-stamp bg-card px-2 py-1.5 text-xs font-semibold text-stamp hover:bg-stamp-soft disabled:opacity-60"
            >
              면접 불합격
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setStatus("submitted", "상태를 '접수완료'로 되돌릴까요?")}
          disabled={pending}
          className="w-full rounded-md border border-line bg-card px-2 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface disabled:opacity-60"
        >
          접수완료로 되돌리기
        </button>
      </div>
      {error && <p className={`mt-2 ${noticeError}`}>{error}</p>}
    </section>
  );
}

// =====================================================================
// 다른 심사위원의 점수 (참고용)
// =====================================================================
function OtherReviewersCard({
  scoresForApp,
  myReviewerName,
}: {
  scoresForApp: ScoreEntry[];
  myReviewerName: string;
}) {
  const otherScreening = scoresForApp.filter(
    (s) => s.stage === "screening" && s.reviewer_name !== myReviewerName
  );
  const allInterview = scoresForApp.filter((s) => s.stage === "interview");

  if (otherScreening.length === 0 && allInterview.length === 0) return null;

  return (
    <section className={cardCls}>
      <h3 className="text-sm font-semibold text-ink">다른 심사위원 점수</h3>
      {otherScreening.length > 0 && (
        <>
          <p className="mt-2 text-[11px] font-semibold text-ink-muted">
            서류
          </p>
          <ul className="mt-1 space-y-1 text-xs">
            {otherScreening.map((s) => (
              <li key={s.id} className="flex justify-between">
                <span className="text-ink-body">{s.reviewer_name}</span>
                <span className="font-semibold text-brand-blue">
                  {s.total_score ?? 0} / {s.max_score}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {allInterview.length > 0 && (
        <>
          <p className="mt-3 text-[11px] font-semibold text-ink-muted">
            면접
          </p>
          <ul className="mt-1 space-y-1 text-xs">
            {allInterview.map((s) => (
              <li key={s.id} className="flex justify-between">
                <span className="text-ink-body">
                  {s.reviewer_name}
                  {s.is_absent && (
                    <span className="ml-1 text-stamp">(불참)</span>
                  )}
                </span>
                <span className="font-semibold text-brand-green">
                  {s.total_score ?? 0} / {s.max_score}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// =====================================================================
// 3) 최종 집계 탭
// =====================================================================
function FinalSummaryView({
  posting,
  applicants,
  aggregated,
  reviewers,
  scores,
  canManageAuth,
}: {
  posting: AdminPosting;
  applicants: AdminApplicant[];
  aggregated: Map<string, Aggregate>;
  reviewers: { screening: string[]; interview: string[] };
  scores: ScoreEntry[];
  canManageAuth: boolean;
}) {
  const ranked = useMemo(() => {
    return [...applicants].sort((a, b) => {
      const av = aggregated.get(a.application_id)?.totalAvg ?? -1;
      const bv = aggregated.get(b.application_id)?.totalAvg ?? -1;
      return bv - av;
    });
  }, [applicants, aggregated]);

  return (
    <div className="space-y-5">
      <InterviewDetailSection
        slug={posting.slug}
        ranked={ranked}
        reviewers={reviewers.interview}
        scores={scores}
      />
      <section className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          최종 집계{" "}
          <span className="ml-1 text-xs font-medium text-ink-hint">
            총점순 정렬
          </span>
        </h3>
        <span className="text-xs text-ink-muted">
          모집 {posting.recruit_count}명 · 지원 {applicants.length}명
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full divide-y divide-line text-sm">
          <thead className="bg-surface text-xs uppercase text-ink-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">순위</th>
              <th className="px-3 py-2 text-left font-medium">이름</th>
              <th className="px-3 py-2 text-left font-medium">상태</th>
              {reviewers.screening.map((nm) => (
                <th
                  key={`hs-${nm}`}
                  className="px-2 py-2 text-right font-medium normal-case text-brand-blue"
                >
                  {nm}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">
                서류 평균 (/{SCREENING_MAX})
              </th>
              {reviewers.interview.map((nm) => (
                <th
                  key={`hi-${nm}`}
                  className="px-2 py-2 text-right font-medium normal-case text-brand-green"
                >
                  {nm}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">
                면접 평균 (/{INTERVIEW_MAX})
              </th>
              <th className="px-3 py-2 text-right font-medium">
                총점 (/{SCREENING_MAX + INTERVIEW_MAX})
              </th>
              <th className="px-3 py-2 text-right font-medium">최종 결정</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ranked.map((a, idx) => {
              const ag = aggregated.get(a.application_id);
              return (
                <FinalRow
                  key={a.application_id}
                  rank={idx + 1}
                  applicant={a}
                  slug={posting.slug}
                  reviewers={reviewers}
                  screeningByReviewer={ag?.screeningByReviewer}
                  interviewByReviewer={ag?.interviewByReviewer}
                  screeningAvg={ag?.screeningAvg ?? null}
                  screeningCount={ag?.screeningCount ?? 0}
                  interviewAvg={ag?.interviewAvg ?? null}
                  interviewCount={ag?.interviewCount ?? 0}
                  totalAvg={ag?.totalAvg ?? null}
                  canManageAuth={canManageAuth}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      </section>
    </div>
  );
}

// =====================================================================
// 심사위원별 면접 세부평가 점수표 — 지원자별로 위원이 q1~q4 항목에 준 점수.
//   * 데이터: recruitment_scores(stage='interview').scores jsonb (q1~q4).
//   * 항목 정의·배점은 INTERVIEW_ITEMS(lib) 단일 기준. 위원 열 동적.
//   * 행=항목(q1~q4)+합계, 열=심사위원(+항목별 평균). 다운로드는 동일 데이터의 xlsx.
// =====================================================================
function InterviewDetailSection({
  slug,
  ranked,
  reviewers,
  scores,
}: {
  slug: string;
  ranked: AdminApplicant[];
  reviewers: string[];
  scores: ScoreEntry[];
}) {
  // 지원자 → (위원명 → 면접 채점) 빠른 조회용.
  const byApp = useMemo(() => {
    const m = new Map<string, Map<string, ScoreEntry>>();
    for (const s of scores) {
      if (s.stage !== "interview") continue;
      const nm = s.reviewer_name.trim();
      if (!nm) continue;
      let inner = m.get(s.application_id);
      if (!inner) {
        inner = new Map();
        m.set(s.application_id, inner);
      }
      inner.set(nm, s);
    }
    return m;
  }, [scores]);

  // 면접 점수가 한 건이라도 있는 지원자만(총점순 = ranked 순서 유지).
  const targets = ranked.filter((a) => (byApp.get(a.application_id)?.size ?? 0) > 0);

  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          심사위원별 세부평가 점수표{" "}
          <span className="ml-1 text-xs font-medium text-ink-hint">
            면접 항목별 · 위원별
          </span>
        </h3>
        <a
          href={`/hr/recruitment/${slug}/interview-detail`}
          className="inline-flex items-center gap-1 rounded-lg border border-brand-green bg-card px-3 py-1.5 text-xs font-semibold text-brand-green hover:bg-brand-green/10"
        >
          📊 세부평가 Excel 다운로드
        </a>
      </div>

      {reviewers.length === 0 || targets.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-surface p-6 text-center text-sm text-ink-muted">
          아직 면접 채점 내역이 없습니다.
        </p>
      ) : (
        <div className="mt-3 space-y-5">
          {targets.map((a) => (
            <InterviewDetailTable
              key={a.application_id}
              applicant={a}
              reviewers={reviewers}
              byReviewer={byApp.get(a.application_id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// 한 지원자의 위원×항목 점수 표. 행=항목(q1~q4)+합계, 열=위원(+평균).
function InterviewDetailTable({
  applicant,
  reviewers,
  byReviewer,
}: {
  applicant: AdminApplicant;
  reviewers: string[];
  byReviewer: Map<string, ScoreEntry> | undefined;
}) {
  // 위원의 한 항목 점수 — 미채점 "—", 불참 "불참", 그 외 점수(없으면 "—").
  const itemCell = (entry: ScoreEntry | undefined, key: string): string => {
    if (!entry) return "—";
    if (entry.is_absent) return "불참";
    const v = entry.scores[key];
    return typeof v === "number" && Number.isFinite(v) ? String(v) : "—";
  };
  // 항목별 위원 평균(불참·미채점 제외). 없으면 "—".
  const itemAvg = (key: string): string => {
    const vals: number[] = [];
    for (const nm of reviewers) {
      const e = byReviewer?.get(nm);
      if (!e || e.is_absent) continue;
      const v = e.scores[key];
      if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
    }
    if (vals.length === 0) return "—";
    return fmtScore(vals.reduce((x, y) => x + y, 0) / vals.length);
  };
  // 위원 총점 셀.
  const totalCell = (entry: ScoreEntry | undefined): string => {
    if (!entry) return "—";
    if (entry.is_absent) return "불참";
    return String(entry.total_score ?? 0);
  };
  // 면접 총점 평균(불참·미채점 제외).
  const totalAvg = (): string => {
    const vals: number[] = [];
    for (const nm of reviewers) {
      const e = byReviewer?.get(nm);
      if (!e || e.is_absent || e.total_score == null) continue;
      vals.push(Number(e.total_score));
    }
    if (vals.length === 0) return "—";
    return fmtScore(vals.reduce((x, y) => x + y, 0) / vals.length);
  };

  return (
    <div className="rounded-lg border border-line">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-surface px-3 py-2">
        <span className="text-sm font-bold text-ink">{applicant.name}</span>
        <span className="font-mono text-[11px] text-ink-muted">
          {applicant.applicant_number}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-line text-sm">
          <thead className="bg-surface text-xs text-ink-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">평가 항목</th>
              {reviewers.map((nm) => (
                <th
                  key={nm}
                  className="px-2 py-2 text-right font-medium text-brand-green"
                >
                  {nm}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">평균</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {INTERVIEW_ITEMS.map((it) => (
              <tr key={it.key} className="hover:bg-surface">
                <td className="px-3 py-2 text-ink-body">
                  {it.shortTitle}
                  <span className="ml-1 text-[10px] text-ink-hint">
                    (/{it.max})
                  </span>
                </td>
                {reviewers.map((nm) => (
                  <td
                    key={nm}
                    className="px-2 py-2 text-right text-brand-green"
                  >
                    {itemCell(byReviewer?.get(nm), it.key)}
                  </td>
                ))}
                <td className="px-3 py-2 text-right text-ink-body">
                  {itemAvg(it.key)}
                </td>
              </tr>
            ))}
            <tr className="bg-brand-green/5 font-semibold">
              <td className="px-3 py-2 text-ink">합계 (/65)</td>
              {reviewers.map((nm) => (
                <td key={nm} className="px-2 py-2 text-right text-brand-green">
                  {totalCell(byReviewer?.get(nm))}
                </td>
              ))}
              <td className="px-3 py-2 text-right text-ink">{totalAvg()}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FinalRow({
  rank,
  applicant,
  slug,
  reviewers,
  screeningByReviewer,
  interviewByReviewer,
  screeningAvg,
  screeningCount,
  interviewAvg,
  interviewCount,
  totalAvg,
  canManageAuth,
}: {
  rank: number;
  applicant: AdminApplicant;
  slug: string;
  reviewers: { screening: string[]; interview: string[] };
  screeningByReviewer: Map<string, ReviewerScore> | undefined;
  interviewByReviewer: Map<string, ReviewerScore> | undefined;
  screeningAvg: number | null;
  screeningCount: number;
  interviewAvg: number | null;
  interviewCount: number;
  totalAvg: number | null;
  canManageAuth: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [converting, startConvert] = useTransition();

  const converted = applicant.converted_to_employee_id != null;

  function setStatus(next: AppStatus) {
    const label =
      next === "final_passed" ? "최종 합격" : "최종 불합격";
    if (!confirm(`${applicant.name} 지원자를 "${label}" 처리할까요?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await updateApplicationStatus(
          applicant.application_id,
          next,
          slug
        );
        if (!res.ok) setError(res.message);
      } catch (e) {
        setError(
          e instanceof Error
            ? `상태 변경 실패: ${e.message}`
            : "알 수 없는 오류가 발생했습니다."
        );
      }
    });
  }

  function handleConvert() {
    if (
      !confirm(
        `${applicant.name} 님을 직원으로 전환합니다.\n이메일은 전환 후 인사기록카드에서 입력하세요.`
      )
    )
      return;
    setError(null);
    startConvert(async () => {
      try {
        const res = await convertApplicantToEmployee(
          applicant.application_id
        );
        if (!res.ok) setError(res.message);
        // 성공 시 revalidate 로 목록이 갱신되어 "전환됨" 배지로 바뀜.
      } catch (e) {
        setError(
          e instanceof Error
            ? `전환 실패: ${e.message}`
            : "직원 전환 중 오류가 발생했습니다."
        );
      }
    });
  }

  return (
    <tr className="hover:bg-surface">
      <td className="px-3 py-2 text-center font-bold text-brand-blue">
        {rank}
      </td>
      <td className="px-3 py-2">
        <p className="font-semibold text-ink">{applicant.name}</p>
        <p className="font-mono text-[11px] text-ink-muted">
          {applicant.applicant_number}
        </p>
      </td>
      <td className="px-3 py-2">
        <span className={statusBadgeOf(applicant.status)}>
          {APPLICATION_STATUS_LABEL[applicant.status]}
        </span>
      </td>
      {reviewers.screening.map((nm) => (
        <td
          key={`s-${nm}`}
          className="px-2 py-2 text-right text-xs text-brand-blue"
        >
          {reviewerScoreText(screeningByReviewer?.get(nm))}
        </td>
      ))}
      <td className="px-3 py-2 text-right font-semibold text-brand-blue">
        {fmtScore(screeningAvg)}
        {screeningCount > 1 && (
          <span className="ml-1 text-[10px] text-ink-hint">
            ({screeningCount}인)
          </span>
        )}
      </td>
      {reviewers.interview.map((nm) => (
        <td
          key={`i-${nm}`}
          className="px-2 py-2 text-right text-xs text-brand-green"
        >
          {reviewerScoreText(interviewByReviewer?.get(nm))}
        </td>
      ))}
      <td className="px-3 py-2 text-right font-semibold text-brand-green">
        {fmtScore(interviewAvg)}
        {interviewCount > 0 && (
          <span className="ml-1 text-[10px] text-ink-hint">
            ({interviewCount}인)
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-base font-bold text-ink">
        {fmtScore(totalAvg)}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="inline-flex flex-col items-stretch gap-1">
          <button
            type="button"
            onClick={() => setStatus("final_passed")}
            disabled={pending}
            className="rounded-md border border-success bg-card px-2 py-1 text-[11px] font-semibold text-success hover:bg-success-soft disabled:opacity-60"
          >
            최종 합격
          </button>
          <button
            type="button"
            onClick={() => setStatus("final_rejected")}
            disabled={pending}
            className="rounded-md border border-stamp bg-card px-2 py-1 text-[11px] font-semibold text-stamp hover:bg-stamp-soft disabled:opacity-60"
          >
            최종 불합격
          </button>

          {/* 직원 전환 — 최종합격자에게만. 전환됨이면 배지, M0만 버튼 노출. */}
          {applicant.status === "final_passed" &&
            (converted ? (
              <span className="rounded-md border border-navy bg-navy-soft px-2 py-1 text-[11px] font-semibold text-navy">
                ✓ 전환됨
              </span>
            ) : canManageAuth ? (
              <button
                type="button"
                onClick={handleConvert}
                disabled={converting}
                className="rounded-md border border-navy bg-card px-2 py-1 text-[11px] font-semibold text-navy hover:bg-navy-soft disabled:opacity-60"
              >
                {converting ? "전환 중…" : "직원으로 전환"}
              </button>
            ) : null)}

          {error && <p className="text-[10px] text-stamp">{error}</p>}
        </div>
      </td>
    </tr>
  );
}

// =====================================================================
// 위험 구역 — 지원자 개인정보 일괄 삭제 (채용 종료 후)
// =====================================================================
function DangerZone({
  slug,
  applicantCount,
}: {
  slug: string;
  applicantCount: number;
}) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <section className="rounded-xl border-2 border-stamp/40 bg-stamp-soft p-4 sm:p-5">
        <h3 className="text-sm font-bold text-stamp">⚠️ 위험 구역</h3>
        <p className="mt-1 text-xs text-stamp/80 sm:text-sm">
          채용 절차가 완전히 종료된 뒤에 사용하세요. 한 번 삭제하면 복구할 수
          없습니다.
        </p>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowModal(true)}
            disabled={applicantCount === 0}
            className="rounded-lg border-2 border-stamp bg-card px-4 py-2 text-sm font-bold text-stamp hover:bg-stamp/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            지원자 개인정보 삭제
          </button>
          {applicantCount === 0 && (
            <p className="mt-1.5 text-xs text-ink-hint">
              삭제할 지원자가 없습니다.
            </p>
          )}
        </div>
      </section>
      {showModal && (
        <AnonymizeModal slug={slug} onClose={() => setShowModal(false)} />
      )}
    </>
  );
}

function AnonymizeModal({
  slug,
  onClose,
}: {
  slug: string;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    anonymized: number;
    preserved: number;
    filesRemoved: number;
  } | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await bulkAnonymizeApplicants(slug);
        if (res.ok) {
          setResult({
            anonymized: res.anonymized,
            preserved: res.preserved,
            filesRemoved: res.filesRemoved,
          });
          // 잠시 결과 표시 후 페이지 새로고침으로 익명화된 데이터 반영.
          setTimeout(() => {
            if (typeof window !== "undefined") window.location.reload();
          }, 1500);
        } else {
          setError(res.message);
        }
      } catch (e) {
        setError(
          e instanceof Error
            ? `삭제 실패: ${e.message}`
            : "삭제 중 알 수 없는 오류가 발생했습니다."
        );
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-line bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-stamp">
          ⚠️ 지원자 개인정보 삭제
        </h3>
        <div className="mt-3 space-y-2 text-sm leading-relaxed text-ink-body">
          <p>이 공고의 모든 지원자 개인정보를 삭제합니다.</p>
          <p>합격자(직원 전환된 경우)의 데이터는 유지됩니다.</p>
          <p className="font-semibold text-stamp">
            삭제된 데이터는 복구할 수 없습니다. 계속하시겠습니까?
          </p>
        </div>

        {result ? (
          <div className="mt-4 space-y-1 rounded-lg bg-success-soft px-3 py-2.5 text-sm text-success">
            <p>✓ 익명화: {result.anonymized}명</p>
            <p>✓ 합격자 보존: {result.preserved}명</p>
            <p>✓ 파일 삭제: {result.filesRemoved}건</p>
            <p className="mt-1 text-xs">잠시 후 화면을 새로고침합니다…</p>
          </div>
        ) : (
          <>
            {error && <p className={`mt-4 ${noticeError}`}>{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className={btnSecondary}
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={pending}
                className="inline-flex h-[38px] items-center justify-center rounded-lg bg-stamp px-4 text-sm font-bold text-white shadow-sm hover:bg-stamp/90 disabled:opacity-60"
              >
                {pending ? "삭제 중…" : "삭제 진행"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
