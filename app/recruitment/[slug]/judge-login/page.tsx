import { notFound, redirect } from "next/navigation";
import { getInterviewPosting } from "../interview/actions";
import {
  getExternalJudgeSession,
} from "@/app/hr/recruitment/[slug]/actions";
import JudgeLoginForm from "./JudgeLoginForm";

// 매 진입 시 공고 상태와 기존 세션을 다시 확인합니다.
export const dynamic = "force-dynamic";

// =====================================================================
// 2-D-5) 외부위원 로그인 — /recruitment/[slug]/judge-login
//   * 인사 관리자(관장·부장) 계정과 완전히 별개의 로그인입니다.
//   * 이름 + 휴대전화 11자리로 본인 확인(authenticateExternalJudge) 후
//     dongrae_external_judge 쿠키(8시간) 발급(loginExternalJudge) →
//     면접 채점 페이지로 이동합니다.
// =====================================================================
export default async function JudgeLoginPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // 공고가 없거나 면접 단계가 아니면(미공개 등) 노출하지 않습니다.
  const posting = await getInterviewPosting(slug);
  if (!posting) notFound();

  // 이미 본 공고로 로그인된 외부위원은 바로 면접 채점으로 보냅니다.
  const session = await getExternalJudgeSession();
  if (session && session.postingSlug === slug) {
    redirect(`/recruitment/${slug}/interview`);
  }

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8 sm:py-10">
      <header className="mb-6 flex items-center gap-4 border-b border-line pb-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/dongrae-logo.png"
          alt="동래구청소년센터"
          className="h-12 w-auto shrink-0 object-contain sm:h-14"
        />
        <div className="min-w-0 border-l border-line pl-4">
          <p className="text-sm font-bold tracking-[0.2em] text-brand-blue">
            직원채용 · 외부위원
          </p>
          <h1 className="mt-1 truncate text-base font-semibold leading-tight text-ink sm:text-lg">
            {posting.title}
          </h1>
        </div>
      </header>

      <JudgeLoginForm slug={slug} />
    </main>
  );
}
