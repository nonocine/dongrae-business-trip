import Link from "next/link";
import Header from "@/app/components/Header";
import LoginForm from "@/app/components/LoginForm";
import ActivityList from "@/app/components/ActivityList";
import {
  enforcePasswordChange,
  getSession,
  listActivities,
  listDriverNames,
} from "@/app/actions";
import { listPublishedRecruitmentSummaries } from "@/app/recruitment/[slug]/actions";
import { cardCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

// 메인 화면 배너 — published 공고가 1건 이상일 때만 노출.
//   * 건수(N)만 요약해 공개 목록 페이지(/recruitment)로 보냄.
function RecruitmentBanner({ count }: { count: number }) {
  return (
    <Link
      href="/recruitment"
      className="flex items-center justify-between gap-2 rounded-lg border border-brand-blue bg-brand-blue-soft/40 px-4 py-2.5 text-sm font-semibold text-brand-blue shadow-sm transition hover:bg-brand-blue-soft"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="rounded-full bg-brand-blue px-2 py-0.5 text-[10px] font-bold text-white"
        >
          채용
        </span>
        <span className="truncate">채용 진행 중 {count}건 보기</span>
      </span>
      <span aria-hidden className="shrink-0">→</span>
    </Link>
  );
}

// 구글 로그인 콜백 실패 코드 → 사용자 안내 문구.
function googleErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "domain_not_allowed") {
    return "onnainna.kr 워크스페이스 계정으로만 로그인할 수 있습니다.";
  }
  return "구글 로그인에 실패했습니다. 다시 시도해주세요.";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ google_error?: string }>;
}) {
  // 임시 비밀번호 사용자는 비번 변경 페이지로 강제 이동
  await enforcePasswordChange();
  const session = await getSession();

  const published = await listPublishedRecruitmentSummaries();
  const recruitmentCount = published.length;

  if (!session) {
    let employees: string[] = [];
    try {
      employees = await listDriverNames();
    } catch {
      // drivers 테이블이 아직 없으면 빈 목록
    }
    const googleError = googleErrorMessage((await searchParams).google_error);
    return (
      <>
        <Header />
        <main className="mx-auto w-full max-w-md flex-1 space-y-3 px-4 py-8">
          {recruitmentCount > 0 && (
            <RecruitmentBanner count={recruitmentCount} />
          )}
          {googleError && (
            <p className="rounded-lg bg-stamp-soft px-3 py-2 text-sm text-stamp">
              {googleError}
            </p>
          )}
          <LoginForm employees={employees} />
        </main>
      </>
    );
  }

  const activities = await listActivities();

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-5 sm:py-6">
        {recruitmentCount > 0 && (
          <RecruitmentBanner count={recruitmentCount} />
        )}
        <section className={cardCls}>
          <h2 className="text-lg font-bold tracking-tight text-ink">
            {session.kind === "admin"
              ? "전체 활동 일지"
              : `${session.name} 님의 활동 일지`}
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            외근 · 출장 · 국내연수 · 해외연수 · 교육 모두 한곳에서 관리하세요.
          </p>
        </section>

        <Link
          href="/new"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-navy-strong"
        >
          <span aria-hidden>＋</span>
          활동 작성
        </Link>

        <ActivityList activities={activities} />
      </main>
    </>
  );
}
