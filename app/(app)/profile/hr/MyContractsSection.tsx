"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ContractView from "@/app/components/ContractView";
import InkSignaturePad, { SignaturePreview } from "@/app/components/InkSignaturePad";
import {
  signMyContract,
  downloadMyContractPdf,
  type MyContract,
  type MyContractsData,
} from "@/app/(app)/profile/hr/contractActions";
import { contractStateLabel, fmtDot, isFinalized, kstYmd } from "@/lib/employmentContracts";
import {
  panelToneCls,
  sectionTitleCls,
  btnPrimary,
  btnSecondary,
  badgeNavy,
  badgeSuccess,
  badgeWarning,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

// =====================================================================
// 마이페이지 '내 계약서' — 열람·서명·다운로드(교부).
//   * 서명은 내용을 끝까지 내려야 열립니다: 본문 스크롤 상자를 바닥까지
//     내리면 [끝까지 읽었습니다] 확인란이 풀리고, 그걸 체크해야 [서명하기].
//   * 저장된 서명이 있어도 자동 적용하지 않습니다 — 서명 창에서 미리보기를 보고
//     본인이 [이 서명으로 서명] 을 눌러야 적용됩니다.
// =====================================================================

function downloadBase64Pdf(b64: string, filename: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function MyContractsSection({ data }: { data: MyContractsData }) {
  const { contracts, savedSignature } = data;
  return (
    <section className={panelToneCls("blue")} id="my-contracts">
      <h3 className={sectionTitleCls("blue")}>내 계약서</h3>
      <p className="mt-1 text-xs text-ink-muted">
        본인 계약서만 보입니다. 체결이 끝난 계약서는 여기서 언제든 내려받을 수 있습니다.
      </p>
      {contracts.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-hint">받은 근로계약서가 없습니다.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {contracts.map((c) => (
            <ContractCard key={c.id} contract={c} savedSignature={savedSignature} />
          ))}
        </div>
      )}
    </section>
  );
}

function ContractCard({ contract: c, savedSignature }: { contract: MyContract; savedSignature: string | null }) {
  const router = useRouter();
  const needsSign = c.status === "sent";
  const [open, setOpen] = useState(needsSign);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [readConfirmed, setReadConfirmed] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const finalized = isFinalized(c);

  // 스크롤 상자 바닥에 닿으면 '끝까지 읽음'. 한 번 닿으면 다시 올려도 유지합니다.
  //   스크롤 이벤트 + 마운트 시 1회 검사(하이드레이션 전에 이미 내려와 있거나,
  //   내용이 상자보다 짧은 경우까지) — 관찰자(IntersectionObserver) 하나에만
  //   기대면 새로고침 직후 스크롤을 놓치는 경우가 있었습니다.
  //   ⚠️ 탭이 숨겨져 있으면 상자 높이가 0 이라 "바닥" 으로 오판합니다 — 높이가
  //   있을 때만 판정하고, 탭이 열려 크기가 생기는 순간(ResizeObserver) 다시 봅니다.
  function checkEnd() {
    const el = scrollRef.current;
    if (!el || el.clientHeight === 0 || el.scrollHeight === 0) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setReachedEnd(true);
  }
  useEffect(() => {
    if (!open || !needsSign) return;
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => checkEnd());
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, needsSign]);

  function download() {
    setMsg(null);
    start(async () => {
      const res = await downloadMyContractPdf(c.id);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      downloadBase64Pdf(res.base64, res.filename);
      router.refresh();
    });
  }

  const badge = finalized ? badgeSuccess : needsSign ? badgeWarning : badgeNavy;
  const period = c.contract_end
    ? `${fmtDot(c.contract_start)} ~ ${fmtDot(c.contract_end)}`
    : `${fmtDot(c.contract_start)} ~`;

  return (
    <article className="rounded-lg border border-rule bg-card" data-testid="my-contract">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">근로계약서 · {period}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {c.employee_signed_at ? `서명 ${kstYmd(c.employee_signed_at)}` : `받은 날 ${kstYmd(c.sent_at) ?? "-"}`}
            {c.delivered_at ? ` · 내려받음 ${kstYmd(c.delivered_at)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={badge}>{contractStateLabel(c)}</span>
          {finalized && (
            <button type="button" onClick={download} disabled={pending} className={btnPrimary}>
              {pending ? "준비 중…" : "PDF 내려받기"}
            </button>
          )}
          <button type="button" onClick={() => setOpen((v) => !v)} className={btnSecondary}>
            {open ? "접기" : "내용 보기"}
          </button>
        </div>
      </div>

      {open && (
        <div className="p-3">
          <div
            ref={scrollRef}
            onScroll={needsSign && !reachedEnd ? checkEnd : undefined}
            data-testid="contract-scroll"
            className="max-h-[60vh] overflow-y-auto rounded-md border border-rule bg-white px-3 py-4 sm:px-5"
          >
            <ContractView
              blocks={c.blocks}
              employeeSigned={!!c.employee_signed_at}
              employerSigned={!!c.employer_signed_at}
            />
          </div>

          {needsSign && (
            <div className="mt-3 space-y-3">
              {!reachedEnd && (
                <p className="text-xs font-medium text-warning">
                  ↓ 계약서를 끝까지 내려 읽으면 서명할 수 있습니다.
                </p>
              )}
              <label
                className={`flex items-start gap-2 text-sm ${reachedEnd ? "text-ink-body" : "text-ink-hint"}`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  disabled={!reachedEnd}
                  checked={readConfirmed}
                  onChange={(e) => setReadConfirmed(e.target.checked)}
                  data-testid="read-confirm"
                />
                계약서 내용을 끝까지 읽었고, 이 내용에 동의합니다.
              </label>
              <button
                type="button"
                className={`${btnPrimary} w-full sm:w-auto`}
                disabled={!readConfirmed || pending}
                onClick={() => {
                  setMsg(null);
                  setDialog(true);
                }}
              >
                서명하기
              </button>
            </div>
          )}
          {c.status === "signed" && !finalized && (
            <p className="mt-3 text-xs text-ink-muted">
              서명이 접수되었습니다. 센터장 서명이 끝나면 여기서 PDF 를 내려받을 수 있습니다.
            </p>
          )}
        </div>
      )}

      {msg && <p className={`m-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>}

      {dialog && (
        <SignDialog
          savedSignature={savedSignature}
          pending={pending}
          onClose={() => setDialog(false)}
          onConfirm={(choice) => {
            start(async () => {
              const res = await signMyContract(c.id, {
                readConfirmed,
                mode: choice.mode,
                dataUrl: choice.mode === "drawn" ? choice.dataUrl : null,
                saveForLater: choice.mode === "drawn" ? choice.save : false,
              });
              if (!res.ok) {
                setMsg({ ok: false, text: res.message });
                setDialog(false);
                return;
              }
              setDialog(false);
              setMsg({ ok: true, text: "서명이 접수되었습니다. 센터장 서명 후 체결이 끝납니다." });
              router.refresh();
            });
          }}
        />
      )}
    </article>
  );
}

