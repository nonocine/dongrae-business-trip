"use client";

// =====================================================================
// 연차 사용촉진 — 직원별 단계 상태판(연도별).
//   미사용(ERP 연차 잔여) → 1차 촉구 → 사용계획(기존 계획서 연결) → 계획 대비 실제(ERP 연가)
//   → 2차 지정 통보 → 연말 소멸 예정. 단계마다 기한과 상태(완료/진행/기한 임박/기한 경과).
// =====================================================================

import { useState, useTransition } from "react";
import Link from "next/link";
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

  // --- 보기 상태 ---
  const [view, setView] = useState<"cards" | "table">("cards");
  const [filter, setFilter] = useState<"all" | "action" | "done" | "first">("all");
  const [openMissed, setOpenMissed] = useState<Set<string>>(new Set());

  const statesOf = (r: PromotionRow) => [r.stage1State, r.planState, r.stage2State];
  const isComplete = (r: PromotionRow) => statesOf(r).every((s) => s === "done" || s === "na");
  const hasOverdue = (r: PromotionRow) => !r.payoutPolicy && statesOf(r).includes("overdue");
  // 정렬 순서: 기한 경과 → 임박 → 진행 → 완료 → 첫해(수당 정산).
  const rankOf = (r: PromotionRow) =>
    r.payoutPolicy ? 5 : hasOverdue(r) ? 1 : statesOf(r).includes("soon") ? 2 : isComplete(r) ? 4 : 3;
  const active = board.rows.filter((r) => !r.payoutPolicy);
  const payoutRows = board.rows.filter((r) => r.payoutPolicy);
  const people = (rows: PromotionRow[]) => new Set(rows.map((r) => r.profileId)).size;
  const doneRows = active.filter(isComplete);
  const forfeitSum = active.reduce((a, r) => a + (r.forfeitDays ?? 0), 0);
  const sorted = [...board.rows].sort((a, b) => rankOf(a) - rankOf(b) || a.name.localeCompare(b.name, "ko"));
  const shown = sorted.filter((r) =>
    filter === "all"
      ? true
      : filter === "first"
        ? r.track === "first_year"
        : filter === "done"
          ? !r.payoutPolicy && isComplete(r)
          : !r.payoutPolicy && !isComplete(r)
  );
  const metaOf = (r: PromotionRow) => [r.rank, r.department].filter((v) => v && String(v).trim()).join(" · ");

  const PILL: Record<StepState | "na", string> = {
    done: "border-success/40 bg-success-soft text-success",
    waiting: "border-line bg-surface text-ink-muted",
    progress: "border-navy/30 bg-navy-soft text-navy",
    soon: "border-warning/50 bg-warning-soft text-warning",
    overdue: "border-stamp/50 bg-stamp-soft text-stamp",
    na: "border-line bg-surface text-ink-hint",
  };
  const pill = (label: string, state: StepState | "na", due: string | null, extra?: string) => {
    const left = due ? daysBetween(board.today, due) : null;
    return (
      <span className={`flex min-w-0 flex-1 flex-col rounded-lg border px-2.5 py-1.5 ${PILL[state]}`} title={due ? `기한 ${due}` : undefined}>
        <span className="text-[11px] font-semibold">{label}</span>
        <span className="text-xs">
          {state === "na" ? "해당 없음" : STEP_LABEL[state]}
          {state !== "done" && state !== "na" && left != null && (left >= 0 ? ` · D-${left}` : ` · +${-left}일`)}
          {extra ? ` · ${extra}` : ""}
        </span>
      </span>
    );
  };
  const arrow = (
    <span aria-hidden className="hidden self-center text-ink-hint sm:inline">
      →
    </span>
  );

  // 단계 버튼(작게) — 기존 동작 그대로.
  const noticeButtons = (row: PromotionRow, stage: PromotionStage) => {
    const n = stage === 1 ? row.stage1 : row.stage2;
    const state = stage === 1 ? row.stage1State : row.stage2State;
    if (state === "na") return null;
    return (
      <span className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] text-ink-hint">{stage === 1 ? "1차" : "2차"}</span>
        {!n?.completed && (
          <button type="button" className={smBtn} disabled={pending} onClick={() => (stage === 1 ? create(row, 1) : setDesignating(row))}>
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
      </span>
    );
  };

  const card = (r: PromotionRow) => {
    const meta = metaOf(r);
    const nameBlock = (
      <div className="w-full shrink-0 lg:w-48">
        <p className="font-semibold text-ink">
          {r.name}
          {r.track === "first_year" && (
            <span className="ml-1 rounded bg-sky-100 px-1 align-middle text-[10px] font-semibold text-sky-900">첫해</span>
          )}
        </p>
        {meta && <p className="text-[11px] text-ink-muted">{meta}</p>}
        {r.track === "first_year" && r.joinDate && <p className="text-[11px] text-ink-hint">입사 {r.joinDate}</p>}
        {!r.erpLinked && <p className="text-[10px] text-stamp">ERP 계정 미연결</p>}
      </div>
    );
    if (r.payoutPolicy)
      return (
        <li key={r.key} className="flex flex-col gap-2 rounded-xl border border-line bg-surface/70 p-3 text-ink-hint lg:flex-row lg:items-center">
          {nameBlock}
          <p className="flex-1 text-sm">
            수당 정산 방식 · 촉진 대상 아님 · 수당 예정 <b className="text-ink-muted">{fmt(r.unusedErp)}일</b>
          </p>
        </li>
      );
    const plannedDays = r.plan?.entries.length ?? 0;
    const missOpen = openMissed.has(r.key);
    return (
      <li key={r.key} className={`rounded-xl border bg-card p-3 ${hasOverdue(r) ? "border-stamp ring-1 ring-stamp/30" : "border-line"}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          {nameBlock}
          <div className="flex flex-1 flex-col gap-1.5 sm:flex-row sm:items-stretch">
            {pill("1차 촉구", r.stage1State, r.schedule.stage1.end, r.stage1?.sentAt ? `${md(r.stage1.sentAt.slice(0, 10))} 발송` : undefined)}
            {arrow}
            {pill(
              "사용계획",
              r.planState,
              r.planDue,
              r.plan?.submittedAt ? `${fmt(r.plan.totalDays)}일 계획` : r.plan ? "미제출" : undefined
            )}
            {arrow}
            {plannedDays === 0 ? (
              pill("계획 대비 실제", "na", null)
            ) : r.missedDates.length === 0 ? (
              pill("계획 대비 실제", "done", null, "계획대로")
            ) : (
              <button
                type="button"
                onClick={() =>
                  setOpenMissed((cur) => {
                    const n = new Set(cur);
                    if (n.has(r.key)) n.delete(r.key);
                    else n.add(r.key);
                    return n;
                  })
                }
                className={`flex min-w-0 flex-1 flex-col rounded-lg border px-2.5 py-1.5 text-left ${PILL.overdue}`}
                aria-expanded={missOpen}
                title="계획했는데 ERP 연가 기록이 없는 지난 날"
              >
                <span className="text-[11px] font-semibold">계획 대비 실제</span>
                <span className="text-xs">미사용 {r.missedDates.length}일 {missOpen ? "▲" : "▼"}</span>
              </button>
            )}
            {arrow}
            {pill("2차 지정", r.stage2State, r.schedule.stage2Due)}
          </div>
          <div className="shrink-0 text-right lg:w-28">
            <p className={`font-mono text-3xl font-bold leading-none ${(r.forfeitDays ?? 0) > 0 ? "text-stamp" : "text-ink-muted"}`}>
              {fmt(r.forfeitDays)}
              <span className="ml-0.5 text-sm font-semibold">일</span>
            </p>
            <p className="mt-0.5 text-[10px] text-ink-hint">{md(r.schedule.periodEnd)} 소멸 예정</p>
          </div>
        </div>
        {missOpen && r.missedDates.length > 0 && (
          <p className="mt-2 rounded-md bg-stamp-soft/60 px-2 py-1 text-xs text-stamp">
            계획했는데 연가 기록이 없는 날: {r.missedDates.map(md).join(", ")}
          </p>
        )}
        <div className="mt-2 flex flex-wrap justify-end gap-x-3 gap-y-1">
          {noticeButtons(r, 1)}
          {noticeButtons(r, 2)}
        </div>
      </li>
    );
  };

  return (
    <section className="space-y-4">
      <div className={`${cardCls} flex flex-wrap items-center gap-2`}>
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
          기한 임박 <b className="text-warning">{counts.soon}</b> · 기한 경과 <b className="text-stamp">{counts.overdue}</b>
        </span>
        <span className="ml-auto flex flex-wrap gap-1">
          <button type="button" className={btnSecondary} onClick={() => setView(view === "cards" ? "table" : "cards")}>
            {view === "cards" ? "표로 보기" : "카드로 보기"}
          </button>
          <a href={`/hr/leave-plans/promotion-report?year=${year}&format=xlsx`} className={btnSecondary}>
            이행 현황 엑셀
          </a>
          <a href={`/hr/leave-plans/promotion-report?year=${year}&format=pdf`} className={btnSecondary}>
            이행 현황 PDF
          </a>
        </span>
        <p className="w-full text-xs text-ink-hint">
          근거: 근로기준법 제61조, 취업규칙 제28조⑤(회계연도 기준)·제29조. {DELIVERY_GUIDE}
        </p>
      </div>
      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}

      {/* 요약 카드 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={cardCls}>
          <p className="text-xs text-ink-muted">회계연도 대상 인원</p>
          <p className="mt-1 font-mono text-3xl font-bold text-navy">
            {people(active)}
            <span className="ml-0.5 text-sm">명</span>
          </p>
          <p className="mt-1 text-[11px] text-ink-hint">
            {payoutRows.length > 0
              ? `첫해 수당 정산 ${people(payoutRows)}명(촉진 대상 아님)`
              : board.firstYearPolicy === "carryover"
                ? "1년 미만 촉진 포함(이월 방식)"
                : "첫해 수당 정산 대상 없음"}
          </p>
        </div>
        <div className={cardCls}>
          <p className="text-xs text-ink-muted">절차 완료 인원</p>
          <p className="mt-1 font-mono text-3xl font-bold text-navy">
            {people(doneRows)}
            <span className="ml-0.5 text-sm text-ink-muted">/ {people(active)}명</span>
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-success"
              style={{ width: `${people(active) ? Math.round((people(doneRows) / people(active)) * 100) : 0}%` }}
            />
          </div>
        </div>
        <div className={`rounded-xl border p-4 shadow-sm ${counts.overdue > 0 ? "border-stamp/50 bg-stamp-soft" : "border-success/40 bg-success-soft"}`}>
          <p className="text-xs text-ink-muted">기한 경과</p>
          {counts.overdue > 0 ? (
            <p className="mt-1 font-mono text-3xl font-bold text-stamp">
              {counts.overdue}
              <span className="ml-0.5 text-sm">건</span>
            </p>
          ) : (
            <p className="mt-2 text-lg font-bold text-success">기한 경과 없음</p>
          )}
          <p className="mt-1 text-[11px] text-ink-muted">기한 임박(14일 이내) {counts.soon}건</p>
        </div>
        <div className={cardCls}>
          <p className="text-xs text-ink-muted">12/31 소멸 예정</p>
          <p className="mt-1 font-mono text-3xl font-bold text-stamp">
            {fmt(forfeitSum)}
            <span className="ml-0.5 text-sm">일</span>
          </p>
          <p className="mt-1 text-[11px] text-ink-hint">
            {board.payoutRun ? (
              <>
                연차수당 산정표({board.payoutRun.status === "confirmed" ? "확정" : "작성 중"}) 예상{" "}
                <b className="text-ink">{board.payoutRun.amount.toLocaleString("ko-KR")}원</b>
              </>
            ) : (
              <Link href={`/hr/leave-payout?year=${year}`} className="text-navy underline">
                산정표 없음 — 연차수당 산정
              </Link>
            )}
          </p>
        </div>
      </div>

      <YearTimeline year={year} today={board.today} />

      {/* 필터 칩 */}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["all", `전체 ${board.rows.length}`],
            ["action", `조치 필요 ${active.filter((r) => !isComplete(r)).length}`],
            ["done", `완료 ${doneRows.length}`],
            ["first", `첫해 ${board.rows.filter((r) => r.track === "first_year").length}`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            aria-pressed={filter === k}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              filter === k ? "bg-navy text-white" : "border border-line bg-card text-ink-muted hover:bg-surface"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "cards" ? (
        <ul className="space-y-2">
          {shown.map(card)}
          {shown.length === 0 && <li className="py-6 text-center text-sm text-ink-hint">해당하는 직원이 없습니다.</li>}
        </ul>
      ) : (
        <div className={`${cardCls} overflow-x-auto`}>
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
              {shown.map((r) => (
                <tr key={r.key} className={`border-b border-line/60 align-top ${r.payoutPolicy ? "bg-surface/70 text-ink-hint" : ""}`}>
                  <td className="px-2 py-2">
                    <p className="font-medium text-ink">{r.name}</p>
                    <p className="text-[11px] text-ink-muted">
                      {[metaOf(r), TRACK_LABEL[r.track]].filter(Boolean).join(" · ")}
                      {r.track === "first_year" && r.joinDate && ` (입사 ${r.joinDate})`}
                    </p>
                    {!r.erpLinked && <p className="text-[10px] text-stamp">ERP 계정 미연결</p>}
                  </td>
                  <td className="px-2 py-2 text-right font-mono">{fmt(r.unusedErp)}</td>
                  {r.payoutPolicy ? (
                    <td colSpan={5} className="px-2 py-2 text-xs">
                      수당 정산 방식 · 촉진 대상 아님 · 수당 예정 {fmt(r.unusedErp)}일
                    </td>
                  ) : (
                    <>
                      <td className="px-2 py-2">{noticeCell(r, 1)}</td>
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
                      <td className="px-2 py-2">{noticeCell(r, 2)}</td>
                      <td className="px-2 py-2 text-right">
                        <span className={`font-mono ${(r.forfeitDays ?? 0) > 0 ? "text-stamp" : ""}`}>{fmt(r.forfeitDays)}</span>
                        <p className="text-[10px] text-ink-hint">{md(r.schedule.periodEnd)}까지 안 쓰면</p>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-ink-hint">
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

// 연간 법정 일정 띠 — 회계연도 기준(1차 촉구 7/1~7/10 · 회신 +10일 · 2차 기한 10/31 · 소멸 12/31). 오늘은 빨간 세로선.
function YearTimeline({ year, today }: { year: number; today: string }) {
  const start = Date.UTC(year, 0, 1);
  const total = Date.UTC(year + 1, 0, 1) - start;
  const pos = (ymd: string) => ((Date.parse(`${ymd}T00:00:00Z`) - start) / total) * 100;
  const end = (ymd: string) => ((Date.parse(`${ymd}T00:00:00Z`) + 86400000 - start) / total) * 100;
  const bands = [
    { label: "1차 촉구", from: `${year}-07-01`, to: `${year}-07-10`, cls: "bg-navy" },
    { label: "회신", from: `${year}-07-11`, to: `${year}-07-20`, cls: "bg-sky-400" },
    { label: "2차 지정 기한", from: `${year}-07-21`, to: `${year}-10-31`, cls: "bg-warning" },
    { label: "소멸", from: `${year}-12-31`, to: `${year}-12-31`, cls: "bg-stamp" },
  ];
  const showToday = today.slice(0, 4) === String(year);
  return (
    <div className={cardCls}>
      <p className="mb-2 text-xs font-semibold text-ink">{year}년 법정 일정(회계연도)</p>
      <div className="relative h-8 rounded-md bg-surface">
        {bands.map((b) => (
          <div
            key={b.label}
            className={`absolute top-1 bottom-1 rounded ${b.cls}`}
            style={{ left: `${pos(b.from)}%`, width: `${Math.max(0.6, end(b.to) - pos(b.from))}%` }}
            title={`${b.label} ${b.from === b.to ? b.from : `${b.from} ~ ${b.to}`}`}
          />
        ))}
        {showToday && (
          <div className="absolute -top-1 -bottom-1 w-0.5 bg-red-600" style={{ left: `${pos(today)}%` }} title={`오늘 ${today}`} />
        )}
      </div>
      <div className="mt-1 grid grid-cols-12 text-center text-[10px] text-ink-hint">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i}>{i + 1}월</span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-muted">
        {bands.map((b) => (
          <span key={b.label} className="flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${b.cls}`} />
            {b.label}
          </span>
        ))}
        {showToday && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-0.5 bg-red-600" />
            오늘
          </span>
        )}
      </div>
    </div>
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
