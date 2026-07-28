import { redirect } from "next/navigation";
import { resolveFacilityAccess } from "@/lib/facilityAccess";
import { listAssets, getLocations } from "@/app/hr/facility/actions";
import { kstTodayYmd } from "@/lib/trainings";
import AssetManager from "@/app/hr/facility/assets/AssetManager";

export const dynamic = "force-dynamic";

export default async function FacilityAssetsPage() {
  // 접근은 layout 에서 가드. 여기서는 isM0 판정을 위해 다시 조회(방어적 null 체크).
  const access = await resolveFacilityAccess();
  if (!access) redirect("/");

  const [assets, locations] = await Promise.all([
    listAssets(),
    getLocations(true), // 활성 장소만(등록·필터 드롭다운용)
  ]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">
        시설 비품(자산) 대장입니다. 연도·장소·예산·상태·검색으로 좁혀 보고, 내용연수
        임박·만료 비품을 배지로 확인합니다.
      </p>
      <AssetManager
        assets={assets}
        locations={locations}
        todayYmd={kstTodayYmd()}
        isM0={access.isM0}
      />
    </div>
  );
}
