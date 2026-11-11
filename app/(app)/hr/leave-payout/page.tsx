import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { loadPayoutRun, planPayoutLines, resolvePayoutAccess } from "@/lib/leavePayoutServer";
import { kstTodayYmd } from "@/lib/erp/duty";
import LeavePayoutManager from "@/app/(app)/hr/leave-payout/LeavePayoutManager";

export const dynamic = "force-dynamic";

// 연차수당 산정 — 관장(M0)·hr 직무·erp_finance 직무만(서버 가드). 직원 화면에는 노출하지 않습니다.
export default async function LeavePayoutPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await enforcePasswordChange();
  const access = await resolvePayoutAccess();
  if (!access) redirect("/");
  const sp = await searchParams;
  const thisYear = Number(kstTodayYmd().slice(0, 4));
  const y = Number(sp.year);
  const year = Number.isFinite(y) && y > 2000 && y <= thisYear ? y : thisYear;
  const { run, lines } = await loadPayoutRun(year);
  // 산정표가 없으면 '만들어질 줄'을 읽기만 해서 미리 보여 줍니다(DB 쓰기 없음).
  const preview = run ? null : await planPayoutLines(year);
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wide text-navy">동래구청소년센터 · 관리자 전용</p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-tight text-ink">연차수당 산정</h2>
          <p className="mt-1 text-xs text-ink-muted">
            첫해 월차 12/31 리셋분(근로기준법 제60조 ⑦·취업규칙 제29조 ①)과 사용촉진을 마치지 못한 회계연도 연차 잔여를 통상임금으로 산정합니다.
          </p>
        </div>
        <Link href="/hr/leave-plans" className="text-sm text-ink-muted hover:underline">
          연차 사용촉진 →
        </Link>
      </div>
      <LeavePayoutManager
        key={`${year}:${run?.id ?? "none"}`}
        year={year}
        thisYear={thisYear}
        run={run}
        lines={lines}
        preview={preview}
        canConfirm={access.canConfirm}
      />
    </div>
  );
}
