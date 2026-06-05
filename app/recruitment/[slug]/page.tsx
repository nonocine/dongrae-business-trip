import Link from "next/link";
import { notFound } from "next/navigation";
import { getRecruitmentPosting } from "./actions";
import {
  cardCls,
  badgeNeutral,
  badgeSuccess,
  noticeWarning,
  splitRecruitmentFields,
  fieldBadgeCls,
} from "@/lib/ui";

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
  const closed = new Date(posting.application_end).getTime() < Date.now();

  // 값이 있는 항목만 순서대로 표시.
  const sections: { title: string; body: string | null }[] = [
    { title: "자격요건", body: posting.qualifications },
    { title: "우대사항", body: posting.preferred },
    { title: "임금조건", body: posting.salary_info },
    { title: "채용절차", body: posting.process_info },
    { title: "유의사항", body: posting.notice },
  ];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      {/* 제목 — 센터 로고 + "직원채용공고" + 공고 제목 */}
      <header className="mb-6 border-b border-line pb-5 sm:mb-8 sm:pb-6">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/dongrae-logo.png"
            alt="동래구청소년센터"
            className="h-12 w-auto shrink-0 object-contain sm:h-14 lg:h-16"
          />
          <div className="min-w-0 border-l border-line pl-4">
            <p className="text-sm font-bold tracking-[0.2em] text-brand-blue sm:text-base lg:text-lg">
              직원채용공고
            </p>
            <h1 className="mt-1 truncate text-base font-semibold leading-tight text-ink sm:text-lg lg:text-xl">
              {posting.title}
            </h1>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {splitRecruitmentFields(posting.field).map((f, i) => (
            <span key={`${f}-${i}`} className={fieldBadgeCls(i)}>
              {f}
            </span>
          ))}
          <span className={badgeNeutral}>
            모집 {posting.recruit_count}명
          </span>
          <span className={closed ? badgeNeutral : badgeSuccess}>
            {closed ? "접수마감" : "접수중"}
          </span>
        </div>
      </header>

      {/* 접수기간 */}
      <section className={`${cardCls} mb-4`}>
        <h2 className="text-xs font-semibold tracking-wide text-navy">
          접수기간
        </h2>
        <dl className="mt-2 space-y-1 text-sm text-ink-body">
          <div className="flex gap-2">
            <dt className="w-10 shrink-0 text-ink-muted">시작</dt>
            <dd>{fmtKST(posting.application_start)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-10 shrink-0 text-ink-muted">마감</dt>
            <dd>{fmtKST(posting.application_end)}</dd>
          </div>
        </dl>
      </section>

      {/* 상세 항목 — 값이 있는 것만 */}
      {sections.map((s) =>
        s.body ? (
          <section key={s.title} className={`${cardCls} mb-4`}>
            <h2 className="text-xs font-semibold tracking-wide text-navy">
              {s.title}
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-body">
              {s.body}
            </p>
          </section>
        ) : null
      )}

      {/* 지원 액션 */}
      <div className="mt-5">
        {closed ? (
          <p className={noticeWarning}>접수가 마감되었습니다.</p>
        ) : (
          <Link
            href={`/recruitment/${posting.slug}/apply`}
            className="flex h-12 w-full items-center justify-center rounded-lg bg-navy text-sm font-semibold text-white shadow-sm transition hover:bg-navy-strong"
          >
            지원하기
          </Link>
        )}
      </div>
    </main>
  );
}
