import { notFound } from "next/navigation";
import { getInterviewPosting } from "./actions";
import InterviewFlow from "./InterviewFlow";

// 매 진입 시 공고 상태(published/closed) 를 다시 확인합니다.
export const dynamic = "force-dynamic";

export default async function RecruitmentInterviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const posting = await getInterviewPosting(slug);
  if (!posting) notFound();

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:py-10">
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
              직원채용 · 면접 채점
            </p>
            <h1 className="mt-1 truncate text-base font-semibold leading-tight text-ink sm:text-lg lg:text-xl">
              {posting.title}
            </h1>
          </div>
        </div>
      </header>

      <InterviewFlow posting={posting} />
    </main>
  );
}
