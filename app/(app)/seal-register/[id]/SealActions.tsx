"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveSealRequest,
  cancelSealRecipient,
  deleteSealDraft,
  rejectSealRequest,
  submitSealRequest,
  withdrawSealRequest,
} from "@/app/(app)/seal-register/actions";
import { btnDanger, btnPrimary, btnSecondary, inputCls, labelCls, noticeError, noticeSuccess } from "@/lib/ui";
import { tap } from "@/app/(app)/seal-register/parts";

type Result = { ok: true } | { ok: false; message: string };

// 상세 화면 버튼 — 무엇이 보이는지는 서버가 정해 넘깁니다(본인 신청이면 결재 버튼 자체가 없음).
//   서버 액션이 권한을 다시 보고, DB 함수가 한 번 더 막습니다.
export default function SealActions({
  id,
  canEdit,
  canSubmit,
  canDelete,
  canWithdraw,
  canDecide,
  pdfHref,
  pdfLabel,
}: {
  id: string;
  canEdit: boolean;
  canSubmit: boolean;
  canDelete: boolean;
  canWithdraw: boolean;
  canDecide: boolean;
  pdfHref: string | null;
  pdfLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const run = (fn: () => Promise<Result & { range?: string }>, okText: (r: { range?: string }) => string, after?: () => void) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setMsg({ ok: true, text: okText(r) });
      after?.();
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canDecide && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm("승인하면 발급번호가 바로 붙고 되돌릴 수 없습니다(잘못되면 취소 → 결번). 승인할까요?"))
                  run(() => approveSealRequest(id), (r) => `승인했습니다. ${r.range ?? ""}`);
              }}
              className={`${btnPrimary} ${tap}`}
            >
              승인
            </button>
            <button type="button" disabled={pending} onClick={() => setRejecting((v) => !v)} className={`${btnDanger} ${tap}`}>
              반려
            </button>
          </>
        )}
        {canEdit && (
          <Link href={`/seal-register/${id}/edit`} className={`${btnSecondary} ${tap}`}>
            고치기
          </Link>
        )}
        {canSubmit && (
          <button type="button" disabled={pending} onClick={() => run(() => submitSealRequest(id), () => "결재에 올렸습니다. 관장·부장에게 알림이 갑니다.")} className={`${btnPrimary} ${tap}`}>
            결재 올리기
          </button>
        )}
        {canWithdraw && (
          <button
            type="button"
            disabled={pending}
            onClick={() => window.confirm("결재 대기를 거둬들일까요? 고친 뒤 다시 올릴 수 있습니다.") && run(() => withdrawSealRequest(id), () => "회수했습니다. [고치기]로 고친 뒤 다시 올리세요.")}
            className={`${btnSecondary} ${tap}`}
          >
            회수
          </button>
        )}
        {pdfHref && (
          <a href={pdfHref} target="_blank" rel="noopener" onClick={() => setTimeout(() => router.refresh(), 2500)} className={`${btnSecondary} ${tap}`}>
            {pdfLabel}
          </a>
        )}
        {canDelete && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              window.confirm("작성 중인 신청을 지울까요?") &&
              start(async () => {
                const r = await deleteSealDraft(id);
                if (!r.ok) return setMsg({ ok: false, text: r.message });
                router.push("/seal-register");
                router.refresh();
              })
            }
            className={`${btnSecondary} ${tap}`}
          >
            지우기
          </button>
        )}
      </div>

      {canDecide && rejecting && (
        <div className="rounded-lg border border-stamp/40 bg-card p-3">
          <label className="block">
            <span className={labelCls}>반려 사유(필수 — 신청자에게 그대로 전달됩니다)</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className={`${inputCls} text-base sm:text-sm`} />
          </label>
          <button
            type="button"
            disabled={pending || !reason.trim()}
            onClick={() => run(() => rejectSealRequest(id, reason), () => "반려했습니다. 신청자에게 알림이 갑니다.", () => setRejecting(false))}
            className={`${btnDanger} ${tap} mt-2`}
          >
            반려하기
          </button>
        </div>
      )}

      {msg && <p className={`${msg.ok ? noticeSuccess : noticeError} break-all text-sm`}>{msg.text}</p>}
    </div>
  );
}

// 발급 취소(관장·부장) — 사유 필수, 번호는 결번으로 남음
export function SealCancelButton({ recipientId, label }: { recipientId: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${btnDanger} ${tap}`}>
        발급 취소
      </button>
    );
  return (
    <div className="w-full rounded-lg border border-stamp/40 bg-card p-3">
      <label className="block">
        <span className={labelCls}>{label} 취소 사유(필수 — 번호는 결번으로 남고 되돌릴 수 없습니다)</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className={`${inputCls} text-base sm:text-sm`} />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || !reason.trim()}
          onClick={() =>
            start(async () => {
              setErr(null);
              const r = await cancelSealRecipient(recipientId, reason);
              if (!r.ok) return setErr(r.message);
              setOpen(false);
              router.refresh();
            })
          }
          className={`${btnDanger} ${tap}`}
        >
          {pending ? "취소하는 중…" : "취소 확정"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={`${btnSecondary} ${tap}`}>
          닫기
        </button>
      </div>
      {err && <p className={`${noticeError} mt-2 break-all text-sm`}>{err}</p>}
    </div>
  );
}
