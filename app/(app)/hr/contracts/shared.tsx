"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import ContractView from "@/app/components/ContractView";
import InkSignaturePad, { SignaturePreview } from "@/app/components/InkSignaturePad";
import {
  bulkPreviewPdf,
  bulkSendContracts,
  deleteDraftContract,
  downloadContractPdf,
  employerSignContract,
  getContractBlocks,
  getEmployerSignOptions,
  recallContract,
  sendContract,
  voidContract,
} from "@/app/(app)/hr/contracts/workflowActions";
import type { EmployerSignInput } from "@/lib/contractServer";
import {
  CONTRACT_KINDS,
  contractStateLabel,
  isFinalized,
  kstYmd,
  type ContractBlock,
  type ContractKind,
  type ContractSummary,
} from "@/lib/contractCore";
import {
  panelToneCls,
  sectionTitleCls,
  tableHeadCls,
  tableRowCls,
  btnPrimary,
  btnSecondary,
  badgeNavy,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  badgeDanger,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

// =====================================================================
// 계약서 관리자 화면 공용 부품 — 근로계약서·연봉계약서 탭이 함께 씁니다.
//   목록(상태·날짜·작업 버튼) · 일괄 선택(미리보기 PDF·발송) · 내용 미리보기 ·
//   센터장 서명 창. 서버 호출은 kind 를 받는 ./workflowActions 하나로 갑니다.
// =====================================================================

export type Msg = { ok: boolean; text: string } | null;

export function downloadBase64Pdf(b64: string, filename: string) {
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

export function SmallBtn({
  children,
  onClick,
  disabled,
  tone = "secondary",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "secondary" | "primary" | "danger";
}) {
  const cls =
    tone === "primary"
      ? "bg-navy text-white hover:bg-navy-strong border-navy"
      : tone === "danger"
        ? "border-stamp text-stamp hover:bg-stamp-soft bg-card"
        : "border-line text-ink-body hover:bg-surface bg-card";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className={`max-h-[92vh] w-full ${wide ? "max-w-4xl" : "max-w-2xl"} overflow-y-auto rounded-xl bg-card p-4 shadow-lg sm:p-5`}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-base font-bold text-ink">{title}</p>
          <button type="button" onClick={onClose} className={btnSecondary}>
            닫기
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// 계약서 목록 — 두 종류 공용. 작성 중 [수정]만 종류별 화면이 onEdit 으로 받습니다.
export function ContractList({
  kind,
  items,
  isM0,
  onEdit,
  bulk = false,
}: {
  kind: ContractKind;
  items: ContractSummary[];
  isM0: boolean;
  onEdit?: (item: ContractSummary) => void;
  bulk?: boolean; // 일괄 선택(미리보기·발송) 사용
}) {
  const router = useRouter();
  const label = CONTRACT_KINDS[kind].label;
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const [showVoid, setShowVoid] = useState(false);
  const [preview, setPreview] = useState<{ c: ContractSummary; blocks: ContractBlock[] } | null>(null);
  const [signTarget, setSignTarget] = useState<ContractSummary | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const visible = items.filter((c) => showVoid || c.status !== "void");
  const pickedItems = visible.filter((c) => picked.has(c.id));
  const pickedDrafts = pickedItems.filter((c) => c.status === "draft");

  function run(fn: () => Promise<{ ok: boolean; message?: string; dmFailed?: string | null }>, okText: string) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setMsg({ ok: false, text: res.message ?? "실패했습니다." });
        return;
      }
      const dm = "dmFailed" in res && res.dmFailed ? ` (슬랙 알림 실패 — ${res.dmFailed})` : "";
      setMsg({ ok: true, text: okText + dm });
      router.refresh();
    });
  }

  function openPreview(c: ContractSummary) {
    setMsg(null);
    start(async () => {
      const res = await getContractBlocks(kind, c.id);
      if (!res.ok) setMsg({ ok: false, text: res.message });
      else setPreview({ c, blocks: res.blocks });
    });
  }

  function pdf(c: ContractSummary) {
    setMsg(null);
    start(async () => {
      const res = await downloadContractPdf(kind, c.id);
      if (!res.ok) setMsg({ ok: false, text: res.message });
      else downloadBase64Pdf(res.base64, res.filename);
    });
  }

  function bulkPdf() {
    setMsg(null);
    start(async () => {
      const res = await bulkPreviewPdf(kind, pickedItems.map((c) => c.id));
      if (!res.ok) setMsg({ ok: false, text: res.message });
      else downloadBase64Pdf(res.base64, res.filename);
    });
  }

  function bulkSend() {
    if (!confirm(`작성 중 ${pickedDrafts.length}건을 한꺼번에 보낼까요?\n보내면 지금 조항 문구로 고정되고 각 직원에게 슬랙 알림이 갑니다.`)) return;
    setMsg(null);
    start(async () => {
      const res = await bulkSendContracts(kind, pickedDrafts.map((c) => c.id));
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      const fails = res.failed.length ? ` · 실패 ${res.failed.length}건(${res.failed.map((f) => f.message).join(", ")})` : "";
      const dm = res.dmFailed ? ` · 슬랙 알림 실패 ${res.dmFailed}건` : "";
      setMsg({ ok: res.failed.length === 0, text: `${res.sent}건 보냈습니다${fails}${dm}` });
      setPicked(new Set());
      router.refresh();
    });
  }

  const allIds = visible.map((c) => c.id);
  const allPicked = allIds.length > 0 && allIds.every((id) => picked.has(id));

  return (
    <section className={panelToneCls("green")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={sectionTitleCls("green")}>
          {label} 목록 ({visible.length})
        </h3>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          <input type="checkbox" checked={showVoid} onChange={(e) => setShowVoid(e.target.checked)} />
          무효 포함
        </label>
      </div>
      {bulk && visible.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-rule px-3 py-2 text-xs">
          <span className="text-ink-muted">선택 {pickedItems.length}건</span>
          <SmallBtn onClick={bulkPdf} disabled={pending || pickedItems.length === 0}>
            선택 미리보기 PDF
          </SmallBtn>
          <SmallBtn tone="primary" onClick={bulkSend} disabled={pending || pickedDrafts.length === 0}>
            선택한 작성 중 {pickedDrafts.length}건 보내기
          </SmallBtn>
        </div>
      )}
      {msg && <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>}
      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-hint">아직 작성한 {label}가 없습니다.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[780px] text-sm">
            <thead>
              <tr className={tableHeadCls}>
                {bulk && (
                  <th className="px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label="전체 선택"
                      checked={allPicked}
                      onChange={(e) => setPicked(e.target.checked ? new Set(allIds) : new Set())}
                    />
                  </th>
                )}
                <th className="px-2 py-2">직원</th>
                <th className="px-2 py-2">기간</th>
                <th className="px-2 py-2">상태</th>
                <th className="px-2 py-2">보냄</th>
                <th className="px-2 py-2">직원 서명</th>
                <th className="px-2 py-2">센터장 서명</th>
                <th className="px-2 py-2">교부(내려받음)</th>
                <th className="px-2 py-2 text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const fin = isFinalized(c);
                const badge =
                  c.status === "void"
                    ? badgeDanger
                    : fin
                      ? badgeSuccess
                      : c.status === "draft"
                        ? badgeNeutral
                        : c.status === "sent"
                          ? badgeWarning
                          : badgeNavy;
                return (
                  <tr key={c.id} className={tableRowCls} data-testid="contract-row">
                    {bulk && (
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label={`${c.employee_name} 선택`}
                          checked={picked.has(c.id)}
                          onChange={(e) => {
                            const next = new Set(picked);
                            if (e.target.checked) next.add(c.id);
                            else next.delete(c.id);
                            setPicked(next);
                          }}
                        />
                      </td>
                    )}
                    <td className="px-2 py-2 font-medium text-ink">
                      {c.employee_name}
                      {c.note && <span className="block text-[11px] font-normal text-ink-muted">{c.note}</span>}
                    </td>
                    <td className="px-2 py-2 text-xs">{c.period}</td>
                    <td className="px-2 py-2">
                      <span className={badge}>{contractStateLabel(c)}</span>
                    </td>
                    <td className="px-2 py-2 text-xs">{kstYmd(c.sent_at) ?? "-"}</td>
                    <td className="px-2 py-2 text-xs">{kstYmd(c.employee_signed_at) ?? "-"}</td>
                    <td className="px-2 py-2 text-xs">{kstYmd(c.employer_signed_at) ?? "-"}</td>
                    <td className="px-2 py-2 text-xs">{kstYmd(c.delivered_at) ?? "-"}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        <SmallBtn onClick={() => openPreview(c)} disabled={pending}>
                          내용
                        </SmallBtn>
                        <SmallBtn onClick={() => pdf(c)} disabled={pending}>
                          {fin ? "PDF" : "PDF 미리보기"}
                        </SmallBtn>
                        {c.status === "draft" && (
                          <>
                            {onEdit && (
                              <SmallBtn onClick={() => onEdit(c)} disabled={pending}>
                                수정
                              </SmallBtn>
                            )}
                            <SmallBtn
                              tone="primary"
                              disabled={pending}
                              onClick={() => {
                                if (confirm(`${c.employee_name} 님에게 ${label}를 보낼까요?\n보내면 지금 조항 문구로 고정되고 직원에게 슬랙 알림이 갑니다.`))
                                  run(() => sendContract(kind, c.id), `${c.employee_name} 님에게 보냈습니다.`);
                              }}
                            >
                              보내기
                            </SmallBtn>
                            <SmallBtn
                              tone="danger"
                              disabled={pending}
                              onClick={() => {
                                if (confirm(`작성 중인 ${label}를 삭제할까요?`)) run(() => deleteDraftContract(kind, c.id), "삭제했습니다.");
                              }}
                            >
                              삭제
                            </SmallBtn>
                          </>
                        )}
                        {c.status === "sent" && (
                          <SmallBtn
                            disabled={pending}
                            onClick={() => {
                              if (confirm("발송을 취소하고 작성 중으로 되돌릴까요? (직원 화면에서 사라집니다)"))
                                run(() => recallContract(kind, c.id), "작성 중으로 되돌렸습니다.");
                            }}
                          >
                            발송 취소
                          </SmallBtn>
                        )}
                        {c.status === "signed" && !c.employer_signed_at && isM0 && (
                          <SmallBtn tone="primary" disabled={pending} onClick={() => setSignTarget(c)}>
                            센터장 서명
                          </SmallBtn>
                        )}
                        {(c.status === "sent" || c.status === "signed") && isM0 && (
                          <SmallBtn
                            tone="danger"
                            disabled={pending}
                            onClick={() => {
                              if (confirm(`${c.employee_name} 님 ${label}를 무효로 할까요? 기록은 남고 직원 화면에서는 사라집니다.`))
                                run(() => voidContract(kind, c.id), "무효로 처리했습니다.");
                            }}
                          >
                            무효
                          </SmallBtn>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!isM0 && <p className="mt-3 text-xs text-ink-muted">센터장 서명과 무효 처리는 관장·부장만 할 수 있습니다.</p>}

      {preview && (
        <Modal title={`${preview.c.employee_name} — ${label} 내용`} onClose={() => setPreview(null)}>
          <p className="mb-3 text-xs text-ink-muted">
            {kind === "employment" ? "화면에서는 주민등록번호 뒷자리를 가립니다. PDF 에는 전체 번호가 들어갑니다. " : ""}
            {preview.c.status === "draft" ? "작성 중이라 현행 조항 문구로 보입니다." : "보낸 시점의 조항 문구로 고정되어 있습니다."}
          </p>
          <div className="rounded-md border border-rule bg-white px-4 py-4">
            <ContractView
              blocks={preview.blocks}
              employeeSigned={!!preview.c.employee_signed_at}
              employerSigned={!!preview.c.employer_signed_at}
            />
          </div>
        </Modal>
      )}

      {signTarget && (
        <EmployerSignDialog
          kind={kind}
          contract={signTarget}
          onClose={() => setSignTarget(null)}
          onDone={(text) => {
            setSignTarget(null);
            setMsg({ ok: true, text });
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

// 센터장 서명 — 관장 도장(stamp_path) 우선, 없거나 원하면 직접 서명.
function EmployerSignDialog({
  kind,
  contract,
  onClose,
  onDone,
}: {
  kind: ContractKind;
  contract: ContractSummary;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [stamp, setStamp] = useState<string | null>(null);
  const [mySig, setMySig] = useState<string | null>(null);
  const [mode, setMode] = useState<"stamp" | "saved" | "drawn">("stamp");
  const [drawn, setDrawn] = useState<string | null>(null);
  const [save, setSave] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    getEmployerSignOptions().then((res) => {
      if (!alive) return;
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      setStamp(res.stamp);
      setMySig(res.mySignature);
      setMode(res.stamp ? "stamp" : res.mySignature ? "saved" : "drawn");
    });
    return () => {
      alive = false;
    };
  }, []);

  const canConfirm = mode === "stamp" ? !!stamp : mode === "saved" ? !!mySig : !!drawn;

  function confirmSign() {
    setErr(null);
    const input: EmployerSignInput = mode === "drawn" ? { mode: "drawn", dataUrl: drawn ?? "", save } : { mode };
    start(async () => {
      const res = await employerSignContract(kind, contract.id, input);
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      onDone(
        `${contract.employee_name} 님 ${CONTRACT_KINDS[kind].label} 체결 완료 — PDF 를 확정했습니다.` +
          (res.dmFailed ? ` (슬랙 알림 실패 — ${res.dmFailed})` : "")
      );
    });
  }

  const opt = (m: typeof mode, text: string, enabled: boolean) => (
    <label className={`flex items-center gap-2 text-sm ${enabled ? "text-ink-body" : "text-ink-hint"}`}>
      <input type="radio" name="employer-sign" checked={mode === m} disabled={!enabled} onChange={() => setMode(m)} />
      {text}
    </label>
  );

  return (
    <Modal title={`센터장 서명 — ${contract.employee_name}`} onClose={onClose}>
      <p className="text-xs text-ink-muted">
        직원 서명이 끝난 {CONTRACT_KINDS[kind].label}입니다({kstYmd(contract.employee_signed_at)}). 서명하면 PDF 가
        확정되어 직원 마이페이지에서 내려받을 수 있게 됩니다.
      </p>
      <div className="mt-3 space-y-2">
        {opt("stamp", stamp ? "관장 도장으로 서명" : "관장 도장 (등록 안 됨)", !!stamp)}
        {opt("saved", mySig ? "내 저장 서명 사용" : "내 저장 서명 (없음)", !!mySig)}
        {opt("drawn", "직접 그려 서명", true)}
      </div>
      <div className="mt-3">
        {mode === "stamp" && stamp && <SignaturePreview src={stamp} alt="관장 도장" />}
        {mode === "saved" && mySig && <SignaturePreview src={mySig} alt="내 저장 서명" />}
        {mode === "drawn" && (
          <>
            <InkSignaturePad onChange={setDrawn} />
            <label className="mt-2 flex items-center gap-2 text-xs text-ink-body">
              <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
              이 서명을 내 서명으로 저장
            </label>
          </>
        )}
      </div>
      {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" className={`${btnPrimary} flex-1`} disabled={pending || !canConfirm} onClick={confirmSign}>
          {pending ? "처리 중…" : "서명하고 PDF 확정"}
        </button>
        <button type="button" className={btnSecondary} onClick={onClose} disabled={pending}>
          취소
        </button>
      </div>
    </Modal>
  );
}
