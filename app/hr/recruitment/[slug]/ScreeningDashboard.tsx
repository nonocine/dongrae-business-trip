"use client";

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
import {
  saveScreeningScore,
  updateApplicationStatus,
  bulkAnonymizeApplicants,
  APPLICATION_STATUS_LABEL,
  type AdminApplicant,
  type AdminPosting,
  type AppStatus,
  type ScoreEntry,
} from "./actions";

const SCREENING_MAX = 35;
const INTERVIEW_MAX = 65;

type TabKey = "list" | "detail" | "final";

export default function ScreeningDashboard({
  posting,
  applicants,
  scores,
  myReviewerName,
}: {
  posting: AdminPosting;
  applicants: AdminApplicant[];
  scores: ScoreEntry[];
  myReviewerName: string;
}) {
  const [tab, setTab] = useState<TabKey>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 지원자별 점수 집계 — 한 번만 계산해서 모든 탭에서 재사용.
  const aggregated = useMemo(
    () => aggregateScores(applicants, scores),
    [applicants, scores]
  );

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
          onOpen={openDetail}
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
          />
        ) : (
          <EmptyDetail onGoList={() => setTab("list")} />
        ))}

      {tab === "final" && (
        <FinalSummaryView
          posting={posting}
          applicants={applicants}
          aggregated={aggregated}
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
type Aggregate = {
  application_id: string;
  screeningAvg: number | null;
  screeningCount: number;
  interviewAvg: number | null;
  interviewCount: number;
  totalAvg: number | null; // 평균 합산
};

function aggregateScores(
  applicants: AdminApplicant[],
  scores: ScoreEntry[]
): Map<string, Aggregate> {
  const result = new Map<string, Aggregate>();
  for (const a of applicants) {
    const screening = scores.filter(
      (s) =>
        s.application_id === a.application_id &&
        s.stage === "screening" &&
        s.total_score != null
    );
    const interview = scores.filter(
      (s) =>
        s.application_id === a.application_id &&
        s.stage === "interview" &&
        s.total_score != null
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
    result.set(a.application_id, {
      application_id: a.application_id,
      screeningAvg: sAvg,
      screeningCount: screening.length,
      interviewAvg: iAvg,
      interviewCount: interview.length,
      totalAvg: tAvg,
    });
  }
  return result;
}

function fmtScore(n: number | null): string {
  if (n == null) return "—";
  return n.toFixed(1).replace(/\.0$/, "");
}

function fmtKstShort(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  onOpen,
}: {
  applicants: AdminApplicant[];
  aggregated: Map<string, Aggregate>;
  onOpen: (applicationId: string) => void;
}) {
  type SortKey = "submitted" | "screening" | "interview" | "total";
  const [sort, setSort] = useState<SortKey>("submitted");

  const sorted = useMemo(() => {
    const arr = [...applicants];
    const ag = (id: string) => aggregated.get(id);
    if (sort === "screening") {
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
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-brand-blue">
                    {fmtScore(ag?.screeningAvg ?? null)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-brand-green">
                    {fmtScore(ag?.interviewAvg ?? null)}
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
}: {
  posting: AdminPosting;
  applicant: AdminApplicant;
  scoresForApp: ScoreEntry[];
  myReviewerName: string;
}) {
  // 내 서류 채점 — 없으면 0/0/0 으로 시작.
  const myScreening =
    scoresForApp.find(
      (s) => s.stage === "screening" && s.reviewer_name === myReviewerName
    ) ?? null;

  const screening = myScreening?.scores as
    | {
        q1_expertise?: number;
        q2_license?: number;
        q3_statement?: number;
      }
    | undefined;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_400px]">
      {/* 좌측: 지원서 전체 */}
      <ApplicantSummary applicant={applicant} />
      {/* 우측: 서류 채점 + 상태 변경 */}
      <div className="space-y-4">
        <ScreeningScoreCard
          slug={posting.slug}
          applicationId={applicant.application_id}
          q1Initial={screening?.q1_expertise ?? 0}
          q2Initial={screening?.q2_license ?? 0}
          q3Initial={screening?.q3_statement ?? 0}
          memoInitial={myScreening?.memo ?? ""}
          submittedAt={myScreening?.submitted_at ?? null}
        />
        <StatusActionsCard
          slug={posting.slug}
          applicationId={applicant.application_id}
          currentStatus={applicant.status}
        />
        <OtherReviewersCard
          scoresForApp={scoresForApp}
          myReviewerName={myReviewerName}
        />
      </div>
    </div>
  );
}

function ApplicantSummary({ applicant: a }: { applicant: AdminApplicant }) {
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
          <h3 className="text-lg font-bold text-ink">{a.name}</h3>
          <p className="mt-0.5 font-mono text-xs text-ink-muted">
            접수번호 {a.applicant_number}
          </p>
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
// 서류 채점 카드 (35점 만점)
// =====================================================================
function ScreeningScoreCard({
  slug,
  applicationId,
  q1Initial,
  q2Initial,
  q3Initial,
  memoInitial,
  submittedAt,
}: {
  slug: string;
  applicationId: string;
  q1Initial: number;
  q2Initial: number;
  q3Initial: number;
  memoInitial: string;
  submittedAt: string | null;
}) {
  const [q1, setQ1] = useState(String(q1Initial));
  const [q2, setQ2] = useState(String(q2Initial));
  const [q3, setQ3] = useState(String(q3Initial));
  const [memo, setMemo] = useState(memoInitial);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const n1 = Number(q1) || 0;
  const n2 = Number(q2) || 0;
  const n3 = Number(q3) || 0;
  const total = n1 + n2 + n3;

  function handleSave() {
    setError(null);
    setOk(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("slug", slug);
        fd.set("application_id", applicationId);
        fd.set("q1_expertise", String(n1));
        fd.set("q2_license", String(n2));
        fd.set("q3_statement", String(n3));
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
      <div className="flex items-center justify-between border-b border-brand-blue/30 pb-2">
        <h3 className="text-sm font-bold tracking-wide text-brand-blue">
          서류 채점 (총 {SCREENING_MAX}점)
        </h3>
        {submittedAt && (
          <span className="text-[11px] text-ink-muted">
            최근 저장 {fmtKstShort(submittedAt)}
          </span>
        )}
      </div>

      <div className="mt-3 space-y-3">
        <ScoreInput
          label="① 전문성(학위) 0~15"
          max={15}
          value={q1}
          onChange={setQ1}
        />
        <ScoreInput
          label="② 자격증 0~5"
          max={5}
          value={q2}
          onChange={setQ2}
        />
        <ScoreInput
          label="③ 자기소개서 0~15"
          max={15}
          value={q3}
          onChange={setQ3}
        />

        <div className="rounded-lg bg-brand-blue-soft px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-brand-blue">합계</span>
            <span className="text-lg font-bold text-brand-blue">
              {total} <span className="text-xs">/ {SCREENING_MAX}</span>
            </span>
          </div>
        </div>

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

function ScoreInput({
  label,
  max,
  value,
  onChange,
}: {
  label: string;
  max: number;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type="number"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
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
}: {
  slug: string;
  applicationId: string;
  currentStatus: AppStatus;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className={cardCls}>
      <h3 className="text-sm font-semibold text-ink">상태 변경</h3>
      <p className="mt-1 text-xs text-ink-muted">
        현재:{" "}
        <span className={statusBadgeOf(currentStatus)}>
          {APPLICATION_STATUS_LABEL[currentStatus]}
        </span>
      </p>

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
}: {
  posting: AdminPosting;
  applicants: AdminApplicant[];
  aggregated: Map<string, Aggregate>;
}) {
  const ranked = useMemo(() => {
    return [...applicants].sort((a, b) => {
      const av = aggregated.get(a.application_id)?.totalAvg ?? -1;
      const bv = aggregated.get(b.application_id)?.totalAvg ?? -1;
      return bv - av;
    });
  }, [applicants, aggregated]);

  return (
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
              <th className="px-3 py-2 text-right font-medium">
                서류 (/{SCREENING_MAX})
              </th>
              <th className="px-3 py-2 text-right font-medium">
                면접 (/{INTERVIEW_MAX})
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
                  screeningAvg={ag?.screeningAvg ?? null}
                  screeningCount={ag?.screeningCount ?? 0}
                  interviewAvg={ag?.interviewAvg ?? null}
                  interviewCount={ag?.interviewCount ?? 0}
                  totalAvg={ag?.totalAvg ?? null}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FinalRow({
  rank,
  applicant,
  slug,
  screeningAvg,
  screeningCount,
  interviewAvg,
  interviewCount,
  totalAvg,
}: {
  rank: number;
  applicant: AdminApplicant;
  slug: string;
  screeningAvg: number | null;
  screeningCount: number;
  interviewAvg: number | null;
  interviewCount: number;
  totalAvg: number | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
      <td className="px-3 py-2 text-right font-semibold text-brand-blue">
        {fmtScore(screeningAvg)}
        {screeningCount > 1 && (
          <span className="ml-1 text-[10px] text-ink-hint">
            ({screeningCount}인)
          </span>
        )}
      </td>
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
