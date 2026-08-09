import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import ActivityList from "@/app/components/ActivityList";
import {
  enforcePasswordChange,
  getSession,
  listActivities,
} from "@/app/actions";
import { cardCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

// 활동일지 목록 — 기존 메인(/)에 있던 활동 목록을 분리한 페이지.
//   * 첫 화면은 대시보드로 바뀌었고, 활동 목록은 헤더 네비("활동일지")로 접근합니다.
export default async function ActivitiesPage() {
  // 임시 비밀번호 사용자는 비번 변경 페이지로 강제 이동
  await enforcePasswordChange();
  const session = await getSession();
  if (!session) redirect("/");

  const activities = await listActivities();

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-5 sm:py-6">
        <section className={cardCls}>
          <h2 className="text-lg font-bold tracking-tight text-ink">
            {`${session.name} 님의 활동 일지`}
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
