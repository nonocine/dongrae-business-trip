import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { dutyDashboardData, resolveDutyDashboardViewer } from "@/lib/erp/view";
import ErpNote from "@/app/components/ErpNote";
import DutyDashboardView from "@/app/(app)/hr/duty-dashboard/DutyDashboardView";
import LeaveBalanceTable from "@/app/(app)/hr/duty-dashboard/LeaveBalanceTable";
import { loadLeaveTable } from "@/lib/erp/leaveTable";

export const dynamic = "force-dynamic";

// 복무·연차 대시보드 — 관장(M0)·hr 직무만. ERP 복제 데이터 조회 전용(회계 표는 읽지 않음).
export default async function DutyDashboardPage() {
  await enforcePasswordChange();
  if (!(await resolveDutyDashboardViewer())) redirect("/");
  const data = await dutyDashboardData();
  const table = await loadLeaveTable(data);
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-ink">복무·연차 대시보드</h2>
        <Link href="/duties" className="text-sm text-ink-muted hover:underline">
          복무 현황판 →
        </Link>
      </div>
      <ErpNote syncedAt={data.syncedDuties} className="mb-3" />
      <div className="space-y-4">
        <LeaveBalanceTable data={table} />
        <DutyDashboardView data={data} />
      </div>
    </div>
  );
}
