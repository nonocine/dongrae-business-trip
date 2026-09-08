import { redirect } from "next/navigation";
import { resolveFacilityAccess } from "@/lib/facilityAccess";
import { kstTodayYmd } from "@/lib/trainings";
import {
  listDrivingLogs,
  getDrivingSummary,
} from "@/app/hr/facility/driving/actions";
import DrivingLogView from "@/app/hr/facility/driving/DrivingLogView";

export const dynamic = "force-dynamic";

// 시설관리 > 운행기록 — 읽기 전용.
//   접근은 layout(resolveFacilityAccess)에서 가드하지만, 비품관리·안전점검과
//   같은 형태로 여기서도 방어적으로 다시 확인합니다.
export default async function FacilityDrivingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const access = await resolveFacilityAccess();
  if (!access) redirect("/");

  const { month: raw } = await searchParams;
  // month 파라미터가 아예 없으면 이번 달(기본), 빈 값(?month=)이면 전체 기간.
  //   동래카와 같은 방식 — 월을 비우면 전체가 나옵니다.
  const month =
    raw === undefined
      ? kstTodayYmd().slice(0, 7)
      : /^\d{4}-\d{2}$/.test(raw)
        ? raw
        : "";

  const [logs, summary] = await Promise.all([
    listDrivingLogs(month),
    getDrivingSummary(month),
  ]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">
        기관 차량의 운행 기록입니다. 조회와 월별 운행대장 출력만 할 수 있습니다
        — <span className="font-semibold">운행일지 작성·수정은 동래카 앱에서</span>{" "}
        합니다.
      </p>
      <DrivingLogView logs={logs} summary={summary} month={month} />
    </div>
  );
}
