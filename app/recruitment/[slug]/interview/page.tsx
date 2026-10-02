import { notFound } from "next/navigation";
import { getInterviewPosting } from "./actions";
import { getInterviewJudgeContext } from "@/app/(app)/hr/recruitment/[slug]/actions";
import InterviewFlow from "./InterviewFlow";
import { getSession } from "@/app/actions";
import { hasHrScope } from "@/app/(app)/hr/actions";
import { JudgeExitTop, type JudgeExit } from "./JudgeExit";

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

  // 로그인한 직원이 이 공고의 활성 내부위원이면 이름·서명 화면을 건너뜁니다.
  //   (외부위원 쿠키만 있는 경우엔 null → 기존 외부위원 인트로 흐름 유지)
  const judge = await getInterviewJudgeContext(posting.id);
  const internalJudge =
    judge && judge.judgeType === "internal" ? { name: judge.name } : null;

  // 나가는 길 — 직원 세션이 있으면 실제 이동 버튼, 없으면(외부위원) 링크 없음.
  //   내부위원 배정 여부가 아니라 "직원 세션" 기준입니다: 관리자 화면의
  //   [면접 채점 열기]로 들어온 관장도 직원이므로 홈으로 돌아갈 수 있어야 합니다.
  //   [채용 관리로]는 그 화면에 들어갈 권한이 있는 직원에게만 보입니다.
  const me = await getSession();
  const isEmployee = !!me && me.kind === "employee" && me.name.trim() !== "";
  const exit: JudgeExit = isEmployee
    ? {
        kind: "internal",
        links: [
          { href: "/", label: "← 홈으로", primary: true },
          ...((await hasHrScope("recruitment"))
            ? [{ href: `/hr/recruitment/${slug}`, label: "채용 관리로" }]
            : []),
        ],
      }
    : { kind: "external" };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:py-10">
      <header className="mb-6 flex flex-col gap-3 border-b border-line pb-5 sm:mb-8 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:pb-6">
        <div className="flex min-w-0 items-center gap-4">
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
        <JudgeExitTop exit={exit} />
      </header>

      <InterviewFlow posting={posting} internalJudge={internalJudge} exit={exit} />
    </main>
  );
}
