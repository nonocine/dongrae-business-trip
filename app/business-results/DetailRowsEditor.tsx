"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveResultDetails,
  type ResultDetail,
  type ResultDetailInput,
} from "./actions";
import { btnPrimary, btnSecondary, noticeError, noticeSuccess } from "@/lib/ui";

// 사업 한 건의 세부 실적(일자형/회차형) 편집기 — 수정 모드에서만 노출됩니다.
//   세부 합계와 본 행 수치의 불일치는 막지 않습니다(본 행이 집계 원본).
type EntryType = "date" | "session";

type Row = {
  entry_date: string;
  session_days: number;
  content: string;
  participants_youth: number;
  participants_other: number;
  room_youth: number;
  room_other: number;
};

// 인원 4칸 — 라벨은 김혜지 확정 문구를 그대로 씁니다.
const COUNT_FIELDS = [
  ["participants_youth", "참가인원(청소년)"],
  ["participants_other", "참가인원(기타)"],
  ["room_youth", "실별인원(청소년)"],
  ["room_other", "실별인원(기타)"],
] as const;

const cellInput =
  "w-full rounded-md border border-line bg-card px-2 py-1 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const numInput = `${cellInput} text-right tabular-nums`;
// 운영내용은 여러 줄 입력 — 기존 '주요 내용' 칸만큼 크게 두고 Enter 로 줄바꿈합니다(이민정 8/25).
const contentTextarea = `${cellInput} min-h-[5.5rem] resize-y py-1.5 leading-5`;

function emptyRow(): Row {
  return {
    entry_date: "",
    session_days: 1,
    content: "",
    participants_youth: 0,
    participants_other: 0,
    room_youth: 0,
    room_other: 0,
  };
}

export default function DetailRowsEditor({
  resultId,
  details,
}: {
  resultId: string;
  details: ResultDetail[];
}) {
  const initialType: EntryType =
    details[0]?.entry_type === "session" ? "session" : "date";
  const [entryType, setEntryType] = useState<EntryType>(initialType);
  const [rows, setRows] = useState<Row[]>(() =>
    details.map((d) => ({
      entry_date: d.entry_date ?? "",
      session_days: d.session_days ?? 1,
      content: d.content,
      participants_youth: d.participants_youth,
      participants_other: d.participants_other,
      room_youth: d.room_youth,
      room_other: d.room_other,
    })),
  );
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          py: a.py + r.participants_youth,
          po: a.po + r.participants_other,
          ry: a.ry + r.room_youth,
          ro: a.ro + r.room_other,
        }),
        { py: 0, po: 0, ry: 0, ro: 0 },
      ),
    [rows],
  );

  function patch(index: number, next: Partial<Row>) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...next } : r)),
    );
  }

  function save() {
    setMsg(null);
    // 회차 번호(session_no)는 입력칸을 없애고 줄 순서로 자동 부여합니다.
    const payload: ResultDetailInput[] = rows.map((r, i) => ({
      entry_type: entryType,
      entry_date: r.entry_date || null,
      session_no: i + 1,
      session_days: r.session_days,
      content: r.content,
      participants_youth: r.participants_youth,
      participants_other: r.participants_other,
      room_youth: r.room_youth,
      room_other: r.room_other,
    }));
    start(async () => {
      const res = await saveResultDetails(resultId, payload);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({ ok: true, text: `세부 실적 ${payload.length}행을 저장했습니다.` });
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-ink">세부 실적</h3>
          <p className="mt-1 text-xs text-ink-muted">
            구청 보고 서식의 사업별 세부표가 이 데이터로 생성됩니다.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-line p-1 text-xs">
          {(
            [
              ["date", "일자형"],
              ["session", "회차형"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setEntryType(key)}
              className={`rounded-md px-3 py-1.5 font-semibold ${
                entryType === key
                  ? "bg-navy text-white"
                  : "text-ink-muted hover:bg-surface"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-ink-muted">
              <th className="w-36 px-2 py-1.5 text-left font-semibold">
                {entryType === "date" ? "일자" : "운영일수"}
              </th>
              <th className="min-w-[18rem] px-2 py-1.5 text-left font-semibold">
                운영내용
              </th>
              {COUNT_FIELDS.map(([field, label]) => (
                <th
                  key={field}
                  className="w-28 px-2 py-1.5 text-right font-semibold"
                >
                  {label}
                </th>
              ))}
              <th className="w-12 px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line/60">
                <td className="px-2 py-1.5">
                  {entryType === "date" ? (
                    <input
                      type="date"
                      value={r.entry_date}
                      onChange={(e) => patch(i, { entry_date: e.target.value })}
                      className={cellInput}
                    />
                  ) : (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="1"
                        value={r.session_days}
                        onChange={(e) =>
                          patch(i, {
                            session_days: Number(e.target.value) || 1,
                          })
                        }
                        className={`${numInput} w-20`}
                      />
                      <span className="text-xs text-ink-hint">일</span>
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <textarea
                    rows={3}
                    value={r.content}
                    onChange={(e) => patch(i, { content: e.target.value })}
                    className={contentTextarea}
                    placeholder="운영내용 (Enter 로 줄바꿈)"
                  />
                </td>
                {COUNT_FIELDS.map(([field]) => (
                  <td key={field} className="px-2 py-1.5">
                    <input
                      type="number"
                      min="0"
                      value={r[field]}
                      onChange={(e) =>
                        patch(i, {
                          [field]: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className={numInput}
                    />
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() =>
                      setRows((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface"
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-2 py-6 text-center text-xs text-ink-hint"
                >
                  세부 행이 없습니다. 아래 &lsquo;행 추가&rsquo;로 입력하세요.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-surface text-xs font-bold text-ink-body">
                <td className="px-2 py-2" colSpan={2}>
                  세부 합계 (참고)
                </td>
                {[totals.py, totals.po, totals.ry, totals.ro].map((v, i) => (
                  <td key={i} className="px-2 py-2 text-right tabular-nums">
                    {v.toLocaleString("ko-KR")}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {msg && (
        <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>
          {msg.text}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={btnSecondary}
          onClick={() => setRows((prev) => [...prev, emptyRow()])}
        >
          행 추가
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={pending}
          onClick={save}
        >
          세부 실적 저장
        </button>
      </div>
    </section>
  );
}
