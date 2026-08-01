"use client";

// =====================================================================
// 연차 사용촉진 담당자 화면 — LP-1 발부 / LP-3 현황·독촉·출력
//   * 권한은 서버(resolveSalaryAccess/requireSalaryAccess)가 판정한다.
//     화면은 M0 여부로 표기만 나눈다.
// =====================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getLeavePlanOverview,
  issueLeavePlans,
  revokeLeavePlan,
  unsubmitLeavePlan,
  remindLeavePlans,
  buildLeavePlanPdfFor,
  buildLeavePlanBundle,
  type LeavePlanOverview,
  type LeavePlanRow,
  type IssueTarget,
} from "@/app/hr/leave-plans/actions";
import { formatDays, formatPeriod, roundHalf, planMismatch } from "@/lib/leavePlan";
import { fmtKstDateTime } from "@/lib/datetime";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  badgeSuccess,
  badgeNeutral,
  badgeWarning,
  badgeDanger,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const selCls =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body";

// 엑셀 서식 출력(라우트) — employeeId 없으면 그 연도 전체(직원당 1시트).
const EXCEL_HREF = (year: number, employeeId?: string) =>
  `/hr/leave-plans/excel?year=${year}${employeeId ? `&employeeId=${employeeId}` : ""}`;

// base64 PDF → 브라우저에서 볼 수 있는 blob URL (증명서 패턴).
function pdfObjectUrl(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}
function downloadUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

// LP-5/LP-6. 미리보기 대상.
type PdfPreview = {
  url: string;
  filename: string;
  title: string;
  note: string | null;
};

