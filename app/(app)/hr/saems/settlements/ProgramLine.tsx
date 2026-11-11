"use client";

// =====================================================================
// ST-5. 정산 내역 표시·조정 공용 컴포넌트 — 정산 생성 미리보기와 정산 상세가
//   같은 산출내역 문장·같은 조정 UI 를 쓴다.
// =====================================================================

import { useState } from "react";
import { formatKRW } from "@/lib/saem";
import {
  calcFormula,
  calcTuitionTotal,
  type RevenueLine,
  type SettlementProgramDetail,
} from "@/lib/settlement";
import { badgeWarning } from "@/lib/ui";

export function ProgramLine({ d }: { d: SettlementProgramDetail }) {
  const adjusted = d.adjusted === true;
  const autoTip =
    adjusted && d.auto_amount != null
      ? `자동 계산: ${d.auto_enrolled ?? "-"}명 → ${formatKRW(d.auto_amount)}원`
      : undefined;
  return (
    <span className="text-xs text-ink-muted">
      <b className="font-medium text-ink">{d.program_name}</b> · {calcFormula(d)} ={" "}
      {formatKRW(d.amount)}
      {adjusted && (
        <span className={`ml-1 ${badgeWarning}`} title={autoTip}>
          조정됨
        </span>
      )}
      {d.deduction_amount != null && (
        <span className="text-stamp">
          {" "}
          · 공제 {d.deduction_rate}% -{formatKRW(d.deduction_amount)}
        </span>
      )}
    </span>
  );
}

// 분배제 행의 [조정] — 인원 또는 금액을 직접 지정. 빈칸으로 저장하면 자동 계산.
export function AdjustControl({
  d,
  disabled,
  onApply,
}: {
  d: SettlementProgramDetail;
  disabled?: boolean;
  onApply: (enrolled: number | null, amount: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [enrolled, setEnrolled] = useState(
    d.enrolled != null ? String(d.enrolled) : ""
  );
  const [amount, setAmount] = useState("");
  const adjusted = d.adjusted === true;

  if (!open) {
    return (
      <span className="ml-1 inline-flex gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setEnrolled(d.enrolled != null ? String(d.enrolled) : "");
            setAmount(adjusted ? String(d.amount) : "");
            setOpen(true);
          }}
          className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted hover:bg-surface disabled:opacity-50"
        >
          조정
        </button>
        {adjusted && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onApply(null, null)}
            className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted hover:bg-surface disabled:opacity-50"
            title="자동 계산으로 되돌립니다"
          >
            해제
          </button>
        )}
      </span>
    );
  }

  const num = (v: string) => {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  return (
    <span className="mt-1 flex flex-wrap items-end gap-1.5 rounded-md border border-navy/30 bg-navy-soft/20 px-2 py-1.5">
      <label className="text-[10px] text-ink-muted">
        인원
        <input
          type="number"
          min={0}
          value={enrolled}
          onChange={(e) => setEnrolled(e.target.value)}
          className="ml-1 w-16 rounded border border-line bg-card px-1.5 py-0.5 text-xs"
        />
      </label>
      <label className="text-[10px] text-ink-muted">
        금액(직접)
        <input
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="자동"
          className="ml-1 w-24 rounded border border-line bg-card px-1.5 py-0.5 text-xs"
        />
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          onApply(num(enrolled), num(amount));
          setOpen(false);
        }}
        className="rounded bg-navy px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50"
      >
        적용
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded border border-line px-2 py-0.5 text-[10px] text-ink-muted hover:bg-surface"
      >
        취소
      </button>
      <span className="text-[10px] text-ink-hint">
        금액을 넣으면 그 금액으로, 인원만 넣으면 인원 × 수강료 × 비율로 계산합니다.
        둘 다 비우면 자동으로 돌아갑니다.
      </span>
    </span>
  );
}


// ST-6. 분배제 수강료 구간 표 — 구분/수강료/인원/수강료 합계.
//   구간은 강좌 설정(tuition_tiers, 없으면 수강료 하나 = '정상')으로 미리 채우고 인원은 담당자가 입력.
//   이 정산에서만 쓰는 줄을 더할 수 있다. [구간 인원 적용]을 눌러야 계산에 반영되며,
//   적용된 구간 계산은 금액(직접)·인원 조정보다 우선한다.
type TierRow = { label: string; fee: string; count: string };

