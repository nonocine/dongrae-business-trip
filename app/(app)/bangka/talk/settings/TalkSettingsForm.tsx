"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTalkSettings } from "@/app/(app)/bangka/talk/actions";
import { getHolidayName, WEEKDAY_LABELS } from "@/lib/koreanHolidays";
import { hoursSummary, isTalkOpen, nextOpenLabel, toMinutes, type TalkHours } from "@/lib/talkHours";
import {
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  linkCls,
  noticeError,
  noticeSuccess,
  noticeWarning,
  panelToneCls,
  sectionTitleCls,
} from "@/lib/ui";

// 운영시간 설정 — 요일·시작/끝 시각·공휴일 막기·추가로 막을 날·안내 문구 + 미리보기("지금은 작성 가능/불가").
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월 … 일
const tap = "min-h-11 sm:min-h-0";
const hm = (t: string) => t.slice(0, 5);

export default function TalkSettingsForm({
  hours,
  canEdit,
  todayYmd,
  nowMs: now,
  holidayWarning,
}: {
  hours: TalkHours;
  canEdit: boolean;
  todayYmd: string;
  nowMs: number; // 미리보기 기준 시각 — 서버가 연 순간(서버·브라우저 화면이 같게)
  holidayWarning: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [weekdays, setWeekdays] = useState<number[]>(hours.weekdays);
  const [openTime, setOpenTime] = useState(hm(hours.open_time));
  const [closeTime, setCloseTime] = useState(hm(hours.close_time));
  const [blockHolidays, setBlockHolidays] = useState(hours.block_holidays);
  const [dates, setDates] = useState<string[]>(hours.extra_closed_dates);
  const [newDate, setNewDate] = useState("");
  const [notice, setNotice] = useState(hours.closed_notice);

  const draft: TalkHours = {
    weekdays,
    open_time: openTime,
    close_time: closeTime,
    block_holidays: blockHolidays,
    extra_closed_dates: dates,
    closed_notice: notice,
  };
  const valid = toMinutes(openTime) != null && toMinutes(closeTime) != null && toMinutes(openTime)! < toMinutes(closeTime)!;
  const openNow = valid && isTalkOpen(draft, now);
  const next = valid ? nextOpenLabel(draft, now) : null;

  const toggleDay = (d: number) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]));
  const addDate = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;
    setDates((ds) => [...new Set([...ds, newDate])].sort());
    setNewDate("");
  };

  const save = () =>
    start(async () => {
      const r = await saveTalkSettings({ weekdays, openTime, closeTime, blockHolidays, extraClosedDates: dates, closedNotice: notice });
      setMsg(r.ok ? { ok: true, text: "저장했습니다. 보호자 앱에 바로 반영됩니다." } : { ok: false, text: r.message });
      if (r.ok) router.refresh();
    });

  return (
    <div className="space-y-4">
      <Link href="/bangka/talk" className={`${linkCls} inline-flex min-h-11 items-center text-sm sm:min-h-0`}>
        ← 방카톡 목록
      </Link>

      {holidayWarning && <p className={noticeWarning}>{holidayWarning}</p>}
      {!canEdit && <p className={noticeWarning}>운영시간은 관장·부장·방과후아카데미 팀장만 바꿀 수 있습니다. 지금 설정을 보기만 합니다.</p>}

      <div className={`${panelToneCls(openNow ? "green" : "yellow")} space-y-1`}>
        <h3 className={sectionTitleCls(openNow ? "green" : "yellow")}>미리보기 — 지금은 보호자 작성 {openNow ? "가능" : "불가"}</h3>
        <p className="text-sm text-ink">{valid ? hoursSummary(draft) : "시각을 확인해 주세요."}</p>
        {!openNow && next && <p className="text-sm text-ink-muted">다음 운영: {next}</p>}
        <p className="text-xs text-ink-muted">직원 답글·보호자 읽기·자기 글 지우기·공결 신청은 시간과 상관없이 됩니다.</p>
      </div>

      <fieldset disabled={!canEdit || pending} className={`${panelToneCls("blue")} space-y-4`}>
        <div>
          <span className={labelCls}>쓸 수 있는 요일</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {ORDER.map((d) => (
              <label key={d} className={`inline-flex ${tap} cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-sm`}>
                <input type="checkbox" checked={weekdays.includes(d)} onChange={() => toggleDay(d)} className="h-4 w-4" />
                {WEEKDAY_LABELS[d]}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
          <label>
            <span className={labelCls}>시작 시각</span>
            <input type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} className={`${inputCls} h-11 text-base sm:h-auto sm:text-sm`} />
          </label>
          <label>
            <span className={labelCls}>끝 시각(이 시각부터 막힘)</span>
            <input type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} className={`${inputCls} h-11 text-base sm:h-auto sm:text-sm`} />
          </label>
        </div>

        <label className={`inline-flex ${tap} cursor-pointer items-center gap-2 text-sm text-ink`}>
          <input type="checkbox" checked={blockHolidays} onChange={(e) => setBlockHolidays(e.target.checked)} className="h-4 w-4" />
          법정 공휴일 막기(대체공휴일 포함)
        </label>

        <div>
          <span className={labelCls}>추가로 막을 날(센터 휴무일·임시공휴일)</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={newDate}
              min={todayYmd}
              onChange={(e) => setNewDate(e.target.value)}
              aria-label="막을 날"
              className={`${inputCls} mt-0 h-11 w-auto text-base sm:h-auto sm:text-sm`}
            />
            <button type="button" onClick={addDate} disabled={!newDate} className={`${btnSecondary} ${tap}`}>
              날짜 추가
            </button>
          </div>
          {dates.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {dates.map((d) => (
                <li key={d} className="inline-flex items-center gap-1 rounded-lg border border-line bg-card pl-3 text-sm">
                  {d}({WEEKDAY_LABELS[new Date(`${d}T00:00:00Z`).getUTCDay()]}){getHolidayName(d) ? ` · ${getHolidayName(d)}` : ""}
                  <button
                    type="button"
                    onClick={() => setDates((ds) => ds.filter((x) => x !== d))}
                    aria-label={`${d} 빼기`}
                    className={`inline-flex ${tap} min-w-11 items-center justify-center rounded-lg text-ink-muted hover:bg-surface sm:min-w-0 sm:px-2`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-ink-muted">없음</p>
          )}
        </div>

        <label className="block">
          <span className={labelCls}>운영시간 밖 안내 문구(보호자 앱에 그대로 보입니다)</span>
          <textarea value={notice} onChange={(e) => setNotice(e.target.value)} maxLength={500} rows={3} className={`${inputCls} text-base sm:text-sm`} />
        </label>

        {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}
        {canEdit && (
          <button type="button" onClick={save} disabled={pending || !valid} className={`${btnPrimary} ${tap}`}>
            {pending ? "저장하는 중…" : "운영시간 저장"}
          </button>
        )}
      </fieldset>
    </div>
  );
}
