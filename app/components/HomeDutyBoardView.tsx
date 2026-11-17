"use client";

// =====================================================================
// 메인 화면 복무 현황판 — 그리기만(데이터·표시 규칙은 서버 HomeDutyBoard).
//   * PC(md 이상): 이번 주 월~일 주간 막대. 월요일은 휴관이라 좁은 회색 칸. 오늘 칸 강조.
//   * 휴대폰: 오늘 + 내일 목록, [이번 주 전체] 로 펼치기.
//   * 막대·목록 부품은 /duties 와 공용(app/(app)/duties/dutyParts).
// =====================================================================

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CalendarDuty } from "@/lib/erp/view";
import { addDaysYmd, dayLabel } from "@/lib/erp/duty";
import { getHolidayName } from "@/lib/koreanHolidays";
import { cardCls } from "@/lib/ui";
import { DutyItemList, dutiesOnDay, dutyChipCls, layoutWeek, peopleLabel, type ShownDuty } from "@/app/(app)/duties/dutyParts";

export type AbsentPerson = { name: string; type: string };

const MAX_LANES = 4;
const WD = ["월", "화", "수", "목", "금", "토", "일"];
// 월요일 휴관(2026-11 관장 지시) — 월요일 칸은 좁게, 나머지 6칸은 같은 폭.
const COLS = "2.75rem repeat(6, minmax(0, 1fr))";
const isClosedDay = (i: number) => i === 0;

export function BoardHeading() {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-sm font-bold tracking-wide text-navy">복무 현황판</h3>
      <Link href="/duties" className="text-xs font-semibold text-brand-blue hover:underline">
        월간 보기 →
      </Link>
    </div>
  );
}

function dayTone(d: string): string {
  const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
  if (getHolidayName(d) || wd === 0) return "text-stamp";
  if (wd === 6) return "text-blue-600";
  return "text-ink";
}

