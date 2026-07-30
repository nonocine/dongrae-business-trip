"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createSettlement,
  previewSettlement,
  type SettlementListRow,
  type SettlementProjectOption,
  type SettlementPreview,
} from "@/app/hr/saems/settlementActions";
import { formatKRW } from "@/lib/saem";
import { deductionRateLabel } from "@/lib/settlement";
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
              확정된 근무일지를 기간별로 모아 정산을 생성합니다. 항목 조정은
              근무일지를 고친 뒤 재계산으로 반영합니다.
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
  const [err, setErr] = useState<string | null>(null);
  const [pendingPreview, startPreview] = useTransition();
  const [pendingSave, startSave] = useTransition();

  const canQuery = projectId && start && end;

  function doPreview() {
    setErr(null);
    setPreview(null);
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
        });
        setPreview(p);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "미리보기 실패");
      }
    });
  }

  function save() {
    setErr(null);
    startSave(async () => {
      const res = await createSettlement({
        projectId,
        title,
        periodStart: start,
        periodEnd: end,
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
                setPreview(null);
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
                setPreview(null);
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
                setPreview(null);
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
            disabled={pendingSave || !preview || preview.rows.length === 0 || !title.trim()}
            className={btnPrimary}
          >
            {pendingSave ? "저장 중…" : "저장(작성중)"}
          </button>
        </div>

        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}

        {preview && (
          <div className="mt-4">
            <p className="mb-2 text-xs text-ink-hint">
              대상 세션 {preview.sessionCount}건 · 강사 {preview.rows.length}명 ·
              차인지급 합계{" "}
              <b className="text-navy">{formatKRW(preview.totalNet)}</b>원
            </p>
            {preview.rows.length === 0 ? (
              <p className={noticeError}>
                대상 세션이 없습니다. (해당 기간에 확정된 미정산 근무일지가 없음)
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead className="bg-surface">
                    <tr>
                      <th className={thCls}>강사</th>
                      <th className={thCls}>프로그램별 내역</th>
                      <th className={`${thCls} text-right`}>지급총액</th>
                      <th className={`${thCls} text-right`}>공제</th>
                      <th className={`${thCls} text-right`}>차인지급</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.instructor_id} className="border-t border-line/60">
                        <td className={`${tdCls} font-medium text-ink`}>
                          {row.instructorName}
                        </td>
                        <td className={tdCls}>
                          <ul className="space-y-0.5">
                            {row.detail.map((d, i) => (
                              <li key={i} className="text-xs text-ink-muted">
                                {d.program_name} · {d.sessions}회 · {d.hours}h ×{" "}
                                {formatKRW(d.rate)} = {formatKRW(d.amount)}
                                {d.deduction_amount != null && (
                                  <span className="text-stamp">
                                    {" "}
                                    · 공제 {d.deduction_rate}% -
                                    {formatKRW(d.deduction_amount)}
                                  </span>
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
                    ))}
                    <tr className="border-t border-line bg-surface font-semibold">
                      <td className={tdCls} colSpan={2}>
                        합계
                      </td>
                      <td className={`${tdCls} text-right`}>
                        {formatKRW(preview.totalGross)}
                      </td>
                      <td className={`${tdCls} text-right text-stamp`}>
                        -{formatKRW(preview.totalDeduction)}
                      </td>
                      <td className={`${tdCls} text-right text-navy`}>
                        {formatKRW(preview.totalNet)}
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
