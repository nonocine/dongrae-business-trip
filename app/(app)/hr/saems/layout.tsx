import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { resolveSaemView } from "@/lib/saemAccess";
import SaemTabs from "@/app/(app)/hr/saems/SaemTabs";

export const dynamic = "force-dynamic";

// 강사·프로그램 관리 공통 레이아웃 — 상단 탭 + 접근 가드.
//   ★ 2026-09: 열람은 로그인 직원 누구나(관장 지시, 동아리관리와 같은 정책).
//     계좌·주민번호·정산 금액·첨부서류처럼 민감한 것은 여전히 관리 권한
//     (M0 또는 saem 직무)에게만 갑니다 — lib/saemAccess.ts 주석 참고.
//   * 라우트 핸들러는 이 레이아웃을 안 거치므로 자체 가드가 필요합니다.
export default async function SaemsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await enforcePasswordChange();
  const access = await resolveSaemView();
  if (!access) redirect("/");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
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
      <SaemTabs canManage={access.canManage} />
      <div className="mt-5">{children}</div>
    </div>
  );
}
