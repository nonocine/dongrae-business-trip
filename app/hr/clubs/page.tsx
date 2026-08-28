import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { getClubDashboard } from "@/app/hr/clubs/actions";
import ClubDashboard from "@/app/hr/clubs/ClubDashboard";
import { resolveClubAccess } from "@/lib/clubAccess";

export const dynamic = "force-dynamic";

export default async function ClubsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  await enforcePasswordChange();
  const access = await resolveClubAccess();
  if (!access) redirect("/");

  const now = new Date();
  const params = await searchParams;
  const year = Math.min(
    2100,
    Math.max(2020, Number(params.year) || now.getFullYear())
  );
  const month = Math.min(
    12,
    Math.max(1, Number(params.month) || now.getMonth() + 1)
  );
  const data = await getClubDashboard(year, month);

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
              동아리관리
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              동아리샘의 활동일지와 출석을 월간보고·사업실적으로 연결합니다.
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 text-sm text-ink-muted hover:underline"
          >
            ← 홈
          </Link>
        </div>
        <ClubDashboard year={year} month={month} data={data} />
      </main>
    </>
  );
}
