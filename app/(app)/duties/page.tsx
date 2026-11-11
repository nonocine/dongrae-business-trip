import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { dutyCalendarItems, erpLastSyncedAt, resolveErpViewer } from "@/lib/erp/view";
import { addDaysYmd, kstTodayYmd, monthRange } from "@/lib/erp/duty";
import ErpNote from "@/app/components/ErpNote";
import DutyCalendar from "@/app/(app)/duties/DutyCalendar";

export const dynamic = "force-dynamic";

// =====================================================================
// 복무 현황판 — 전 직원. ERP 복무(진행·완료)를 월간 달력으로(?m=YYYY-MM, 기본 이번 달).
//   직원: 연가·병가·공가·대휴 → "휴가"(반차 "휴가(반일)"), 휴근·초과·야근 숨김.
//   관장(M0): 원래 유형 + 휴근·초과·야근까지. 판정은 서버(lib/erp/view)가 하고 화면은 그리기만.
// =====================================================================

export default async function DutyBoardPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await enforcePasswordChange();
  const viewer = await resolveErpViewer();
  if (!viewer) redirect("/");
  const sp = await searchParams;
  const today = kstTodayYmd();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m ?? "") ? sp.m! : today.slice(0, 7);

  // 달력 칸 — 그 달 1일이 든 주의 월요일 ~ 말일이 든 주의 일요일.
  const mr = monthRange(`${month}-01`);
  const dow = (ymd: string) => (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7; // 월=0
  const gridStart = addDaysYmd(mr.start, -dow(mr.start));
  const gridEnd = addDaysYmd(mr.end, 6 - dow(mr.end));
  const weeks = Math.round((Date.parse(`${gridEnd}T00:00:00Z`) - Date.parse(`${gridStart}T00:00:00Z`)) / 86400000 + 1) / 7;

  const [items, syncedAt] = await Promise.all([
    dutyCalendarItems(gridStart, gridEnd, viewer.isM0),
    erpLastSyncedAt("duties"),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-ink">복무 현황판</h2>
        <Link href="/" className="text-sm text-ink-muted hover:underline">
          ← 메인
        </Link>
      </div>
      <ErpNote syncedAt={syncedAt} className="mb-3" />
      <DutyCalendar
        key={month}
        month={month}
        today={today}
        gridStart={gridStart}
        weeks={weeks}
        items={items}
        isM0={viewer.isM0}
      />
    </div>
  );
}
