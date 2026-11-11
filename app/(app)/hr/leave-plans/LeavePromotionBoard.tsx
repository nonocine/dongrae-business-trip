"use client";

// =====================================================================
// 연차 사용촉진 — 직원별 단계 상태판(연도별).
//   미사용(ERP 연차 잔여) → 1차 촉구 → 사용계획(기존 계획서 연결) → 계획 대비 실제(ERP 연가)
//   → 2차 지정 통보 → 연말 소멸 예정. 단계마다 기한과 상태(완료/진행/기한 임박/기한 경과).
// =====================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  completePromotionNotice,
  createPromotionNotice,
  openPromotionFile,
  recordAuxDelivery,
  searchErpDocuments,
} from "@/app/(app)/hr/leave-plans/promotionActions";
import type { NoticeInfo, PromotionBoard, PromotionRow } from "@/lib/leavePromotionServer";
import {
  DELIVERY_GUIDE,
  DELIVERY_LABEL,
  STEP_LABEL,
  TRACK_LABEL,
  daysBetween,
  type PromotionStage,
  type StepState,
} from "@/lib/leavePromotion";
import { ERP_NOTE } from "@/lib/erp/duty";
import {
  badgeDanger,
  badgeNavy,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  btnPrimary,
  btnSecondary,
  cardCls,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

const fmt = (v: number | null | undefined) => (v == null ? "-" : Number.isInteger(v) ? String(v) : Number(v).toFixed(1));
const md = (ymd: string | null | undefined) => (ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}` : "-");
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "기록 없음";
const smBtn = "rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-body hover:bg-surface disabled:opacity-50";

const STATE_BADGE: Record<StepState | "na", string> = {
  done: badgeSuccess,
  waiting: badgeNeutral,
  progress: badgeNavy,
  soon: badgeWarning,
  overdue: badgeDanger,
  na: badgeNeutral,
};
function StateBadge({ state, due, today }: { state: StepState | "na"; due: string | null; today: string }) {
  const left = due ? daysBetween(today, due) : null;
  return (
    <span className={STATE_BADGE[state]} title={due ? `기한 ${due}` : undefined}>
      {state === "na" ? "해당 없음" : STEP_LABEL[state]}
      {state !== "done" && state !== "na" && left != null && (left >= 0 ? ` D-${left}` : ` +${-left}일`)}
    </span>
  );
}

export default function LeavePromotionBoard({ board }: { board: PromotionBoard }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [designating, setDesignating] = useState<PromotionRow | null>(null);
  const [completing, setCompleting] = useState<{ row: PromotionRow; notice: NoticeInfo } | null>(null);
  const year = board.year;
  const thisYear = Number(board.today.slice(0, 4));

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, okText: string) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) return setMsg({ ok: false, text: r.message ?? "실패했습니다." });
      setMsg({ ok: true, text: okText });
      router.refresh();
    });
  }
  function open(id: string, kind: "pdf" | "receipt") {
    start(async () => {
      const r = await openPromotionFile(id, kind);
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      window.open(r.url, "_blank", "noopener");
    });
  }
  function create(row: PromotionRow, stage: PromotionStage, dates?: string[]) {
    let unusedDays: number | null = null;
    if (row.unusedErp == null) {
      const v = prompt(`${row.name} — ERP 연차 잔여가 없습니다. 미사용 일수를 입력하세요.`);
      if (v == null) return;
      unusedDays = Number(v);
      if (!Number.isFinite(unusedDays) || unusedDays <= 0) return setMsg({ ok: false, text: "미사용 일수가 올바르지 않습니다." });
    }
    run(
      () => createPromotionNotice({ year, profileId: row.profileId, track: row.track, stage, designatedDates: dates, unusedDays }),
      `${row.name} ${stage === 1 ? "1차 촉구서" : "2차 지정 통보서"}를 만들었습니다. PDF 를 출력해 전달한 뒤 완료 처리하세요.`
    );
  }
  function aux(n: NoticeInfo) {
    const method = prompt("보조 안내 방식: app 또는 email 을 입력하세요.", "app");
    if (method !== "app" && method !== "email") return;
    const note = prompt("메모(선택)") ?? "";
    run(() => recordAuxDelivery(n.id, method, note), "보조 안내를 기록했습니다(완료 처리는 아닙니다).");
  }

  const counts = board.rows.reduce(
    (a, r) => {
      for (const s of [r.stage1State, r.planState, r.stage2State]) {
        if (s === "overdue") a.overdue++;
        else if (s === "soon") a.soon++;
      }
      return a;
    },
    { soon: 0, overdue: 0 }
  );

  const noticeCell = (row: PromotionRow, stage: PromotionStage) => {
    const n = stage === 1 ? row.stage1 : row.stage2;
    const state = stage === 1 ? row.stage1State : row.stage2State;
    const due = stage === 1 ? row.schedule.stage1.end : row.schedule.stage2Due;
    return (
      <div className="space-y-1">
        <StateBadge state={state} due={due} today={board.today} />
        <p className="text-[10px] text-ink-hint">
          {stage === 1 ? `법정 ${md(row.schedule.stage1.start)}~${md(row.schedule.stage1.end)}` : `기한 ${md(row.schedule.stage2Due)}`}
          {stage === 1 && row.schedule.stage1Later && ` · 추가분 ${md(row.schedule.stage1Later.start)}~${md(row.schedule.stage1Later.end)}`}
          {stage === 2 && row.schedule.stage2LaterDue && ` · 추가분 ${md(row.schedule.stage2LaterDue)}`}
        </p>
        {n && (
          <p className="text-[10px] text-ink-muted">
            {fmt(n.unusedDays)}일 박제{n.sentAt && ` · ${md(n.sentAt.slice(0, 10))} ${n.method ? DELIVERY_LABEL[n.method] : ""}`}
            {n.erpDocumentNumber != null && ` · ERP ${n.erpDocumentNumber}호`}
            {stage === 2 && n.designatedDates.length > 0 && ` · 지정 ${n.designatedDates.map(md).join(",")}`}
          </p>
        )}
        {n?.memo && <p className="whitespace-pre-line text-[10px] text-ink-hint">{n.memo}</p>}
        {state !== "na" && (
          <div className="flex flex-wrap gap-1">
            {!n?.completed && (
              <button
                type="button"
                className={smBtn}
                disabled={pending}
                onClick={() => (stage === 1 ? create(row, 1) : setDesignating(row))}
              >
                {n ? "다시 만들기" : stage === 1 ? "1차 촉구서 만들기" : "2차 지정 통보서 만들기"}
              </button>
            )}
            {n?.hasPdf && (
              <button type="button" className={smBtn} disabled={pending} onClick={() => open(n.id, "pdf")}>
                PDF
              </button>
            )}
            {n && !n.completed && (
              <>
                <button type="button" className={`${smBtn} border-navy text-navy`} onClick={() => setCompleting({ row, notice: n })}>
                  완료 처리
                </button>
                <button type="button" className={smBtn} disabled={pending} onClick={() => aux(n)}>
                  보조 안내 기록
                </button>
              </>
            )}
            {n?.hasReceipt && (
              <button type="button" className={smBtn} disabled={pending} onClick={() => open(n.id, "receipt")}>
                수령본
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-bold text-ink">사용촉진 진행 현황</h3>
        <select
          value={year}
          onChange={(e) => router.push(`/hr/leave-plans?year=${e.target.value}`)}
          className="rounded-md border border-line bg-card px-2 py-1 text-sm"
          aria-label="연도"
        >
          {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-muted">
          대상 {board.rows.length}건 · 기한 임박 <b className="text-warning">{counts.soon}</b> · 기한 경과{" "}
          <b className="text-stamp">{counts.overdue}</b>
        </span>
        <span className="ml-auto flex gap-1">
          <a href={`/hr/leave-plans/promotion-report?year=${year}&format=xlsx`} className={btnSecondary}>
            이행 현황 엑셀
          </a>
          <a href={`/hr/leave-plans/promotion-report?year=${year}&format=pdf`} className={btnSecondary}>
            이행 현황 PDF
          </a>
        </span>
      </div>
      <p className="mt-2 text-xs text-ink-hint">
        근거: 근로기준법 제61조, 취업규칙 제28조⑤(회계연도 기준)·제29조. {DELIVERY_GUIDE}
      </p>
      {msg && <p className={`mt-2 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-navy">
              <th className="px-2 py-2 font-semibold">직원</th>
              <th className="px-2 py-2 text-right font-semibold">미사용(ERP)</th>
              <th className="px-2 py-2 font-semibold">1차 촉구</th>
              <th className="px-2 py-2 font-semibold">사용계획(회신 10일)</th>
              <th className="px-2 py-2 font-semibold">계획 대비 실제</th>
              <th className="px-2 py-2 font-semibold">2차 지정 통보</th>
              <th className="px-2 py-2 text-right font-semibold">소멸 예정</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((r) => (
              <tr key={r.key} className={`border-b border-line/60 align-top ${r.payoutPolicy ? "bg-surface/70 text-ink-hint opacity-70" : ""}`}>
                <td className="px-2 py-2">
                  <p className="font-medium text-ink">{r.name}</p>
                  <p className="text-[11px] text-ink-muted">
                    {r.department ?? "-"} · <span className={r.track === "first_year" ? "text-warning" : ""}>{TRACK_LABEL[r.track]}</span>
                    {r.track === "first_year" && r.joinDate && ` (입사 ${r.joinDate})`}
                  </p>
                  {!r.erpLinked && <p className="text-[10px] text-stamp">ERP 계정 미연결</p>}
                  {r.payoutPolicy && (
                    <p className="mt-0.5 text-[10px] font-semibold text-ink-muted">수당 정산 방식 — 촉진 대상 아님</p>
                  )}
                </td>
                <td className="px-2 py-2 text-right font-mono">{fmt(r.unusedErp)}</td>
                <td className="px-2 py-2">
                  {noticeCell(r, 1)}
                </td>
                <td className="px-2 py-2">
                  <StateBadge state={r.planState} due={r.planDue} today={board.today} />
                  <p className="mt-1 text-[10px] text-ink-muted">
                    {r.plan
                      ? r.plan.submittedAt
                        ? `제출 ${md(r.plan.submittedAt.slice(0, 10))} · ${fmt(r.plan.totalDays)}일`
                        : "계획서 발부됨(미제출)"
                      : "계획서 없음"}
                    {r.planDue && ` · 회신기한 ${md(r.planDue)}`}
                  </p>
                </td>
                <td className="px-2 py-2 text-xs">
                  {!r.plan?.entries.length ? (
                    <span className="text-ink-hint">-</span>
                  ) : r.missedDates.length === 0 ? (
                    <span className="text-success">계획대로 사용</span>
                  ) : (
                    <span className="text-stamp" title="계획했는데 ERP 연가 기록이 없는 지난 날">
                      미사용 {r.missedDates.length}일: {r.missedDates.map(md).join(", ")}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2">
                  {noticeCell(r, 2)}
                </td>
                <td className="px-2 py-2 text-right">
                  <span className={`font-mono ${(r.forfeitDays ?? 0) > 0 ? "text-stamp" : ""}`}>{fmt(r.forfeitDays)}</span>
                  <p className="text-[10px] text-ink-hint">{md(r.schedule.periodEnd)}까지 안 쓰면</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-ink-hint">
        미사용·소멸 예정은 현재 ERP 연차 잔여, 실제 사용은 ERP 연가(결재 진행·완료) 기준 · {ERP_NOTE} · 잔여 동기화 {when(board.syncedLeave)} · 복무 동기화{" "}
        {when(board.syncedDuties)}
      </p>

      {designating && (
        <DesignateDialog
          row={designating}
          pending={pending}
          onClose={() => setDesignating(null)}
          onSubmit={(dates) => {
            const row = designating;
            setDesignating(null);
            create(row, 2, dates);
          }}
        />
      )}
      {completing && (
        <CompleteDialog
          row={completing.row}
          notice={completing.notice}
          today={board.today}
          onClose={() => setCompleting(null)}
          onDone={(text) => {
            setCompleting(null);
            setMsg({ ok: true, text });
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function DesignateDialog({
  row,
  pending,
  onClose,
  onSubmit,
}: {
  row: PromotionRow;
  pending: boolean;
  onClose: () => void;
  onSubmit: (dates: string[]) => void;
}) {
  const need = Math.max(1, Math.ceil(row.unusedErp ?? 1));
  const [dates, setDates] = useState<string[]>(row.stage2?.designatedDates.length ? row.stage2.designatedDates : Array(need).fill(""));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-card p-5 shadow-lg">
        <h3 className="text-base font-bold text-ink">2차 지정 통보서 — 사용일 지정</h3>
        <p className="mt-1 text-xs text-ink-muted">
          {row.name} · 미사용 {fmt(row.unusedErp)}일 · 사용기한 {row.schedule.periodEnd}. 지정할 날짜를 고르세요.
        </p>
        <ul className="mt-3 space-y-1.5">
          {dates.map((d, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                type="date"
                value={d}
                max={row.schedule.periodEnd}
                onChange={(e) => setDates((cur) => cur.map((x, k) => (k === i ? e.target.value : x)))}
                className="rounded-md border border-line bg-card px-2 py-1 text-sm"
              />
              <button type="button" className="text-xs text-stamp hover:underline" onClick={() => setDates((cur) => cur.filter((_, k) => k !== i))}>
                삭제
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="mt-2 text-xs text-navy hover:underline" onClick={() => setDates((cur) => [...cur, ""])}>
          + 날짜 추가
        </button>
        <div className="mt-4 flex gap-2">
          <button type="button" className={btnPrimary} disabled={pending || !dates.some(Boolean)} onClick={() => onSubmit(dates.filter(Boolean))}>
            통보서 만들기
          </button>
          <button type="button" className={btnSecondary} onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

function CompleteDialog({
  row,
  notice,
  today,
  onClose,
  onDone,
}: {
  row: PromotionRow;
  notice: NoticeInfo;
  today: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [method, setMethod] = useState<"paper" | "erp">("paper");
  const [sentDate, setSentDate] = useState(today);
  const [file, setFile] = useState<File | null>(null);
  const [q, setQ] = useState("");
  const [docs, setDocs] = useState<Awaited<ReturnType<typeof searchErpDocuments>>>([]);
  const [docId, setDocId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = notice.stage === 1 ? "1차 촉구서" : "2차 지정 통보서";

  function submit() {
    setErr(null);
    const fd = new FormData();
    fd.set("id", notice.id);
    fd.set("method", method);
    fd.set("sent_date", sentDate);
    if (method === "paper") {
      if (!file) return setErr("서명 수령본 스캔 파일을 올리세요.");
      fd.set("file", file);
    } else {
      if (!docId) return setErr("연결할 ERP 문서를 고르세요.");
      fd.set("erp_document_id", docId);
    }
    start(async () => {
      const r = await completePromotionNotice(fd);
      if (!r.ok) return setErr(r.message);
      onDone(`${row.name} ${label}를 완료 처리했습니다(${method === "paper" ? "종이 서명 수령" : "ERP 전자결재"}).`);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-card p-5 shadow-lg">
        <h3 className="text-base font-bold text-ink">
          {label} 완료 처리 <span className="text-sm font-normal text-ink-muted">{row.name}</span>
        </h3>
        <p className={`mt-2 ${noticeWarning}`}>{DELIVERY_GUIDE}</p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          {(["paper", "erp"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1.5">
              <input type="radio" checked={method === m} onChange={() => setMethod(m)} />
              {DELIVERY_LABEL[m]}
            </label>
          ))}
        </div>
        <label className="mt-3 block text-xs font-semibold text-navy">
          {method === "paper" ? "수령(서명)일" : "ERP 시행일"}
          <input type="date" value={sentDate} onChange={(e) => setSentDate(e.target.value)} className="ml-2 rounded-md border border-line bg-card px-2 py-1 text-sm" />
        </label>
        {method === "paper" ? (
          <div className="mt-3">
            <p className="text-xs text-ink-muted">직원이 서명한 수령본을 스캔(PDF·사진)해 올리세요. 올려야 완료됩니다.</p>
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block text-sm" />
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-xs text-ink-muted">ERP 전자결재로 시행한 문서를 찾아 연결하세요(문서번호 또는 제목).</p>
            <div className="mt-1 flex gap-1">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 1234 또는 연차" className="flex-1 rounded-md border border-line bg-card px-2 py-1 text-sm" />
              <button
                type="button"
                className={btnSecondary}
                disabled={pending || !q.trim()}
                onClick={() => start(async () => setDocs(await searchErpDocuments(q)))}
              >
                찾기
              </button>
            </div>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {docs.map((d) => (
                <li key={d.id}>
                  <label className="flex items-start gap-1.5 text-xs">
                    <input type="radio" checked={docId === String(d.id)} onChange={() => setDocId(String(d.id))} />
                    <span>
                      <b>{d.number ?? "-"}호</b> {d.title} <span className="text-ink-hint">{d.registeredAt?.slice(0, 10)} · {d.status ?? ""}</span>
                    </span>
                  </label>
                </li>
              ))}
              {docs.length === 0 && <li className="text-[11px] text-ink-hint">검색 결과가 여기에 나옵니다.</li>}
            </ul>
          </div>
        )}
        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" className={btnPrimary} disabled={pending} onClick={submit}>
            {pending ? "처리 중…" : "완료 처리"}
          </button>
          <button type="button" className={btnSecondary} onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
