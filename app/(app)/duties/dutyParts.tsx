// =====================================================================
// 복무 현황판 공용 부품 — /duties 월간 달력과 메인 화면(/) 복무 현황판이 같이 씁니다.
//   * 표시 규칙(휴가 묶기·관장 원래 유형·휴근·초과·야근 숨김)은 서버(lib/erp/view)가
//     이미 적용해 내려 주므로, 여기서는 배치·그리기만 합니다.
//   * 결재 중(진행)은 점선 테두리 + "결재 중" 배지.
// =====================================================================

import type { CalendarDuty } from "@/lib/erp/view";
import { DUTY_COLOR_CLASS } from "@/lib/erp/duty";
import { badgeWarning } from "@/lib/ui";

export type ShownDuty = { duty: CalendarDuty; people: CalendarDuty["people"] };
export type WeekSeg = ShownDuty & { col: number; span: number; lane: number };

// "노미현" / "노미현 외 2명"
export function peopleLabel(people: CalendarDuty["people"]): string {
  if (!people.length) return "";
  return people.length > 1 ? `${people[0].name} 외 ${people.length - 1}명` : people[0].name;
}

// 한 주(days = 7칸 날짜) 안에서 막대 배치 — 여러 날 걸친 복무는 이어진 막대로.
//   maxLanes 줄까지 그리고, 넘치는 건 칸별 hidden 개수로(+N건).
export function layoutWeek(shown: ShownDuty[], days: string[], maxLanes: number): { segs: WeekSeg[]; hidden: number[] } {
  const start = days[0];
  const end = days[days.length - 1];
  const parts = shown
    .filter((x) => x.duty.start <= end && x.duty.end >= start)
    .map((x) => {
      const s = x.duty.start < start ? start : x.duty.start;
      const e = x.duty.end > end ? end : x.duty.end;
      return { ...x, col: days.indexOf(s), span: days.indexOf(e) - days.indexOf(s) + 1 };
    })
    .sort((a, b) => a.col - b.col || b.span - a.span || a.duty.time.localeCompare(b.duty.time));
  const laneEnd: number[] = []; // 레인별 마지막으로 찬 칸
  const segs: WeekSeg[] = [];
  const hidden = Array<number>(days.length).fill(0);
  for (const p of parts) {
    let lane = laneEnd.findIndex((last) => last < p.col);
    if (lane === -1) {
      lane = laneEnd.length;
      laneEnd.push(-1);
    }
    laneEnd[lane] = p.col + p.span - 1;
    if (lane < maxLanes) segs.push({ duty: p.duty, people: p.people, col: p.col, span: p.span, lane });
    else for (let k = p.col; k < p.col + p.span; k++) hidden[k]++;
  }
  return { segs, hidden };
}

// 그날 걸친 복무.
export function dutiesOnDay(shown: ShownDuty[], d: string): ShownDuty[] {
  return shown.filter((x) => x.duty.start <= d && x.duty.end >= d);
}

// 막대(칩) 색 — 결재 중이면 점선.
export function dutyChipCls(duty: CalendarDuty): string {
  return `${DUTY_COLOR_CLASS[duty.color]} ${duty.inProgress ? "border-dashed" : ""}`;
}

// 하루치 복무 목록(상세 패널·휴대폰 목록).
export function DutyItemList({ list, compact = false }: { list: ShownDuty[]; compact?: boolean }) {
  if (list.length === 0) return <p className="text-xs text-ink-hint">등록된 복무가 없습니다.</p>;
  return (
    <ul className={compact ? "space-y-1.5" : "space-y-2"}>
      {list.map((x) => (
        <li
          key={x.duty.id}
          className={`rounded-md border border-line text-sm ${compact ? "px-2 py-1.5" : "p-2"}`}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${dutyChipCls(x.duty)}`}>
              {x.duty.type}
            </span>
            {x.duty.inProgress && <span className={badgeWarning}>결재 중</span>}
            {compact && <span className="font-medium text-ink">{x.people.map((p) => p.name).join(", ")}</span>}
            {compact && <span className="text-xs text-ink-muted">{x.duty.time}</span>}
          </div>
          {!compact && <p className="mt-1 font-medium text-ink">{x.people.map((p) => p.name).join(", ")}</p>}
          {!compact && <p className="text-xs text-ink-muted">{x.duty.time}</p>}
          {x.duty.location && <p className="text-xs text-ink-body">장소: {x.duty.location}</p>}
        </li>
      ))}
    </ul>
  );
}
