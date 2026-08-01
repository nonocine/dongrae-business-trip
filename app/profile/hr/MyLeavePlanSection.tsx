"use client";

// =====================================================================
// LP-2. 직원 본인 연차 사용계획서 작성·제출 — 마이페이지 "연차 사용계획서" 탭
//   * 미사용 일수·잔여기간은 담당자가 정한 값 → 읽기 전용.
//   * 계획 행: 날짜(date) + 일수(0.5/1). 추가·삭제 자유, 합계 자동 표시.
//   * 합계 ≠ 미사용 일수면 경고를 띄우되 제출은 허용(확인 모달로 한 번 붙잡음).
//   * 제출 후에는 읽기 전용 — 담당자가 제출 취소해야 다시 고칠 수 있다.
// =====================================================================

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveMyLeavePlan,
  type MyLeavePlan,
} from "@/app/profile/hr/leavePlanActions";
import {
  LEAVE_DAY_OPTIONS,
  PLAN_MISMATCH_TEXT,
  formatDays,
  formatPeriod,
  planMismatch,
  sumLeavePlan,
  type LeavePlanEntry,
} from "@/lib/leavePlan";
import { fmtKstDateTime } from "@/lib/datetime";
import {
  btnPrimary,
  btnSecondary,
  badgeSuccess,
  badgeDanger,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body";
const inCls =
  "w-full rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";

// 편집용 행 — 날짜가 비어 있는 행도 허용(입력 중). 저장 시 걸러낸다.
type Row = { key: string; date: string; days: number };

let keySeq = 0;
const newKey = () => `row-${keySeq++}`;

function toRows(plan: LeavePlanEntry[]): Row[] {
  return plan.map((p) => ({ key: newKey(), date: p.date, days: p.days }));
}

export default function MyLeavePlanSection({
  initial,
}: {
  initial: MyLeavePlan;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    initial.plan.length ? toRows(initial.plan) : [{ key: newKey(), date: "", days: 1 }]
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [askSubmit, setAskSubmit] = useState(false);
  const [pending, start] = useTransition();

  const submitted = initial.submitted_at != null;

  // 날짜가 채워진 행만 계획으로 본다.
  const filled = useMemo(
    () => rows.filter((r) => r.date.trim().length > 0),
    [rows]
  );
  const total = useMemo(
    () => sumLeavePlan(filled.map((r) => ({ date: r.date, days: r.days }))),
    [filled]
  );
  const mismatch = planMismatch(total, initial.unused_days);

  // 화면 단계 검증 — 잔여기간 밖·중복 날짜는 저장 전에 잡아 준다.
  const rowErrors = useMemo(() => {
    const map = new Map<string, string>();
    const seen = new Map<string, number>();
    for (const r of filled) seen.set(r.date, (seen.get(r.date) ?? 0) + 1);
    for (const r of filled) {
      if (initial.period_start && r.date < initial.period_start)
        map.set(r.key, "잔여기간 시작 이전");
      else if (initial.period_end && r.date > initial.period_end)
        map.set(r.key, "잔여기간 종료 이후");
      else if ((seen.get(r.date) ?? 0) > 1) map.set(r.key, "날짜 중복");
    }
    return map;
  }, [filled, initial.period_start, initial.period_end]);

  const hasRowError = rowErrors.size > 0;
  const overMax = filled.length > initial.maxRows;

  function setRow(key: string, p: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, { key: newKey(), date: "", days: 1 }]);
  }
  function removeRow(key: string) {
    setRows((prev) => {
      const next = prev.filter((r) => r.key !== key);
      return next.length ? next : [{ key: newKey(), date: "", days: 1 }];
    });
  }

  function persist(submit: boolean) {
    setAskSubmit(false);
    setMsg(null);
    start(async () => {
      const res = await saveMyLeavePlan({
        planId: initial.id,
        plan: filled.map((r) => ({ date: r.date, days: r.days })),
        submit,
      });
      if (!res.ok) return setMsg({ ok: false, text: res.message });
      setMsg({
        ok: true,
        text: submit
          ? `제출했습니다. (합계 ${formatDays(res.total)}일) 수정이 필요하면 담당자에게 제출 취소를 요청하세요.`
          : `임시저장했습니다. (합계 ${formatDays(res.total)}일)`,
      });
      router.refresh();
    });
  }

  function onSubmitClick() {
    setMsg(null);
    if (filled.length === 0) {
      setMsg({ ok: false, text: "계획을 최소 1행 입력하세요." });
      return;
    }
    if (hasRowError) {
      setMsg({ ok: false, text: "빨간 표시된 행을 고친 뒤 제출하세요." });
      return;
    }
    if (overMax) {
      setMsg({
        ok: false,
        text: `계획은 최대 ${initial.maxRows}행까지 입력할 수 있습니다.`,
      });
      return;
    }
    // 합계 불일치는 막지 않고 확인만 받는다.
    if (mismatch) {
      setAskSubmit(true);
      return;
    }
    persist(true);
  }

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-ink">
          {initial.year}년 미사용 연차유급휴가 사용계획서
          <span className="ml-2 align-middle">
            {submitted ? (
              <span className={badgeSuccess}>제출 완료</span>
            ) : (
              <span className={badgeDanger}>미제출</span>
            )}
          </span>
        </h3>
        <p className="mt-1 text-xs text-ink-muted">
          근로기준법 제61조의2에 따른 연차 사용촉진 서식입니다. 남은 연차를 언제
          쓸 계획인지 적어 제출해 주세요. (보관용 — 실제 휴가 결재는 별도입니다.)
        </p>
      </div>

      {/* 담당자가 정한 값 — 읽기 전용 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ReadOnly
          label="미사용 연차유급휴가일"
          value={`${formatDays(initial.unused_days)}일`}
          strong
        />
        <ReadOnly
          label="미사용 연차유급휴가 잔여기간"
          value={formatPeriod(initial.period_start, initial.period_end)}
        />
      </div>

      {submitted && (
        <p className={noticeSuccess}>
          {fmtKstDateTime(initial.submitted_at)}에 제출되었습니다. 내용을 고쳐야
          하면 담당자(회계)에게 <b>제출 취소</b>를 요청하세요.
        </p>
      )}

      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}

      {/* 계획 표 */}
      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full border-collapse">
          <thead className="bg-surface">
            <tr>
              <th className={`${thCls} w-10 text-right`}>#</th>
              <th className={thCls}>날짜</th>
              <th className={`${thCls} w-28`}>기간(일)</th>
              {!submitted && <th className={`${thCls} w-16 text-right`}>삭제</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const err = rowErrors.get(r.key);
              return (
                <tr
                  key={r.key}
                  className={`border-t border-line/60 ${err ? "bg-stamp-soft/40" : ""}`}
                >
                  <td className={`${tdCls} text-right text-xs text-ink-hint`}>
                    {i + 1}
                  </td>
                  <td className={tdCls}>
                    {submitted ? (
                      <span className="font-mono">{r.date || "-"}</span>
                    ) : (
                      <>
                        <input
                          type="date"
                          value={r.date}
                          min={initial.period_start ?? undefined}
                          max={initial.period_end ?? undefined}
                          onChange={(e) => setRow(r.key, { date: e.target.value })}
                          className={inCls}
                        />
                        {err && (
                          <span className="mt-0.5 block text-[11px] text-stamp">
                            {err}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className={tdCls}>
                    {submitted ? (
                      <span className="font-mono">{formatDays(r.days)}일</span>
                    ) : (
                      <select
                        value={String(r.days)}
                        onChange={(e) =>
                          setRow(r.key, { days: Number(e.target.value) })
                        }
                        className={inCls}
                      >
                        {LEAVE_DAY_OPTIONS.map((d) => (
                          <option key={d} value={String(d)}>
                            {formatDays(d)}일
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  {!submitted && (
                    <td className={`${tdCls} text-right`}>
                      <button
                        type="button"
                        onClick={() => removeRow(r.key)}
                        className="rounded border border-stamp px-2 py-1 text-xs text-stamp hover:bg-stamp-soft"
                        aria-label={`${i + 1}행 삭제`}
                      >
                        삭제
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            <tr className="border-t border-line bg-surface font-semibold">
              <td className={tdCls} colSpan={2}>
                합 계
              </td>
              <td
                className={`${tdCls} font-mono ${
                  mismatch ? "text-stamp" : "text-navy"
                }`}
              >
                {formatDays(total)}일
              </td>
              {!submitted && <td className={tdCls} />}
            </tr>
          </tbody>
        </table>
      </div>

      {!submitted && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addRow}
              disabled={pending || filled.length >= initial.maxRows}
              className={btnSecondary}
              title={
                filled.length >= initial.maxRows
                  ? `서식 칸수 상한(${initial.maxRows}행)에 도달했습니다.`
                  : ""
              }
            >
              + 행 추가
            </button>
            <p className="text-xs text-ink-hint">
              {filled.length}/{initial.maxRows}행 · 0.5일(반차) 단위로 입력할 수
              있습니다.
            </p>
          </div>

          {mismatch && filled.length > 0 && (
            <p className={noticeWarning}>
              {PLAN_MISMATCH_TEXT} (계획 {formatDays(total)}일 / 미사용{" "}
              {formatDays(initial.unused_days)}일) — 그래도 제출할 수 있습니다.
            </p>
          )}
          {overMax && (
            <p className={noticeError}>
              계획은 최대 {initial.maxRows}행까지 입력할 수 있습니다. (현재{" "}
              {filled.length}행)
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSubmitClick}
              disabled={pending}
              className={btnPrimary}
            >
              {pending ? "처리 중…" : "제출"}
            </button>
            <button
              type="button"
              onClick={() => persist(false)}
              disabled={pending}
              className={btnSecondary}
            >
              임시저장
            </button>
          </div>
          <p className="text-[11px] text-ink-hint">
            제출하면 담당자가 확인·보관합니다. 제출 후에는 담당자가 제출 취소를
            해주어야 다시 고칠 수 있습니다.
          </p>
        </>
      )}

      {/* 합계 불일치 확인 모달 */}
      {askSubmit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-line bg-card p-5 shadow-lg">
            <h4 className="text-base font-bold text-ink">이대로 제출할까요?</h4>
            <p className={`mt-3 ${noticeWarning}`}>
              {PLAN_MISMATCH_TEXT}
            </p>
            <p className="mt-2 text-sm text-ink-body">
              계획 합계 <b>{formatDays(total)}일</b> / 미사용 연차{" "}
              <b>{formatDays(initial.unused_days)}일</b>
            </p>
            <p className="mt-1 text-xs text-ink-hint">
              그대로 제출해도 됩니다. 다시 확인하려면 [돌아가기]를 누르세요.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => persist(true)}
                disabled={pending}
                className={btnPrimary}
              >
                이대로 제출
              </button>
              <button
                type="button"
                onClick={() => setAskSubmit(false)}
                disabled={pending}
                className={btnSecondary}
              >
                돌아가기
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ReadOnly({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface/60 px-3 py-2">
      <p className="text-[11px] text-ink-muted">{label}</p>
      <p
        className={`mt-0.5 ${
          strong ? "font-mono text-base font-bold text-navy" : "text-sm text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
