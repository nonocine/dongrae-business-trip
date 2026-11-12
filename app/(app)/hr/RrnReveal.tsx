"use client";

// 인사기록카드 주민번호 표시 — 기본은 앞 7자리(900101-1******).
//   canReveal(M0·hr 직무)이면 [주민번호 보기]: 목적 선택 → 서버 복호화(열람 기록 1건)
//   → 30초 뒤 다시 가림. 전체 번호는 이 컴포넌트 상태에만 잠깐 있고 저장하지 않습니다.

import { useEffect, useState, useTransition } from "react";
import { revealEmployeeRrn } from "@/app/(app)/hr/actions";
import { RRN_VIEW_PURPOSES, rrnMaskDisplay } from "@/lib/sensitiveMask";

const HIDE_AFTER_SEC = 30;

export default function RrnReveal({
  driverId,
  mask,
  canReveal,
}: {
  driverId: string;
  mask: string | null;
  canReveal: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState<string>("");
  const [other, setOther] = useState("");
  const [full, setFull] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // 30초 카운트다운 → 0 이 되면 다시 가림.
  useEffect(() => {
    if (!full) return;
    const t = setTimeout(() => {
      if (left <= 1) {
        setFull(null);
        setLeft(0);
      } else {
        setLeft(left - 1);
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [full, left]);

  if (!mask) {
    return <p className="mb-1 text-xs text-ink-hint">등록된 주민번호 없음</p>;
  }

  function reveal() {
    setErr(null);
    const p = purpose === "기타" ? `기타: ${other.trim()}` : purpose;
    start(async () => {
      const res = await revealEmployeeRrn(driverId, p);
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      setFull(res.rrn);
      setLeft(HIDE_AFTER_SEC);
      setOpen(false);
    });
  }

  const canSubmit = purpose !== "" && (purpose !== "기타" || other.trim() !== "");

  return (
    <div className="mb-1.5 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-ink">{full ?? rrnMaskDisplay(mask)}</span>
        {full ? (
          <>
            <span className="text-[11px] text-stamp">{left}초 뒤 가림</span>
            <button
              type="button"
              onClick={() => setFull(null)}
              className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted hover:bg-surface"
            >
              지금 가리기
            </button>
          </>
        ) : (
          canReveal && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded border border-line px-1.5 py-0.5 text-[11px] text-navy hover:bg-surface"
            >
              주민번호 보기
            </button>
          )
        )}
      </div>
      {open && !full && (
        <div className="flex flex-wrap items-center gap-1.5 rounded border border-line bg-surface p-2 text-xs">
          <span className="text-ink-muted">열람 목적</span>
          <select
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className="rounded border border-line bg-white px-1.5 py-1 text-xs"
          >
            <option value="">선택</option>
            {RRN_VIEW_PURPOSES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value="기타">기타(직접 입력)</option>
          </select>
          {purpose === "기타" && (
            <input
              value={other}
              onChange={(e) => setOther(e.target.value)}
              maxLength={200}
              placeholder="목적"
              className="min-w-[8rem] flex-1 rounded border border-line bg-white px-1.5 py-1 text-xs"
            />
          )}
          <button
            type="button"
            disabled={!canSubmit || pending}
            onClick={reveal}
            className="rounded bg-navy px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
          >
            {pending ? "확인 중…" : "보기"}
          </button>
          <span className="w-full text-[11px] text-ink-hint">
            누를 때마다 열람 기록(누가·언제·목적)이 남습니다.
          </span>
        </div>
      )}
      {err && <p className="text-xs text-stamp">{err}</p>}
    </div>
  );
}
