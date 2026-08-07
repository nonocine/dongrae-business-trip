"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  btnPrimary,
  cardCls,
  inputCls,
  labelCls,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";
import { deleteCoinPay, saveCoinPay, type CoinPayResult } from "./actions";

// 동전PAY — 건별 거래가 아니라 "월 합계"만 기록합니다.
//   한 행 = 해당 월 × 구분(적립/차감) × 사용처 의 합계.
const number = new Intl.NumberFormat("ko-KR");

export default function CoinPayTab({
  year,
  month,
  periodLabel,
  configured,
  rows,
  cumulative,
}: {
  year: number;
  month: number;
  periodLabel: string;
  configured: boolean;
  rows: CoinPayResult[];
  cumulative: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<CoinPayResult | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const periodTotals = useMemo(() => {
    const base = {
      earn: { headcount: 0, amount: 0 },
      spend: { headcount: 0, amount: 0 },
    };
    for (const row of rows) {
      const bucket = row.entry_type === "차감" ? base.spend : base.earn;
      bucket.headcount += row.headcount;
      bucket.amount += Number(row.amount);
    }
    return base;
  }, [rows]);

  if (!configured)
    return (
      <section className={cardCls}>
        <h2 className="font-bold text-ink">동전PAY 저장 준비가 필요합니다</h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          화면은 준비됐습니다. 운영 Supabase에 <code>coin_pay_results</code>{" "}
          테이블을 적용하면 바로 사용할 수 있습니다.
        </p>
      </section>
    );

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setMsg(null);
    start(async () => {
      try {
        await saveCoinPay(new FormData(form));
        form.reset();
        setEditing(null);
        setMsg({ ok: true, text: "저장했습니다." });
        router.refresh();
      } catch (err) {
        setMsg({
          ok: false,
          text: err instanceof Error ? err.message : "저장하지 못했습니다.",
        });
      }
    });
  }

  function remove(row: CoinPayResult) {
    if (!confirm(`'${row.place}' ${row.entry_type} 기록을 삭제할까요?`)) return;
    setMsg(null);
    start(async () => {
      const res = await deleteCoinPay(row.id);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({ ok: true, text: "삭제했습니다." });
      router.refresh();
    });
  }

  const cards = [
    {
      label: `${periodLabel} 적립`,
      value: periodTotals.earn.amount,
      sub: `${number.format(periodTotals.earn.headcount)}명`,
      tone: "bg-brand-blue-soft text-brand-blue-strong",
    },
    {
      label: `${periodLabel} 차감`,
      value: periodTotals.spend.amount,
      sub: `${number.format(periodTotals.spend.headcount)}명`,
      tone: "bg-[#fff0ef] text-[#a92a26]",
    },
    {
      label: "최종 금액 (센터 전체 누적)",
      value: cumulative,
      sub: "조회 기간과 무관한 전체 누적",
      tone: "bg-[#eef8eb] text-[#39772a]",
    },
  ];

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <article key={card.label} className={cardCls}>
            <div
              className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-bold ${card.tone}`}
            >
              {card.label}
            </div>
            <p className="mt-3 text-2xl font-extrabold tracking-tight text-ink">
              {number.format(card.value)}
              <span className="ml-1 text-sm font-semibold text-ink-muted">
                동전
              </span>
            </p>
            <p className="mt-1 text-xs text-ink-muted">{card.sub}</p>
          </article>
        ))}
      </section>

      <section className={cardCls}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-bold text-ink">
            {editing ? "동전PAY 수정" : "동전PAY 입력"}
          </h2>
          {editing && (
            <button
              type="button"
              className="text-sm font-semibold text-ink-muted hover:underline"
              onClick={() => setEditing(null)}
            >
              수정 취소
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          건별 거래가 아니라 <b>월 합계</b>를 한 행으로 기록합니다 (구분 ×
          사용처 기준).
        </p>
        <form
          key={editing?.id ?? "new"}
          className="mt-4 grid gap-3 md:grid-cols-3"
          onSubmit={submit}
        >
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <input type="hidden" name="year" value={year} />
          <label className={labelCls}>
            실적 월
            <select
              name="month"
              className={inputCls}
              defaultValue={editing?.report_month ?? month}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((v) => (
                <option key={v} value={v}>
                  {v}월
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            구분
            <select
              name="entry_type"
              className={inputCls}
              defaultValue={editing?.entry_type ?? "적립"}
            >
              <option>적립</option>
              <option>차감</option>
            </select>
          </label>
          <label className={labelCls}>
            사용처
            <input
              name="place"
              required
              className={inputCls}
              defaultValue={editing?.place ?? ""}
              placeholder="예: 동래점빵 다있소"
            />
          </label>
          <label className={labelCls}>
            인원
            <input
              name="headcount"
              type="number"
              min="0"
              className={inputCls}
              defaultValue={editing?.headcount ?? 0}
            />
          </label>
          <label className={labelCls}>
            금액(동전)
            <input
              name="amount"
              type="number"
              min="0"
              className={inputCls}
              defaultValue={editing?.amount ?? 0}
            />
          </label>
          <label className={labelCls}>
            비고
            <input
              name="note"
              className={inputCls}
              defaultValue={editing?.note ?? ""}
            />
          </label>
          <div className="md:col-span-3">
            <button disabled={pending} className={btnPrimary}>
              {editing ? "수정 저장" : "저장"}
            </button>
          </div>
        </form>

        {msg && (
          <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>
            {msg.text}
          </p>
        )}

        <div className="mt-6 space-y-2">
          {rows.length === 0 && (
            <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-10 text-center text-sm text-ink-muted">
              이 기간에 등록된 동전PAY 기록이 없습니다.
            </p>
          )}
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3 text-sm"
            >
              <div className="min-w-0">
                <strong className="text-ink">{row.place}</strong>
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${
                    row.entry_type === "차감"
                      ? "bg-stamp-soft text-stamp"
                      : "bg-brand-blue-soft text-brand-blue-strong"
                  }`}
                >
                  {row.entry_type}
                </span>
                <p className="mt-1 text-ink-muted">
                  {row.report_month}월 · {number.format(row.headcount)}명 ·{" "}
                  {number.format(Number(row.amount))}동전 · 작성{" "}
                  {row.author_name}
                  {row.note ? ` · ${row.note}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-navy hover:bg-navy-soft"
                  onClick={() => {
                    setEditing(row);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  수정
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-ink-muted hover:bg-surface"
                  onClick={() => remove(row)}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
