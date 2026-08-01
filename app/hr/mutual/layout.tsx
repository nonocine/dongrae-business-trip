import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { resolveMutualAccess } from "@/lib/mutualAccess";
import MutualTabs from "@/app/hr/mutual/MutualTabs";
import { MUTUAL_FEE, formatKRW } from "@/lib/mutual";

export const dynamic = "force-dynamic";

// 상조회 공통 레이아웃 — 상단 탭 + 접근 가드(M0 또는 mutual 직무).
//   * 라우트 핸들러는 이 레이아웃을 안 거치므로 자체 requireMutualAccess 필요.
export default async function MutualLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await enforcePasswordChange();
  const access = await resolveMutualAccess();
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
            상조회
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            직원 자치 상조회 장부 — 회비 월 {formatKRW(MUTUAL_FEE)}원(급여공제),
            경조사 지출은 규정 금액표로 자동 계산합니다.
          </p>
        </div>
        <MutualTabs />
        <div className="mt-5">{children}</div>
      </main>
    </>
  );
}
