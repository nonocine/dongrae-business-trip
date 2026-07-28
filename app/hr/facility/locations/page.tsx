import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { resolveFacilityAccess } from "@/lib/facilityAccess";
import {
  getLocations,
  getLocationAssetCounts,
} from "@/app/hr/facility/actions";
import LocationManager from "@/app/hr/facility/locations/LocationManager";

export const dynamic = "force-dynamic";

export default async function FacilityLocationsPage() {
  await enforcePasswordChange();

  // 접근: M0(관장·부장) 또는 facility(시설) 직무만. 그 외 대시보드로.
  const access = await resolveFacilityAccess();
  if (!access) redirect("/");

  const [locations, counts] = await Promise.all([
    getLocations(false), // 비활성 포함(관리 화면)
    getLocationAssetCounts(),
  ]);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-navy">
              동래구청소년센터
            </p>
            <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
              장소 관리
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              비품 설치장소를 관리합니다. 이름을 바꾸면 그 장소를 쓰는 비품도 함께
              바뀌고, 기존 이름과 합쳐지면 통합됩니다.
            </p>
          </div>
          <Link
            href="/hr/facility/assets"
            className="text-sm text-ink-muted hover:underline"
          >
            비품관리 →
          </Link>
        </div>

        <LocationManager locations={locations} counts={counts} />
      </main>
    </>
  );
}
