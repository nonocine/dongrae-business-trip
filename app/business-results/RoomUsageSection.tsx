"use client";

import { useMemo, useState } from "react";
import type { ReportRoom } from "./actions";

// 보고용 26개 실의 청소년/기타 사용인원 입력 — 층별 그룹, 접이식.
//   실인원 = 여기 입력값의 합. 서버가 business_results.youth_uses/other_uses 로
//   동기화하므로 폼의 실인원 칸은 읽기 전용입니다.
const FLOOR_ORDER = ["지하1층", "1층", "2층", "3층", "온나"];

const cellInput =
  "w-full rounded-md border border-line bg-card px-2 py-1 text-right text-sm tabular-nums text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";

export type RoomCounts = Record<string, { youth: number; other: number }>;

export default function RoomUsageSection({
  rooms,
  values,
  onChange,
}: {
  rooms: ReportRoom[];
  values: RoomCounts;
  onChange: (next: RoomCounts) => void;
}) {
  const [open, setOpen] = useState(false);

  const grouped = useMemo(() => {
    const active = rooms.filter((r) => r.is_active);
    const byFloor = new Map<string, ReportRoom[]>();
    for (const room of active) {
      const list = byFloor.get(room.floor) ?? [];
      list.push(room);
      byFloor.set(room.floor, list);
    }
    return [...byFloor.entries()].sort(
      (a, b) =>
        (FLOOR_ORDER.indexOf(a[0]) + 1 || 99) -
        (FLOOR_ORDER.indexOf(b[0]) + 1 || 99),
    );
  }, [rooms]);

  const totals = useMemo(
    () =>
      Object.values(values).reduce(
        (a, v) => ({ youth: a.youth + v.youth, other: a.other + v.other }),
        { youth: 0, other: 0 },
      ),
    [values],
  );

  function set(roomId: string, kind: "youth" | "other", raw: string) {
    const n = Math.max(0, Number(raw) || 0);
    const current = values[roomId] ?? { youth: 0, other: 0 };
    onChange({ ...values, [roomId]: { ...current, [kind]: n } });
  }

  const filled = Object.values(values).filter(
    (v) => v.youth > 0 || v.other > 0,
  ).length;

  return (
    <div className="rounded-xl border border-line md:col-span-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-bold text-ink">
          실별 사용인원
          <span className="ml-2 text-xs font-medium text-ink-muted">
            사용 {filled}개 실 · 청소년 {totals.youth.toLocaleString("ko-KR")} ·
            기타 {totals.other.toLocaleString("ko-KR")} · 계{" "}
            {(totals.youth + totals.other).toLocaleString("ko-KR")}
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-navy">
          {open ? "접기" : "펼치기"}
        </span>
      </button>

      {/* 접었을 때도 input 을 DOM 에 남겨야 FormData 에 실별 값이 실립니다. */}
      <div
        className={`space-y-4 border-t border-line px-4 py-4 ${open ? "" : "hidden"}`}
      >
          {grouped.map(([floor, list]) => (
            <div key={floor}>
              <p className="text-xs font-bold tracking-wide text-navy">
                {floor}
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs text-ink-muted">
                      <th className="px-2 py-1.5 text-left font-semibold">
                        실명
                      </th>
                      <th className="w-24 px-2 py-1.5 text-right font-semibold">
                        청소년
                      </th>
                      <th className="w-24 px-2 py-1.5 text-right font-semibold">
                        기타
                      </th>
                      <th className="w-20 px-2 py-1.5 text-right font-semibold">
                        계
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((room) => {
                      const v = values[room.id] ?? { youth: 0, other: 0 };
                      return (
                        <tr key={room.id} className="border-b border-line/60">
                          <td className="px-2 py-1.5 text-ink-body">
                            {room.name}
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              min="0"
                              name={`room_${room.id}_youth`}
                              value={v.youth}
                              onChange={(e) =>
                                set(room.id, "youth", e.target.value)
                              }
                              className={cellInput}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              min="0"
                              name={`room_${room.id}_other`}
                              value={v.other}
                              onChange={(e) =>
                                set(room.id, "other", e.target.value)
                              }
                              className={cellInput}
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">
                            {(v.youth + v.other).toLocaleString("ko-KR")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <p className="rounded-lg bg-surface px-3 py-2 text-xs text-ink-muted">
            값이 0인 실은 저장하지 않습니다. 여기 합계가 위 실인원 칸에 그대로
            반영됩니다.
          </p>
      </div>
    </div>
  );
}
