import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { dutyBoard, erpLastSyncedAt, resolveErpViewer } from "@/lib/erp/view";
import { dayLabel, kstTodayYmd, weekRange } from "@/lib/erp/duty";
import ErpNote from "@/app/components/ErpNote";
import { badgeNeutral, badgeWarning, cardCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

// =====================================================================
// 복무 현황판 — 로그인한 직원 모두. ERP 복무(진행·완료)를 날짜별로.
//   직원: 연가·병가·공가·대휴 → "휴가"(반차 "휴가(반일)"), 휴근·초과·야근 숨김.
//   관장(M0): 원래 유형 + 휴근·초과·야근까지.
// =====================================================================

const TABS = [
  { key: "today", label: "오늘" },
  { key: "week", label: "이번 주" },
  { key: "next", label: "다음 주" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function DutyBoardPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await enforcePasswordChange();
  const viewer = await resolveErpViewer();
  if (!viewer) redirect("/");
  const sp = await searchParams;
  const tab: TabKey = sp.tab === "week" || sp.tab === "next" ? sp.tab : "today";

  const today = kstTodayYmd();
  const range = tab === "today" ? { start: today, end: today } : weekRange(today, tab === "next" ? 1 : 0);
  const [days, syncedAt] = await Promise.all([dutyBoard(range.start, range.end, viewer.isM0), erpLastSyncedAt("duties")]);
  const total = days.reduce((n, d) => n + d.items.length, 0);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-ink">복무 현황판</h2>
        <Link href="/" className="text-sm text-ink-muted hover:underline">
          ← 메인
        </Link>
      </div>
      <ErpNote syncedAt={syncedAt} className="mb-3" />

      <div className="mb-3 flex gap-1" role="tablist">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/duties?tab=${t.key}`}
            role="tab"
            aria-selected={tab === t.key}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
              tab === t.key ? "bg-navy text-white" : "border border-line bg-card text-ink-muted hover:bg-surface"
            }`}
          >
            {t.label}
          </Link>
        ))}
        <span className="ml-auto self-center text-xs text-ink-hint">
          {range.start === range.end ? dayLabel(range.start) : `${dayLabel(range.start)} ~ ${dayLabel(range.end)}`} · {total}건
        </span>
      </div>

      <div className="space-y-3">
        {days.map((d) => (
          <section key={d.date} className={cardCls}>
            <h3 className={`mb-2 text-sm font-bold ${d.date === today ? "text-navy" : "text-ink"}`}>
              {dayLabel(d.date)}
              {d.date === today && <span className="ml-1 text-xs font-normal text-navy">오늘</span>}
            </h3>
            {d.items.length === 0 ? (
              <p className="text-xs text-ink-hint">등록된 복무가 없습니다.</p>
            ) : (
              <ul className="divide-y divide-line/60">
                {d.items.map((it) => (
                  <li key={`${d.date}-${it.dutyId}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-sm">
                    <span className="font-medium text-ink">{it.names.join(", ")}</span>
                    <span className={badgeNeutral}>{it.type}</span>
                    {it.time && <span className="text-xs text-ink-muted">{it.time}</span>}
                    {it.location && <span className="text-xs text-ink-body">· {it.location}</span>}
                    {it.inProgress && (
                      <span className={badgeWarning} title="ERP 결재 진행 중">
                        결재 중
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      {!viewer.isM0 && (
        <p className="mt-3 text-[11px] text-ink-hint">연가·병가·공가·대휴는 &lsquo;휴가&rsquo;로 표시합니다.</p>
      )}
    </div>
  );
}
