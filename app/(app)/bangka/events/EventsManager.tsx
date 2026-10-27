"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEvent, saveEvent, type BkEventInput } from "@/app/(app)/bangka/events/actions";
import { BK_SCOPES, BK_SCOPE_LABEL, type BkEventRow, type BkScope } from "@/lib/bangkaContent";
import {
  badgeNavy,
  badgeNeutral,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  noticeError,
  panelToneCls,
  tableHeadCls,
  tableRowCls,
} from "@/lib/ui";

// =====================================================================
// 연간일정 — 연도별 목록(월로 묶음) + 추가·수정·삭제.
//   종료일이 비거나 시작일과 같으면 하루짜리 일정입니다.
// =====================================================================

const EMPTY: BkEventInput = { title: "", start_date: "", end_date: "", scope: "all", memo: "" };
const dow = (ymd: string) => "일월화수목금토"[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8))}(${dow(ymd)})`;

export default function EventsManager({ year, events }: { year: number; events: BkEventRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<BkEventInput | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove(e: BkEventRow) {
    if (!confirm(`"${e.title}" 일정을 지울까요?`)) return;
    setErr(null);
    start(async () => {
      const res = await deleteEvent(e.id);
      if (!res.ok) setErr(res.message);
      else router.refresh();
    });
  }

  // 월별로 묶기(시작 월 기준, 전해에 시작한 일정은 1월에).
  const groups = new Map<number, BkEventRow[]>();
  for (const e of events) {
    const mo = e.start_date.startsWith(`${year}-`) ? Number(e.start_date.slice(5, 7)) : 1;
    groups.set(mo, [...(groups.get(mo) ?? []), e]);
  }

  return (
    <div className="space-y-4">
      <div className={`${panelToneCls("blue")} flex flex-wrap items-center gap-2`}>
        <button type="button" onClick={() => router.push(`/bangka/events?year=${year - 1}`)} className={btnSecondary}>
          ◀
        </button>
        <span className="min-w-[5rem] text-center text-lg font-bold text-ink">{year}년</span>
        <button type="button" onClick={() => router.push(`/bangka/events?year=${year + 1}`)} className={btnSecondary}>
          ▶
        </button>
        <span className="text-xs text-ink-muted">{events.length}건</span>
        <button
          type="button"
          onClick={() => setEditing({ ...EMPTY, start_date: `${year}-` })}
          className={`ml-auto ${btnPrimary}`}
        >
          일정 추가
        </button>
      </div>

      {editing && (
        <EventForm
          initial={editing}
          onDone={() => {
            setEditing(null);
            router.refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {err && <p className={noticeError}>{err}</p>}

      <div className={`${panelToneCls("green")} overflow-x-auto`}>
        {events.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">{year}년 일정이 없습니다.</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className={tableHeadCls}>
                <th className="px-2 py-2 text-left">날짜</th>
                <th className="px-2 py-2 text-left">일정</th>
                <th className="px-2 py-2 text-left">대상</th>
                <th className="px-2 py-2 text-right"> </th>
              </tr>
            </thead>
            <tbody>
              {[...groups.entries()]
                .sort((a, b) => a[0] - b[0])
                .flatMap(([mo, list]) => [
                  <tr key={`m${mo}`}>
                    <td colSpan={4} className="bg-surface px-2 py-1 text-xs font-bold text-navy">
                      {mo}월
                    </td>
                  </tr>,
                  ...list.map((e) => (
                    <tr key={e.id} className={tableRowCls}>
                      <td className="px-2 py-2 whitespace-nowrap text-ink-body">
                        {md(e.start_date)}
                        {e.end_date && ` ~ ${md(e.end_date)}`}
                      </td>
                      <td className="px-2 py-2">
                        <span className="font-semibold text-ink">{e.title}</span>
                        {e.memo && <p className="text-xs text-ink-hint">{e.memo}</p>}
                      </td>
                      <td className="px-2 py-2">
                        <span className={e.scope === "all" ? badgeNeutral : badgeNavy}>{BK_SCOPE_LABEL[e.scope]}</span>
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            setEditing({
                              id: e.id,
                              title: e.title,
                              start_date: e.start_date,
                              end_date: e.end_date ?? "",
                              scope: e.scope,
                              memo: e.memo ?? "",
                            })
                          }
                          className={`${btnSecondary} h-8 px-3 text-xs`}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(e)}
                          disabled={pending}
                          className={`ml-1 ${btnSecondary} h-8 px-3 text-xs`}
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  )),
                ])}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function EventForm({
  initial,
  onDone,
  onCancel,
}: {
  initial: BkEventInput;
  onDone: () => void;
  onCancel: () => void;
}) {
  // 새 일정의 시작일 칸은 비워 둡니다("2026-" 은 연도 힌트용으로만 넘어옴).
  const [f, setF] = useState<BkEventInput>({ ...initial, start_date: /^\d{4}-\d{2}-\d{2}$/.test(initial.start_date) ? initial.start_date : "" });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof BkEventInput) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const res = await saveEvent(f);
      if (!res.ok) setErr(res.message);
      else onDone();
    });
  }

  return (
    <form onSubmit={submit} className={`${panelToneCls("yellow")} space-y-3`}>
      <h3 className="text-sm font-bold text-ink">{f.id ? "일정 수정" : "일정 추가"}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="sm:col-span-2">
          <span className={labelCls}>제목 *</span>
          <input value={f.title} onChange={set("title")} className={inputCls} required />
        </label>
        <label>
          <span className={labelCls}>시작일 *</span>
          <input type="date" value={f.start_date} onChange={set("start_date")} className={inputCls} required />
        </label>
        <label>
          <span className={labelCls}>종료일(하루면 비움)</span>
          <input type="date" value={f.end_date} min={f.start_date || undefined} onChange={set("end_date")} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>대상</span>
          <select value={f.scope} onChange={(e) => setF((p) => ({ ...p, scope: e.target.value as BkScope }))} className={inputCls}>
            {BK_SCOPES.map((s) => (
              <option key={s} value={s}>
                {BK_SCOPE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-3">
          <span className={labelCls}>메모</span>
          <input value={f.memo} onChange={set("memo")} className={inputCls} />
        </label>
      </div>
      {err && <p className={noticeError}>{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={pending} className={btnSecondary}>
          취소
        </button>
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}
