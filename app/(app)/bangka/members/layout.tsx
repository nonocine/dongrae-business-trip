import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { resolveBangkaAccess } from "@/lib/bangkaAccess";
import BangkaTabs from "@/app/(app)/bangka/members/BangkaTabs";

export const dynamic = "force-dynamic";

// 방과후아카데미 학생·보호자 관리 공통 레이아웃 — 상단 탭 + 접근 가드.
//   M0 또는 bangka 직무(lib/bangkaAccess). 메뉴 조건(lib/menu.ts m0OrRole)과 같습니다.
export default async function BangkaMembersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await enforcePasswordChange();
  const access = await resolveBangkaAccess();
  if (!access) redirect("/");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4">
        <p className="text-xs font-semibold tracking-wide text-navy">
          동래구청소년센터 방과후아카데미
        </p>
        <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
          학생·보호자 관리
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          이음반·지음반 학생 명단과 보호자 계정. 보호자는 초대 링크로 동래방카 앱에
          가입(PIN 4자리)합니다.
        </p>
      </div>
      <BangkaTabs />
      <div className="mt-5">{children}</div>
    </div>
  );
}
