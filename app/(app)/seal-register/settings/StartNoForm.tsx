"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSealStartNo } from "@/app/(app)/seal-register/actions";
import { btnPrimary, inputCls, labelCls, noticeError, noticeSuccess } from "@/lib/ui";
import { sealIssueLabel } from "@/lib/sealRegister";
import { tap } from "@/app/(app)/seal-register/parts";

// 연도별 시작 번호 — 그해 첫 발급 전에만(이미 발급이 있으면 잠김, DB 도 거절).
export default function StartNoForm({ year, nextSeq, locked }: { year: number; nextSeq: number; locked: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(String(nextSeq));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= 9999;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className={labelCls}>{year}년 첫 발급 번호</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={9999}
            value={value}
            disabled={locked || pending}
            onChange={(e) => setValue(e.target.value)}
            className={`${inputCls} h-11 w-32 text-base sm:h-auto sm:text-sm`}
          />
        </label>
        <button
          type="button"
          disabled={locked || pending || !valid}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const r = await setSealStartNo(year, n);
              setMsg(r.ok ? { ok: true, text: `저장했습니다. 첫 발급은 ${sealIssueLabel(year, n)}입니다.` } : { ok: false, text: r.message });
              if (r.ok) router.refresh();
            })
          }
          className={`${btnPrimary} ${tap}`}
        >
          저장
        </button>
      </div>
      {!locked && valid && <p className="text-xs text-ink-muted">→ {year}년 첫 승인 때 {sealIssueLabel(year, n)}부터 붙습니다.</p>}
      {msg && <p className={`${msg.ok ? noticeSuccess : noticeError} break-all text-sm`}>{msg.text}</p>}
    </div>
  );
}
