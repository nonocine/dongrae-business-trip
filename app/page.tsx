import Link from "next/link";
import Header from "@/app/components/Header";
import VehicleCard from "@/app/components/VehicleCard";
import DriverBar from "@/app/components/DriverBar";
import LoggedOutPanel from "@/app/components/LoggedOutPanel";
import MonthFilter from "@/app/components/MonthFilter";
import LogList from "@/app/components/LogList";
import {
  getDriverSession,
  getLatestCumulative,
  isAdmin,
  listDrivingLogs,
} from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: rawMonth } = await searchParams;
  const month = rawMonth && /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : "";

  const [admin, driver, cumulative] = await Promise.all([
    isAdmin(),
    getDriverSession(),
    getLatestCumulative(),
  ]);
  const loggedIn = admin || !!driver;

  if (!loggedIn) {
    return (
      <>
        <Header />
        <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-5 sm:py-6">
          <VehicleCard cumulative={cumulative} />
          <LoggedOutPanel />
        </main>
      </>
    );
  }

  const logs = await listDrivingLogs(month);
  const totalKm = logs.reduce((sum, l) => sum + Number(l.distance), 0);
  const downloadHref = month
    ? `/api/export?month=${encodeURIComponent(month)}`
    : `/api/export`;

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-5 sm:py-6">
        <VehicleCard cumulative={cumulative} />

        <DriverBar />

        <section className="flex flex-wrap items-center justify-between gap-3">
          <MonthFilter value={month} />
          <div className="flex items-center gap-2">
            {admin && (
              <a
                href={downloadHref}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#217346] px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1a5c38]"
              >
                <span aria-hidden>📊</span>
                엑셀 다운로드
              </a>
            )}
            {driver && (
              <Link
                href="/new"
                className="rounded-md bg-[color:var(--brand)] px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-[color:var(--brand-strong)]"
              >
                + 운행일지 작성
              </Link>
            )}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">조회 건수</p>
            <p className="mt-1 text-lg font-bold text-slate-900">
              {logs.length.toLocaleString("ko-KR")} 건
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">기간 운행거리</p>
            <p className="mt-1 text-lg font-bold text-slate-900">
              {new Intl.NumberFormat("ko-KR", {
                maximumFractionDigits: 1,
              }).format(totalKm)}{" "}
              km
            </p>
          </div>
        </section>

        <LogList logs={logs} isAdmin={admin} />
      </main>
    </>
  );
}
