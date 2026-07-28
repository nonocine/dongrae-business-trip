"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCheck,
  copyFromPrevious,
  deleteCheck,
} from "@/app/hr/facility/safetyActions";
import { ymLabel, type SafetyCheck } from "@/lib/safetyCheck";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  badgeSuccess,
  badgeNeutral,
  noticeError,
} from "@/lib/ui";

const selCls =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function SafetyList({
  checks,
  thisYear,
  thisMonth,
  isM0,
}: {
  checks: SafetyCheck[];
  thisYear: number;
  thisMonth: number;
  isM0: boolean;
}) {
  const router = useRouter();
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(thisMonth);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2];

  function create(copy: boolean) {
    setMsg(null);
    start(async () => {
      const res = copy
        ? await copyFromPrevious(year, month)
        : await createCheck(year, month);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      router.push(`/hr/facility/safety/${res.id}`);
    });
  }

  function onDelete(c: SafetyCheck) {
    if (
      !confirm(
        `${ymLabel(c.check_year, c.check_month)} 점검표를 삭제할까요? 되돌릴 수 없습니다.`
      )
    )
      return;
    setMsg(null);
    setBusyId(c.id);
    start(async () => {
      const res = await deleteCheck(c.id);
      setBusyId(null);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({ ok: true, text: "삭제했습니다." });
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* 새 점검 */}
      <section className={cardCls}>
        <p className="mb-2 text-sm font-bold text-ink">새 점검</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className={selCls}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className={selCls}
          >
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}월
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => create(true)}
            disabled={pending}
            className={btnPrimary}
          >
            지난달 복사로 생성
          </button>
          <button
            type="button"
            onClick={() => create(false)}
            disabled={pending}
            className={btnSecondary}
          >
            빈 표로 생성
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ink-hint">
          “지난달 복사”는 직전월 점검 결과·지적사항을 그대로 채워 시작합니다(없으면
          기본값). 기본값은 해당없음 지정 항목만 “해당없음”, 나머지는 “적합”.
        </p>
      </section>

      {msg && (
        <p className={msg.ok ? "rounded-lg bg-success-soft px-3 py-2 text-xs text-success" : noticeError}>
          {msg.text}
        </p>
      )}

      {/* 목록 */}
      <section className={cardCls}>
        {checks.length === 0 ? (
          <div className="py-10 text-center text-sm text-ink-hint">
            점검 기록이 없습니다. 위에서 새 점검을 생성하세요.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={thCls}>연월</th>
                  <th className={thCls}>상태</th>
                  <th className={thCls}>점검일시</th>
                  <th className={thCls}>점검자</th>
                  <th className={`${thCls} text-right`}>관리</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.id} className="border-b border-line/60">
                    <td className={`${tdCls} font-medium text-ink`}>
                      {ymLabel(c.check_year, c.check_month)}
                    </td>
                    <td className={tdCls}>
                      <span className={c.status === "completed" ? badgeSuccess : badgeNeutral}>
                        {c.status === "completed" ? "완료" : "작성중"}
                      </span>
                    </td>
                    <td className={`${tdCls} font-mono text-xs`}>
                      {c.checked_on ?? "-"}
                    </td>
                    <td className={tdCls}>{c.inspector ?? "-"}</td>
                    <td className={`${tdCls} text-right`}>
                      <div className="flex justify-end gap-1">
                        <a
                          href={`/hr/facility/safety/${c.id}`}
                          className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface"
                        >
                          열기
                        </a>
                        {isM0 && (
                          <button
                            type="button"
                            onClick={() => onDelete(c)}
                            disabled={pending && busyId === c.id}
                            className="rounded border border-stamp px-2 py-1 text-xs text-stamp hover:bg-stamp-soft disabled:opacity-50"
                          >
                            삭제
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