type SignChoice = { mode: "saved" } | { mode: "drawn"; dataUrl: string; save: boolean };

// 서명 창 — 저장된 서명이 있으면 미리보기 + [이 서명으로 서명](본인이 눌러야 적용),
//   [새로 그리기] 로 바꿀 수 있습니다. 배경 탭으로는 닫지 않습니다(그리다 닫힘 방지).
function SignDialog({
  savedSignature,
  pending,
  onClose,
  onConfirm,
}: {
  savedSignature: string | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (c: SignChoice) => void;
}) {
  const [drawing, setDrawing] = useState(!savedSignature);
  const [drawn, setDrawn] = useState<string | null>(null);
  const [save, setSave] = useState(true);
  const canConfirm = drawing ? !!drawn : !!savedSignature;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="근로계약서 서명"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className="max-h-[92vh] w-full max-w-[440px] overflow-y-auto rounded-xl bg-card p-4 shadow-lg">
        <p className="text-base font-bold text-ink">근로계약서 서명</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {drawing
            ? "손가락으로 서명해주세요. 서명하면 계약 내용에 동의한 것으로 처리되며 되돌릴 수 없습니다."
            : "저장해 둔 내 서명입니다. 이 서명이 맞는지 확인한 뒤 적용해주세요."}
        </p>
        <div className="mt-3">
          {drawing ? (
            <InkSignaturePad onChange={setDrawn} />
          ) : (
            savedSignature && <SignaturePreview src={savedSignature} alt="저장된 내 서명" />
          )}
        </div>
        {drawing && (
          <label className="mt-3 flex items-center gap-2 text-xs text-ink-body">
            <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
            이 서명을 저장해 다음 계약서에도 쓸 수 있게 하기
          </label>
        )}
        {!drawing && (
          <button
            type="button"
            onClick={() => {
              setDrawing(true);
              setDrawn(null);
            }}
            disabled={pending}
            className={`${btnSecondary} mt-3 w-full`}
          >
            새로 그리기
          </button>
        )}
        {drawing && savedSignature && (
          <button
            type="button"
            onClick={() => setDrawing(false)}
            disabled={pending}
            className="mt-2 w-full text-xs text-navy underline-offset-2 hover:underline"
          >
            저장된 서명 사용
          </button>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={pending || !canConfirm}
            onClick={() => onConfirm(drawing ? { mode: "drawn", dataUrl: drawn ?? "", save } : { mode: "saved" })}
            className={`${btnPrimary} flex-1`}
          >
            {pending ? "서명 중…" : drawing ? "서명 완료" : "이 서명으로 서명"}
          </button>
          <button type="button" onClick={onClose} disabled={pending} className={btnSecondary}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
