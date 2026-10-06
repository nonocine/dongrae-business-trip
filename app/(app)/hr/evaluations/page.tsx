import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { resolveEvaluationAdmin } from "@/lib/hrEvaluationServer";
import { listEvaluationRoster } from "@/app/(app)/hr/evaluations/actions";
import EvaluationManager from "@/app/(app)/hr/evaluations/EvaluationManager";
import { isPeriodHalf, type PeriodHalf } from "@/lib/hrEvaluation";
import { kstTodayYmd } from "@/lib/trainings";

export const dynamic = "force-dynamic";

// 인사평가(근무성적평정, 운영규정 33조) — 관장·부장(M0)만. 본인·인사 담당도 진입 불가.
//   그 밖은 페이지 자체를 렌더하지 않으므로 RSC 페이로드에 평정 데이터가 실리지 않습니다.
//   /hr/discipline 과 별도 화면으로 둔 이유: 상벌은 사건이 생길 때 쓰고, 평정은 반기·연
//   단위로 전 직원을 한 번에 훑는 작업이라 진입점·목록이 다릅니다(메뉴에서 나란히 둠).
export default async function EvaluationsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; half?: string; driver?: string }>;
}) {
  await enforcePasswordChange();
  const me = await resolveEvaluationAdmin();
  if (!me) redirect("/");
  const params = await searchParams;
  const thisYear = Number(kstTodayYmd().slice(0, 4));
  const year = Math.min(2100, Math.max(2020, Number(params.year) || thisYear));
  const half: PeriodHalf = isPeriodHalf(params.half) ? params.half : "YEAR";
  const roster = await listEvaluationRoster(year, half);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wide text-navy">동래구청소년센터</p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">인사평가</h2>
          <p className="mt-1 text-xs text-ink-muted">
            근무성적평정(운영규정 33조). 재료는 자동으로 모으고, 점수·등급은 평정자가 넣습니다. 확정하면 그 시점 재료가
            고정됩니다.
          </p>
        </div>
        <Link href="/" className="text-sm text-ink-muted hover:underline">
          ← 목록
        </Link>
      </div>
      <EvaluationManager
        key={`${year}-${half}`}
        year={year}
        half={half}
        roster={roster}
        initialDriverId={roster.some((r) => r.driverId === params.driver) ? params.driver! : ""}
      />
    </div>
  );
}
