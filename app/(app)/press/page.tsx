import { redirect } from "next/navigation";
import { enforcePasswordChange, isManagerAdmin } from "@/app/actions";
import { kstTodayYmd } from "@/lib/trainings";
import { loadLastCollectRun, loadPressData } from "./actions";
import PressManager from "./PressManager";

export const dynamic = "force-dynamic";
// [지금 수집] 서버 액션이 30초~1분 걸립니다(최근 7일 + 판정·원문 읽기).
export const maxDuration = 300;

// 보도자료 기자 — 관장 전용(직급 관장 + master). 부장·personnel 포함 안 함.
//   docs/PRESS_AUTOMATION.md 3-4.
export default async function PressPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await enforcePasswordChange();
  if (!(await isManagerAdmin())) redirect("/");

  const { tab } = await searchParams;
  const [{ reporters, articles }, lastRun] = await Promise.all([loadPressData(), loadLastCollectRun()]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-5">
        <p className="text-xs font-semibold tracking-wide text-navy">
          동래구청소년센터 · 관장 전용
        </p>
        <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
          보도자료 기자
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          우리 센터 기사를 쓴 기자와 기사 목록입니다. 평일 아침 8시 자동 수집이
          채우고, 메모·전화·담당 분야·보도자료 받기는 직접 고칩니다.
          기자 명단은 슬랙 등에 공유하지 않습니다.
        </p>
      </div>
      <PressManager
        reporters={reporters}
        articles={articles}
        lastRun={lastRun}
        today={kstTodayYmd()}
        initialTab={tab === "articles" ? "articles" : "reporters"}
      />
    </div>
  );
}
