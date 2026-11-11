"use client";

// =====================================================================
// 복무 현황판 — 월간 캘린더(월~일 7칸). ERP 복무(진행·완료)를 칩/막대로.
//   * 여러 날 걸친 복무는 주(週) 안에서 이어진 막대로, 주가 바뀌면 다음 줄에서 이어집니다.
//   * 한 칸에 MAX_LANES 줄까지, 넘치면 "+N건". 날짜를 누르면 상세 패널(PC 오른쪽, 좁은 화면 아래).
//   * 필터: 유형·부서. 표시 규칙(휴가 묶기·관장 원래 유형)은 서버가 이미 적용해 내려 줍니다.
//   * 폭이 좁으면(md 미만) 달력 대신 주간 목록 보기.
// =====================================================================

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CalendarDuty } from "@/lib/erp/view";
import { DUTY_COLOR_CLASS, DUTY_COLOR_LABEL, addDaysYmd, dayLabel, type DutyColorKey } from "@/lib/erp/duty";
import { getHolidayName } from "@/lib/koreanHolidays";
import { badgeWarning, cardCls } from "@/lib/ui";

const MAX_LANES = 3;
const WD = ["월", "화", "수", "목", "금", "토", "일"];

type Seg = { duty: CalendarDuty; people: CalendarDuty["people"]; col: number; span: number; lane: number };

function peopleLabel(people: CalendarDuty["people"]): string {
  if (!people.length) return "";
  return people.length > 1 ? `${people[0].name} 외 ${people.length - 1}명` : people[0].name;
}

