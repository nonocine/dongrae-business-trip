"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  issueMyCertificate,
  reissuePdf,
} from "@/app/hr/certificates/actions";
import {
  CERT_TYPES,
  formatIssuedDate,
  type CertificateIssue,
} from "@/lib/certificates";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  badgeNavy,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";

// base64 → PDF 다운로드(클라이언트).
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

export default function MyCertificatesSection({
  history,
  defaultDuty,
  canIssue,
}: {
  history: CertificateIssue[];
  defaultDuty: string;
  canIssue: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reissuingId, setReissuingId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function doReissue(rec: CertificateIssue) {
    setMsg(null);
    setReissuingId(rec.id);
    start(async () => {
      const res = await reissuePdf(rec.id);
      setReissuingId(null);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      downloadBase64Pdf(res.pdfBase64, res.filename);
    });
  }

  return (
    <section className={cardCls} id="my-certificates">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">증명서 발급</h3>
        <button
          type="button"
          onClick={() => {
            setMsg(null);
            setOpen(true);
          }}
          disabled={!canIssue}
          className={btnPrimary}
          title={
            !canIssue ? "재직 중인 직원만 재직증명서를 발급할 수 있습니다." : ""
          }
        >
          재직증명서 발급
        </button>
      </div>

      {!canIssue && (
        <p className={`mb-3 ${noticeWarning}`}>
          재직 중인 직원만 재직증명서를 즉시 발급할 수 있습니다. (경력증명서는
          담당자에게 요청하세요.)
        </p>
      )}

      {msg && (
        <p className={`mb-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>
      )}

      {history.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-hint">
          발급 이력이 없습니다. 위 버튼으로 재직증명서를 즉시 발급하세요.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className="px-2 py-2 text-left text-xs font-semibold text-navy">
                  번호
                </th>
                <th className="px-2 py-2 text-left text-xs font-semibold text-navy">
                  종류
                </th>
                <th className="px-2 py-2 text-left text-xs font-semibold text-navy">
                  발급일
                </th>
                <th className="px-2 py-2 text-left text-xs font-semibold text-navy">
                  용도
                </th>
                <th className="px-2 py-2 text-right text-xs font-semibold text-navy">
                  다시받기
                </th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-line/60">
                  <td className="px-2 py-2 font-mono text-xs text-ink-body">
                    {h.snapshot?.issueLabel ??
                      `제${h.issue_year}년-${String(h.issue_seq).padStart(2, "0")}호`}
                  </td>
                  <td className="px-2 py-2 text-sm">
                    <span className={badgeNavy}>{CERT_TYPES[h.cert_type]}</span>
                  </td>
                  <td className="px-2 py-2 font-mono text-xs text-ink-body">
                    {h.issued_on ? formatIssuedDate(h.issued_on) : "-"}
                  </td>
                  <td className="px-2 py-2 text-sm text-ink-body">{h.purpose}</td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => doReissue(h)}
                      disabled={pending && reissuingId === h.id}
                      className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface disabled:opacity-50"
                    >
                      {pending && reissuingId === h.id ? "생성 중…" : "PDF 다시받기"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <IssueModal
          defaultDuty={defaultDuty}
          onClose={() => setOpen(false)}
          onIssued={(text) => {
            setOpen(false);
            setMsg({ ok: true, text });
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function IssueModal({
  defaultDuty,
  onClose,
  onIssued,
}: {
  defaultDuty: string;
  onClose: () => void;
  onIssued: (text: string) => void;
}) {
  const [purpose, setPurpose] = useState("서류제출용");
  const [duty, setDuty] = useState(defaultDuty);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    setErr(null);
    start(async () => {
      const res = await issueMyCertificate({ purpose, duty });
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      downloadBase64Pdf(res.pdfBase64, res.filename);
      onIssued(`${res.label}로 발급되었습니다. PDF가 다운로드됩니다.`);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">재직증명서 발급</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:underline"
          >
            닫기
          </button>
        </div>

        <p className="mb-3 text-xs text-ink-muted">
          성명·생년월일·주소·근무부서·재직기간은 인사기록에서 자동으로 채워집니다.
          용도와 직위·담당업무만 확인하세요.
        </p>

        <label className="block text-[11px] font-semibold text-navy">용도</label>
        <input
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          className={`${inCls} mt-1`}
          placeholder="서류제출용"
        />

        <label className="mt-3 block text-[11px] font-semibold text-navy">
          직위 및 담당업무
        </label>
        <input
          value={duty}
          onChange={(e) => setDuty(e.target.value)}
          className={`${inCls} mt-1`}
          placeholder="예: 팀원 / 청소년활동 담당"
        />

        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className={btnPrimary}
          >
            {pending ? "발급 중…" : "발급 · PDF 받기"}
          </button>
          <button type="button" onClick={onClose} className={btnSecondary}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
