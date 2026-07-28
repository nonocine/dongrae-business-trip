"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  issueCareerCertificate,
  reissuePdf,
  approveRequest,
  rejectRequest,
  type CertEmployee,
} from "@/app/hr/certificates/actions";
import {
  CERT_TYPES,
  formatIssuedDate,
  periodToLabel,
  type CertificateIssue,
  type CertRequest,
} from "@/lib/certificates";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  badgeNavy,
  badgeNeutral,
  badgeWarning,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

const selCls =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body";

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

export default function CertificateLedger({
  issues,
  employees,
  pending: pendingReqs,
  isM0,
}: {
  issues: CertificateIssue[];
  employees: CertEmployee[];
  pending: CertRequest[];
  isM0: boolean;
}) {
  const router = useRouter();
  const [year, setYear] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<CertRequest | null>(null);
  const [pending, start] = useTransition();

  function doApprove(req: CertRequest) {
    if (!confirm(`${req.employee_name}님의 재직증명서 신청을 승인·발급할까요?`))
      return;
    setMsg(null);
    setBusyId(req.id);
    start(async () => {
      const res = await approveRequest(req.id);
      setBusyId(null);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({ ok: true, text: `승인·발급했습니다. (${res.label})` });
      router.refresh();
    });
  }

  const years = useMemo(() => {
    const s = new Set<number>();
    for (const i of issues) s.add(i.issue_year);
    return Array.from(s).sort((a, b) => b - a);
  }, [issues]);

  const rows = useMemo(
    () => (year === "all" ? issues : issues.filter((i) => String(i.issue_year) === year)),
    [issues, year]
  );

  function doReissue(rec: CertificateIssue) {
    setMsg(null);
    setBusyId(rec.id);
    start(async () => {
      const res = await reissuePdf(rec.id);
      setBusyId(null);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      downloadBase64Pdf(res.pdfBase64, res.filename);
    });
  }

  return (
    <div className="space-y-5">
      {/* 승인 대기 */}
      <section className={cardCls}>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-bold text-ink">재직증명서 승인 대기</h3>
          {pendingReqs.length > 0 && (
            <span className={badgeWarning}>{pendingReqs.length}건</span>
          )}
        </div>
        {!isM0 && (
          <p className={`mb-3 ${noticeWarning}`}>
            승인·반려는 관장·부장만 할 수 있습니다. (열람만 가능)
          </p>
        )}
        {pendingReqs.length === 0 ? (
          <p className="py-3 text-center text-sm text-ink-hint">
            대기 중인 신청이 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={thCls}>신청자</th>
                  <th className={thCls}>용도</th>
                  <th className={thCls}>직위·담당업무</th>
                  <th className={thCls}>신청일</th>
                  <th className={`${thCls} text-right`}>처리</th>
                </tr>
              </thead>
              <tbody>
                {pendingReqs.map((r) => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className={`${tdCls} font-medium text-ink`}>
                      {r.employee_name}
                    </td>
                    <td className={tdCls}>{r.purpose}</td>
                    <td className={tdCls}>{r.duty ?? "-"}</td>
                    <td className={`${tdCls} font-mono text-xs`}>
                      {r.requested_at ? r.requested_at.slice(0, 10) : "-"}
                    </td>
                    <td className={`${tdCls} text-right`}>
                      {isM0 ? (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => doApprove(r)}
                            disabled={pending && busyId === r.id}
                            className="rounded border border-navy bg-navy px-2 py-1 text-xs font-semibold text-white hover:bg-navy-strong disabled:opacity-50"
                          >
                            {pending && busyId === r.id ? "처리 중…" : "승인·발급"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMsg(null);
                              setRejectTarget(r);
                            }}
                            disabled={pending && busyId === r.id}
                            className="rounded border border-stamp px-2 py-1 text-xs text-stamp hover:bg-stamp-soft disabled:opacity-50"
                          >
                            반려
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-ink-hint">열람만</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className={selCls}
              aria-label="발급연도"
            >
              <option value="all">전체 연도</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}년
                </option>
              ))}
            </select>
            <span className="text-xs text-ink-hint">{rows.length}건</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setMsg(null);
              setOpen(true);
            }}
            className={btnPrimary}
          >
            경력증명서 발급
          </button>
        </div>

        {msg && (
          <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>
        )}
      </section>

      <section className={cardCls}>
        {rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-ink-hint">
            발급 기록이 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={thCls}>번호</th>
                  <th className={thCls}>종류</th>
                  <th className={thCls}>성명</th>
                  <th className={thCls}>용도</th>
                  <th className={thCls}>발급일</th>
                  <th className={thCls}>발급자</th>
                  <th className={`${thCls} text-right`}>재발급</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className={`${tdCls} font-mono text-xs`}>
                      {r.snapshot?.issueLabel ??
                        `제${r.issue_year}년-${String(r.issue_seq).padStart(2, "0")}호`}
                    </td>
                    <td className={tdCls}>
                      <span className={badgeNavy}>{CERT_TYPES[r.cert_type]}</span>
                    </td>
                    <td className={`${tdCls} font-medium text-ink`}>
                      {r.employee_name}
                    </td>
                    <td className={tdCls}>{r.purpose}</td>
                    <td className={`${tdCls} font-mono text-xs`}>
                      {r.issued_on ? formatIssuedDate(r.issued_on) : "-"}
                    </td>
                    <td className={tdCls}>
                      {r.issued_by === "수기발급(이관)" ? (
                        <span className={badgeNeutral}>수기발급(이관)</span>
                      ) : (
                        r.issued_by
                      )}
                    </td>
                    <td className={`${tdCls} text-right`}>
                      <button
                        type="button"
                        onClick={() => doReissue(r)}
                        disabled={pending && busyId === r.id}
                        className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface disabled:opacity-50"
                        title={
                          r.snapshot ? "" : "저장된 내용이 없어 재발급할 수 없습니다."
                        }
                      >
                        {pending && busyId === r.id ? "생성 중…" : "PDF 다시받기"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open && (
        <CareerModal
          employees={employees}
          onClose={() => setOpen(false)}
          onIssued={(text) => {
            setOpen(false);
            setMsg({ ok: true, text });
            router.refresh();
          }}
        />
      )}

      {rejectTarget && (
        <RejectModal
          req={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onRejected={(text) => {
            setRejectTarget(null);
            setMsg({ ok: true, text });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function RejectModal({
  req,
  onClose,
  onRejected,
}: {
  req: CertRequest;
  onClose: () => void;
  onRejected: (text: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    setErr(null);
    if (!reason.trim()) {
      setErr("반려 사유를 입력하세요.");
      return;
    }
    start(async () => {
      const res = await rejectRequest(req.id, reason);
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      onRejected(`${req.employee_name}님의 신청을 반려했습니다.`);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-card p-5 shadow-lg">
        <h3 className="mb-1 text-base font-bold text-ink">신청 반려</h3>
        <p className="mb-3 text-xs text-ink-muted">
          <b className="text-ink">{req.employee_name}</b>님의 재직증명서 신청을
          반려합니다. 사유는 신청자에게 표시됩니다.
        </p>
        <label className="block text-[11px] font-semibold text-navy">반려 사유</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={`${inCls} mt-1`}
          placeholder="예: 용도 재확인 필요"
          autoFocus
        />
        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex h-[38px] items-center rounded-lg border border-stamp bg-card px-4 text-sm font-semibold text-stamp hover:bg-stamp-soft disabled:opacity-60"
          >
            {pending ? "반려 중…" : "반려"}
          </button>
          <button type="button" onClick={onClose} className={btnSecondary}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

function CareerModal({
  employees,
  onClose,
  onIssued,
}: {
  employees: CertEmployee[];
  onClose: () => void;
  onIssued: (text: string) => void;
}) {
  const [driverId, setDriverId] = useState("");
  const [purpose, setPurpose] = useState("서류제출용");
  const [duty, setDuty] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const selected = employees.find((e) => e.driverId === driverId) ?? null;

  function onSelect(id: string) {
    setDriverId(id);
    const e = employees.find((x) => x.driverId === id);
    if (e) {
      setFrom(e.joinDate ?? "");
      setTo(e.resignationDate ?? ""); // 빈값 = 현재(재직자)
      setDuty(e.defaultDuty ?? "");
    }
  }

  // 기간 미리보기(범위만 — 정확한 년·개월은 발급 시 서버가 오늘 기준 계산).
  const periodPreview = from ? `${from} ~ ${periodToLabel(to || null)}` : "-";

  function submit() {
    setErr(null);
    if (!driverId) {
      setErr("직원을 선택하세요.");
      return;
    }
    start(async () => {
      const res = await issueCareerCertificate(driverId, {
        purpose,
        duty,
        from: from || null,
        to: to || null,
      });
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
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">경력증명서 발급</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:underline"
          >
            닫기
          </button>
        </div>

        <label className="block text-[11px] font-semibold text-navy">직원</label>
        <select
          value={driverId}
          onChange={(e) => onSelect(e.target.value)}
          className={`${inCls} mt-1`}
        >
          <option value="">직원 선택…</option>
          <optgroup label="퇴사자">
            {employees
              .filter((e) => e.status === "resigned")
              .map((e) => (
                <option key={e.driverId} value={e.driverId}>
                  {e.name}
                  {e.rank ? ` (${e.rank})` : ""} — 퇴사
                </option>
              ))}
          </optgroup>
          <optgroup label="재직자">
            {employees
              .filter((e) => e.status === "active")
              .map((e) => (
                <option key={e.driverId} value={e.driverId}>
                  {e.name}
                  {e.rank ? ` (${e.rank})` : ""}
                </option>
              ))}
          </optgroup>
        </select>

        {selected && (
          <p className="mt-2 text-[11px] text-ink-hint">
            근무기간(자동): {periodPreview}
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-navy">
              시작일
            </label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={`${inCls} mt-1`}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-navy">
              종료일 (비우면 “현재”)
            </label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={`${inCls} mt-1`}
            />
          </div>
        </div>

        <label className="mt-3 block text-[11px] font-semibold text-navy">
          직위 및 담당업무
        </label>
        <input
          value={duty}
          onChange={(e) => setDuty(e.target.value)}
          className={`${inCls} mt-1`}
          placeholder="예: 팀원 / 청소년활동 담당"
        />

        <label className="mt-3 block text-[11px] font-semibold text-navy">용도</label>
        <input
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          className={`${inCls} mt-1`}
          placeholder="서류제출용"
        />

        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending || !driverId}
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
