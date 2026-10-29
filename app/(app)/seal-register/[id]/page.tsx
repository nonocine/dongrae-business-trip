import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { getSealRequestDetail, resolveSealRegisterAccess } from "@/lib/sealRegisterServer";
import { SEAL_STATUS_LABEL, certDateLabel, sealDocTypeLabel } from "@/lib/sealRegister";
import { linkCls, noticeWarning, panelToneCls, sectionTitleCls } from "@/lib/ui";
import { SealStatusBadge } from "@/app/(app)/seal-register/parts";
import { CertPreview } from "@/app/(app)/seal-register/SealRequestForm";
import SealActions, { SealCancelButton } from "@/app/(app)/seal-register/[id]/SealActions";

export const dynamic = "force-dynamic";

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }) : "-");
const APPROVAL_LABEL = { pending: "결재대기", approved: "승인", rejected: "반려", withdrawn: "회수" } as const;

// 신청 상세 — 본인 신청 또는 관장·부장만(남의 신청은 없는 것처럼 404).
export default async function SealRequestPage({ params }: { params: Promise<{ id: string }> }) {
  await enforcePasswordChange();
  const a = await resolveSealRegisterAccess();
  if (!a) redirect("/");
  const { id } = await params;
  const d = await getSealRequestDetail(a, id);
  if (!d) notFound();

  const mine = d.requesterDriverId === a.driverId;
  const editable = ["draft", "rejected", "withdrawn"].includes(d.status);
  const issued = d.status === "issued";
  const liveCount = d.recipients.filter((r) => r.issueSeq != null && !r.canceledAt).length;
  const pdfHref = issued ? (liveCount ? `/seal-register/${d.id}/pdf` : null) : d.recipients.length ? `/seal-register/${d.id}/pdf` : null;
  const printedBefore = d.prints.length > 0;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-navy">직인사용대장 · {sealDocTypeLabel(d.docType)}</p>
          <h2 className="mt-0.5 flex flex-wrap items-center gap-2 text-2xl font-bold text-ink">
            <span className="break-all">{d.title}</span>
            <SealStatusBadge status={d.status} />
          </h2>
          <p className="mt-1 break-keep text-sm text-ink-muted">
            신청 {d.requesterName} · 대상 {d.recipientCount}명 · 증서 날짜 {certDateLabel(d.certDate)}
            {d.issueRange ? ` · ${d.issueRange}` : ""}
          </p>
          {d.purpose && <p className="mt-0.5 break-all text-xs text-ink-muted">사용 목적: {d.purpose}</p>}
        </div>
        <Link href="/seal-register" className="inline-flex min-h-11 shrink-0 items-center text-sm text-ink-muted hover:underline sm:min-h-0">
          ← 목록
        </Link>
      </div>

      {d.status === "rejected" && d.lastRejectReason && (
        <p className={noticeWarning}>
          반려 사유: <span className="break-all">{d.lastRejectReason}</span>
          {mine ? " — [고치기] 후 [결재 올리기]를 누르세요." : ""}
        </p>
      )}
      {d.status === "pending" && mine && <p className={noticeWarning}>관장·부장 결재를 기다리는 중입니다. 고치려면 [회수]하세요.</p>}
      {d.status === "pending" && !mine && a.isApprover && (
        <p className={noticeWarning}>아래 대상자 전원의 증서를 확인한 뒤 승인 또는 반려하세요. 승인하면 발급번호가 차례로 붙습니다.</p>
      )}

      <SealActions
        id={d.id}
        canEdit={mine && editable}
        canSubmit={mine && editable}
        canDelete={mine && d.status === "draft" && d.approvals.length === 0}
        canWithdraw={mine && d.status === "pending"}
        canDecide={a.isApprover && !mine && d.status === "pending"}
        pdfHref={pdfHref}
        pdfLabel={issued ? `PDF ${printedBefore ? "재출력" : "출력"}(${liveCount}명)` : "PDF 미리보기(직인 없음)"}
      />

      <section className="space-y-3">
        <h3 className={sectionTitleCls("navy")}>대상자 {d.recipients.length}명</h3>
        <ol className="space-y-3">
          {d.recipients.map((r, i) => (
            <li key={r.id} className={`rounded-lg border bg-card p-3 ${r.canceledAt ? "border-stamp/40" : "border-rule"}`}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs font-semibold text-ink-muted">{r.lineNo}번</span>
                <span className="min-w-0 break-all font-semibold text-ink">{r.name}</span>
                {r.issueLabel && <span className={`text-sm ${r.canceledAt ? "text-ink-muted line-through" : "text-navy"}`}>{r.issueLabel}</span>}
                {r.canceledAt && <span className="text-xs font-semibold text-stamp">취소(결번)</span>}
                {r.printed && !r.canceledAt && <span className="text-xs text-ink-muted">출력함</span>}
              </div>
              {r.canceledAt && (
                <p className="mt-1 break-all text-xs text-stamp">
                  {dt(r.canceledAt)} {r.canceledBy} 취소 — {r.cancelReason}
                </p>
              )}
              <details className="mt-2" open={!issued && i < 3}>
                <summary className="flex min-h-11 cursor-pointer items-center text-sm text-navy sm:min-h-0">증서 모양 보기</summary>
                <div className="mt-2">
                  <CertPreview
                    issueLabel={r.issueLabel ?? undefined}
                    title={d.title}
                    items={r.items}
                    body={r.body}
                    date={certDateLabel(d.certDate)}
                  />
                </div>
              </details>
              {issued && !r.canceledAt && r.issueSeq != null && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <a
                    href={`/seal-register/${d.id}/pdf?ids=${r.id}`}
                    target="_blank"
                    rel="noopener"
                    className={`${linkCls} inline-flex min-h-11 items-center text-sm sm:min-h-0`}
                  >
                    이 사람만 {r.printed ? "재출력" : "출력"}
                  </a>
                  {a.isApprover && <SealCancelButton recipientId={r.id} label={r.issueLabel ?? ""} />}
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className={`${panelToneCls("navy")} space-y-2`}>
        <h3 className={sectionTitleCls("navy")}>결재 이력</h3>
        {d.approvals.length === 0 ? (
          <p className="text-sm text-ink-muted">아직 결재에 올리지 않았습니다({SEAL_STATUS_LABEL[d.status]}).</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {d.approvals.map((p) => (
              <li key={p.round} className="break-keep">
                <span className="font-semibold">{p.round}차</span> · 올림 {dt(p.requestedAt)} · {APPROVAL_LABEL[p.status]}
                {p.approverName ? ` (${p.approverRank ?? ""} ${p.approverName}, ${dt(p.decidedAt)})` : ""}
                {p.rejectReason && <span className="block break-all text-xs text-stamp">사유: {p.rejectReason}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {issued && (
        <section className={`${panelToneCls("navy")} space-y-2`}>
          <h3 className={sectionTitleCls("navy")}>출력 기록</h3>
          {d.prints.length === 0 ? (
            <p className="text-sm text-ink-muted">아직 출력하지 않았습니다.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {d.prints.map((p, i) => (
                <li key={i} className="break-keep">
                  {dt(p.printedAt)} · {p.printedBy} · {p.count}명 · {p.isReprint ? "재출력" : "첫 출력"}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
