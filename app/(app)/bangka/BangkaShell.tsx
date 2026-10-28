import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { resolveBangkaAccess } from "@/lib/bangkaAccess";
import BangkaContentTabs from "@/app/(app)/bangka/BangkaContentTabs";
import { linkCls } from "@/lib/ui";
import { countPendingAbsences } from "@/app/(app)/bangka/absences/actions";
import { countOpenTalks } from "@/app/(app)/bangka/talk/actions";

// 방과후아카데미 콘텐츠(공지·알림장 / 급식 / 연간일정 / 공결 / 방카톡) 공통 틀 — 접근 가드 + 상단 탭.
//   권한은 학생·보호자 관리와 같습니다(M0 또는 bangka 직무 — lib/bangkaAccess).
export default async function BangkaShell({ children }: { children: React.ReactNode }) {
  await enforcePasswordChange();
  if (!(await resolveBangkaAccess())) redirect("/");
  const [pendingAbsences, openTalks] = await Promise.all([countPendingAbsences(), countOpenTalks()]);
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold tracking-wide text-navy">동래구청소년센터 방과후아카데미</p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">동래방카 콘텐츠</h2>
          <p className="mt-1 text-xs text-ink-muted">여기서 쓴 글·급식·일정이 보호자 앱(동래방카)에 그대로 보입니다.</p>
        </div>
        <Link href="/bangka/members" className={`text-sm ${linkCls}`}>
          학생·보호자 관리 →
        </Link>
      </div>
      <BangkaContentTabs pendingAbsences={pendingAbsences} openTalks={openTalks} />
      <div className="mt-5">{children}</div>
    </div>
  );
}
