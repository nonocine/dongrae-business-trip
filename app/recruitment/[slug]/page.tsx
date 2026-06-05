import Link from "next/link";
import { notFound } from "next/navigation";
import { getRecruitmentPosting } from "./actions";
import {
  noticeWarning,
  splitRecruitmentFields,
  fieldBadgeCls,
} from "@/lib/ui";
import {
  RecruitmentHeader,
  SectionCard,
  type SectionAccent,
} from "@/app/recruitment/[slug]/PublicUi";

// DB 조회 기반이므로 매 요청마다 최신 공고를 렌더링합니다.
export const dynamic = "force-dynamic";

// 접수 기간 표시용 — KST(Asia/Seoul) 기준 날짜·시각.
function fmtKST(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function RecruitmentPostingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const posting = await getRecruitmentPosting(slug);
  // 공고가 없거나 비공개(draft/closed)면 404.
  if (!posting) notFound();

  // 마감 여부는 status 가 아니라 application_end 시각으로 판정합니다.
  // 서버 컴포넌트(force-dynamic)는 요청마다 1회 렌더되므로 Date.now() 가 안전.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const endTime = new Date(posting.application_end).getTime();
  const closed = endTime < now;
  // D-Day — KST 달력일 기준(UTC+9 고정). 0이면 오늘 마감.
  const kstDay = (ms: number) => Math.floor((ms + 9 * 3600 * 1000) / 86400000);
  const daysLeft = kstDay(endTime) - kstDay(now);
  const ddayLabel = closed
    ? null
    : daysLeft <= 0
      ? "오늘 마감"
      : `D-${daysLeft}`;

  // 값이 있는 항목만 순서대로 표시 — 디자인 지정 색상 매핑.
  type Section = { title: string; body: string | null; accent: SectionAccent };
  // 근무조건 카드 앞쪽(자격·우대·임금) / 뒤쪽(채용절차·심사항목·유의) 으로 분리.
  const beforeWork: Section[] = [
    { title: "자격요건", body: posting.qualifications, accent: "green" },
    { title: "우대사항", body: posting.preferred, accent: "orange" },
    { title: "임금조건", body: posting.salary_info, accent: "violet" },
  ];
  const afterWork: Section[] = [
    { title: "채용절차", body: posting.process_info, accent: "red" },
    { title: "서류전형 심사항목", body: posting.screening_criteria, accent: "orange" },
    { title: "면접전형 심사항목", body: posting.interview_criteria, accent: "green" },
    { title: "유의사항", body: posting.notice, accent: "navy" },
  ];

  // 근무조건 — 2열 그리드 텍스트 + 주요업무.
  const workFields = [
    { label: "계약기간", value: posting.work_contract_period },
    { label: "근무지", value: posting.work_location },
    { label: "근무시간", value: posting.work_hours },
  ].filter((f) => f.value);
  const hasWork = workFields.length > 0 || !!posting.work_duties;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <RecruitmentHeader title={posting.title}>
        {splitRecruitmentFields(posting.field).map((f, i) => (
          <span key={`${f}-${i}`} className={fieldBadgeCls(i)}>
            {f}
          </span>
        ))}
        <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold text-white">
          모집 {posting.recruit_count}명
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
            closed ? "bg-white/15 text-white/70" : "bg-brand-green text-white"
          }`}
        >
          {closed ? "접수마감" : "접수중"}
        </span>
        {ddayLabel && (
          <span className="rounded-full bg-stamp px-2.5 py-0.5 text-xs font-bold text-white shadow-sm">
            {ddayLabel}
          </span>
        )}
      </RecruitmentHeader>

      {/* 접수기간 — 파랑 포인트 + 마감 강조 */}
      <SectionCard
        title="접수기간"
        accent="blue"
        action={
          ddayLabel ? (
            <span className="rounded-full bg-stamp-soft px-2.5 py-1 text-xs font-bold text-stamp">
              {ddayLabel}
            </span>
          ) : undefined
        }
      >
        <dl className="space-y-1.5 text-sm text-ink-body">
          <div className="flex gap-2">
            <dt className="w-10 shrink-0 text-ink-muted">시작</dt>
            <dd>{fmtKST(posting.application_start)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-10 shrink-0 text-ink-muted">마감</dt>
            <dd className="font-bold text-stamp">
              {fmtKST(posting.application_end)}
            </dd>
          </div>
        </dl>
      </SectionCard>

      {/* 자격·우대·임금 */}
      {beforeWork.map((s) =>
        s.body ? (
          <SectionCard key={s.title} title={s.title} accent={s.accent}>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink-body">
              {s.body}
            </p>
          </SectionCard>
        ) : null
      )}

      {/* 근무조건 — 2열 그리드 */}
      {hasWork && (
        <SectionCard title="근무조건" accent="blue">
          {workFields.length > 0 && (
            <dl className="grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2">
              {workFields.map((f) => (
                <div key={f.label} className="flex gap-2 text-sm">
                  <dt className="w-16 shrink-0 font-semibold text-ink-muted">
                    {f.label}
                  </dt>
                  <dd className="min-w-0 break-words text-ink-body">
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {posting.work_duties && (
            <div
              className={
                workFields.length > 0
                  ? "mt-3 border-t border-line pt-3"
                  : undefined
              }
            >
              <p className="text-xs font-semibold text-ink-muted">주요업무</p>
              <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-ink-body">
                {posting.work_duties}
              </p>
            </div>
          )}
        </SectionCard>
      )}

      {/* 채용절차·심사항목·유의사항 */}
      {afterWork.map((s) =>
        s.body ? (
          <SectionCard key={s.title} title={s.title} accent={s.accent}>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink-body">
              {s.body}
            </p>
          </SectionCard>
        ) : null
      )}

      {/* 지원 액션 */}
      <div className="mt-6">
        {closed ? (
          <p className={noticeWarning}>접수가 마감되었습니다.</p>
        ) : (
          <Link
            href={`/recruitment/${posting.slug}/apply`}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-blue to-navy py-3.5 text-base font-bold text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0"
          >
            지원하기
            <span aria-hidden>→</span>
          </Link>
        )}
      </div>
    </main>
  );
}
