"use client";

// =====================================================================
// ST-5. 정산 내역 표시·조정 공용 컴포넌트 — 정산 생성 미리보기와 정산 상세가
//   같은 산출내역 문장·같은 조정 UI 를 쓴다.
// =====================================================================

import { useState } from "react";
import { formatKRW } from "@/lib/saem";
import { calcFormula, type SettlementProgramDetail } from "@/lib/settlement";
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

