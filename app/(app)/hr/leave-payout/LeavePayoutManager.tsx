"use client";

// 연차수당 산정 화면 — 산정표(run) 만들기·포함 항목·줄 고치기·확정/무효·엑셀.
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  confirmPayoutRun,
  createPayoutRun,
  updatePayoutLine,
  updateWageBasis,
  voidPayoutRun,
} from "@/app/(app)/hr/leave-payout/actions";
import type { PayoutLineRow, PayoutRun, PlannedLine } from "@/lib/leavePayoutServer";
import {
  DEFAULT_WAGE_BASIS,
  HOLIDAY_BONUS_NOTE,
  PAYOUT_CATEGORY_LABEL,
  WAGE_ITEMS,
  WAGE_ITEM_LABEL,
  type PayoutCategory,
  type WageBasis,
} from "@/lib/leavePayout";
import { badgeDanger, badgeNeutral, badgeSuccess, btnDanger, btnPrimary, btnSecondary, cardCls, noticeError, noticeSuccess, noticeWarning } from "@/lib/ui";

const won = (n: number | null | undefined) => (n == null ? "-" : `${Math.round(n).toLocaleString("ko-KR")}`);
const fmtDays = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

type AnyLine = (PayoutLineRow | (PlannedLine & { id?: string })) & { id?: string };

