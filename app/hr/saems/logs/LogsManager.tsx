"use client";

import { useMemo, useState, useTransition } from "react";
import {
  getLogs,
  confirmSessions,
  unconfirmSession,
  type LogResult,
  type LogRow,
  type TermOption,
} from "@/app/hr/saems/logActions";
import { TERM_STATUS_LABEL, type TermStatus } from "@/lib/saem";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  badgeSuccess,
  badgeWarning,
  badgeNeutral,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

const selCls =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body";

export default function LogsManager({
  termOptions,
  initial,
  isM0,
}: {
  termOptions: TermOption[];
  initial: LogResult;
  isM0: boolean;
}) {
  const [termId, setTermId] = useState("");
  const [date, setDate] = useState("");
  const [result, setResult] = useState<LogResult>(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<LogRow | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function reload(nextTerm = termId, nextDate = date) {
    start(async () => {
      const r = await getLogs({ termId: nextTerm || undefined, date: nextDate || undefined });
      setResult(r);
      setSelected(new Set());
    });
  }

  // 날짜별 그룹.
  const groups = useMemo(() => {
    const map = new Map<string, LogRow[]>();
    for (const r of result.rows) {
      const k = r.session_date ?? "미정";
      const list = map.get(k) ?? [];
      list.push(r);
      map.set(k, list);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [result.rows]);

  // 선택 가능(제출됨·미확정) 세션.
  const selectableIds = useMemo(
    () => result.rows.filter((r) => r.submitted && !r.confirmed).map((r) => r.id),
    [result.rows]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function confirmSelected() {
    if (selected.size === 0) return;
    setMsg(null);
    start(async () => {
      const res = await confirmSessions([...selected]);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({ ok: true, text: `${res.confirmed}건을 확정했습니다.` });
      reload();
    });
  }

  const rate =
    result.summary.elapsed > 0
      ? Math.round((result.summary.submitted / result.summary.elapsed) * 100)
      : null;

  return (
    <div className="space-y-5">
      {/* 필터 + 요약 */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={termId}
            onChange={(e) => {
              setTermId(e.target.value);
              reload(e.target.value, date);
            }}
            className={selCls}
            aria-label="차시"
          >
            <option value="">활성 차시 전체</option>
            {termOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.projectName} · {t.name} ({TERM_STATUS_LABEL[t.status as TermStatus] ?? t.status})
              </option>
            ))}
          </select>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              reload(termId, e.target.value);
            }}
            className={selCls}
          />
          {(termId || date) && (
            <button
              type="button"
              onClick={() => {
                setTermId("");
                setDate("");
                reload("", "");
              }}
              className="text-xs text-ink-muted hover:underline"
            >
              필터 초기화
            </button>
          )}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label="제출률(경과 회차)"
            value={rate == null ? "-" : `${rate}% (${result.summary.submitted}/${result.summary.elapsed})`}
          />
          <div className="rounded-lg border border-line bg-surface/60 px-3 py-2 sm:col-span-2">
            <p className="text-[11px] text-ink-muted">미제출 강사</p>
            <p className="mt-0.5 text-sm text-ink">
              {result.summary.unsubmittedInstructors.length === 0
                ? "없음 ✓"
                : result.summary.unsubmittedInstructors.join(", ")}
            </p>
          </div>
        </div>
      </section>

      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}

      {/* 일괄 확정 바 */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-hint">
          선택 {selected.size}건 (확정 가능 {selectableIds.length}건)
        </p>
        <button
          type="button"
          onClick={confirmSelected}
          disabled={pending || selected.size === 0}
          className={btnPrimary}
        >
          선택 확정
        </button>
      </div>

      {/* 날짜별 그룹 */}
      {groups.length === 0 ? (
        <section className={cardCls}>
          <p className="py-8 text-center text-sm text-ink-hint">
            표시할 근무일지가 없습니다.
          </p>
        </section>
      ) : (
        groups.map(([day, rows]) => (
          <section key={day} className={cardCls}>
            <h3 className="mb-2 text-sm font-bold text-navy">{day}</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <thead>
                  <tr className="border-b border-line">
                    <th className={`${thCls} w-8`}></th>
                    <th className={thCls}>프로그램</th>
                    <th className={thCls}>강사</th>
                    <th className={thCls}>상태</th>
                    <th className={`${thCls} text-right`}>인원</th>
                    <th className={`${thCls} text-right`}>시간</th>
                    <th className={thCls}>수업내용</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const canSelect = r.submitted && !r.confirmed;
                    return (
                      <tr
                        key={r.id}
                        className="cursor-pointer border-b border-line/60 hover:bg-surface"
                        onClick={() => setDetail(r)}
                      >
                        <td className={tdCls} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            disabled={!canSelect}
                            checked={selected.has(r.id)}
                            onChange={() => toggle(r.id)}
                            className="h-4 w-4"
                          />
                        </td>
                        <td className={`${tdCls} font-medium text-ink`}>
                          {r.programName}
                        </td>
                        <td className={tdCls}>{r.instructorName ?? "-"}</td>
                        <td className={tdCls}>
                          {r.confirmed ? (
                            <span className={badgeSuccess}>확정</span>
                          ) : r.submitted ? (
                            <span className={badgeWarning}>제출됨</span>
                          ) : (
                            <span className={badgeNeutral}>미제출</span>
                          )}
                        </td>
                        <td className={`${tdCls} text-right`}>
                          {r.student_count ?? "-"}
                        </td>
                        <td className={`${tdCls} text-right`}>
                          {r.work_hours ?? "-"}
                        </td>
                        <td className={`${tdCls} max-w-[220px] truncate`}>
                          {r.log_content || r.plan_content || "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      {detail && (
        <DetailModal
          row={detail}
          isM0={isM0}
          onClose={() => setDetail(null)}
          onChanged={(text) => {
            setDetail(null);
            setMsg({ ok: true, text });
            reload();
          }}
          onError={(text) => setMsg({ ok: false, text })}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface/60 px-3 py-2">
      <p className="text-[11px] text-ink-muted">{label}</p>
      <p className="mt-0.5 font-mono text-base font-bold text-ink">{value}</p>
    </div>
  );
}

function DetailModal({
  row,
  isM0,
  onClose,
  onChanged,
  onError,
}: {
  row: LogRow;
  isM0: boolean;
  onClose: () => void;
  onChanged: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">
            {row.session_date} · {row.programName}
          </h3>
          <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:underline">
            닫기
          </button>
        </div>
        <p className="mb-3 text-sm text-ink-muted">
          강사 {row.instructorName ?? "-"} · 인원 {row.student_count ?? "-"} · 시간{" "}
          {row.work_hours ?? "-"}h ·{" "}
          {row.confirmed ? "확정됨" : row.submitted ? "제출됨(미확정)" : "미제출"}
        </p>

        <div className="space-y-3">
          <Block title="계획(plan)" text={row.plan_content} />
          <Block title="실제 수업내용(log)" text={row.log_content} highlight />
          <Block title="특이사항" text={row.note} />
        </div>

        <div className="mt-4 flex gap-2">
          {!row.confirmed ? (
            <button
              type="button"
              disabled={pending || !row.submitted}
              className={btnPrimary}
              title={!row.submitted ? "강사 제출 후 확정할 수 있습니다." : ""}
              onClick={() =>
                start(async () => {
                  const res = await confirmSessions([row.id]);
                  if (!res.ok) return onError(res.message);
                  if (res.confirmed === 0)
                    return onError("확정할 수 없습니다(미제출이거나 이미 확정).");
                  onChanged("확정했습니다.");
                })
              }
            >
              확정
            </button>
          ) : (
            isM0 && (
              <button
                type="button"
                disabled={pending}
                className={btnSecondary}
                onClick={() =>
                  start(async () => {
                    const res = await unconfirmSession(row.id);
                    if (!res.ok) return onError(res.message);
                    onChanged("확정을 취소했습니다.");
                  })
                }
              >
                확정 취소
              </button>
            )
          )}
          <button type="button" onClick={onClose} className={btnSecondary}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

function Block({
  title,
  text,
  highlight,
}: {
  title: string;
  text: string | null;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-navy">{title}</p>
      <p
        className={`mt-0.5 whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm ${
          highlight ? "border-navy/30 bg-navy-soft/30 text-ink" : "border-line bg-surface/50 text-ink-body"
        }`}
      >
        {text || "—"}
      </p>
    </div>
  );
}