export default function LeavePlansManager({
  initial,
}: {
  initial: LeavePlanOverview;
}) {
  const router = useRouter();
  const [data, setData] = useState<LeavePlanOverview>(initial);
  const [issueOpen, setIssueOpen] = useState(false);
  const [detail, setDetail] = useState<LeavePlanRow | null>(null);
  const [pdf, setPdf] = useState<PdfPreview | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  // 미리보기를 닫을 때 blob URL 을 해제한다(메모리 누수 방지).
  function closePdf() {
    setPdf((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }

  // LP-5. 직원 1명 날인 PDF — 미리보기부터 띄운다.
  function openPdf(row: LeavePlanRow) {
    setMsg(null);
    start(async () => {
      const res = await buildLeavePlanPdfFor({
        year: data.year,
        employeeId: row.employee_id,
      });
      if (!res.ok) return setMsg({ ok: false, text: res.message });
      setPdf({
        url: pdfObjectUrl(res.pdfBase64),
        filename: res.filename,
        title: `${row.name} · ${data.year}년 사용계획서 (날인본)`,
        note: res.hasStamp
          ? null
          : `${row.name} 님의 도장 이미지가 등록되어 있지 않아 서명란이 비어 있습니다. (마이페이지 → 내 정보에서 등록)`,
      });
    });
  }

  // LP-6. 제출 완료자 전원 합본.
  function openBundle() {
    setMsg(null);
    start(async () => {
      const res = await buildLeavePlanBundle(data.year);
      if (!res.ok) return setMsg({ ok: false, text: res.message });
      setPdf({
        url: pdfObjectUrl(res.pdfBase64),
        filename: res.filename,
        title: `${data.year}년 전체 날인본 (표지 + ${res.included}명, ${res.pages}면)`,
        note:
          res.withoutStamp.length > 0
            ? `도장 미등록 ${res.withoutStamp.length}명(${res.withoutStamp.join(
                ", "
              )})은 서명란이 비어 있습니다.`
            : null,
      });
    });
  }

  async function reload(year = data.year) {
    setData(await getLeavePlanOverview(year));
  }

  function changeYear(next: number) {
    setMsg(null);
    start(async () => {
      setData(await getLeavePlanOverview(next));
    });
  }

  function run(
    fn: () => Promise<{ ok: true } | { ok: false; message: string }>,
    okText: string,
    confirmText?: string
  ) {
    if (confirmText && !confirm(confirmText)) return;
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) return setMsg({ ok: false, text: res.message });
      setMsg({ ok: true, text: okText });
      setDetail(null);
      await reload();
      router.refresh();
    });
  }

  function doRemind() {
    if (data.pendingNames.length === 0) return;
    if (
      !confirm(
        `미제출 ${data.pendingNames.length}명(${data.pendingNames.join(", ")})에게 슬랙 DM으로 독촉할까요?`
      )
    )
      return;
    setMsg(null);
    start(async () => {
      const res = await remindLeavePlans(data.year);
      if (!res.ok) return setMsg({ ok: false, text: res.message });
      const tail =
        res.dmFailed.length > 0
          ? ` (슬랙 미연결·실패 ${res.dmFailed.length}명: ${res.dmFailed.join(", ")})`
          : "";
      setMsg({
        ok: true,
        text: `${res.targets}명 중 ${res.dmSent}명에게 DM을 보냈습니다.${tail}`,
      });
    });
  }

  const rate =
    data.issuedCount > 0
      ? Math.round((data.submittedCount / data.issuedCount) * 100)
      : null;
  const notIssued = data.roster.filter(
    (e) => !data.rows.some((r) => r.employee_id === e.driver_id)
  );

  return (
    <div className="space-y-5">
      {/* 연도 + 액션 */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={data.year}
            onChange={(e) => changeYear(Number(e.target.value))}
            className={selCls}
            aria-label="연도"
          >
            {data.years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setMsg(null);
                setIssueOpen(true);
              }}
              className={btnPrimary}
              disabled={pending}
            >
              계획서 발부
            </button>
            <button
              type="button"
              onClick={doRemind}
              className={btnSecondary}
              disabled={pending || data.pendingNames.length === 0}
              title={
                data.pendingNames.length === 0
                  ? "미제출자가 없습니다."
                  : "미제출자에게 슬랙 DM 일괄 발송"
              }
            >
              미제출 독촉 ({data.pendingNames.length})
            </button>
            {data.submittedCount > 0 && (
              <button
                type="button"
                onClick={openBundle}
                disabled={pending}
                className={btnPrimary}
                title="제출 완료자 전원의 날인 PDF를 한 파일로(표지 + 1인 1면)"
              >
                전체 날인본 다운로드 ({data.submittedCount})
              </button>
            )}
            {data.issuedCount > 0 && (
              <a
                href={EXCEL_HREF(data.year)}
                className={btnSecondary}
                title="발부된 전원의 서식을 엑셀 한 파일로(직원당 1시트)"
              >
                엑셀(전체)
              </a>
            )}
          </div>
        </div>

        {/* 현황 요약 */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="발부" value={`${data.issuedCount}명`} />
          <Stat
            label="제출"
            value={
              rate == null
                ? "-"
                : `${data.submittedCount}명 (${rate}%)`
            }
          />
          <Stat
            label="미제출"
            value={`${data.pendingNames.length}명`}
            tone={data.pendingNames.length > 0 ? "danger" : undefined}
          />
        </div>
        {data.pendingNames.length > 0 && (
          <p className="mt-2 text-xs text-stamp">
            미제출: {data.pendingNames.join(", ")}
          </p>
        )}
        {notIssued.length > 0 && (
          <p className="mt-1.5 text-xs text-ink-hint">
            미발부 재직자 {notIssued.length}명: {notIssued.map((e) => e.name).join(", ")}
          </p>
        )}
      </section>

      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}

      {/* 발부 목록 */}
      <section className={cardCls}>
        <h3 className="mb-3 text-sm font-bold text-ink">
          {data.year}년 발부 현황
        </h3>
        {data.rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-hint">
            발부된 계획서가 없습니다. [계획서 발부]로 시작하세요.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={thCls}>직원</th>
                  <th className={thCls}>부서</th>
                  <th className={`${thCls} text-right`}>미사용</th>
                  <th className={thCls}>잔여기간</th>
                  <th className={thCls}>상태</th>
                  <th className={`${thCls} text-right`}>계획 합계</th>
                  <th className={thCls}>제출일시</th>
                  <th className={`${thCls} text-right`}>관리</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const submitted = r.submitted_at != null;
                  const mismatch =
                    submitted &&
                    planMismatch(r.total_days ?? 0, r.unused_days);
                  return (
                    <tr
                      key={r.id}
                      className={`border-b border-line/60 ${
                        submitted ? "" : "bg-stamp-soft/30"
                      }`}
                    >
                      <td
                        className={`${tdCls} font-medium ${
                          submitted ? "text-ink" : "text-stamp"
                        }`}
                      >
                        {r.name}
                      </td>
                      <td className={tdCls}>{r.department ?? "-"}</td>
                      <td className={`${tdCls} text-right font-mono`}>
                        {formatDays(r.unused_days)}일
                      </td>
                      <td className={`${tdCls} whitespace-nowrap text-xs`}>
                        {formatPeriod(r.period_start, r.period_end)}
                      </td>
                      <td className={tdCls}>
                        {submitted ? (
                          <span className={badgeSuccess}>제출</span>
                        ) : (
                          <span className={badgeDanger}>미제출</span>
                        )}
                        {mismatch && (
                          <span
                            className={`ml-1 ${badgeWarning}`}
                            title="계획 합계가 미사용 일수와 다릅니다."
                          >
                            합계 불일치
                          </span>
                        )}
                      </td>
                      <td className={`${tdCls} text-right font-mono`}>
                        {r.total_days == null ? "-" : `${formatDays(r.total_days)}일`}
                      </td>
                      <td className={`${tdCls} whitespace-nowrap text-xs`}>
                        {r.submitted_at ? fmtKstDateTime(r.submitted_at) : "-"}
                      </td>
                      <td className={`${tdCls} text-right`}>
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setDetail(r)}
                            className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface"
                          >
                            보기
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => openPdf(r)}
                            className="rounded border border-navy px-2 py-1 text-xs font-semibold text-navy hover:bg-navy-soft"
                            title="날인 PDF 미리보기 → 다운로드"
                          >
                            PDF
                          </button>
                          <a
                            href={EXCEL_HREF(data.year, r.employee_id)}
                            className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface"
                          >
                            엑셀
                          </a>
                          {submitted ? (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                run(
                                  () => unsubmitLeavePlan(r.id),
                                  `${r.name}의 제출을 취소했습니다. 직원이 다시 수정할 수 있습니다.`,
                                  `${r.name}의 제출을 취소할까요? 직원이 계획을 다시 고칠 수 있게 됩니다.`
                                )
                              }
                              className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface"
                            >
                              제출 취소
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                run(
                                  () => revokeLeavePlan(r.id),
                                  `${r.name}의 계획서를 회수했습니다.`,
                                  `${r.name}에게 발부한 계획서를 회수(삭제)할까요?`
                                )
                              }
                              className="rounded border border-stamp px-2 py-1 text-xs text-stamp hover:bg-stamp-soft"
                            >
                              회수
                            </button>
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
      </section>

      {issueOpen && (
        <IssueModal
          overview={data}
          onClose={() => setIssueOpen(false)}
          onDone={async (text) => {
            setIssueOpen(false);
            setMsg({ ok: true, text });
            await reload();
            router.refresh();
          }}
        />
      )}

      {detail && (
        <PlanDetailModal
          row={detail}
          onClose={() => setDetail(null)}
          onPdf={() => {
            const row = detail;
            setDetail(null);
            openPdf(row);
          }}
        />
      )}

      {/* LP-5/LP-6. 다운로드 전 브라우저 미리보기(증명서 패턴) */}
      {pdf && (
        <PdfPreviewModal
          preview={pdf}
          onClose={closePdf}
          onDownload={() => downloadUrl(pdf.url, pdf.filename)}
        />
      )}
    </div>
  );
}

