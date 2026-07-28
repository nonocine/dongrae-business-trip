import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { resolveFacilityAccess } from "@/lib/facilityAccess";
import FacilityTabs from "@/app/hr/facility/FacilityTabs";

export const dynamic = "force-dynamic";

// 시설관리 공통 레이아웃 — 상단 탭 + 접근 가드(M0 또는 facility 직무).
//   * 라우트 핸들러(export/route.ts)는 이 레이아웃을 거치지 않으므로 그쪽은
//     자체적으로 requireFacilityAccess 를 호출합니다.
export default async function FacilityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await enforcePasswordChange();
  const access = await resolveFacilityAccess();
  if (!access) redirect("/");

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-4">
          <p className="text-xs font-semibold tracking-wide text-navy">
            동래구청소년센터
          </p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
            시설관리
          </h2>
        </div>
        <FacilityTabs />
        <div className="mt-5">{children}</div>
      </main>
    </>
  );
}
