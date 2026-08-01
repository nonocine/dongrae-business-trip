"use client";

import { useMemo, useState, useTransition } from "react";
import {
  getLogs,
  confirmSessions,
  unconfirmSession,
  resetSession,
  type LogResult,
  type LogRow,
  type TermOption,
} from "@/app/hr/saems/logActions";
import { TERM_STATUS_LABEL, type TermStatus } from "@/lib/saem";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
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
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");
const mmdd = (d: string) => (d.length >= 10 ? d.slice(5).replace("-", "/") : d);

type DateTab = {
  date: string;
  total: number;
  submitted: number;
  allConfirmed: boolean;
  future: boolean;
};

function buildTabs(rows: LogRow[], today: string): DateTab[] {
  const map = new Map<string, LogRow[]>();
  for (const r of rows) {
    if (!r.session_date) continue;
    const list = map.get(r.session_date) ?? [];
    list.push(r);
    map.set(r.session_date, list);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, list]) => ({
      date,
      total: list.length,
      submitted: list.filter((r) => r.submitted).length,
      allConfirmed: list.length > 0 && list.every((r) => r.confirmed),
      future: date > today,
    }));
}

// 기본 선택 = 오늘 이하 중 가장 최근, 없으면 첫 탭.
function defaultDate(tabs: DateTab[], today: string): string {
  const past = tabs.filter((t) => t.date <= today);
  if (past.length) return past[past.length - 1].date;
  return tabs[0]?.date ?? "";
}

