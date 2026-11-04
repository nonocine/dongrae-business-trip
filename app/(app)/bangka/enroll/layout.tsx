import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { resolveBangkaAccess } from "@/lib/bangkaAccess";
import BangkaTabs from "@/app/(app)/bangka/members/BangkaTabs";
import { linkCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

// 신규 청소년 온라인 접수(모집) — 회차·접수 목록·상세·합격 처리.
//   권한: M0 또는 bangka 직무(lib/bangkaAccess) — 학생·보호자 관리와 같은 게이트.
//   보호자 신청 화면은 동래방카 /apply (설계: docs/설계_방카신규접수.md).
export default async function BangkaEnrollLayout({ children }: { children: React.ReactNode }) {
  await enforcePasswordChange();
  const access = await resolveBangkaAccess();
  if (!access) redirect("/");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold tracking-wide text-navy">동래구청소년센터 방과후아카데미</p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">신규 접수</h2>
          <p className="mt-1 text-xs text-ink-muted">
            보호자가 동래방카 앱의 신청 화면(/apply)에서 낸 신청서를 확인하고 합격 처리합니다. 서류·민감정보 열람은 모두 기록됩니다.
          </p>
        </div>
        <Link href="/bangka/posts" className={`text-sm ${linkCls}`}>
          동래방카 콘텐츠 →
        </Link>
      </div>
      <BangkaTabs />
      <div className="mt-5">{children}</div>
    </div>
  );
}
