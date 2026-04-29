import { getDriverSession, logoutDriver } from "@/app/actions";

export default async function DriverBar() {
  const driver = await getDriverSession();
  if (!driver) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--brand-soft)] bg-[color:var(--brand-soft)]/40 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--brand)] text-xs font-bold text-white">
          {driver.name.slice(0, 1)}
        </span>
        <span className="text-slate-700">
          <span className="font-semibold text-[color:var(--brand-strong)]">
            {driver.name}
          </span>{" "}
          운전자로 로그인됨
        </span>
      </div>
      <form action={logoutDriver}>
        <button
          type="submit"
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          로그아웃
        </button>
      </form>
    </div>
  );
}
