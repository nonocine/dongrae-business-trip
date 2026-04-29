import Link from "next/link";

export default function LoggedOutPanel() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <p className="text-sm font-medium text-slate-800">
        로그인이 필요합니다
      </p>
      <p className="mt-1 text-xs text-slate-500">
        운행 기록은 로그인한 운전자 본인 또는 관리자만 조회할 수 있습니다.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link
          href="/login"
          className="rounded-md bg-[color:var(--brand)] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[color:var(--brand-strong)]"
        >
          운전자 로그인
        </Link>
        <Link
          href="/admin/login"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          관리자 로그인
        </Link>
      </div>
    </section>
  );
}
