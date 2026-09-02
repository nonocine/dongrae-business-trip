"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createSettlement,
  previewSettlement,
  type SettlementAdjustment,
  type SettlementListRow,
  type SettlementProjectOption,
  type SettlementPreview,
} from "@/app/hr/saems/settlementActions";
import {
  ProgramLine,
  AdjustControl,
} from "@/app/hr/saems/settlements/ProgramLine";
import { formatKRW } from "@/lib/saem";
import { deductionRateLabel, detailMethod } from "@/lib/settlement";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  badgeSuccess,
  badgeNeutral,
  noticeError,
} from "@/lib/ui";

const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body";
const period = (a: string | null, b: string | null) =>
  `${a ?? "?"} ~ ${b ?? "?"}`;

export default function SettlementsManager({
  rows,
  projects,
}: {
  rows: SettlementListRow[];
  projects: SettlementProjectOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-5">
      <section className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-ink">강사비 정산</h3>
            <p className="mt-1 text-xs text-ink-hint">
              시급제는 확정된 근무일지를, 수강료 분배제는 등록 인원을 기준으로
              기간별 정산을 생성합니다. 분배제 항목만 담당자가 인원·금액을 조정할
              수 있고, 시급제는 근무일지를 고친 뒤 재계산으로 반영합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={btnPrimary}
          >
            + 정산 생성
          </button>
        </div>
      </section>

      <section className={cardCls}>
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-hint">
            생성된 정산이 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={thCls}>프로젝트</th>
                  <th className={thCls}>제목</th>
                  <th className={thCls}>기간</th>
                  <th className={thCls}>상태</th>
                  <th className={`${thCls} text-right`}>인원</th>
                  <th className={`${thCls} text-right`}>총지급액</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => router.push(`/hr/saems/settlements/${r.id}`)}
                    className="cursor-pointer border-b border-line/60 hover:bg-surface"
                  >
                    <td className={tdCls}>{r.projectName}</td>
                    <td className={`${tdCls} font-medium text-ink`}>{r.title}</td>
                    <td className={`${tdCls} whitespace-nowrap text-xs`}>
                      {period(r.period_start, r.period_end)}
                    </td>
                    <td className={tdCls}>
                      <span
                        className={
                          r.status === "confirmed" ? badgeSuccess : badgeNeutral
                        }
                      >
                        {r.status === "confirmed" ? "확정" : "작성중"}
                      </span>
                    </td>
                    <td className={`${tdCls} text-right`}>{r.instructorCount}명</td>
                    <td className={`${tdCls} text-right font-semibold text-navy`}>
                      {formatKRW(r.totalNet)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open && (
        <CreateModal
          projects={projects}
          onClose={() => setOpen(false)}
          onCreated={(id) => router.push(`/hr/saems/settlements/${id}`)}
        />
      )}
    </div>
  );
}

