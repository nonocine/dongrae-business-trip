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
import { cardCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function Home() {
  // 임시 비밀번호 사용자는 비번 변경 페이지로 강제 이동
  await enforcePasswordChange();
  const session = await getSession();

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
        <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
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