export default function DutyCalendar({
  month,
  today,
  gridStart,
  weeks,
  items,
  isM0,
}: {
  month: string; // YYYY-MM
  today: string;
  gridStart: string; // 달력 첫 칸(월요일)
  weeks: number;
  items: CalendarDuty[];
  isM0: boolean;
}) {
  const [type, setType] = useState("");
  const [dept, setDept] = useState("");
  const [selected, setSelected] = useState<string>(today.slice(0, 7) === month ? today : `${month}-01`);
  const [weekIdx, setWeekIdx] = useState<number>(() => {
    const base = today.slice(0, 7) === month ? today : `${month}-01`;
    const diff = Math.round((Date.parse(`${base}T00:00:00Z`) - Date.parse(`${gridStart}T00:00:00Z`)) / 86400000);
    return Math.max(0, Math.min(weeks - 1, Math.floor(diff / 7)));
  });

  const types = useMemo(() => [...new Set(items.map((i) => i.type))].sort((a, b) => a.localeCompare(b, "ko")), [items]);
  const depts = useMemo(
    () =>
      [...new Set(items.flatMap((i) => i.people.map((p) => p.department ?? "")).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "ko")
      ),
    [items]
  );
  const colorsUsed = useMemo(() => [...new Set(items.map((i) => i.color))] as DutyColorKey[], [items]);

  // 필터 적용 — 부서는 사람 단위로 걸러 "노미현 외 N명" 숫자도 그 부서 기준.
  const shown = useMemo(
    () =>
      items
        .filter((i) => !type || i.type === type)
        .map((i) => ({ duty: i, people: dept ? i.people.filter((p) => p.department === dept) : i.people }))
        .filter((x) => x.people.length > 0),
    [items, type, dept]
  );

  // 주별 막대 배치.
  const weekRows = useMemo(() => {
    const rows: { start: string; days: string[]; segs: Seg[]; hidden: number[] }[] = [];
    for (let w = 0; w < weeks; w++) {
      const start = addDaysYmd(gridStart, w * 7);
      const end = addDaysYmd(start, 6);
      const days = Array.from({ length: 7 }, (_, k) => addDaysYmd(start, k));
      const parts = shown
        .filter((x) => x.duty.start <= end && x.duty.end >= start)
        .map((x) => {
          const s = x.duty.start < start ? start : x.duty.start;
          const e = x.duty.end > end ? end : x.duty.end;
          return { ...x, col: days.indexOf(s), span: days.indexOf(e) - days.indexOf(s) + 1 };
        })
        .sort((a, b) => a.col - b.col || b.span - a.span || a.duty.time.localeCompare(b.duty.time));
      const laneEnd: number[] = []; // 레인별 마지막으로 찬 칸
      const segs: Seg[] = [];
      const hidden = Array(7).fill(0);
      for (const p of parts) {
        let lane = laneEnd.findIndex((last) => last < p.col);
        if (lane === -1) {
          lane = laneEnd.length;
          laneEnd.push(-1);
        }
        laneEnd[lane] = p.col + p.span - 1;
        if (lane < MAX_LANES) segs.push({ duty: p.duty, people: p.people, col: p.col, span: p.span, lane });
        else for (let k = p.col; k < p.col + p.span; k++) hidden[k]++;
      }
      rows.push({ start, days, segs, hidden });
    }
    return rows;
  }, [shown, weeks, gridStart]);

  const onDay = (d: string) => shown.filter((x) => x.duty.start <= d && x.duty.end >= d);
  const [y, m] = month.split("-").map(Number);
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;

  const dayTone = (d: string) => {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (getHolidayName(d) || wd === 0) return "text-stamp";
    if (wd === 6) return "text-blue-600";
    return "text-ink";
  };

  const detail = (d: string) => {
    const list = onDay(d);
    const holiday = getHolidayName(d);
    return (
      <div>
        <h3 className="mb-2 text-sm font-bold text-ink">
          {dayLabel(d)}
          {holiday && <span className="ml-1 text-xs font-normal text-stamp">{holiday}</span>}
          <span className="ml-1 text-xs font-normal text-ink-muted">{list.length}건</span>
        </h3>
        {list.length === 0 ? (
          <p className="text-xs text-ink-hint">등록된 복무가 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {list.map((x) => (
              <li key={x.duty.id} className="rounded-md border border-line p-2 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${DUTY_COLOR_CLASS[x.duty.color]}`}>
                    {x.duty.type}
                  </span>
                  {x.duty.inProgress && <span className={badgeWarning}>결재 중</span>}
                </div>
                <p className="mt-1 font-medium text-ink">{x.people.map((p) => p.name).join(", ")}</p>
                <p className="text-xs text-ink-muted">{x.duty.time}</p>
                {x.duty.location && <p className="text-xs text-ink-body">장소: {x.duty.location}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* 이동·필터 */}
      <section className={`${cardCls} flex flex-wrap items-center gap-2`}>
        <Link href={`/duties?m=${prev}`} className="rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-surface" aria-label="이전 달">
          ◀
        </Link>
        <span className="min-w-[7rem] text-center text-lg font-bold text-ink">
          {y}년 {m}월
        </span>
        <Link href={`/duties?m=${next}`} className="rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-surface" aria-label="다음 달">
          ▶
        </Link>
        <Link href="/duties" className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white">
          오늘
        </Link>
        <span className="ml-auto flex flex-wrap gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-md border border-line bg-card px-2 py-1.5 text-sm" aria-label="유형">
            <option value="">전체 유형</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="rounded-md border border-line bg-card px-2 py-1.5 text-sm" aria-label="부서">
            <option value="">전체 부서</option>
            {depts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </span>
        <div className="flex w-full flex-wrap gap-1.5 pt-1">
          {colorsUsed.map((c) => (
            <span key={c} className={`rounded border px-1.5 py-0.5 text-[11px] ${DUTY_COLOR_CLASS[c]}`}>
              {DUTY_COLOR_LABEL[c]}
            </span>
          ))}
          {!isM0 && <span className="text-[11px] text-ink-hint">연가·병가·공가·대휴는 &lsquo;휴가&rsquo;로 표시합니다.</span>}
        </div>
      </section>

      {/* PC — 월간 달력 + 상세 패널 */}
      <div className="hidden gap-3 md:grid lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className={`${cardCls} !p-0 overflow-hidden`}>
          <div className="grid grid-cols-7 border-b border-line bg-surface text-center text-xs font-semibold">
            {WD.map((w, i) => (
              <div key={w} className={`py-1.5 ${i === 6 ? "text-stamp" : i === 5 ? "text-blue-600" : "text-ink-muted"}`}>
                {w}
              </div>
            ))}
          </div>
          {weekRows.map((row) => (
            <div key={row.start} className="relative border-b border-line/70 last:border-b-0">
              {/* 바탕 칸(누르면 그날 선택) */}
              <div className="absolute inset-0 grid grid-cols-7">
                {row.days.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setSelected(d)}
                    aria-label={`${dayLabel(d)} 상세`}
                    className={`border-r border-line/50 text-left last:border-r-0 ${
                      d.slice(0, 7) !== month ? "bg-surface/60" : ""
                    } ${d === selected ? "ring-2 ring-inset ring-navy/50" : ""} ${d === today ? "bg-navy-soft/40" : ""}`}
                  />
                ))}
              </div>
              {/* 날짜·칩 */}
              <div
                className="pointer-events-none relative grid grid-cols-7 gap-y-0.5 pb-1"
                style={{ gridTemplateRows: `auto repeat(${MAX_LANES}, 1.375rem) auto` }}
              >
                {row.days.map((d, i) => (
                  <div key={d} className="px-1.5 pt-1 text-xs" style={{ gridColumn: i + 1, gridRow: 1 }}>
                    <span
                      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-semibold ${
                        d === today ? "bg-navy text-white" : dayTone(d)
                      } ${d.slice(0, 7) !== month ? "opacity-50" : ""}`}
                    >
                      {Number(d.slice(8, 10))}
                    </span>
                    {getHolidayName(d) && (
                      <span className="ml-1 truncate text-[10px] text-stamp">{getHolidayName(d)}</span>
                    )}
                  </div>
                ))}
                {row.segs.map((s) => (
                  <button
                    key={`${s.duty.id}-${row.start}`}
                    type="button"
                    onClick={() => setSelected(row.days[s.col])}
                    title={`${s.people.map((p) => p.name).join(", ")} · ${s.duty.type} · ${s.duty.time}`}
                    className={`pointer-events-auto mx-0.5 truncate rounded border px-1 text-left text-[11px] leading-[1.25rem] ${DUTY_COLOR_CLASS[s.duty.color]} ${
                      s.duty.inProgress ? "border-dashed" : ""
                    }`}
                    style={{ gridColumn: `${s.col + 1} / span ${s.span}`, gridRow: s.lane + 2 }}
                  >
                    {peopleLabel(s.people)} {s.duty.type}
                  </button>
                ))}
                {row.hidden.map((n, i) =>
                  n > 0 ? (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelected(row.days[i])}
                      className="pointer-events-auto px-1.5 text-left text-[11px] font-semibold text-navy hover:underline"
                      style={{ gridColumn: i + 1, gridRow: MAX_LANES + 2 }}
                    >
                      +{n}건
                    </button>
                  ) : null
                )}
              </div>
            </div>
          ))}
        </section>
        <aside className={`${cardCls} self-start`}>{detail(selected)}</aside>
      </div>

      {/* 좁은 화면 — 주간 목록 */}
      <div className="md:hidden">
        <section className={cardCls}>
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              disabled={weekIdx === 0}
              onClick={() => setWeekIdx((w) => Math.max(0, w - 1))}
              className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-40"
              aria-label="이전 주"
            >
              ◀
            </button>
            <span className="text-sm font-semibold text-ink">
              {dayLabel(weekRows[weekIdx]?.start ?? gridStart)} ~ {dayLabel(addDaysYmd(weekRows[weekIdx]?.start ?? gridStart, 6))}
            </span>
            <button
              type="button"
              disabled={weekIdx >= weeks - 1}
              onClick={() => setWeekIdx((w) => Math.min(weeks - 1, w + 1))}
              className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-40"
              aria-label="다음 주"
            >
              ▶
            </button>
          </div>
          <div className="space-y-3">
            {(weekRows[weekIdx]?.days ?? []).map((d) => (
              <div key={d} className={`rounded-lg border p-2 ${d === today ? "border-navy bg-navy-soft/30" : "border-line"}`}>
                {detail(d)}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