export default function LogsManager({
  termOptions,
  initial,
  defaultTermId,
}: {
  termOptions: TermOption[];
  initial: LogResult;
  defaultTermId: string;
}) {
  const [termId, setTermId] = useState(defaultTermId);
  const [result, setResult] = useState<LogResult>(initial);
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    defaultDate(buildTabs(initial.rows, initial.today), initial.today)
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<LogRow | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [pending, start] = useTransition();

  const today = result.today;
  const tabs = useMemo(() => buildTabs(result.rows, today), [result.rows, today]);

  function loadTerm(nextTerm: string) {
    setTermId(nextTerm);
    setMsg(null);
    start(async () => {
      const r = await getLogs({ termId: nextTerm || undefined });
      setResult(r);
      setSelectedDate(defaultDate(buildTabs(r.rows, r.today), r.today));
      setSelected(new Set());
    });
  }
  function reload() {
    start(async () => {
      const r = await getLogs({ termId: termId || undefined });
      setResult(r);
      setSelected(new Set());
    });
  }

  // 선택 날짜의 행(교시→sort_order 정렬).
  const dayRows = useMemo(() => {
    return result.rows
      .filter((r) => r.session_date === selectedDate)
      .sort(
        (a, b) =>
          (a.periodNo ?? 9999) - (b.periodNo ?? 9999) || a.sortOrder - b.sortOrder
      );
  }, [result.rows, selectedDate]);

  // 교시 구분행 삽입 위치 표시(렌더 중 변수 변형 없이 미리 계산).
  const dayItems = useMemo(
    () =>
      dayRows.map((r, i) => ({
        r,
        showDivider: i === 0 || r.periodNo !== dayRows[i - 1].periodNo,
      })),
    [dayRows]
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
      if (!res.ok) return setMsg({ ok: false, text: res.message });
      setMsg({ ok: true, text: `${res.confirmed}건을 확정했습니다.` });
      reload();
    });
  }

  const termRate =
    result.summary.elapsed > 0
      ? Math.round((result.summary.submitted / result.summary.elapsed) * 100)
      : null;

  return (
    <div className="space-y-5">
      {/* 차시 선택 + 요약 토글 */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={termId}
            onChange={(e) => loadTerm(e.target.value)}
            className={selCls}
            aria-label="차시"
          >
            {termOptions.length === 0 && <option value="">차시 없음</option>}
            {termOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.projectName} · {t.name} (
                {TERM_STATUS_LABEL[t.status as TermStatus] ?? t.status})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSummaryOpen((v) => !v)}
            className="ml-auto text-xs font-semibold text-ink-muted hover:underline"
          >
            차시 요약 {summaryOpen ? "접기 ▲" : "펼치기 ▼"}
          </button>
        </div>

        {summaryOpen && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat
                label="제출률(경과 회차)"
                value={
                  termRate == null
                    ? "-"
                    : `${termRate}% (${result.summary.submitted}/${result.summary.elapsed})`
                }
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
            {/* 회차별 제출률 미니 표 */}
            <div className="flex flex-wrap gap-1.5">
              {tabs.map((t) => (
                <span
                  key={t.date}
                  className="rounded-md border border-line px-2 py-1 text-xs text-ink-muted"
                >
                  {mmdd(t.date)} {t.submitted}/{t.total}
                  {t.allConfirmed ? " ✓" : ""}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 회차 날짜 탭 */}
      {tabs.length > 0 && (
        <div className="overflow-x-auto">
          <div className="flex min-w-max gap-1.5">
            {tabs.map((t) => {
              const active = t.date === selectedDate;
              return (
                <button
                  key={t.date}
                  type="button"
                  onClick={() => {
                    setSelectedDate(t.date);
                    setSelected(new Set());
                  }}
                  className={`whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    active
                      ? "border-navy bg-navy text-white"
                      : t.future
                        ? "border-line bg-surface text-ink-hint"
                        : "border-line bg-card text-ink-body hover:bg-surface"
                  }`}
                >
                  {mmdd(t.date)}
                  <span
                    className={`ml-1.5 text-xs font-normal ${
                      active ? "text-white/80" : "text-ink-hint"
                    }`}
                  >
                    ({t.submitted}/{t.total}){t.allConfirmed ? " ✓" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}

      {/* 선택 날짜 목록 */}
      <section className={cardCls}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">
            {selectedDate ? `${selectedDate} 근무일지` : "회차를 선택하세요"}
            {dayRows.length > 0 && (
              <span className="ml-2 text-xs font-normal text-ink-hint">
                {dayRows.length}개 프로그램
              </span>
            )}
          </h3>
          <button
            type="button"
            onClick={confirmSelected}
            disabled={pending || selected.size === 0}
            className={btnPrimary}
          >
            선택 확정 ({selected.size})
          </button>
        </div>

        {dayRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-hint">
            표시할 근무일지가 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={`${thCls} w-8`}></th>
                  <th className={thCls}>프로그램</th>
                  <th className={thCls}>강사</th>
                  <th className={thCls}>상태</th>
                  <th className={`${thCls} text-right`}>인원</th>
                  <th className={thCls}>출석</th>
                  <th className={`${thCls} text-right`}>시간</th>
                  <th className={thCls}>수업내용</th>
                </tr>
              </thead>
              <tbody>
                {dayItems.map(({ r, showDivider }) => {
                  const canSelect = r.submitted && !r.confirmed;
                  return (
                    <FragmentRow key={r.id}>
                      {showDivider && (
                        <tr className="bg-surface/70">
                          <td colSpan={8} className="px-2 py-1 text-xs font-bold text-navy">
                            {r.periodNo != null ? `${r.periodNo}교시` : "교시 미지정"}
                            {r.timeStart
                              ? ` ${hhmm(r.timeStart)}~${hhmm(r.timeEnd)}`
                              : ""}
                          </td>
                        </tr>
                      )}
                      <tr
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
                        <td className={tdCls}>
                          <AttendanceCell row={r} />
                        </td>
                        <td className={`${tdCls} text-right`}>
                          {r.work_hours ?? "-"}
                        </td>
                        <td className={`${tdCls} max-w-[220px] truncate`}>
                          {r.log_content || r.plan_content || "-"}
                        </td>
                      </tr>
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detail && (
        <DetailModal
          row={detail}
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

// tbody 직계 자식만 허용되므로 divider+row 를 함께 반환.
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// SA-18. 출석 요약 — 강사가 동래샘들에서 체크한 결과가 있을 때만 표시한다.
//   "출석 n/정원" (지각은 출석에 포함, 상세는 title 로).
function AttendanceCell({ row }: { row: LogRow }) {
  const a = row.attendance;
  if (!a) {
    // 명단이 있는데 아직 체크가 없으면 그 사실을 알린다(명단조차 없으면 조용히).
    if (row.enrolledCount === 0)
      return <span className="text-xs text-ink-hint">-</span>;
    return (
      <span className={badgeNeutral} title={`명단 ${row.enrolledCount}명 · 출석 미체크`}>
        미체크
      </span>
    );
  }
  const attended = a.present + a.late;
  const denom = row.capacity ?? row.enrolledCount ?? 0;
  return (
    <span
      className={a.absent > 0 ? badgeWarning : badgeSuccess}
      title={`출석 ${a.present} · 지각 ${a.late} · 결석 ${a.absent} / 체크 ${a.checked}명 · 명단 ${row.enrolledCount}명${
        row.capacity != null ? ` · 정원 ${row.capacity}명` : ""
      }`}
    >
      출석 {attended}/{denom || a.checked}
      {a.late > 0 && ` (지각 ${a.late})`}
    </span>
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
  onClose,
  onChanged,
  onError,
}: {
  row: LogRow;
  onClose: () => void;
  onChanged: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [pending, start] = useTransition();
  const [askReset, setAskReset] = useState(false);
  // 초기화 대상 = 미확정 + 지울 내용이 있는 회차(계획만 있는 빈 회차는 제외).
  const hasWritten =
    row.submitted ||
    row.log_content != null ||
    row.note != null ||
    row.student_count != null ||
    row.work_hours != null;
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
        {row.attendance && (
          <p className="mb-3 text-xs text-ink-body">
            출석 체크 — 출석 {row.attendance.present} · 지각 {row.attendance.late} ·
            결석 {row.attendance.absent} (명단 {row.enrolledCount}명
            {row.capacity != null && ` · 정원 ${row.capacity}명`})
          </p>
        )}

        <div className="space-y-3">
          <Block title="계획(plan)" text={row.plan_content} />
          <Block title="실제 수업내용(log)" text={row.log_content} highlight />
          <Block title="특이사항" text={row.note} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {!row.confirmed ? (
            <>
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
              {hasWritten && (
                <button
                  type="button"
                  disabled={pending}
                  className={btnSecondary}
                  onClick={() => setAskReset(true)}
                >
                  작성 내용 초기화
                </button>
              )}
            </>
          ) : (
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
          )}
          <button type="button" onClick={onClose} className={btnSecondary}>
            닫기
          </button>
        </div>

        {askReset && (
          <div className="mt-4 rounded-lg border border-stamp/40 bg-stamp-soft p-3">
            <p className="text-sm text-stamp">
              {row.instructorName ?? "담당 강사"} 선생님의 {row.session_no}회차
              작성 내용을 초기화합니다.
            </p>
            <p className="mt-1 text-[11px] text-ink-muted">
              수업내용·특이사항·인원·시간·제출 기록이 지워지고 미제출 상태로
              돌아갑니다. 계획(plan)과 날짜·회차는 그대로 남습니다.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={pending}
                className={btnDanger}
                onClick={() =>
                  start(async () => {
                    const res = await resetSession(row.id);
                    if (!res.ok) {
                      setAskReset(false);
                      return onError(res.message);
                    }
                    onChanged("작성 내용을 초기화했습니다.");
                  })
                }
              >
                초기화
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setAskReset(false)}
                className={btnSecondary}
              >
                취소
              </button>
            </div>
          </div>
        )}
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
          highlight
            ? "border-navy/30 bg-navy-soft/30 text-ink"
            : "border-line bg-surface/50 text-ink-body"
        }`}
      >
        {text || "—"}
      </p>
    </div>
  );
}
