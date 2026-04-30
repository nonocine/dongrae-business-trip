import Link from "next/link";
import Header from "@/app/components/Header";
import LoginForm from "@/app/components/LoginForm";
import ActivityList from "@/app/components/ActivityList";
import {
  getSession,
  listActivities,
  listDriverNames,
} from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function Home() {
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
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            {session.kind === "admin"
              ? "전체 활동 일지"
              : `${session.name} 님의 활동 일지`}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            외근 · 출장 · 국내연수 · 해외연수 · 교육 모두 한곳에서 관리하세요.
          </p>
        </div>

        <Link
          href="/new"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-blue-600"
        >
          <span aria-hidden>＋</span>
          활동 작성
        </Link>

        <ActivityList activities={activities} />
      </main>
    </>
  );
}
