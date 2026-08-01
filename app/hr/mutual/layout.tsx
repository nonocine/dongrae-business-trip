import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { resolveMutualAccess } from "@/lib/mutualAccess";
import MutualTabs from "@/app/hr/mutual/MutualTabs";
import { MUTUAL_FEE, formatKRW } from "@/lib/mutual";
import { badgeNavy, badgeNeutral } from "@/lib/ui";

export const dynamic = "force-dynamic";

// 상조회 공통 레이아웃 — 상단 탭 + 접근 가드.
//   MU-5: 열람은 로그인 직원 전원(자치 조직이므로 장부를 회원 누구나 본다).
//   기입·수정은 mutual 직무·M0 만 — 각 서버 액션이 requireMutualManage 로
//   재검증하고, 화면은 canManage 로 버튼을 감춘다.
//   * 라우트 핸들러는 이 레이아웃을 안 거치므로 자체 requireMutualManage 필요.
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
          <h2 className="mt-0.5 flex flex-wrap items-center gap-2 text-2xl font-bold tracking-[0.1em] text-ink">
            상조회
            <span className={access.canManage ? badgeNavy : badgeNeutral}>
              {access.canManage ? "담당" : "열람"}
            </span>
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            직원 자치 상조회 장부 — 회비 월 {formatKRW(MUTUAL_FEE)}원(급여공제),
            경조사 지출은 규정 금액표로 자동 계산합니다.
            {!access.canManage &&
              " 기입·수정은 상조회 담당자(또는 관장·부장)만 할 수 있습니다."}
          </p>
        </div>
        <MutualTabs canManage={access.canManage} />
        <div className="mt-5">{children}</div>
      </main>
    </>
  );
}
