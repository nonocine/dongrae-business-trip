import { addDaysYmd, kstTodayYmd, weekRange } from "@/lib/erp/duty";
import { dutyCalendarItems, erpLastSyncedAt, resolveErpViewer } from "@/lib/erp/view";
import { cardCls } from "@/lib/ui";
import HomeDutyBoardView, { BoardHeading, type AbsentPerson } from "@/app/components/HomeDutyBoardView";

// =====================================================================
// 메인 화면(/) 복무 현황판 — 이번 주(PC) / 오늘·내일(휴대폰).
//   * 데이터는 이 구역만 따로 불러옵니다 — EmployeeDashboard 가 <Suspense> 로 감싸
//     메인 화면은 먼저 그리고, 이 구역은 스켈레톤 → 데이터 순으로 채워집니다.
//   * 보는 권한은 /duties 와 같습니다(resolveErpViewer 가 null 이면 숨김).
//   * 표시 규칙은 /duties 와 같은 dutyCalendarItems(직원: 휴가/휴가(반일), 휴근·초과·야근 숨김,
//     관장: 원래 유형, ERP 계정 여러 개 합산)를 그대로 씁니다.
//   * 실패해도 메인 화면은 살아 있어야 하므로 오류는 이 구역 안에서만 안내합니다.
// =====================================================================

// 맨 위 요약 줄 — 오늘 부재(휴근·초과·야근 제외, 결재 중 포함 = countAbsentToday 와 같은 기준).
//   한 사람이 여러 건이면 유형을 '·' 로 묶습니다. 유형은 보는 사람 기준 표시 유형.
function absentOn(items: Awaited<ReturnType<typeof dutyCalendarItems>>, day: string): AbsentPerson[] {
  const byKey = new Map<string, { name: string; types: string[] }>();
  for (const it of items) {
    if (it.color === "overtime") continue; // 휴근·초과·야근(관장 화면에만 있음)은 부재 아님
    if (it.start > day || it.end < day) continue;
    for (const p of it.people) {
      const key = `${p.name}|${p.department ?? ""}`;
      const cur = byKey.get(key) ?? { name: p.name, types: [] };
      if (!cur.types.includes(it.type)) cur.types.push(it.type);
      byKey.set(key, cur);
    }
  }
  return [...byKey.values()]
    .map((v) => ({ name: v.name, type: v.types.join("·") }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

// "12:00" (오늘 동기화) / "11/16 12:00" (그 전).
function syncedText(iso: string | null, today: string): string | null {
  if (!iso) return null;
  const kst = new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString();
  const ymd = kst.slice(0, 10);
  const hm = kst.slice(11, 16);
  return ymd === today ? hm : `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))} ${hm}`;
}

export default async function HomeDutyBoard() {
  const viewer = await resolveErpViewer();
  if (!viewer) return null; // /duties 와 같은 권한 — 못 보는 사람에겐 구역 자체를 숨김

  const today = kstTodayYmd();
  const tomorrow = addDaysYmd(today, 1);
  const week = weekRange(today, 0); // 월~일
  const rangeEnd = tomorrow > week.end ? tomorrow : week.end; // 일요일이면 내일(다음 주 월)까지

  let data: { items: Awaited<ReturnType<typeof dutyCalendarItems>>; syncedAt: string | null } | null = null;
  try {
    const [items, syncedAt] = await Promise.all([
      dutyCalendarItems(week.start, rangeEnd, viewer.isM0),
      erpLastSyncedAt("duties"),
    ]);
    data = { items, syncedAt };
  } catch {
    data = null;
  }

  if (!data) {
    return (
      <section className={cardCls}>
        <BoardHeading />
        <p className="py-3 text-center text-xs text-ink-hint">
          복무 정보를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.
        </p>
      </section>
    );
  }
  return (
    <HomeDutyBoardView
      today={today}
      tomorrow={tomorrow}
      weekStart={week.start}
      items={data.items}
      absent={absentOn(data.items, today)}
      isM0={viewer.isM0}
      synced={syncedText(data.syncedAt, today)}
    />
  );
}

// 불러오는 동안 — 실제 구역과 비슷한 높이의 회색 막대.
export function HomeDutyBoardSkeleton() {
  return (
    <section className={cardCls} aria-busy="true" aria-label="복무 현황판 불러오는 중">
      <BoardHeading />
      <div className="animate-pulse space-y-2">
        <div className="h-4 w-2/3 rounded bg-line" />
        <div className="hidden h-36 rounded-lg bg-surface md:block" />
        <div className="space-y-2 md:hidden">
          <div className="h-14 rounded-lg bg-surface" />
          <div className="h-14 rounded-lg bg-surface" />
        </div>
        <div className="h-3 w-32 rounded bg-line/70" />
      </div>
    </section>
  );
}
