import Link from "next/link";
import { VEHICLE } from "@/lib/vehicle";
import { isAdmin, adminLogout } from "@/app/actions";

export default async function Header() {
  const admin = await isAdmin();
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto grid w-full max-w-3xl grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 sm:py-4">
        <Link href="/" className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={VEHICLE.logoPath}
            alt="동래구청소년센터 로고"
            className="h-10 w-auto rounded-md bg-white object-contain"
          />
        </Link>

        <h1 className="text-center text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
          차량 운행일지
        </h1>

        <div className="flex items-center justify-end">
          {admin ? (
            <form action={adminLogout}>
              <button
                type="submit"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                관리자 로그아웃
              </button>
            </form>
          ) : (
            <Link
              href="/admin/login"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              관리자
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
