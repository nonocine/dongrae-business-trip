import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { resolveSalaryAccess } from "@/lib/salaryAccess";
import { getPayoutData } from "@/app/(app)/hr/payouts/actions";
import PayoutManager from "@/app/(app)/hr/payouts/PayoutManager";

export const dynamic = "force-dynamic";

// 강사비 지출표 — 회계 담당이 이체·품의를 올리는 화면.
//   접근: M0(관장·부장·master) 또는 accounting(회계) 직무. 그 외 / 로.
//   계좌번호·지급 금액이 나오므로 강사관리 '열람' 수준으로는 열지 않습니다.
//   (lib/menu.ts 의 accounting-payouts 조건도 같은 기준입니다)
export default async function PayoutsPage() {
  await enforcePasswordChange();
  if (!(await resolveSalaryAccess())) redirect("/");

  const data = await getPayoutData();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-5">
        <p className="text-xs font-semibold tracking-wide text-navy">
          동래구청소년센터
        </p>
        <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
          강사비 지출표
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          확정된 정산에서 모은 지급 내역입니다. 금액은 정산에 저장된 값을 그대로
          쓰고 합계만 여기서 냅니다 — 이 화면에서는 아무것도 바뀌지 않습니다.
        </p>
      </div>
      <PayoutManager data={data} />
    </div>
  );
}