export function TierEditor({
  d,
  disabled,
  onApply,
}: {
  d: SettlementProgramDetail;
  disabled?: boolean;
  onApply: (lines: RevenueLine[] | null) => void;
}) {
  const applied = d.revenue_lines && d.revenue_lines.length ? d.revenue_lines : null;
  const initial = (): TierRow[] => {
    if (applied) return applied.map((l) => ({ label: l.label, fee: String(l.fee), count: String(l.count) }));
    const tiers = d.tuition_tiers && d.tuition_tiers.length ? d.tuition_tiers : [{ label: "정상", fee: d.tuition ?? 0 }];
    const autoCount = d.auto_enrolled ?? d.enrolled ?? 0;
    return tiers.map((t, i) => ({ label: t.label, fee: String(t.fee), count: i === 0 ? String(autoCount) : "0" }));
  };
  const [rows, setRows] = useState<TierRow[]>(initial);
  const n = (v: string) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? Math.round(x) : 0;
  };
  const lines: RevenueLine[] = rows.map((r) => ({ label: r.label.trim(), fee: n(r.fee), count: n(r.count) }));
  const total = calcTuitionTotal(lines);
  const rate = d.share_rate ?? 0;
  const pay = Math.round((total * rate) / 100);
  const setRow = (i: number, p: Partial<TierRow>) => setRows((cur) => cur.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const inp = "w-full rounded border border-line bg-card px-1.5 py-0.5 text-xs";

  return (
    <div className="mt-1 rounded-md border border-line bg-surface/40 p-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-navy">
            <th className="px-1 text-left font-semibold">구분</th>
            <th className="px-1 text-right font-semibold">수강료</th>
            <th className="px-1 text-right font-semibold">인원</th>
            <th className="px-1 text-right font-semibold">수강료 합계</th>
            <th className="w-6" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="px-1 py-0.5">
                <input value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} className={`${inp} min-w-[4rem]`} aria-label="구분" />
              </td>
              <td className="px-1 py-0.5">
                <input type="number" min={0} value={r.fee} onChange={(e) => setRow(i, { fee: e.target.value })} className={`${inp} w-24 text-right`} aria-label="수강료" />
              </td>
              <td className="px-1 py-0.5">
                <input type="number" min={0} value={r.count} onChange={(e) => setRow(i, { count: e.target.value })} className={`${inp} w-16 text-right`} aria-label="인원" />
              </td>
              <td className="px-1 py-0.5 text-right">{formatKRW(lines[i].fee * lines[i].count)}</td>
              <td className="px-1 py-0.5 text-right">
                <button
                  type="button"
                  onClick={() => setRows((cur) => cur.filter((_, k) => k !== i))}
                  className="text-[10px] text-stamp hover:underline"
                  aria-label="줄 삭제"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-ink">
        {formatKRW(total)}원 × {rate}% = <b className="text-navy">{formatKRW(pay)}원</b>
        <span className="ml-1 text-[10px] text-ink-hint">(공제 전)</span>
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => setRows((cur) => [...cur, { label: "", fee: "", count: "0" }])}
          className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted hover:bg-surface"
        >
          줄 추가
        </button>
        <button
          type="button"
          disabled={disabled || lines.every((l) => !l.label && !l.fee)}
          onClick={() => onApply(lines)}
          className="rounded bg-navy px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50"
        >
          구간 인원 적용
        </button>
        {applied && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onApply(null)}
            className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted hover:bg-surface disabled:opacity-50"
            title="구간 계산을 빼고 자동(또는 조정) 계산으로 돌아갑니다"
          >
            구간 해제
          </button>
        )}
        <span className="text-[10px] text-ink-hint">
          {applied ? "구간 계산 적용 중 — 금액(직접)·인원 조정보다 우선합니다." : "인원을 넣고 [구간 인원 적용]을 누르면 계산에 반영됩니다."}
        </span>
      </div>
    </div>
  );
}
