import { notFound } from "next/navigation";
import Link from "next/link";
import { getApplyPosting } from "./actions";
import ApplyForm from "./ApplyForm";
import { badgeNavy, badgeNeutral, cardCls, noticeWarning } from "@/lib/ui";

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
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:py-8">
      <header className="mb-5">
        <Link
          href={`/recruitment/${slug}`}
          className="text-xs text-ink-muted hover:underline"
        >
          ← 공고로 돌아가기
        </Link>
        <p className="mt-2 text-xs font-semibold tracking-wide text-navy">
          채용 지원서
        </p>
        <h1 className="mt-1 text-xl font-bold leading-snug text-ink sm:text-2xl">
          {posting.title}
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className={badgeNavy}>{posting.field}</span>
          <span className={badgeNeutral}>
            마감 {fmtKST(posting.application_end)}
          </span>
        </div>
      </header>

      {closed ? (
        <section className={cardCls}>
          <p className={noticeWarning}>접수가 마감되었습니다.</p>
          <p className="mt-3 text-xs text-ink-muted">
            마감 시각 이후에는 새 지원서를 접수할 수 없습니다. 이미 임시저장된
            지원서가 있더라도 제출은 불가합니다.
          </p>
        </section>
      ) : (
        // 초기 렌더 시 지원자/지원서 정보는 없습니다.
        // 클라이언트에서 이메일로 “기존 지원서 불러오기” 를 통해 임시저장을 이어 갈 수 있습니다.
        <ApplyForm
          posting={posting}
          initialApplicant={null}
          initialApplication={null}
        />
      )}
    </main>
  );
}
