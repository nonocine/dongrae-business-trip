import Link from "next/link";
import { notFound } from "next/navigation";
import { getApplyPosting } from "./actions";
import ApplyForm from "./ApplyForm";
import { cardCls, noticeWarning } from "@/lib/ui";

// 임시저장 후 페이지 재방문 시 최신 상태가 반영되도록 동적 렌더.
export const dynamic = "force-dynamic";

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

export default async function RecruitmentApplyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const posting = await getApplyPosting(slug);
  // published 가 아니거나 존재하지 않는 공고는 404.
  if (!posting) notFound();

  const closed =
    new Date(posting.application_end).getTime() < Date.now();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      {/* 상단 헤더 — 센터 로고 + "직원채용공고" + 공고 제목 */}
      <header className="mb-6 border-b border-line pb-5 sm:mb-8 sm:pb-6">
        <Link
          href={`/recruitment/${slug}`}
          className="text-xs text-ink-muted hover:underline sm:text-sm"
        >
          ← 공고로 돌아가기
        </Link>
        <div className="mt-3 flex items-center gap-4">
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
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted sm:text-sm">
          <span className="inline-flex items-center rounded-full bg-brand-blue-soft px-2 py-0.5 text-[11px] font-semibold text-brand-blue sm:text-xs">
            {posting.field}
          </span>
          <span>마감 {fmtKST(posting.application_end)}</span>
        </div>
      </header>

      {closed ? (
        <section className={cardCls}>
          <p className={noticeWarning}>접수가 마감되었습니다.</p>
          <p className="mt-3 text-xs text-ink-muted sm:text-sm">
            마감 시각 이후에는 새 지원서를 접수할 수 없습니다. 이미 임시저장된
            지원서가 있더라도 제출은 불가합니다.
          </p>
        </section>
      ) : (
        <ApplyForm
          posting={posting}
          initialApplicant={null}
          initialApplication={null}
        />
      )}
    </main>
  );
}
