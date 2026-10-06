"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ContractView from "@/app/components/ContractView";
import {
  saveSalaryContract,
  bulkCreateSalaryDrafts,
  getSalaryContractForEdit,
  saveSalaryHolidays,
  saveSalaryClauses,
  type SalaryWorkspace,
  type SalaryEmployee,
} from "@/app/(app)/hr/contracts/salaryActions";
import { ContractList, Modal, type Msg } from "@/app/(app)/hr/contracts/shared";
import { contractStateLabel, type ContractSummary } from "@/lib/contractCore";
import {
  DEFAULT_SALARY_CLAUSES,
  amountInKorean,
  buildSalaryContractBlocks,
  computeSalaryContract,
  won,
  type CertLevel,
  type HolidayDates,
  type SalaryClauses,
  type SegmentInput,
} from "@/lib/salaryContracts";
import {
  panelToneCls,
  sectionTitleCls,
  tableHeadCls,
  tableRowCls,
  inputCls,
  labelCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  badgeNeutral,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

// =====================================================================
// 연봉계약서 탭 — 명절 날짜 · 직원별 계산/작성(구간 수정·실시간 미리보기) ·
//   일괄 작성 · (공용) 목록의 일괄 미리보기/발송 · 조항 문구.
//   미리보기 금액은 화면에서 계산하지만, 저장할 때 서버가 같은 함수로 다시 계산합니다.
// =====================================================================

const cellIn =
  "w-full rounded-md border border-line bg-card px-1.5 py-1 text-xs text-ink-body focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";

const segSummary = (segs: SegmentInput[]) =>
  segs.map((s) => `${s.grade} ${s.step}호봉 ${s.start_month}~${s.end_month}월`).join(" / ") || "구간 없음";

export default function SalaryContractsManager({
  workspace: ws,
  contracts,
  isM0,
}: {
  workspace: SalaryWorkspace;
  contracts: ContractSummary[];
  isM0: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<{ emp: SalaryEmployee; id: string | null; segments: SegmentInput[] } | null>(null);

  const calcFor = (segments: SegmentInput[]) =>
    computeSalaryContract({ year: ws.year, segments, gradeRows: ws.gradeRows, config: ws.config, holidays: ws.holidays });

  const totals = useMemo(
    () => new Map(ws.employees.map((e) => [e.driverId, calcFor(e.defaultSegments)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws]
  );
  const statusById = new Map(contracts.map((c) => [c.id, c]));
  const noContract = ws.employees.filter((e) => !e.contract);
  const pickable = noContract.map((e) => e.driverId);

  function bulkCreate() {
    const ids = [...picked].filter((id) => pickable.includes(id));
    if (!ids.length) return;
    if (!confirm(`${ids.length}명의 연봉계약서를 급여설정 기본 구간으로 '작성 중' 저장할까요?\n가족수당은 0으로 들어갑니다 — 해당 직원은 저장 뒤 [수정]에서 넣어주세요.`)) return;
    setMsg(null);
    start(async () => {
      const res = await bulkCreateSalaryDrafts(ws.year, ids);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      const skip = res.skipped.length ? ` · 건너뜀 ${res.skipped.length}명(${res.skipped.map((s) => `${s.name}: ${s.reason}`).join(", ")})` : "";
      setMsg({ ok: res.skipped.length === 0, text: `${res.created.length}명 작성 중으로 저장했습니다${skip}. 아래 목록에서 미리보기 후 보내세요.` });
      setPicked(new Set());
      router.refresh();
    });
  }

  function editDraft(item: ContractSummary) {
    setMsg(null);
    start(async () => {
      const res = await getSalaryContractForEdit(item.id);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      const emp =
        ws.employees.find((e) => e.driverId === res.driverId) ??
        ({ driverId: res.driverId, name: item.employee_name, defaultSegments: res.segments, familyHint: null, contract: { id: item.id, status: res.status } } as SalaryEmployee);
      setEditor({ emp, id: item.id, segments: res.segments });
    });
  }

  const holidayMissing = !ws.holidays.seol || !ws.holidays.chuseok;

  return (
    <div className="space-y-6">
      <HolidayPanel year={ws.year} holidays={ws.holidays} />

      <section className={panelToneCls("yellow")}>
        <h3 className={sectionTitleCls("yellow")}>{ws.year}년 연봉계약서 작성</h3>
        <p className="mt-1 text-xs text-ink-muted">
          급여설정(직원별 급여 구간)·호봉표·급여 설정값으로 계산합니다. 금액이 0 인 수당은 표에서 빠지고, 구간이 둘
          이상이면 비고에 개월 수가 들어갑니다. 계약 당시와 급여설정이 다르면(예: 계약 후 승급) [미리보기·작성]에서
          구간을 고치세요.
        </p>
        {holidayMissing && <p className={`mt-2 ${noticeWarning}`}>{ws.year}년 설·추석 날짜를 먼저 넣어야 명절휴가비를 계산할 수 있습니다.</p>}
        {msg && <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>}
        {ws.employees.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-hint">{ws.year}년 급여설정이 있는 재직 직원이 없습니다.</p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-ink-muted">선택 {[...picked].filter((id) => pickable.includes(id)).length}명</span>
              <button type="button" className={btnSecondary} disabled={pending || picked.size === 0} onClick={bulkCreate}>
                선택 직원 일괄 작성(작성 중 저장)
              </button>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className={tableHeadCls}>
                    <th className="px-2 py-2">
                      <input
                        type="checkbox"
                        aria-label="계약서 없는 직원 전체 선택"
                        checked={pickable.length > 0 && pickable.every((id) => picked.has(id))}
                        onChange={(e) => setPicked(e.target.checked ? new Set(pickable) : new Set())}
                      />
                    </th>
                    <th className="px-2 py-2">직원</th>
                    <th className="px-2 py-2">구간(급여설정)</th>
                    <th className="px-2 py-2 text-right">계산 연봉</th>
                    <th className="px-2 py-2">계약서</th>
                    <th className="px-2 py-2 text-right">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {ws.employees.map((e) => {
                    const calc = totals.get(e.driverId)!;
                    const existing = e.contract ? statusById.get(e.contract.id) : null;
                    return (
                      <tr key={e.driverId} className={tableRowCls} data-testid="salary-employee">
                        <td className="px-2 py-2">
                          {!e.contract && (
                            <input
                              type="checkbox"
                              aria-label={`${e.name} 선택`}
                              checked={picked.has(e.driverId)}
                              onChange={(ev) => {
                                const next = new Set(picked);
                                if (ev.target.checked) next.add(e.driverId);
                                else next.delete(e.driverId);
                                setPicked(next);
                              }}
                            />
                          )}
                        </td>
                        <td className="px-2 py-2 font-medium text-ink">
                          {e.name}
                          {e.familyHint && <span className="block text-[11px] font-normal text-warning">가족수당 확인 필요</span>}
                        </td>
                        <td className="px-2 py-2 text-xs text-ink-muted">{segSummary(e.defaultSegments)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {calc.errors.length ? <span className="text-xs text-stamp">계산 불가</span> : `${won(calc.total)}원`}
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {existing ? contractStateLabel(existing) : e.contract ? e.contract.status : <span className={badgeNeutral}>없음</span>}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {!e.contract && (
                            <button
                              type="button"
                              className="rounded-md border border-line bg-card px-2 py-1 text-xs font-medium text-ink-body hover:bg-surface"
                              onClick={() => setEditor({ emp: e, id: null, segments: e.defaultSegments.map((s) => ({ ...s })) })}
                            >
                              미리보기·작성
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <ContractList kind="salary" items={contracts} isM0={isM0} onEdit={editDraft} bulk />

      <SalaryClauseEditor initial={ws.clauses} />

      {editor && (
        <SegmentEditor
          ws={ws}
          emp={editor.emp}
          id={editor.id}
          initial={editor.segments}
          calcFor={calcFor}
          onClose={() => setEditor(null)}
          onSaved={(text) => {
            setEditor(null);
            setMsg({ ok: true, text });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// 연도 선택 + 설·추석 날짜(음력이라 해마다 입력).
function HolidayPanel({ year, holidays }: { year: number; holidays: HolidayDates }) {
  const router = useRouter();
  const [seol, setSeol] = useState(holidays.seol ?? "");
  const [chuseok, setChuseok] = useState(holidays.chuseok ?? "");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const nowYear = new Date().getFullYear();
  const years = [nowYear - 1, nowYear, nowYear + 1];

  return (
    <section className={panelToneCls("blue")}>
      <h3 className={sectionTitleCls("blue")}>연도 · 명절 날짜</h3>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className={labelCls}>계약 연도</label>
          <select
            className={inputCls}
            value={year}
            onChange={(e) => router.push(`/hr/contracts?tab=salary&year=${e.target.value}`)}
          >
            {[...new Set([...years, year])].sort().map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>설날</label>
          <input type="date" className={inputCls} value={seol} onChange={(e) => setSeol(e.target.value)} data-testid="holiday-seol" />
        </div>
        <div>
          <label className={labelCls}>추석</label>
          <input type="date" className={inputCls} value={chuseok} onChange={(e) => setChuseok(e.target.value)} data-testid="holiday-chuseok" />
        </div>
        <button
          type="button"
          className={btnSecondary}
          disabled={pending}
          onClick={() => {
            setMsg(null);
            start(async () => {
              const res = await saveSalaryHolidays(year, { seol: seol || null, chuseok: chuseok || null });
              setMsg(res.ok ? { ok: true, text: "명절 날짜를 저장했습니다." } : { ok: false, text: res.message });
              if (res.ok) router.refresh();
            });
          }}
        >
          날짜 저장
        </button>
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        명절휴가비는 설·추석 각각 월기본급 × (급여 설정의 명절휴가비 비율 ÷ 2)이고, 그 명절이 속한 달이 계약
        구간에 있을 때만 들어갑니다(예: 3월 시작 계약은 추석만).
      </p>
      {msg && <p className={`mt-2 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>}
    </section>
  );
}

// 구간 편집 + 실시간 미리보기 → 작성 중 저장.
function SegmentEditor({
  ws,
  emp,
  id,
  initial,
  calcFor,
  onClose,
  onSaved,
}: {
  ws: SalaryWorkspace;
  emp: SalaryEmployee;
  id: string | null;
  initial: SegmentInput[];
  calcFor: (s: SegmentInput[]) => ReturnType<typeof computeSalaryContract>;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [segs, setSegs] = useState<SegmentInput[]>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const calc = calcFor(segs);
  const grades = [...new Set(ws.gradeRows.map((g) => g.grade))].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));

  function upd(i: number, patch: Partial<SegmentInput>) {
    setSegs((cur) => cur.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  const blocks = calc.errors.length
    ? []
    : buildSalaryContractBlocks({
        contract: {
          period_start: calc.period_start,
          period_end: calc.period_end,
          total_annual: calc.total,
          amount_in_korean: amountInKorean(calc.total),
          segments: calc.segments,
        },
        employeeName: emp.name,
        clauses: ws.clauses,
      });

  function save() {
    setErr(null);
    start(async () => {
      const res = await saveSalaryContract({ id, driverId: emp.driverId, year: ws.year, segments: segs });
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      onSaved(`${emp.name} 연봉계약서를 작성 중으로 저장했습니다(연봉 ${won(res.total)}원). 목록에서 확인 후 보내세요.`);
    });
  }

  return (
    <Modal title={`${emp.name} — ${ws.year}년 연봉계약서`} onClose={onClose} wide>
      {emp.familyHint && (
        <p className={`mb-3 ${noticeWarning}`}>
          {emp.familyHint}. 계약서 가족수당은 자동으로 넣지 않습니다 — 계약 당시 지급 대상이면 아래 &lsquo;가족수당 월액&rsquo;에
          입력하세요.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs" data-testid="segment-editor">
          <thead>
            <tr className={tableHeadCls}>
              <th className="px-1 py-1.5">시작월</th>
              <th className="px-1 py-1.5">종료월</th>
              <th className="px-1 py-1.5">급</th>
              <th className="px-1 py-1.5">호봉</th>
              <th className="px-1 py-1.5">자격수당</th>
              <th className="px-1 py-1.5">급식</th>
              <th className="px-1 py-1.5">교통</th>
              <th className="px-1 py-1.5">가족수당 월액</th>
              <th className="px-1 py-1.5 text-right">구간 합계</th>
              <th className="px-1 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {segs.map((s, i) => (
              <tr key={i} className={tableRowCls}>
                <td className="px-1 py-1">
                  <input className={cellIn} type="number" min={1} max={12} value={s.start_month} onChange={(e) => upd(i, { start_month: Number(e.target.value) })} />
                </td>
                <td className="px-1 py-1">
                  <input className={cellIn} type="number" min={1} max={12} value={s.end_month} onChange={(e) => upd(i, { end_month: Number(e.target.value) })} />
                </td>
                <td className="px-1 py-1">
                  <select className={cellIn} value={s.grade} onChange={(e) => upd(i, { grade: e.target.value })}>
                    {[...new Set([...grades, s.grade])].map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-1 py-1">
                  <input className={cellIn} type="number" min={1} value={s.step} onChange={(e) => upd(i, { step: Number(e.target.value) })} />
                </td>
                <td className="px-1 py-1">
                  <select className={cellIn} value={s.cert_level} onChange={(e) => upd(i, { cert_level: e.target.value as CertLevel })}>
                    <option value="">없음</option>
                    <option value="1">1급</option>
                    <option value="2">2급</option>
                    <option value="3">3급</option>
                  </select>
                </td>
                <td className="px-1 py-1 text-center">
                  <input type="checkbox" checked={s.meal} onChange={(e) => upd(i, { meal: e.target.checked })} />
                </td>
                <td className="px-1 py-1 text-center">
                  <input type="checkbox" checked={s.transport} onChange={(e) => upd(i, { transport: e.target.checked })} />
                </td>
                <td className="px-1 py-1">
                  <input className={cellIn} type="number" min={0} step={10000} value={s.family_monthly} onChange={(e) => upd(i, { family_monthly: Number(e.target.value) })} />
                </td>
                <td className="px-1 py-1 text-right tabular-nums">{calc.segments[i] ? won(calc.segments[i].total) : "-"}</td>
                <td className="px-1 py-1 text-right">
                  {segs.length > 1 && (
                    <button type="button" className="text-stamp hover:underline" onClick={() => setSegs((cur) => cur.filter((_, j) => j !== i))}>
                      삭제
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={btnSecondary}
          onClick={() => {
            const last = segs[segs.length - 1];
            if (!last || last.end_month >= 12) return;
            setSegs([...segs, { ...last, start_month: last.end_month + 1, end_month: 12, family_monthly: last.family_monthly }]);
          }}
        >
          구간 추가
        </button>
        <button type="button" className={btnSecondary} onClick={() => setSegs(emp.defaultSegments.map((s) => ({ ...s })))}>
          급여설정 값으로 되돌리기
        </button>
      </div>

      {calc.errors.length > 0 ? (
        <div className={`mt-3 ${noticeError}`}>
          {calc.errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm font-semibold text-ink" data-testid="salary-total">
            연봉 {won(calc.total)}원 · {calc.months}개월
          </p>
          <div className="mt-2 rounded-md border border-rule bg-white px-4 py-4">
            <ContractView blocks={blocks} />
          </div>
        </>
      )}
      {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" className={btnPrimary} disabled={pending || calc.errors.length > 0} onClick={save} data-testid="salary-save">
          {pending ? "저장 중…" : id ? "수정 저장" : "작성 중으로 저장"}
        </button>
        <button type="button" className={btnSecondary} onClick={onClose} disabled={pending}>
          닫기
        </button>
      </div>
    </Modal>
  );
}

// 4~6항 조항 문구 — settings. 보낸 계약서에는 영향 없음(고정본).
function SalaryClauseEditor({ initial }: { initial: SalaryClauses }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [c, setC] = useState<SalaryClauses>(initial);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  return (
    <section className={panelToneCls("navy")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={sectionTitleCls("navy")}>연봉계약서 조항 문구</h3>
        <button type="button" className={btnSecondary} onClick={() => setOpen((v) => !v)}>
          {open ? "접기" : "열기"}
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        규정이 바뀌면 여기서 고칩니다(코드 수정 없음). 이미 보낸 계약서는 보낸 시점 문구로 고정되어 바뀌지 않습니다.
      </p>
      {open && (
        <div className="mt-4 space-y-3">
          <div>
            <label className={labelCls}>머리말</label>
            <textarea className={inputCls} rows={2} value={c.lead} onChange={(e) => setC({ ...c, lead: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>
              4. 보수 지급방법 (줄마다 ○ 한 줄 · 자리표시 {"{개월수}"} {"{명절}"} {"{횟수}"} — {"{명절}"}이 든 줄은 명절이 없는 계약에서 빠짐)
            </label>
            <textarea className={inputCls} rows={3} value={c.payment.join("\n")} onChange={(e) => setC({ ...c, payment: e.target.value.split("\n") })} />
          </div>
          <div>
            <label className={labelCls}>5. 연봉재계약의 시기</label>
            <input className={inputCls} value={c.renewal} onChange={(e) => setC({ ...c, renewal: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>6. 기타</label>
            <textarea className={inputCls} rows={2} value={c.etc} onChange={(e) => setC({ ...c, etc: e.target.value })} />
          </div>
          {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={pending}
              onClick={() => {
                setMsg(null);
                start(async () => {
                  const res = await saveSalaryClauses(c);
                  if (!res.ok) {
                    setMsg({ ok: false, text: res.message });
                    return;
                  }
                  setC(res.clauses);
                  setMsg({ ok: true, text: "조항 문구를 저장했습니다. 이제부터 보내는 연봉계약서에 적용됩니다." });
                  router.refresh();
                });
              }}
            >
              조항 문구 저장
            </button>
            <button
              type="button"
              className={btnDanger}
              disabled={pending}
              onClick={() => {
                if (confirm("기본 문구로 되돌릴까요? (저장을 눌러야 반영됩니다)")) setC(DEFAULT_SALARY_CLAUSES);
              }}
            >
              기본 문구로
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
