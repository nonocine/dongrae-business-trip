import { redirect } from "next/navigation";
import { resolveFacilityAccess } from "@/lib/facilityAccess";
import { listChecks } from "@/app/hr/facility/safetyActions";
import { kstTodayYmd } from "@/lib/trainings";
import SafetyList from "@/app/hr/facility/safety/SafetyList";

export const dynamic = "force-dynamic";

export default async function SafetyPage() {
  const access = await resolveFacilityAccess();
  if (!access) redirect("/");

  const checks = await listChecks();
  const today = kstTodayYmd();

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">
        청소년수련시설 안전점검(법정 67항목)을 월별로 기록합니다. “새 점검”으로
        지난달 결과를 복사하거나 빈 표로 시작하고, 완료 후 점검표 PDF를 받으세요.
      </p>
      <SafetyList
        checks={checks}
        thisYear={Number(today.slice(0, 4))}
        thisMonth={Number(today.slice(5, 7))}
        isM0={access.isM0}
      />
    </div>
  );
}