function CreateModal({
  projects,
  onClose,
  onCreated,
}: {
  projects: SettlementProjectOption[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  // 정산에 포함할 강사. 미리보기 직후에는 전체 선택이고, 담당자가 뺀다.
  //   요약·합계는 이 선택분만 더해서 보여 준다(보조금 대상 금액을 눌러보며 확인).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // 저장 전 조정값 — (강사|프로그램) → 인원/금액. 저장 시 그대로 넘긴다.
  const [adjustments, setAdjustments] = useState<SettlementAdjustment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pendingPreview, startPreview] = useTransition();
  const [pendingSave, startSave] = useTransition();

  const canQuery = projectId && start && end;

  // 선택된 강사만의 합계 — 요약·표 하단이 함께 쓴다. 선택을 바꾸면 바로 반응한다.
  const pickedRows = (preview?.rows ?? []).filter((r) => picked.has(r.instructor_id));
  const sel = pickedRows.reduce(
    (acc, r) => ({
      sessions: acc.sessions + r.sessionCount,
      gross: acc.gross + r.gross_amount,
      deduction: acc.deduction + r.deduction_amount,
      net: acc.net + r.net_amount,
      revenuePrograms:
        acc.revenuePrograms +
        r.detail.filter((d) => detailMethod(d) === "revenue_share").length,
    }),
    { sessions: 0, gross: 0, deduction: 0, net: 0, revenuePrograms: 0 }
  );
  const allPicked =
    (preview?.rows.length ?? 0) > 0 && picked.size === preview?.rows.length;

  function toggleOne(instructorId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(instructorId)) next.delete(instructorId);
      else next.add(instructorId);
      return next;
    });
  }

  function toggleAll() {
    setPicked(
      allPicked ? new Set() : new Set((preview?.rows ?? []).map((r) => r.instructor_id))
    );
  }

  function reset() {
    setPreview(null);
    setPicked(new Set());
    setAdjustments([]);
  }

  function load(next: SettlementAdjustment[]) {
    setErr(null);
    if (!canQuery) {
      setErr("프로젝트와 기간을 선택하세요.");
      return;
    }
    startPreview(async () => {
      try {
        const p = await previewSettlement({
          projectId,
          periodStart: start,
          periodEnd: end,
          adjustments: next,
        });
        setPreview(p);
        // 처음 조회하면 전체 선택(지금까지의 동작과 같게). 조정 때문에 다시
        //   불린 경우에는 담당자가 해둔 선택을 유지하고, 사라진 강사만 뺀다.
        setPicked((prevPicked) => {
          const ids = p.rows.map((r) => r.instructor_id);
          if (prevPicked.size === 0) return new Set(ids);
          const live = new Set(ids);
          return new Set([...prevPicked].filter((id) => live.has(id)));
        });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "미리보기 실패");
      }
    });
  }

  function doPreview() {
    setPreview(null);
    setPicked(new Set());
    load(adjustments);
  }

  // 조정 적용/해제 → 서버에 다시 계산을 맡긴다(공제·차인지급까지 일관되게).
  function applyAdjustment(a: SettlementAdjustment) {
    const next = adjustments.filter(
      (x) => !(x.instructor_id === a.instructor_id && x.program_id === a.program_id)
    );
    if (a.enrolled != null || a.amount != null) next.push(a);
    setAdjustments(next);
    load(next);
  }

  function save() {
    setErr(null);
    startSave(async () => {
      const res = await createSettlement({
        projectId,
        title,
        periodStart: start,
        periodEnd: end,
        adjustments,
        instructorIds: [...picked],
      });
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      onCreated(res.id);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">정산 생성</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:underline"
          >
            닫기
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="block text-[11px] font-semibold text-navy">
              프로젝트 *
            </span>
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                reset();
              }}
              className={`${inCls} mt-1`}
            >
              <option value="">선택</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold text-navy">제목 *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 2025 2학기 2차시 강사비"
              className={`${inCls} mt-1`}
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold text-navy">
              기간 시작 *
            </span>
            <input
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                reset();
              }}
              className={`${inCls} mt-1`}
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold text-navy">
              기간 종료 *
            </span>
            <input
              type="date"
              value={end}
              onChange={(e) => {
                setEnd(e.target.value);
                reset();
              }}
              className={`${inCls} mt-1`}
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={doPreview}
            disabled={pendingPreview || !canQuery}
            className={btnSecondary}
          >
            {pendingPreview ? "계산 중…" : "미리보기"}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={
              pendingSave ||
              !preview ||
              preview.rows.length === 0 ||
              // 강사를 전부 빼면 만들 게 없다(서버에서도 같은 규칙으로 막는다).
              picked.size === 0 ||
              !title.trim()
            }
            className={btnPrimary}
          >
            {pendingSave ? "저장 중…" : "저장(작성중)"}
          </button>
        </div>

        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}

        {preview && (
          <div className="mt-4">
            {/* 요약은 "선택된 강사" 기준이다 — 체크를 바꾸면 지급총액·차인지급·
                강사수·세션수가 즉시 따라 움직인다(보조금 대상 금액 확인용). */}
            <p className="mb-2 text-xs text-ink-hint">
              대상 세션 {sel.sessions}건
              {sel.revenuePrograms > 0 &&
                ` · 분배제 프로그램 ${sel.revenuePrograms}개`}{" "}
              · 강사 {pickedRows.length}명
              {pickedRows.length < preview.rows.length &&
                ` (조회 ${preview.rows.length}명 중)`}{" "}
              · 지급총액 <b className="text-navy">{formatKRW(sel.gross)}</b>원 ·
              차인지급 합계{" "}
              <b className="text-navy">{formatKRW(sel.net)}</b>원
              {adjustments.length > 0 && (
                <span className="ml-1 text-warning">
                  · 조정 {adjustments.length}건 반영
                </span>
              )}
            </p>
            {preview.rows.length === 0 ? (
              <p className={noticeError}>
                대상이 없습니다. (해당 기간에 확정된 미정산 근무일지도, 세션이 있는
                분배제 프로그램도 없음)
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead className="bg-surface">
                    <tr>
                      {/* 전체 선택/해제 — 조회 결과 전원을 한 번에 넣거나 뺀다. */}
                      <th className={thCls}>
                        <input
                          type="checkbox"
                          checked={allPicked}
                          onChange={toggleAll}
                          aria-label="강사 전체 선택"
                        />
                      </th>
                      <th className={thCls}>강사</th>
                      <th className={thCls}>프로그램별 내역</th>
                      <th className={`${thCls} text-right`}>지급총액</th>
                      <th className={`${thCls} text-right`}>공제</th>
                      <th className={`${thCls} text-right`}>차인지급</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => {
                      const on = picked.has(row.instructor_id);
                      return (
                      <tr
                        key={row.instructor_id}
                        className={`border-t border-line/60 ${
                          on ? "" : "opacity-50"
                        }`}
                      >
                        <td className={tdCls}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleOne(row.instructor_id)}
                            aria-label={`${row.instructorName} 포함`}
                          />
                        </td>
                        <td className={`${tdCls} font-medium text-ink`}>
                          {row.instructorName}
                        </td>
                        <td className={tdCls}>
                          <ul className="space-y-1">
                            {row.detail.map((d, i) => (
                              <li key={d.program_id ?? i}>
                                <ProgramLine d={d} />
                                {detailMethod(d) === "revenue_share" && (
                                  <AdjustControl
                                    d={d}
                                    disabled={pendingPreview}
                                    onApply={(enrolled, amount) =>
                                      applyAdjustment({
                                        instructor_id: row.instructor_id,
                                        program_id: d.program_id ?? "",
                                        enrolled,
                                        amount,
                                      })
                                    }
                                  />
                                )}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td className={`${tdCls} text-right`}>
                          {formatKRW(row.gross_amount)}
                        </td>
                        <td className={`${tdCls} text-right text-stamp`}>
                          -{formatKRW(row.deduction_amount)}
                          <span className="ml-1 text-[10px] text-ink-hint">
                            ({deductionRateLabel(row.detail, row.deduction_rate)}%)
                          </span>
                        </td>
                        <td className={`${tdCls} text-right font-semibold text-navy`}>
                          {formatKRW(row.net_amount)}
                        </td>
                      </tr>
                      );
                    })}
                    {/* 합계도 선택분만 — 체크박스 열이 생겨 colSpan 이 3 이 된다. */}
                    <tr className="border-t border-line bg-surface font-semibold">
                      <td className={tdCls} colSpan={3}>
                        선택 {pickedRows.length}명 합계
                      </td>
                      <td className={`${tdCls} text-right`}>
                        {formatKRW(sel.gross)}
                      </td>
                      <td className={`${tdCls} text-right text-stamp`}>
                        -{formatKRW(sel.deduction)}
                      </td>
                      <td className={`${tdCls} text-right text-navy`}>
                        {formatKRW(sel.net)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
