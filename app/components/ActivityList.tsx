"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ACTIVITY_BADGE_CLASS,
  ACTIVITY_ICON,
  ACTIVITY_KINDS,
  ACTIVITY_LABEL,
  type Activity,
  type ActivityKind,
} from "@/lib/supabase";

function formatDate(d: string | null) {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${y}.${m}.${day}`;
}

function formatRange(start: string | null, end: string | null) {
  if (!start) return "";
  if (!end || end === start) return formatDate(start);
  return `${formatDate(start)} ~ ${formatDate(end)}`;
}

function locationOf(a: Activity): string {
  if (a.kind === "overseas_training") {
    return [a.country, a.city].filter(Boolean).join(" / ") || "-";
  }
  return a.location || "-";
}

const inputCls =
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export default function ActivityList({ activities }: { activities: Activity[] }) {
  const [kindFilter, setKindFilter] = useState<ActivityKind | "">("");
  const [monthFilter, setMonthFilter] = useState("");

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const a of activities) {
      if (a.start_date) set.add(a.start_date.slice(0, 7));
    }
    return [...set].sort().reverse();
  }, [activities]);

  const filtered = useMemo(() => {
    return activities.filter((a) => {
      if (kindFilter && a.kind !== kindFilter) return false;
      if (monthFilter) {
        const m = a.start_date?.slice(0, 7);
        if (m !== monthFilter) return false;
      }
      return true;
    });
  }, [activities, kindFilter, monthFilter]);

  return (
    <>
      <section className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-slate-600">유형</label>
          <select
            value={kindFilter}
            onChange={(e) =>
              setKindFilter(e.target.value as ActivityKind | "")
            }
            className={`mt-1 ${inputCls}`}
          >
            <option value="">전체 유형</option>
            {ACTIVITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {ACTIVITY_ICON[k]} {ACTIVITY_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">월</label>
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className={`mt-1 ${inputCls}`}
          >
            <option value="">전체 월</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {m.slice(0, 4)}년 {Number(m.slice(5, 7))}월
              </option>
            ))}
          </select>
        </div>
      </section>

      <p className="text-xs text-slate-500">
        총 <strong className="text-slate-800">{filtered.length}</strong>건
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center">
          <div
            aria-hidden
            className="text-5xl text-slate-300"
            style={{ filter: "grayscale(100%) opacity(0.6)" }}
          >
            📂
          </div>
          <p className="mt-2 text-sm font-medium text-slate-400">
            아직 등록된 활동이 없습니다.
          </p>
          <p className="text-xs text-slate-400">
            상단의 + 버튼으로 새 활동을 작성해보세요.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((a) => (
            <li key={a.id}>
              <Link
                href={`/activities/${a.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ACTIVITY_BADGE_CLASS[a.kind]}`}
                      >
                        {ACTIVITY_ICON[a.kind]} {ACTIVITY_LABEL[a.kind]}
                      </span>
                      <span className="text-xs font-medium text-slate-500">
                        {formatRange(a.start_date, a.end_date)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-base font-semibold text-slate-900">
                      {locationOf(a)}
                    </p>
                    {a.purpose && (
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {a.purpose}
                      </p>
                    )}
                  </div>
                  {a.photos.length > 0 && (
                    <span className="shrink-0 text-xs text-slate-400">
                      📷 {a.photos.length}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
