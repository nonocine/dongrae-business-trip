import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { resolveSalaryAccess } from "@/lib/salaryAccess";
import { getLeavePlanOverview } from "@/app/hr/leave-plans/actions";
import LeavePlansManager from "@/app/hr/leave-plans/LeavePlansManager";

export const dynamic = "force-dynamic";

export default async function LeavePlansPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await enforcePasswordChange();

  // 접근: M0(관장·부장·master) 또는 회계(accounting) 직무 — 급여 게이트 재사용.
  const access = await resolveSalaryAccess();
  if (!access) redirect("/");

  const { year } = await searchParams;
  const y = Number(year);
  const overview = await getLeavePlanOverview(
    Number.isFinite(y) && y > 0 ? y : undefined
  );

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-navy">
              동래구청소년센터
            </p>
            <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
              연차 사용촉진
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              근로기준법 제61조의2에 따라 미사용 연차 사용계획서를 발부·수합합니다.
              (연 1회 · 보관용 — 실제 휴가 결재와는 별개입니다.)
            </p>
          </div>
          <Link href="/" className="text-sm text-ink-muted hover:underline">
            ← 목록
          </Link>
        </div>
        <LeavePlansManager initial={overview} />
      </main>
    </>
  );
}
