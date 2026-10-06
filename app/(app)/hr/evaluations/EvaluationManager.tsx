"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  getEvaluationSheet,
  saveEvaluation,
  deleteDraftEvaluation,
  type EvaluationSheet,
  type RosterRow,
} from "@/app/(app)/hr/evaluations/actions";
import {
  GRADE_SUGGESTIONS,
  PERIOD_HALVES,
  PERIOD_LABEL,
  awardSummary,
  disciplineSummary,
  fmtDot,
  serviceSummary,
  totalScore,
  trainingSummary,
  type EvaluationScores,
  type PeriodHalf,
} from "@/lib/hrEvaluation";
import {
  panelToneCls,
  sectionTitleCls,
  inputCls,
  labelCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

// =====================================================================
// 인사평가 화면 — 연도·기간 → 재직자 명단(평정 상태) → 평정표.
//   평정표는 한 화면에 들어오게: 재료는 요약 한 줄씩, 눌러야 펼칩니다(관장 지시 —
//   교육은 25~29건이라 다 나열하면 못 읽음). 점수는 입력, 총점만 자동 합산.
// =====================================================================

type Msg = { ok: boolean; text: string } | null;

const SCORE_LABEL: Record<string, string> = {
  score_duty: "근무",
  score_training: "교육훈련",
  score_career: "경력",
  bonus_award: "포상 가점",
  penalty_discipline: "징계 감점",
  grade: "등급",
  evaluator_note: "의견",
};

export default function EvaluationManager({
  year,
  half,
  roster,
  initialDriverId,
}: {
  year: number;
  half: PeriodHalf;
  roster: RosterRow[];
  initialDriverId: string;
}) {
  const router = useRouter();
  const [driverId, setDriverId] = useState(initialDriverId);
  const done = roster.filter((r) => r.status === "confirmed").length;
  const years = [year - 2, year - 1, year, year + 1];
  const go = (y: number, h: PeriodHalf) => router.push(`/hr/evaluations?year=${y}&half=${h}`);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
      <section className={`${panelToneCls("blue")} h-fit`}>
        <div className="flex flex-wrap gap-2">
          <select className={inputCls} value={year} onChange={(e) => go(Number(e.target.value), half)} aria-label="평정 연도">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          <select className={inputCls} value={half} onChange={(e) => go(year, e.target.value as PeriodHalf)} aria-label="평정 기간">
            {PERIOD_HALVES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <h3 className={`mt-4 ${sectionTitleCls("blue")}`}>
          재직자 {roster.length}명 · 확정 {done}명
        </h3>
        <ul className="mt-2 space-y-1" data-testid="eval-roster">
          {roster.map((r) => (
            <li key={r.driverId}>
              <button
                type="button"
                onClick={() => setDriverId(r.driverId)}
                className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm ${
                  r.driverId === driverId ? "bg-navy-soft ring-1 ring-navy" : "hover:bg-surface"
                }`}
              >
                <span>
                  <span className="font-medium text-ink">{r.name}</span>
                  <span className="ml-1 text-xs text-ink-hint">{r.where}</span>
                </span>
                {r.status === "confirmed" ? (
                  <span className={badgeSuccess}>{r.total ?? "-"}점{r.grade ? ` ${r.grade}` : ""}</span>
                ) : r.status === "draft" ? (
                  <span className={badgeWarning}>작성 중</span>
                ) : (
                  <span className={badgeNeutral}>미평정</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <div>
        {driverId ? (
          <SheetView key={driverId} driverId={driverId} year={year} half={half} onSaved={() => router.refresh()} />
        ) : (
          <section className={panelToneCls("navy")}>
            <p className="py-16 text-center text-sm text-ink-hint">왼쪽에서 평정할 직원을 고르세요.</p>
          </section>
        )}
      </div>
    </div>
  );
}

function Fold({ title, summary, tone = "navy", children, testId }: { title: string; summary: ReactNode; tone?: "navy" | "red"; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-lg border ${tone === "red" ? "border-edge-red" : "border-rule"} bg-card`} data-testid={testId}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2 text-left">
        <span className="w-16 shrink-0 text-xs font-bold text-navy">{title}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink-body" data-testid={testId ? `${testId}-summary` : undefined}>
          {summary}
        </span>
        <span className="shrink-0 text-xs text-ink-hint">{open ? "접기 ▲" : "펼치기 ▼"}</span>
      </button>
      {open && <div className="border-t border-rule px-3 py-2 text-xs text-ink-body">{children}</div>}
    </div>
  );
}

function SheetView({ driverId, year, half, onSaved }: { driverId: string; year: number; half: PeriodHalf; onSaved: () => void }) {
  const [sheet, setSheet] = useState<EvaluationSheet | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    getEvaluationSheet(driverId, year, half).then((r) => {
      if (!alive) return;
      if (r.ok) setSheet(r.sheet);
      else setErr(r.message);
    });
    return () => {
      alive = false;
    };
  }, [driverId, year, half, reload]);

  if (err) return <p className={noticeError}>{err}</p>;
  if (!sheet) return <p className="py-8 text-center text-sm text-ink-hint">재료를 모으는 중…</p>;
  const m = sheet.materials;
  const ev = sheet.evaluation;

  return (
    <div className="space-y-4" data-testid="eval-sheet">
      <section className={panelToneCls("green")}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className={sectionTitleCls("green")}>
            {sheet.name} — {year}년 {PERIOD_LABEL[half]} 평정
          </h3>
          <span className="text-xs text-ink-muted">
            {sheet.frozen
              ? `확정 ${fmtDot(ev?.evaluated_at?.slice(0, 10))} · ${ev?.evaluated_by ?? ""} — 재료는 확정 시점 기준(${fmtDot(m.collectedAt.slice(0, 10))})`
              : `재료 집계 ${fmtDot(m.collectedAt.slice(0, 10))} 기준 · 기간 ${fmtDot(m.period.from)} ~ ${fmtDot(m.period.to)}`}
          </span>
        </div>

        {m.disciplines.blockUntil && (
          <p className="mt-3 rounded-lg border-2 border-stamp bg-stamp-soft px-3 py-2 text-sm font-bold text-stamp" data-testid="eval-block">
            {fmtDot(m.disciplines.blockUntil)}까지 승진제한 — 운영규정 32조
          </p>
        )}

        <div className="mt-3 space-y-2">
          <Fold title="근무" summary={serviceSummary(m.service)} testId="fold-service">
            <p>입사일 {fmtDot(m.service.joinDate) || "미기재"} · 직급 {m.service.rank ?? "-"}</p>
            {m.service.appointmentsInPeriod.length > 0 ? (
              <ul className="mt-1 list-disc pl-4">
                {m.service.appointmentsInPeriod.map((a, i) => (
                  <li key={i}>
                    {fmtDot(a.date)} {a.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-ink-hint">이 기간 인사발령 없음</p>
            )}
          </Fold>
          <Fold title="교육훈련" summary={trainingSummary(m.training)} testId="fold-training">
            <p className="font-semibold">의무교육 {m.training.mandatory.completed}/{m.training.mandatory.target} · 이수 {m.training.mandatory.hours}시간</p>
            <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">
              {m.training.mandatory.items.map((t, i) => (
                <li key={i} className={t.completed ? "" : "text-stamp"}>
                  {t.completed ? "✓" : "✗"} {t.name}
                  {t.hours ? ` (${t.hours}h)` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-2 font-semibold">종사자교육 {m.training.staff.count}건 · {m.training.staff.hours}시간</p>
            {m.training.staff.items.length === 0 ? (
              <p className="text-ink-hint">이 기간 직접 입력된 종사자교육 없음</p>
            ) : (
              <ul className="mt-1">
                {m.training.staff.items.map((s, i) => (
                  <li key={i}>
                    {fmtDot(s.date)} {s.name}
                    {s.hours ? ` · ${s.hours}h` : ""}
                    {s.organizer ? ` · ${s.organizer}` : ""}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-ink-hint">※ 사업실적의 종사자교육 중 의무교육에서 자동으로 옮겨진 행은 의무교육과 중복이라 빼고 셉니다.</p>
          </Fold>
          <Fold title="경력" summary={m.career.length ? `경력 ${m.career.length}건 — ${m.career.map((c) => c.company).filter(Boolean).slice(0, 3).join(", ")}${m.career.length > 3 ? " 외" : ""}` : "경력 기록 없음"} testId="fold-career">
            <ul>
              {m.career.map((c, i) => (
                <li key={i}>
                  {c.period} · {c.company} {c.department}
                  {c.duties ? ` — ${c.duties}` : ""}
                </li>
              ))}
            </ul>
          </Fold>
          <Fold title="포상" summary={awardSummary(m.awards)} testId="fold-awards">
            <p className="font-semibold">센터 포상(운영규정 30조 — 인사고과 반영 대상)</p>
            {m.awards.internal.length ? (
              <ul>
                {m.awards.internal.map((a, i) => (
                  <li key={i}>
                    {fmtDot(a.date)} {a.title}
                    {a.kind ? ` · ${a.kind}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-hint">없음</p>
            )}
            <p className="mt-2 font-semibold">외부 수상</p>
            {m.awards.external.length ? (
              <ul>
                {m.awards.external.map((a, i) => (
                  <li key={i}>
                    {fmtDot(a.date)} {a.title}
                    {a.body ? ` · ${a.body}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-hint">없음</p>
            )}
            <p className="mt-2 text-ink-hint">가점은 자동으로 매기지 않습니다 — 아래 포상 가점 칸에 평정자가 넣습니다.</p>
          </Fold>
          <Fold title="징계" summary={disciplineSummary(m.disciplines)} tone={m.disciplines.blockUntil ? "red" : "navy"} testId="fold-discipline">
            {m.disciplines.items.length ? (
              <ul>
                {m.disciplines.items.map((d, i) => (
                  <li key={i}>
                    {fmtDot(d.date)} {d.label} — {d.reason}
                    {d.blockUntil ? ` (승진제한 ~${fmtDot(d.blockUntil)})` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-hint">없음</p>
            )}
          </Fold>
        </div>

        {sheet.previous.length > 0 && (
          <div className="mt-3 rounded-lg border border-rule px-3 py-2 text-xs" data-testid="eval-previous">
            <p className="font-semibold text-ink">전년도({year - 1}) 평정</p>
            {sheet.previous.map((p, i) => (
              <p key={i} className="text-ink-body">
                {PERIOD_LABEL[p.half]} · 총점 {p.total ?? "-"} · 등급 {p.grade ?? "-"} · 근무 {p.scores.score_duty ?? "-"} / 교육 {p.scores.score_training ?? "-"} / 경력{" "}
                {p.scores.score_career ?? "-"} / 가점 {p.scores.bonus_award ?? "-"} / 감점 {p.scores.penalty_discipline ?? "-"}
                {p.status !== "confirmed" ? " (작성 중)" : ""}
              </p>
            ))}
          </div>
        )}
      </section>

      <ScoreForm
        sheet={sheet}
        driverId={driverId}
        year={year}
        half={half}
        onSaved={() => {
          setReload((k) => k + 1);
          onSaved();
        }}
      />
    </div>
  );
}

function ScoreForm({ sheet, driverId, year, half, onSaved }: { sheet: EvaluationSheet; driverId: string; year: number; half: PeriodHalf; onSaved: () => void }) {
  const ev = sheet.evaluation;
  const toStr = (v: number | null | undefined) => (v == null ? "" : String(v));
  const [f, setF] = useState({
    score_duty: toStr(ev?.score_duty),
    score_training: toStr(ev?.score_training),
    score_career: toStr(ev?.score_career),
    bonus_award: toStr(ev?.bonus_award),
    penalty_discipline: toStr(ev?.penalty_discipline),
    grade: ev?.grade ?? "",
    evaluator_note: ev?.evaluator_note ?? "",
  });
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const n = (v: string) => (v.trim() === "" ? null : Number(v));
  const scores: EvaluationScores = {
    score_duty: n(f.score_duty),
    score_training: n(f.score_training),
    score_career: n(f.score_career),
    bonus_award: n(f.bonus_award),
    penalty_discipline: n(f.penalty_discipline),
    grade: f.grade,
    evaluator_note: f.evaluator_note,
  };
  const total = totalScore(scores);
  const confirmed = ev?.status === "confirmed";
  const revisions = ev?.snapshot.revisions ?? [];

  function save(confirm: boolean) {
    if (confirm && !window.confirm("평정을 확정할까요? 지금 화면의 재료(교육·포상·징계 등)가 이 평정의 근거로 고정됩니다.")) return;
    setMsg(null);
    start(async () => {
      const r = await saveEvaluation({ ...scores, driverId, year, half, confirm });
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setMsg({ ok: true, text: confirmed ? "수정했습니다(수정 기록에 남음)." : r.status === "confirmed" ? `확정했습니다. 총점 ${r.total}` : `임시 저장했습니다. 총점 ${r.total}` });
      onSaved();
    });
  }

  const field = (key: keyof typeof f, label: string, hint?: string) => (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        className={inputCls}
        inputMode="decimal"
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
        data-testid={`eval-${key}`}
      />
      {hint && <p className="mt-0.5 text-[11px] text-ink-hint">{hint}</p>}
    </div>
  );

  return (
    <section className={panelToneCls("yellow")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={sectionTitleCls("yellow")}>평정 점수</h3>
        {confirmed ? <span className={badgeSuccess}>확정</span> : ev ? <span className={badgeWarning}>작성 중</span> : <span className={badgeNeutral}>미평정</span>}
      </div>
      <p className="mt-1 text-xs text-ink-muted">센터 평정 기준표가 규정에 없어 점수는 자동으로 매기지 않습니다. 각 칸을 평정자가 넣고, 총점만 자동으로 합산합니다.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {field("score_duty", "근무사항")}
        {field("score_training", "교육훈련사항")}
        {field("score_career", "경력사항")}
        {field("bonus_award", "포상 가점", "센터 포상·외부 수상 구분해 판단")}
        {field("penalty_discipline", "징계 감점", "양수로 넣으면 총점에서 뺍니다")}
        <div>
          <label className={labelCls}>등급</label>
          <input className={inputCls} list="eval-grades" value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })} data-testid="eval-grade" />
          <datalist id="eval-grades">
            {GRADE_SUGGESTIONS.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>
      </div>
      <p className="mt-3 text-sm font-bold text-ink" data-testid="eval-total">
        총점 {total}점
      </p>
      <label className={`mt-3 ${labelCls}`}>평정 의견</label>
      <textarea className={inputCls} rows={3} value={f.evaluator_note} onChange={(e) => setF({ ...f, evaluator_note: e.target.value })} />
      {msg && <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {confirmed ? (
          <button type="button" className={btnPrimary} disabled={pending} onClick={() => save(false)} data-testid="eval-update">
            수정 저장(기록 남음)
          </button>
        ) : (
          <>
            <button type="button" className={btnSecondary} disabled={pending} onClick={() => save(false)} data-testid="eval-draft">
              임시 저장
            </button>
            <button type="button" className={btnPrimary} disabled={pending} onClick={() => save(true)} data-testid="eval-confirm">
              확정
            </button>
            {ev && (
              <button
                type="button"
                className={btnDanger}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    if (!window.confirm("작성 중인 평정을 지울까요?")) return;
                    const r = await deleteDraftEvaluation(driverId, year, half);
                    if (!r.ok) return setMsg({ ok: false, text: r.message });
                    onSaved();
                  })
                }
              >
                작성 중 평정 삭제
              </button>
            )}
          </>
        )}
      </div>
      {revisions.length > 0 && (
        <div className="mt-4 rounded-lg border border-rule px-3 py-2 text-xs" data-testid="eval-revisions">
          <p className="font-semibold text-ink">확정 후 수정 기록</p>
          {revisions.map((r, i) => (
            <p key={i} className="text-ink-body">
              {r.at.slice(0, 16).replace("T", " ")} · {r.by} —{" "}
              {Object.keys(r.after)
                .map((k) => `${SCORE_LABEL[k] ?? k} ${String((r.before as Record<string, unknown>)[k] ?? "-")}→${String((r.after as Record<string, unknown>)[k] ?? "-")}`)
                .join(", ")}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