// 미리보기 모달 — iframe 으로 PDF 를 띄우고, 확인 후 다운로드/새 창.
function PdfPreviewModal({
  preview,
  onClose,
  onDownload,
}: {
  preview: PdfPreview;
  onClose: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-4 w-full max-w-3xl rounded-xl border border-line bg-card p-4 shadow-lg">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-ink">{preview.title}</h3>
          <div className="flex flex-wrap gap-2">
            <a
              href={preview.url}
              target="_blank"
              rel="noreferrer"
              className="self-center text-xs font-semibold text-navy hover:underline"
            >
              새 창 ↗
            </a>
            <button type="button" onClick={onDownload} className={btnPrimary}>
              다운로드
            </button>
            <button type="button" onClick={onClose} className={btnSecondary}>
              닫기
            </button>
          </div>
        </div>
        {preview.note && (
          <p className={`mb-2 ${noticeWarning}`}>{preview.note}</p>
        )}
        <iframe
          src={preview.url}
          title={preview.title}
          className="h-[70vh] w-full rounded-lg border border-line bg-white"
        />
        <p className="mt-2 text-[11px] text-ink-hint">
          제출자의 도장 이미지(마이페이지 등록분)가 서명란에 자동 합성됩니다.
          미등록이면 빈칸으로 출력되니 인쇄 후 손도장을 받으세요.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger";
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        tone === "danger"
          ? "border-stamp/40 bg-stamp-soft"
          : "border-line bg-surface/60"
      }`}
    >
      <p className="text-[11px] text-ink-muted">{label}</p>
      <p
        className={`mt-0.5 font-mono text-base font-bold ${
          tone === "danger" ? "text-stamp" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// =====================================================================
// LP-1. 발부 모달 — 공통 기본값(미사용 일수·잔여기간)을 넣고 개별 수정.
// =====================================================================
type Draft = { checked: boolean; days: string; start: string; end: string };

function IssueModal({
  overview,
  onClose,
  onDone,
}: {
  overview: LeavePlanOverview;
  onClose: () => void;
  onDone: (text: string) => void | Promise<void>;
}) {
  const issuedById = new Map(overview.rows.map((r) => [r.employee_id, r]));
  const year = overview.year;

  // 공통 기본값 — 잔여기간은 보통 그 해 말까지.
  const [baseDays, setBaseDays] = useState("");
  const [baseStart, setBaseStart] = useState(`${year}-01-01`);
  const [baseEnd, setBaseEnd] = useState(`${year}-12-31`);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const init: Record<string, Draft> = {};
    for (const e of overview.roster) {
      const prev = issuedById.get(e.driver_id);
      init[e.driver_id] = {
        checked: false,
        days: prev ? formatDays(prev.unused_days) : "",
        start: prev?.period_start ?? `${year}-01-01`,
        end: prev?.period_end ?? `${year}-12-31`,
      };
    }
    return init;
  });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const setDraft = (id: string, p: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));

  // 공통값 일괄 적용 — 체크된 대상(없으면 전원)에 덮어쓴다.
  function applyBase() {
    const ids = Object.entries(drafts)
      .filter(([, d]) => d.checked)
      .map(([id]) => id);
    const targets = ids.length ? ids : overview.roster.map((e) => e.driver_id);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const id of targets) {
        next[id] = {
          ...next[id],
          days: baseDays.trim() ? baseDays.trim() : next[id].days,
          start: baseStart,
          end: baseEnd,
        };
      }
      return next;
    });
  }

  // 제출된 건은 발부 대상에서 제외(서버도 건너뛴다).
  const selectable = overview.roster.filter(
    (e) => !issuedById.get(e.driver_id)?.submitted_at
  );
  function toggleAll(on: boolean) {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const e of selectable) next[e.driver_id] = { ...next[e.driver_id], checked: on };
      return next;
    });
  }

  const chosen = overview.roster.filter((e) => drafts[e.driver_id]?.checked);

  function submit() {
    setErr(null);
    if (chosen.length === 0) {
      setErr("발부할 직원을 선택하세요.");
      return;
    }
    const targets: IssueTarget[] = [];
    for (const e of chosen) {
      const d = drafts[e.driver_id];
      const days = roundHalf(Number(d.days));
      if (!d.days.trim() || days <= 0) {
        setErr(`${e.name}의 미사용 일수를 입력하세요. (0.5 단위)`);
        return;
      }
      if (d.start && d.end && d.start > d.end) {
        setErr(`${e.name}의 잔여기간이 올바르지 않습니다.`);
        return;
      }
      targets.push({
        employeeId: e.driver_id,
        unusedDays: days,
        periodStart: d.start || null,
        periodEnd: d.end || null,
      });
    }

    start(async () => {
      const res = await issueLeavePlans({ year, targets });
      if (!res.ok) return setErr(res.message);
      const parts: string[] = [];
      if (res.issued > 0) parts.push(`신규 ${res.issued}명`);
      if (res.updated > 0) parts.push(`수정 ${res.updated}명`);
      if (res.skipped.length > 0)
        parts.push(`제출됨 건너뜀 ${res.skipped.length}명(${res.skipped.join(", ")})`);
      parts.push(`슬랙 DM ${res.dmSent}건`);
      if (res.dmFailed.length > 0)
        parts.push(`DM 미연결 ${res.dmFailed.length}명(${res.dmFailed.join(", ")})`);
      await onDone(`${year}년 계획서를 발부했습니다. (${parts.join(" · ")})`);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-4 w-full max-w-3xl rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">
            {year}년 계획서 발부
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:underline"
          >
            닫기
          </button>
        </div>
        <p className="mb-3 text-xs text-ink-hint">
          공통 기본값을 넣고 [일괄 적용] 후, 사람마다 다른 값만 고치면 됩니다. 발부
          시 대상 직원에게 슬랙 DM으로 작성 요청을 보냅니다(미연결이어도 발부는
          진행됩니다).
        </p>

        {/* 공통 기본값 */}
        <div className="rounded-lg border border-navy/30 bg-navy-soft/20 p-3">
          <p className="mb-2 text-[11px] font-bold text-navy">공통 기본값</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <label className="block">
              <span className="block text-[11px] font-semibold text-navy">
                미사용 일수
              </span>
              <input
                type="number"
                step="0.5"
                min="0"
                value={baseDays}
                onChange={(e) => setBaseDays(e.target.value)}
                placeholder="예: 5"
                className={`${inCls} mt-1`}
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-navy">
                잔여기간 시작
              </span>
              <input
                type="date"
                value={baseStart}
                onChange={(e) => setBaseStart(e.target.value)}
                className={`${inCls} mt-1`}
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-navy">
                잔여기간 종료
              </span>
              <input
                type="date"
                value={baseEnd}
                onChange={(e) => setBaseEnd(e.target.value)}
                className={`${inCls} mt-1`}
              />
            </label>
            <div className="flex items-end">
              <button type="button" onClick={applyBase} className={btnSecondary}>
                일괄 적용
              </button>
            </div>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-hint">
            체크한 직원에게만 적용됩니다(아무도 체크하지 않으면 전원).
          </p>
        </div>

        {/* 직원 목록 */}
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-ink-muted">
            재직자 {overview.roster.length}명 · 선택 {chosen.length}명
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => toggleAll(true)}
              className="text-xs font-semibold text-navy hover:underline"
            >
              전체 선택
            </button>
            <button
              type="button"
              onClick={() => toggleAll(false)}
              className="text-xs font-semibold text-ink-muted hover:underline"
            >
              해제
            </button>
          </div>
        </div>

        <div className="mt-2 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[620px] border-collapse">
            <thead className="bg-surface">
              <tr>
                <th className={`${thCls} w-8`}></th>
                <th className={thCls}>직원</th>
                <th className={thCls}>발부 상태</th>
                <th className={thCls}>미사용 일수</th>
                <th className={thCls}>잔여기간</th>
              </tr>
            </thead>
            <tbody>
              {overview.roster.map((e) => {
                const d = drafts[e.driver_id];
                const prev = issuedById.get(e.driver_id);
                const locked = prev?.submitted_at != null;
                return (
                  <tr key={e.driver_id} className="border-t border-line/60">
                    <td className={tdCls}>
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        disabled={locked}
                        checked={d?.checked ?? false}
                        onChange={(ev) =>
                          setDraft(e.driver_id, { checked: ev.target.checked })
                        }
                      />
                    </td>
                    <td className={`${tdCls} font-medium text-ink`}>
                      {e.name}
                      {!e.email && (
                        <span
                          className={`ml-1.5 ${badgeNeutral}`}
                          title="이메일이 없어 슬랙 DM을 보낼 수 없습니다."
                        >
                          이메일 없음
                        </span>
                      )}
                    </td>
                    <td className={tdCls}>
                      {locked ? (
                        <span className={badgeSuccess} title="제출된 계획서는 덮어쓰지 않습니다.">
                          제출됨
                        </span>
                      ) : prev ? (
                        <span className={badgeWarning}>발부됨(미제출)</span>
                      ) : (
                        <span className={badgeNeutral}>미발부</span>
                      )}
                    </td>
                    <td className={tdCls}>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        disabled={locked}
                        value={d?.days ?? ""}
                        onChange={(ev) =>
                          setDraft(e.driver_id, { days: ev.target.value })
                        }
                        className="w-24 rounded-md border border-line bg-card px-2 py-1 text-sm disabled:bg-surface"
                      />
                    </td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-1">
                        <input
                          type="date"
                          disabled={locked}
                          value={d?.start ?? ""}
                          onChange={(ev) =>
                            setDraft(e.driver_id, { start: ev.target.value })
                          }
                          className="rounded-md border border-line bg-card px-1.5 py-1 text-xs disabled:bg-surface"
                        />
                        <span className="text-ink-hint">~</span>
                        <input
                          type="date"
                          disabled={locked}
                          value={d?.end ?? ""}
                          onChange={(ev) =>
                            setDraft(e.driver_id, { end: ev.target.value })
                          }
                          className="rounded-md border border-line bg-card px-1.5 py-1 text-xs disabled:bg-surface"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {overview.rows.some((r) => r.submitted_at != null) && (
          <p className={`mt-3 ${noticeWarning}`}>
            이미 제출된 계획서는 선택할 수 없습니다. 값을 바꿔야 하면 목록에서
            [제출 취소] 후 다시 발부하세요.
          </p>
        )}

        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending || chosen.length === 0}
            className={btnPrimary}
          >
            {pending ? "발부 중…" : `발부 (${chosen.length}명)`}
          </button>
          <button type="button" onClick={onClose} className={btnSecondary}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

// 제출 내용 확인 모달(읽기 전용).
function PlanDetailModal({
  row,
  onClose,
  onPdf,
}: {
  row: LeavePlanRow;
  onClose: () => void;
  onPdf: () => void;
}) {
  const total = row.total_days ?? 0;
  const mismatch = row.submitted_at != null && planMismatch(total, row.unused_days);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">
            {row.name} · {row.year}년 사용계획서
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:underline"
          >
            닫기
          </button>
        </div>
        <p className="text-sm text-ink-muted">
          {row.department ?? "-"} · 미사용 {formatDays(row.unused_days)}일 · 잔여기간{" "}
          {formatPeriod(row.period_start, row.period_end)}
        </p>
        <p className="mt-0.5 text-xs text-ink-hint">
          {row.submitted_at
            ? `제출 ${fmtKstDateTime(row.submitted_at)}`
            : "아직 제출되지 않았습니다."}
          {row.issued_by ? ` · 발부자 ${row.issued_by}` : ""}
        </p>

        {mismatch && (
          <p className={`mt-3 ${noticeWarning}`}>
            계획 합계({formatDays(total)}일)가 미사용 일수(
            {formatDays(row.unused_days)}일)와 다릅니다.
          </p>
        )}

        {row.plan.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-hint">
            입력된 계획이 없습니다.
          </p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg border border-line">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-surface">
                <tr>
                  <th className={`${thCls} w-10 text-right`}>#</th>
                  <th className={thCls}>날짜</th>
                  <th className={`${thCls} text-right`}>기간(일)</th>
                </tr>
              </thead>
              <tbody>
                {row.plan.map((p, i) => (
                  <tr key={`${p.date}-${i}`} className="border-t border-line/60">
                    <td className={`${tdCls} text-right text-xs text-ink-hint`}>
                      {i + 1}
                    </td>
                    <td className={`${tdCls} font-mono`}>{p.date}</td>
                    <td className={`${tdCls} text-right font-mono`}>
                      {formatDays(p.days)}일
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-line bg-surface font-semibold">
                  <td className={tdCls} colSpan={2}>
                    합계
                  </td>
                  <td className={`${tdCls} text-right font-mono text-navy`}>
                    {formatDays(total)}일
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={onPdf} className={btnPrimary}>
            날인 PDF 미리보기
          </button>
          <a
            href={EXCEL_HREF(row.year, row.employee_id)}
            className={btnSecondary}
          >
            엑셀 서식
          </a>
          <button type="button" onClick={onClose} className={btnSecondary}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