export default function HomeDutyBoardView({
  today,
  tomorrow,
  weekStart,
  items,
  absent,
  isM0,
  synced,
}: {
  today: string;
  tomorrow: string;
  weekStart: string; // 이번 주 월요일
  items: CalendarDuty[];
  absent: AbsentPerson[];
  isM0: boolean;
  synced: string | null; // "12:00" / "11/16 12:00"
}) {
  const [expanded, setExpanded] = useState(false);
  const shown: ShownDuty[] = useMemo(() => items.map((duty) => ({ duty, people: duty.people })), [items]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, k) => addDaysYmd(weekStart, k)), [weekStart]);
  const { segs, hidden } = useMemo(() => layoutWeek(shown, days, MAX_LANES), [shown, days]);

  // 휴대폰 목록 — 접힘: 오늘·내일 / 펼침: 이번 주 전체(일요일이면 내일=다음 주 월요일도 덧붙임).
  const mobileDays = expanded ? (days.includes(tomorrow) ? days : [...days, tomorrow]) : [today, tomorrow];

  return (
    <section className={cardCls}>
      <BoardHeading />

      {/* 요약 한 줄 — 오늘 부재 n명 — 이름(유형), 이름(유형) */}
      <p className="mb-3 text-sm text-ink-body">
        <span className="font-semibold text-ink">
          오늘 부재 <b className="text-navy">{absent.length}</b>명
        </span>
        {absent.length > 0 && (
          <span className="text-ink-body">
            {" — "}
            {absent.map((p, i) => (
              <span key={`${p.name}-${i}`} className="whitespace-nowrap">
                {p.name}
                <span className="text-ink-muted">({p.type})</span>
                {i < absent.length - 1 ? ", " : ""}
              </span>
            ))}
          </span>
        )}
      </p>

      {/* PC — 이번 주 주간 막대 */}
      <div className="hidden overflow-hidden rounded-lg border border-line md:block">
        <div className="grid border-b border-line bg-surface text-center text-xs font-semibold" style={{ gridTemplateColumns: COLS }}>
          {days.map((d, i) => (
            <div
              key={d}
              className={`py-1.5 ${isClosedDay(i) ? "bg-line/60 text-ink-hint" : d === today ? "bg-navy-soft text-navy" : i === 6 ? "text-stamp" : i === 5 ? "text-blue-600" : "text-ink-muted"}`}
            >
              {WD[i]}
              {d === today && <span className="ml-1 text-[10px]">오늘</span>}
            </div>
          ))}
        </div>
        <div className="relative">
          {/* 바탕 칸 — 휴관일 회색, 오늘 강조 */}
          <div className="absolute inset-0 grid" style={{ gridTemplateColumns: COLS }}>
            {days.map((d, i) => (
              <div
                key={d}
                className={`border-r border-line/50 last:border-r-0 ${
                  isClosedDay(i) ? "bg-surface" : d === today ? "bg-navy-soft/40" : ""
                }`}
              />
            ))}
          </div>
          <div
            className="relative grid gap-y-0.5 pb-1.5"
            style={{ gridTemplateColumns: COLS, gridTemplateRows: `auto repeat(${MAX_LANES}, 1.375rem) auto` }}
          >
            {days.map((d, i) => (
              <div key={d} className="truncate px-1.5 pt-1 text-xs" style={{ gridColumn: i + 1, gridRow: 1 }}>
                <span
                  className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-semibold ${
                    d === today ? "bg-navy text-white" : isClosedDay(i) ? "text-ink-hint" : dayTone(d)
                  }`}
                >
                  {Number(d.slice(8, 10))}
                </span>
                {isClosedDay(i) ? (
                  <span className="sr-only">휴관</span>
                ) : (
                  getHolidayName(d) && <span className="ml-1 text-[10px] text-stamp">{getHolidayName(d)}</span>
                )}
              </div>
            ))}
            {segs.map((s) => (
              <span
                key={s.duty.id}
                title={`${s.people.map((p) => p.name).join(", ")} · ${s.duty.type} · ${s.duty.time}${s.duty.inProgress ? " · 결재 중" : ""}`}
                className={`mx-0.5 truncate rounded border px-1 text-[11px] leading-[1.25rem] ${dutyChipCls(s.duty)}`}
                style={{ gridColumn: `${s.col + 1} / span ${s.span}`, gridRow: s.lane + 2 }}
              >
                {peopleLabel(s.people)} {s.duty.type}
              </span>
            ))}
            {hidden.map((n, i) =>
              n > 0 ? (
                <Link
                  key={i}
                  href="/duties"
                  className="truncate px-1.5 text-[11px] font-semibold text-navy hover:underline"
                  style={{ gridColumn: i + 1, gridRow: MAX_LANES + 2 }}
                >
                  +{n}건
                </Link>
              ) : null
            )}
            {segs.length === 0 && (
              <p className="self-center text-center text-xs text-ink-hint" style={{ gridColumn: "2 / span 6", gridRow: "2 / span 2" }}>
                이번 주 등록된 복무가 없습니다.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 휴대폰 — 오늘·내일 목록 + [이번 주 전체] */}
      <div className="space-y-2 md:hidden">
        {mobileDays.map((d) => {
          const closed = new Date(`${d}T00:00:00Z`).getUTCDay() === 1;
          const list = dutiesOnDay(shown, d);
          return (
            <div
              key={d}
              className={`rounded-lg border p-2 ${d === today ? "border-navy bg-navy-soft/30" : closed ? "border-line bg-surface" : "border-line"}`}
            >
              <p className="mb-1.5 text-xs font-bold text-ink">
                {d === today ? "오늘 " : d === tomorrow ? "내일 " : ""}
                <span className={d === today || d === tomorrow ? "font-normal text-ink-muted" : dayTone(d)}>{dayLabel(d)}</span>
                {closed && <span className="ml-1 font-normal text-ink-hint">휴관</span>}
                {getHolidayName(d) && <span className="ml-1 font-normal text-stamp">{getHolidayName(d)}</span>}
                {list.length > 0 && <span className="ml-1 font-normal text-ink-muted">{list.length}건</span>}
              </p>
              <DutyItemList list={list} compact />
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="w-full rounded-md border border-line py-2 text-sm font-semibold text-navy hover:bg-surface"
        >
          {expanded ? "접기" : "이번 주 전체"}
        </button>
      </div>

      <p className="mt-2 text-[11px] text-ink-hint">
        ERP 기준 · {synced ? `${synced} 동기화` : "동기화 기록 없음"}
        {!isM0 && " · 연가·병가·공가·대휴는 ‘휴가’로 표시"}
      </p>
    </section>
  );
}
