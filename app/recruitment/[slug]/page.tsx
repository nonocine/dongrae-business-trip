import Link from "next/link";
import { notFound } from "next/navigation";
import { getRecruitmentPosting } from "./actions";
import {
  cardCls,
  badgeNavy,
  badgeNeutral,
  badgeSuccess,
  noticeWarning,
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
  const closed =
    new Date(posting.application_end).getTime() < Date.now();

  // 값이 있는 항목만 순서대로 표시.
  const sections: { title: string; body: string | null }[] = [
    { title: "자격요건", body: posting.qualifications },
    { title: "우대사항", body: posting.preferred },
    { title: "임금조건", body: posting.salary_info },
    { title: "채용절차", body: posting.process_info },
    { title: "유의사항", body: posting.notice },
  ];

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:py-8">
      {/* 제목 */}
      <header className="mb-5">
        <p className="text-xs font-semibold tracking-wide text-navy">
          채용 공고
        </p>
        <h1 className="mt-1 text-xl font-bold leading-snug text-ink sm:text-2xl">
          {posting.title}
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className={badgeNavy}>{posting.field}</span>
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
