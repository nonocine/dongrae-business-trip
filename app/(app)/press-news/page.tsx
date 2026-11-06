import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { kstTodayYmd } from "@/lib/trainings";
import { linkCls } from "@/lib/ui";
import { loadPressNews } from "./data";
import PressNewsList from "./PressNewsList";

export const dynamic = "force-dynamic";

// 언론보도 — 공통 메뉴(로그인한 직원 누구나 조회).
//   기자 명단·기사 확인(승인/제외)·자동 수집은 /press(관장 전용)에 있습니다.
export default async function PressNewsPage() {
  await enforcePasswordChange();
  const data = await loadPressNews();
  if (!data) redirect("/");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-5">
        <p className="text-xs font-semibold tracking-wide text-navy">동래구청소년센터 · 공통</p>
        <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">언론보도</h2>
        <p className="mt-1 text-xs text-ink-muted">
          자동 수집된 우리 센터 기사와 홍보 실적(언론보도) 연결 현황입니다. 조회 전용입니다.
        </p>
        {data.canManage && (
          <p className="mt-1 text-xs text-ink-muted">
            기자 명단·기사 확인·지금 수집은{" "}
            <Link href="/press" className={linkCls}>
              보도자료 기자(관장 전용)
            </Link>
            에서 합니다.
          </p>
        )}
      </div>
      <PressNewsList
        articles={data.articles}
        reporterNames={data.reporterNames}
        canManage={data.canManage}
        today={kstTodayYmd()}
      />
    </div>
  );
}
