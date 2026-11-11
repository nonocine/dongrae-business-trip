import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { getLeavePlanOverview } from "@/app/(app)/hr/leave-plans/actions";
import LeavePlansManager from "@/app/(app)/hr/leave-plans/LeavePlansManager";
import LeavePromotionBoard from "@/app/(app)/hr/leave-plans/LeavePromotionBoard";
import { loadPromotionBoard, resolveLeavePromotionAccess } from "@/lib/leavePromotionServer";
import { kstTodayYmd } from "@/lib/erp/duty";

export const dynamic = "force-dynamic";

export default async function LeavePlansPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await enforcePasswordChange();

  // 접근: 관장(M0)·hr 직무·인사 파일 열람 보유자.
  //   기존 사용계획서 발부·수합(아래 LeavePlansManager)은 예전처럼 인사 파일 열람 보유자에게만 보입니다.
  const access = await resolveLeavePromotionAccess();
  if (!access) redirect("/");

  const { year } = await searchParams;
  const y = Number(year);
  const thisYear = Number(kstTodayYmd().slice(0, 4));
  const promoYear = Number.isFinite(y) && y > 2000 ? y : thisYear;
  const [board, overview] = await Promise.all([
    loadPromotionBoard(promoYear),
    access.isPersonnel ? getLeavePlanOverview(Number.isFinite(y) && y > 0 ? y : undefined) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wide text-navy">동래구청소년센터</p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">연차 사용촉진</h2>
          <p className="mt-1 text-xs text-ink-muted">
            근로기준법 제61조에 따른 1차 사용 촉구 → 사용계획 → 2차 사용시기 지정 통보를 직원별로 관리합니다.
          </p>
        </div>
        <Link href="/" className="text-sm text-ink-muted hover:underline">
          ← 목록
        </Link>
      </div>
      <div className="space-y-6">
        <LeavePromotionBoard board={board} />
        {overview ? (
          <div>
            <h3 className="mb-2 text-base font-bold text-ink">사용계획서 발부·수합</h3>
            <LeavePlansManager initial={overview} />
          </div>
        ) : (
          <p className="text-xs text-ink-hint">사용계획서 발부·수합은 인사 파일 열람 권한자에게만 보입니다.</p>
        )}
      </div>
    </div>
  );
}
