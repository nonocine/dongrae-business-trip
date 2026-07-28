import { redirect } from "next/navigation";
import { resolveFacilityAccess } from "@/lib/facilityAccess";
import {
  getLocations,
  getLocationAssetCounts,
} from "@/app/hr/facility/actions";
import LocationManager from "@/app/hr/facility/locations/LocationManager";

export const dynamic = "force-dynamic";

export default async function FacilityLocationsPage() {
  // 접근은 layout 에서 가드. 방어적 null 체크만.
  const access = await resolveFacilityAccess();
  if (!access) redirect("/");

  const [locations, counts] = await Promise.all([
    getLocations(false), // 비활성 포함(관리 화면)
    getLocationAssetCounts(),
  ]);

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-xs text-ink-muted">
        비품 설치장소를 관리합니다. 이름을 바꾸면 그 장소를 쓰는 비품도 함께 바뀌고,
        기존 이름과 합쳐지면 통합됩니다.
      </p>
      <LocationManager locations={locations} counts={counts} />
    </div>
  );
}
