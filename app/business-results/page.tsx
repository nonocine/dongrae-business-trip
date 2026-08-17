import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange, getSession } from "@/app/actions";
import BusinessResultsDashboard from "./BusinessResultsDashboard";
import { getBusinessResultsData } from "./actions";

export const dynamic = "force-dynamic";

export default async function BusinessResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; period?: string }>;
}) {
  await enforcePasswordChange();
  const session = await getSession();
  if (!session) redirect("/");
  const query = await searchParams;
  const now = new Date();
  const year = Number(query.year) || now.getFullYear();
  const month = Math.min(
    12,
    Math.max(1, Number(query.month) || now.getMonth() + 1),
  );
  const period = /^(month|q1|q2|q3|q4|h1|h2|year)$/.test(query.period ?? "")
    ? query.period!
    : "month";
  const ranges: Record<string, [number, number]> = {
    month: [month, month],
    q1: [1, 3],
    q2: [4, 6],
    q3: [7, 9],
    q4: [10, 12],
    h1: [1, 6],
    h2: [7, 12],
    year: [1, 12],
  };
  const [startMonth, endMonth] = ranges[period];
  const data = await getBusinessResultsData(year, startMonth, endMonth);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-navy">
              동래구청소년센터
            </p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-[0.08em] text-ink">
              사업실적
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              월별 사업실적과 홍보내용을 함께 취합합니다.
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 text-sm text-ink-muted hover:underline"
          >
            ← 홈
          </Link>
        </div>
        <BusinessResultsDashboard
          year={year}
          month={month}
          period={period}
          startMonth={startMonth}
          endMonth={endMonth}
          data={data}
          currentUser={session.name}
        />
      </main>
    </>
  );
}