export default function LeavePayoutManager({
  year,
  thisYear,
  run,
  lines,
  preview,
  canConfirm,
}: {
  year: number;
  thisYear: number;
  run: PayoutRun | null;
  lines: PayoutLineRow[];
  preview: PlannedLine[] | null; // 산정표가 없을 때 — 만들어질 줄(읽기만)
  canConfirm: boolean;
}) {
  const router = useRouter();
  const [basis, setBasis] = useState<WageBasis>(run?.wage_basis ?? DEFAULT_WAGE_BASIS);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const draft = run?.status === "draft";
  const rows: AnyLine[] = run ? lines : preview ?? [];

  function run_(fn: () => Promise<{ ok: boolean; message?: string }>, okText: string) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) return setMsg({ ok: false, text: r.message ?? "실패했습니다." });
      setMsg({ ok: true, text: okText });
      router.refresh();
    });
  }

  const sum = (["first_year_monthly", "annual_unpromoted", "annual_promoted"] as PayoutCategory[]).map((c) => {
    const ls = rows.filter((l) => l.category === c);
    const inc = ls.filter((l) => !l.excluded);
    return {
      c,
      people: ls.length,
      included: inc.length,
      days: inc.reduce((a, l) => a + l.unused_days, 0),
      amount: inc.reduce((a, l) => a + l.amount, 0),
    };
  });
  const total = sum.reduce((a, s) => a + s.amount, 0);
  const basisChanged = run && WAGE_ITEMS.some((k) => basis[k] !== run.wage_basis[k]);

  return (
    <div className="space-y-4">
      <section className={`${cardCls} flex flex-wrap items-center gap-2`}>
        <select
          value={year}
          onChange={(e) => router.push(`/hr/leave-payout?year=${e.target.value}`)}
          className="rounded-md border border-line bg-card px-2 py-1.5 text-sm"
          aria-label="연도"
        >
          {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
        {run ? (
          <>
            <span className={run.status === "confirmed" ? badgeSuccess : badgeNeutral}>
              {run.status === "confirmed" ? "확정" : "작성 중"}
            </span>
            <span className="text-xs text-ink-muted">
              {run.title} · 만든 날 {run.created_at.slice(0, 10)}
              {run.confirmed_at && ` · 확정 ${run.confirmed_at.slice(0, 10)}`}
            </span>
            <span className="ml-auto flex flex-wrap gap-1">
              <a href={`/hr/leave-payout/excel?runId=${run.id}`} className={btnSecondary}>
                엑셀 내보내기
              </a>
              {canConfirm && draft && (
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={pending}
                  onClick={() => {
                    if (!confirm("확정하면 더 이상 고칠 수 없습니다. 확정할까요?")) return;
                    run_(() => confirmPayoutRun(run.id), "확정했습니다.");
                  }}
                >
                  확정
                </button>
              )}
              {canConfirm && (
                <button
                  type="button"
                  className={btnDanger}
                  disabled={pending}
                  onClick={() => {
                    const why = prompt("무효 사유를 입력하세요. 무효 뒤 다시 만들 수 있습니다.");
                    if (!why) return;
                    run_(() => voidPayoutRun(run.id, why), "무효 처리했습니다. 다시 만들 수 있습니다.");
                  }}
                >
                  무효
                </button>
              )}
            </span>
          </>
        ) : (
          <>
            <span className="text-xs text-ink-muted">아직 산정표가 없습니다. 아래는 지금 만들면 생길 줄(미리보기)입니다.</span>
            <button
              type="button"
              className={`${btnPrimary} ml-auto`}
              disabled={pending}
              onClick={() => run_(() => createPayoutRun(year, basis), `${year}년 산정표를 만들었습니다(작성 중).`)}
            >
              {year === thisYear ? "올해 산정표 만들기" : `${year}년 산정표 만들기`}
            </button>
          </>
        )}
      </section>

      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}

      <section className={cardCls}>
        <h3 className="text-sm font-bold text-ink">통상임금 포함 항목</h3>
        <div className="mt-2 flex flex-wrap gap-3">
          {WAGE_ITEMS.map((k) => (
            <label key={k} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={basis[k]}
                disabled={!!run && !draft}
                onChange={(e) => setBasis((b) => ({ ...b, [k]: e.target.checked }))}
              />
              {WAGE_ITEM_LABEL[k]}
            </label>
          ))}
          {run && draft && basisChanged && (
            <button type="button" className={btnSecondary} disabled={pending} onClick={() => run_(() => updateWageBasis(run.id, basis), "포함 항목을 바꾸고 다시 계산했습니다.")}>
              적용(다시 계산)
            </button>
          )}
        </div>
        <p className={`mt-2 ${noticeWarning}`}>{HOLIDAY_BONUS_NOTE}</p>
        <p className="mt-1 text-[11px] text-ink-hint">
          시간급 = 월 통상임금 ÷ 209, 일급 = 시간급 × 8(원 미만 절사), 금액 = 일급 × 미사용 일수(0.5일 단위, 원 미만 절사). 월액은 그해 체결 완료 연봉계약서의 12월 구간
          기준입니다.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        {sum.map((s) => (
          <div key={s.c} className={cardCls}>
            <p className="text-xs text-ink-muted">{PAYOUT_CATEGORY_LABEL[s.c]}</p>
            <p className="mt-1 font-mono text-lg font-bold text-navy">{won(s.amount)}원</p>
            <p className="text-[11px] text-ink-hint">
              {s.people}명(지급 {s.included}명) · {fmtDays(s.days)}일
            </p>
          </div>
        ))}
        <div className={cardCls}>
          <p className="text-xs text-ink-muted">합계(제외 빼고)</p>
          <p className="mt-1 font-mono text-lg font-bold text-navy">{won(total)}원</p>
        </div>
      </div>

      <section className={`${cardCls} overflow-x-auto`}>
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-navy">
              <th className="px-2 py-2 font-semibold">직원</th>
              <th className="px-2 py-2 font-semibold">구분</th>
              <th className="px-2 py-2 text-right font-semibold">미사용 일수</th>
              <th className="px-2 py-2 text-right font-semibold">월 통상임금</th>
              <th className="px-2 py-2 text-right font-semibold">일급</th>
              <th className="px-2 py-2 text-right font-semibold">금액</th>
              <th className="px-2 py-2 font-semibold">계산식</th>
              <th className="px-2 py-2 font-semibold">제외</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => {
              const key = l.id ?? `p${i}`;
              const snap = l.calc_snapshot;
              const editable = !!run && draft && !!l.id;
              return (
                <Fragment key={key}>
                  <tr className={`border-b border-line/60 align-top ${l.excluded ? "opacity-60" : ""}`}>
                    <td className="px-2 py-2">
                      <p className="font-medium text-ink">{l.name}</p>
                      <p className="text-[11px] text-ink-muted">{l.department ?? "-"}</p>
                    </td>
                    <td className="px-2 py-2 text-xs">{PAYOUT_CATEGORY_LABEL[l.category]}</td>
                    <td className="px-2 py-2 text-right">
                      {editable ? (
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          defaultValue={l.unused_days}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (v !== l.unused_days) run_(() => updatePayoutLine(l.id!, { unusedDays: v }), "미사용 일수를 고쳤습니다.");
                          }}
                          className="w-20 rounded border border-line bg-card px-1.5 py-0.5 text-right text-sm"
                        />
                      ) : (
                        <span className="font-mono">{fmtDays(l.unused_days)}</span>
                      )}
                      <p className="text-[10px] text-ink-hint">{l.unused_source === "manual" ? "직접 입력" : "ERP"}</p>
                      {snap.planned_days > 0 && (
                        <p className="text-[10px] text-warning">
                          예정 사용 {fmtDays(snap.planned_days)}일{snap.planned_deducted ? "(차감됨)" : ""}
                          {editable && (
                            <button
                              type="button"
                              className="ml-1 underline"
                              disabled={pending}
                              onClick={() =>
                                run_(
                                  () => updatePayoutLine(l.id!, { deductPlanned: !snap.planned_deducted }),
                                  snap.planned_deducted ? "예정 사용 차감을 되돌렸습니다." : "예정 사용을 차감했습니다."
                                )
                              }
                            >
                              {snap.planned_deducted ? "되돌리기" : "차감"}
                            </button>
                          )}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">{won(l.monthly_ordinary_wage)}</td>
                    <td className="px-2 py-2 text-right font-mono">{won(l.daily_ordinary_wage)}</td>
                    <td className="px-2 py-2 text-right font-mono font-semibold">{won(l.amount)}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        className="text-xs text-navy hover:underline"
                        onClick={() =>
                          setOpen((cur) => {
                            const n = new Set(cur);
                            if (n.has(key)) n.delete(key);
                            else n.add(key);
                            return n;
                          })
                        }
                      >
                        {open.has(key) ? "접기" : "펼치기"}
                      </button>
                      {snap.errors?.length > 0 && <p className="text-[10px] text-stamp">{snap.errors.join(" · ")}</p>}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {editable ? (
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={l.excluded}
                            disabled={pending}
                            onChange={(e) => {
                              const on = e.target.checked;
                              const reason = on ? prompt("제외 사유를 입력하세요.", l.exclude_reason ?? "") : null;
                              if (on && !reason) return;
                              run_(() => updatePayoutLine(l.id!, { excluded: on, excludeReason: reason }), on ? "제외했습니다." : "제외를 풀었습니다.");
                            }}
                          />
                          제외
                        </label>
                      ) : (
                        l.excluded && <span className={badgeDanger}>제외</span>
                      )}
                      {l.exclude_reason && <p className="text-[10px] text-ink-muted">{l.exclude_reason}</p>}
                    </td>
                  </tr>
                  {open.has(key) && (
                    <tr className="border-b border-line/60 bg-surface/50">
                      <td colSpan={8} className="px-3 py-2 text-xs text-ink-body">
                        <p>
                          기준일 {snap.basis_date} · ERP 잔여 {snap.erp_remaining ?? "없음"}일
                          {snap.contract
                            ? ` · 연봉계약서 ${snap.contract.contract_date ?? ""} (${snap.contract.segment ?? "-"})`
                            : " · 연봉계약서 없음"}
                          {snap.join_date && ` · 입사 ${snap.join_date}`}
                        </p>
                        {snap.items.length > 0 && (
                          <ul className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                            {snap.items.map((it) => (
                              <li key={it.key} className={snap.included.includes(it.key) ? "" : "text-ink-hint line-through"}>
                                {it.label}: {won(it.monthly)}원 <span className="text-ink-hint">({it.basis})</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {snap.formula && <p className="mt-1 font-medium">{snap.formula}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="py-6 text-center text-sm text-ink-hint">대상 직원이 없습니다.</p>}
      </section>
    </div>
  );
}
