import Link from "next/link";
import { getSession, logoutCurrent } from "@/app/actions";

export default async function Header() {
  const session = await getSession();
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:py-4">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/dongrae-logo.png"
            alt="동래구청소년센터 로고"
            className="h-9 w-auto rounded-md bg-white object-contain sm:h-10"
          />
          <span className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
            출장일지
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          {session && (
            <span className="hidden items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 sm:inline-flex">
              {session.kind === "admin"
                ? "👑 관리자"
                : `👤 ${session.name}`}
            </span>
          )}
          {session?.kind === "admin" && (
            <Link
              href="/admin"
              className="inline-flex items-center gap-1 rounded-md bg-violet-500 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-violet-600"
            >
              <span aria-hidden>⚙</span>
              <span className="hidden sm:inline">관리자 대시보드</span>
              <span className="sm:hidden">관리자</span>
            </Link>
          )}
          {session && (
            <form action={logoutCurrent}>
              <button
                type="submit"
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                로그아웃
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
