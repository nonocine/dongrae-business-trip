import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { resolveFacilityAccess } from "@/lib/facilityAccess";
import { listAssets, getLocations } from "@/app/hr/facility/actions";
import { kstTodayYmd } from "@/lib/trainings";
import AssetManager from "@/app/hr/facility/assets/AssetManager";

export const dynamic = "force-dynamic";

export default async function FacilityAssetsPage() {
  await enforcePasswordChange();

  // 접근: M0(관장·부장) 또는 facility(시설) 직무만. 그 외 대시보드로.
  const access = await resolveFacilityAccess();
  if (!access) redirect("/");

  const [assets, locations] = await Promise.all([
    listAssets(),
    getLocations(true), // 활성 장소만(등록·필터 드롭다운용)
  ]);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-navy">
              동래구청소년센터
            </p>
            <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
              비품관리
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              시설 비품(자산) 대장입니다. 연도·장소·예산·상태·검색으로 좁혀 보고,
              내용연수 임박·만료 비품을 배지로 확인합니다.
            </p>
          </div>
          <Link href="/" className="text-sm text-ink-muted hover:underline">
            ← 목록
          </Link>
        </div>

        <AssetManager
          assets={assets}
          locations={locations}
          todayYmd={kstTodayYmd()}
          isM0={access.isM0}
        />
      </main>
    </>
  );
}
