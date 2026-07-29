import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { resolveSaemAccess } from "@/lib/saemAccess";
import SaemTabs from "@/app/hr/saems/SaemTabs";

export const dynamic = "force-dynamic";

// 강사·프로그램 관리 공통 레이아웃 — 상단 탭 + 접근 가드(M0 또는 hr 직무).
//   * 라우트 핸들러(있으면)는 이 레이아웃을 안 거치므로 자체 requireSaemAccess 필요.
export default async function SaemsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await enforcePasswordChange();
  const access = await resolveSaemAccess();
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
            강사·프로그램 관리
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            외부 위촉강사 등록·초대, 프로그램 편성, 근무일지 확정. (강사는 동래샘들
            앱에서 계획서·근무일지를 입력합니다.)
          </p>
        </div>
        <SaemTabs />
        <div className="mt-5">{children}</div>
      </main>
    </>
  );
}
