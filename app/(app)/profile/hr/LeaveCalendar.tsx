"use client";

// =====================================================================
// LP-4. 연차 계획 날짜 선택 달력
//   * 일요일·공휴일은 붉게 + 공휴일명 표시. 토요일은 파랑(관례).
//   * 쉬는 날을 고르면 "공휴일/일요일입니다" 확인을 받되 선택 자체는 허용한다
//     (실제로 그날 연차를 쓰는 경우가 있고, 규정 판단은 담당자 몫).
//   * 이동 범위는 잔여기간 안의 달로 제한한다.
// =====================================================================

import { useMemo, useState } from "react";
import {
  WEEKDAY_LABELS,
  hasHolidayData,
  monthCells,
  monthsInRange,
  restDayReason,
} from "@/lib/koreanHolidays";
import { formatDays } from "@/lib/leavePlan";
import { btnPrimary, btnSecondary, noticeWarning } from "@/lib/ui";

export type CalendarSelection = { date: string; days: number };

export default function LeaveCalendar({
  periodStart,
  periodEnd,
  fallbackYear,
  selected,
  disabled,
  onToggle,
}: {
  periodStart: string | null;
  periodEnd: string | null;
  fallbackYear: number;
  selected: CalendarSelection[];
  disabled?: boolean;
  /** 날짜를 누를 때. 이미 선택된 날이면 해제 의도로 호출된다. */
  onToggle: (date: string, alreadySelected: boolean) => void;
}) {
  const months = useMemo(
    () => monthsInRange(periodStart, periodEnd, fallbackYear),
    [periodStart, periodEnd, fallbackYear]
  );
  const [idx, setIdx] = useState(0);
  // 쉬는 날 확인 대기 중인 날짜.
  const [ask, setAsk] = useState<{ date: string; reason: string } | null>(null);

  const cur = months[Math.min(idx, months.length - 1)] ?? {
    year: fallbackYear,
    month: 1,
  };
  const cells = useMemo(() => monthCells(cur.year, cur.month), [cur.year, cur.month]);
  const byDate = useMemo(
    () => new Map(selected.map((s) => [s.date, s.days])),
    [selected]
  );

  const inPeriod = (date: string) =>
    (!periodStart || date >= periodStart) && (!periodEnd || date <= periodEnd);

  function click(date: string) {
    if (disabled) return;
    const already = byDate.has(date);
    // 해제는 확인 없이 바로.
    if (already) return onToggle(date, true);
    const reason = restDayReason(date);
    if (reason) return setAsk({ date, reason });
    onToggle(date, false);
  }

  return (
    <div className="rounded-lg border border-line bg-card p-3">
      {/* 달 이동 */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx <= 0}
          className="rounded-md border border-line px-2 py-1 text-sm text-ink-muted hover:bg-surface disabled:opacity-40"
          aria-label="이전 달"
        >
          ←
        </button>
        <p className="text-sm font-bold text-ink">
          {cur.year}년 {cur.month}월
        </p>
        <button
          type="button"
          onClick={() => setIdx((i) => Math.min(months.length - 1, i + 1))}
          disabled={idx >= months.length - 1}
          className="rounded-md border border-line px-2 py-1 text-sm text-ink-muted hover:bg-surface disabled:opacity-40"
          aria-label="다음 달"
        >
          →
        </button>
      </div>

      {!hasHolidayData(cur.year) && (
        <p className="mb-2 rounded-md bg-surface px-2 py-1.5 text-[11px] text-ink-hint">
          {cur.year}년 공휴일 자료가 아직 등록되지 않아 일요일만 표시됩니다.
        </p>
      )}

      {/* 요일 머리 */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_LABELS.map((w, i) => (
          <div
            key={w}
            className={`py-1 text-[11px] font-bold ${
              i === 0 ? "text-stamp" : i === 6 ? "text-brand-blue" : "text-ink-muted"
            }`}
          >
            {w}
          </div>
        ))}
      </div>

      {/* 날짜 칸 */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c) return <div key={`x${i}`} />;
          const days = byDate.get(c.date);
          const on = days != null;
          const allowed = inPeriod(c.date);
          const color = c.rest
            ? "text-stamp"
            : c.saturday
              ? "text-brand-blue"
              : "text-ink-body";
          return (
            <button
              key={c.date}
              type="button"
              disabled={disabled || !allowed}
              onClick={() => click(c.date)}
              title={c.holiday ?? (c.sunday ? "일요일" : undefined)}
              className={`flex min-h-[52px] flex-col items-center justify-start rounded-md border px-0.5 py-1 transition ${
                on
                  ? "border-navy bg-navy text-white"
                  : allowed
                    ? "border-line bg-card hover:bg-surface"
                    : "cursor-not-allowed border-transparent bg-surface/50 opacity-40"
              }`}
            >
              <span
                className={`text-sm font-semibold ${on ? "text-white" : color}`}
              >
                {c.day}
              </span>
              {on ? (
                <span className="mt-0.5 rounded-full bg-white/20 px-1 text-[10px] font-bold text-white">
                  {formatDays(days!)}일
                </span>
              ) : (
                c.holiday && (
                  <span className="mt-0.5 w-full truncate text-[9px] leading-tight text-stamp">
                    {c.holiday.replace(" 대체공휴일", " 대체")}
                  </span>
                )
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-[11px] text-ink-hint">
        날짜를 눌러 추가·해제합니다. 일수(0.5/1)는 아래 목록에서 바꿉니다.
        <span className="ml-1 text-stamp">붉은 날</span>은 일요일·공휴일입니다.
      </p>

      {/* 쉬는 날 확인 */}
      {ask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl border border-line bg-card p-5 shadow-lg">
            <h4 className="text-base font-bold text-ink">
              {ask.date} 을 선택할까요?
            </h4>
            <p className={`mt-3 ${noticeWarning}`}>
              <b>{ask.reason}</b>입니다. 그래도 계획에 넣을 수 있습니다.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onToggle(ask.date, false);
                  setAsk(null);
                }}
                className={btnPrimary}
              >
                선택
              </button>
              <button
                type="button"
                onClick={() => setAsk(null)}
                className={btnSecondary}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
