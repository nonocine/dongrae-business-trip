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

// 메인 화면 배너 — published 공고가 있을 때만 노출.
//   * 가장 마감이 임박한 공고 1건의 slug 로 이동.
function RecruitmentBanner({
  slug,
  title,
}: {
  slug: string;
  title: string;
}) {
  return (
    <Link
      href={`/recruitment/${slug}`}
      className="flex items-center justify-between gap-2 rounded-lg border border-brand-blue bg-brand-blue-soft/40 px-4 py-2.5 text-sm font-semibold text-brand-blue shadow-sm transition hover:bg-brand-blue-soft"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="rounded-full bg-brand-blue px-2 py-0.5 text-[10px] font-bold text-white"
        >
          채용
        </span>
        <span className="truncate">직원 채용 안내 — {title}</span>
      </span>
      <span aria-hidden className="shrink-0">→</span>
    </Link>
  );
}

export default async function Home() {
  // 임시 비밀번호 사용자는 비번 변경 페이지로 강제 이동
  await enforcePasswordChange();
  const session = await getSession();

  const published = await listPublishedRecruitmentSummaries();
  const banner = published[0] ?? null;

  if (!session) {
    let employees: string[] = [];
    try {
      employees = await listDriverNames();
    } catch {
      // drivers 테이블이 아직 없으면 빈 목록
    }
    return (
      <>
        <Header />
        <main className="mx-auto w-full max-w-md flex-1 space-y-3 px-4 py-8">
          {banner && (
            <RecruitmentBanner slug={banner.slug} title={banner.title} />
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
        {banner && (
          <RecruitmentBanner slug={banner.slug} title={banner.title} />
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
