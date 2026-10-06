"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveContract,
  saveContractClauses,
  getEmploymentContract,
  type ContractEmployee,
  type ContractInput,
} from "@/app/(app)/hr/contracts/actions";
import { ContractList, type Msg } from "@/app/(app)/hr/contracts/shared";
import { periodLabel, type ContractSummary } from "@/lib/contractCore";
import {
  CONTRACT_DEFAULTS,
  DEFAULT_CONTRACT_CLAUSES,
  defaultProbationEnd,
  type ContractClauses,
  type ContractType,
  type EmploymentContract,
} from "@/lib/employmentContracts";
import {
  panelToneCls,
  sectionTitleCls,
  inputCls,
  labelCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

// =====================================================================
// 근로계약서 탭 — 작성 폼 + (공용) 목록 + 조항 문구.
//   목록·보내기·서명·PDF 는 연봉계약서와 공용인 ./shared(ContractList) 를 씁니다.
// =====================================================================

type FormState = {
  id: string | null;
  driverId: string;
  contractType: ContractType;
  contractStart: string;
  contractEnd: string;
  probation: boolean;
  probationStart: string;
  probationEnd: string;
  probationTouched: boolean; // 직접 고쳤으면 시작일 바뀌어도 덮지 않음
  department: string;
  position: string;
  dutyContent: string;
  workHours: string;
  workDays: string;
  weeklyHours: string;
  workplace: string;
  breakTime: string;
  paymentDay: string;
};

function thisYear(): number {
  return new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();
}

function emptyForm(): FormState {
  const y = thisYear();
  const start = `${y}-01-01`;
  return {
    id: null,
    driverId: "",
    contractType: "fixed_term",
    contractStart: start,
    contractEnd: `${y}-12-31`,
    probation: true,
    probationStart: start,
    probationEnd: defaultProbationEnd(start),
    probationTouched: false,
    department: "",
    position: "",
    dutyContent: CONTRACT_DEFAULTS.duty_content,
    workHours: CONTRACT_DEFAULTS.work_hours,
    workDays: CONTRACT_DEFAULTS.work_days,
    weeklyHours: String(CONTRACT_DEFAULTS.weekly_hours),
    workplace: CONTRACT_DEFAULTS.workplace,
    breakTime: CONTRACT_DEFAULTS.break_time,
    paymentDay: CONTRACT_DEFAULTS.payment_day,
  };
}

function formFromContract(c: EmploymentContract): FormState {
  return {
    id: c.id,
    driverId: c.driver_id,
    contractType: c.contract_type,
    contractStart: c.contract_start,
    contractEnd: c.contract_end ?? "",
    probation: !!(c.probation_start && c.probation_end),
    probationStart: c.probation_start ?? c.contract_start,
    probationEnd: c.probation_end ?? defaultProbationEnd(c.contract_start),
    probationTouched: true,
    department: c.department ?? "",
    position: c.position ?? "",
    dutyContent: c.duty_content ?? "",
    workHours: c.work_hours ?? "",
    workDays: c.work_days ?? "",
    weeklyHours: c.weekly_hours == null ? "" : String(c.weekly_hours),
    workplace: c.workplace ?? "",
    breakTime: c.break_time ?? "",
    paymentDay: c.payment_day ?? "",
  };
}


export default function ContractsManager({
  contracts,
  employees,
  clauses,
  isM0,
}: {
  contracts: ContractSummary[];
  employees: ContractEmployee[];
  clauses: ContractClauses;
  isM0: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  const empById = useMemo(() => new Map(employees.map((e) => [e.driverId, e])), [employees]);
  const selected = form.driverId ? empById.get(form.driverId) ?? null : null;


  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // 직원 선택 → 부서·직위는 currentAssignment(발령 이력)에서 채웁니다.
  function pickEmployee(id: string) {
    const e = empById.get(id);
    setForm((f) => ({
      ...f,
      driverId: id,
      department: e?.department ?? "",
      position: e?.position ?? "",
    }));
  }

  // 시작일이 바뀌면 시용기간(시작일부터 3개월, 취업규칙 7조 수습기간 기준)을 다시 깝니다 — 직접 고친 뒤엔 그대로.
  function changeStart(v: string) {
    setForm((f) => ({
      ...f,
      contractStart: v,
      ...(f.probationTouched || !v
        ? {}
        : { probationStart: v, probationEnd: defaultProbationEnd(v) }),
    }));
  }

  function toInput(f: FormState): ContractInput {
    return {
      id: f.id,
      driverId: f.driverId,
      contractType: f.contractType,
      contractStart: f.contractStart,
      contractEnd: f.contractType === "fixed_term" ? f.contractEnd : null,
      probation: f.probation,
      probationStart: f.probation ? f.probationStart : null,
      probationEnd: f.probation ? f.probationEnd : null,
      department: f.department,
      position: f.position,
      dutyContent: f.dutyContent,
      workHours: f.workHours,
      workDays: f.workDays,
      weeklyHours: f.weeklyHours.trim() === "" ? null : Number(f.weeklyHours),
      workplace: f.workplace,
      breakTime: f.breakTime,
      paymentDay: f.paymentDay,
    };
  }

  function submit() {
    setMsg(null);
    start(async () => {
      const res = await saveContract(toInput(form));
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({ ok: true, text: form.id ? "수정했습니다." : "작성 중으로 저장했습니다. 목록에서 내용을 확인한 뒤 [보내기] 하세요." });
      setForm(emptyForm());
      router.refresh();
    });
  }

  // 목록의 [수정] — 원본을 다시 읽어 폼에 채웁니다.
  function editDraft(item: ContractSummary) {
    setMsg(null);
    start(async () => {
      const res = await getEmploymentContract(item.id);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setForm(formFromContract(res.contract));
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }


  const contractMonths =
    form.contractType === "fixed_term" && form.contractStart && form.contractEnd
      ? periodLabel(form.contractStart, form.contractEnd)
      : "";

  return (
    <div className="space-y-6">
      {/* ---------- 작성 ---------- */}
      <section className={panelToneCls("yellow")}>
        <h3 className={sectionTitleCls("yellow")}>{form.id ? "계약서 수정 (작성 중)" : "계약서 작성"}</h3>
        <p className="mt-1 text-xs text-ink-muted">
          사람마다 달라지는 2·3조만 입력합니다. 성명·주민등록번호·주소는 인사기록카드에서 자동으로
          들어가고(주민번호는 PDF 에만), 나머지 조항은 아래 [조항 문구]에서 관리합니다.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelCls}>직원</label>
            <select
              className={inputCls}
              value={form.driverId}
              onChange={(e) => pickEmployee(e.target.value)}
              disabled={!!form.id}
              data-testid="contract-employee"
            >
              <option value="">— 직원 선택 —</option>
              {employees.map((e) => (
                <option key={e.driverId} value={e.driverId}>
                  {e.name}
                  {e.department || e.position ? ` · ${[e.department, e.position].filter(Boolean).join(" ")}` : ""}
                </option>
              ))}
            </select>
            {selected && (!selected.hasAssignment || !selected.hasRrn || !selected.hasAddress) && (
              <p className={`mt-2 ${noticeWarning}`}>
                {[
                  !selected.hasAssignment && "발령기록 없음(직위·부서를 직접 입력하세요)",
                  !selected.hasRrn && "주민등록번호 미입력",
                  !selected.hasAddress && "주소 미입력",
                ]
                  .filter(Boolean)
                  .join(" · ")}{" "}
                — 인사기록카드를 먼저 채우면 계약서에 자동으로 들어갑니다.
              </p>
            )}
          </div>

          <div>
            <label className={labelCls}>계약 형태</label>
            <select
              className={inputCls}
              value={form.contractType}
              onChange={(e) => set("contractType", e.target.value as ContractType)}
            >
              <option value="fixed_term">기간제</option>
              <option value="permanent">기간의 정함 없음</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>계약 시작일</label>
              <input type="date" className={inputCls} value={form.contractStart} onChange={(e) => changeStart(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>계약 종료일 {contractMonths && <span className="text-navy">({contractMonths})</span>}</label>
              <input
                type="date"
                className={inputCls}
                value={form.contractEnd}
                disabled={form.contractType !== "fixed_term"}
                onChange={(e) => set("contractEnd", e.target.value)}
              />
            </div>
          </div>

          <div className="sm:col-span-2 rounded-lg border border-rule p-3">
            <label className="flex items-center gap-2 text-sm text-ink-body">
              <input type="checkbox" checked={form.probation} onChange={(e) => set("probation", e.target.checked)} />
              시용기간 두기 <span className="text-xs text-ink-muted">(시작일부터 3개월이 기본 — 취업규칙 7조)</span>
            </label>
            {form.probation && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>시용 시작</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.probationStart}
                    onChange={(e) => setForm((f) => ({ ...f, probationStart: e.target.value, probationTouched: true }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>
                    시용 종료{" "}
                    {form.probationStart && form.probationEnd && (
                      <span className="text-navy">({periodLabel(form.probationStart, form.probationEnd)})</span>
                    )}
                  </label>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.probationEnd}
                    onChange={(e) => setForm((f) => ({ ...f, probationEnd: e.target.value, probationTouched: true }))}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <label className={labelCls}>① 부서</label>
            <input className={inputCls} value={form.department} onChange={(e) => set("department", e.target.value)} placeholder="청소년사업팀" />
          </div>
          <div>
            <label className={labelCls}>① 직위</label>
            <input className={inputCls} value={form.position} onChange={(e) => set("position", e.target.value)} placeholder="청소년지도자" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>② 업무내용</label>
            <input className={inputCls} value={form.dutyContent} onChange={(e) => set("dutyContent", e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-2 sm:col-span-2">
            <div>
              <label className={labelCls}>③ 근무시간</label>
              <input className={inputCls} value={form.workHours} onChange={(e) => set("workHours", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>근무요일</label>
              <input className={inputCls} value={form.workDays} onChange={(e) => set("workDays", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>주 근로시간</label>
              <input className={inputCls} inputMode="numeric" value={form.weeklyHours} onChange={(e) => set("weeklyHours", e.target.value)} />
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>④ 근무장소</label>
            <input className={inputCls} value={form.workplace} onChange={(e) => set("workplace", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>⑤ 휴게시간</label>
            <input className={inputCls} value={form.breakTime} onChange={(e) => set("breakTime", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>⑦ 임금 지급일</label>
            <input className={inputCls} value={form.paymentDay} onChange={(e) => set("paymentDay", e.target.value)} />
          </div>
        </div>

        {msg && <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} disabled={pending || !form.driverId} onClick={submit} data-testid="contract-save">
            {form.id ? "수정 저장" : "작성 중으로 저장"}
          </button>
          {form.id && (
            <button type="button" className={btnSecondary} onClick={() => setForm(emptyForm())} disabled={pending}>
              새로 작성
            </button>
          )}
        </div>
      </section>

      {/* ---------- 목록(공용) ---------- */}
      <ContractList kind="employment" items={contracts} isM0={isM0} onEdit={editDraft} />

      {/* ---------- 조항 문구 ---------- */}
      <ClauseEditor initial={clauses} />
    </div>
  );
}

// 조항 문구 — settings 테이블. 줄마다 한 항목. 보낸 계약서에는 영향 없음(고정본).
function ClauseEditor({ initial }: { initial: ContractClauses }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [c, setC] = useState<ContractClauses>(initial);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  const toLines = (arr: string[]) => arr.join("\n");

  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveContractClauses(c);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setC(res.clauses);
      setMsg({ ok: true, text: "조항 문구를 저장했습니다. 이제부터 보내는 계약서에 적용됩니다." });
      router.refresh();
    });
  }

  const field = (label: string, value: string, onChange: (v: string) => void, rows = 2) => (
    <div>
      <label className={labelCls}>{label}</label>
      <textarea className={inputCls} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );

  return (
    <section className={panelToneCls("navy")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={sectionTitleCls("navy")}>조항 문구</h3>
        <button type="button" className={btnSecondary} onClick={() => setOpen((v) => !v)}>
          {open ? "접기" : "열기"}
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        규정이 바뀌면 여기서 고칩니다(코드 수정 없음). 이미 보낸 계약서는 보낸 시점 문구로 고정되어 바뀌지 않습니다.
      </p>
      {open && (
        <div className="mt-4 space-y-3">
          {field("1조 리드문 ({근로자} 자리에 성명이 들어갑니다)", c.lead, (v) => setC({ ...c, lead: v }))}
          {field("2조 시용 문장 (기간 뒤에 붙는 말)", c.probationNote, (v) => setC({ ...c, probationNote: v }))}
          {field("3조 ④ 근무장소 단서 (괄호 안)", c.workplaceNote, (v) => setC({ ...c, workplaceNote: v }))}
          {field("3조 ⑥ 임금의 구성", c.wageComposition, (v) => setC({ ...c, wageComposition: v }), 1)}
          {field("3조 ⑦ 임금 지급 단서 (괄호 안)", c.paymentNote, (v) => setC({ ...c, paymentNote: v }))}
          {field("3조 ⑧ 기타사항 (줄마다 한 항목)", toLines(c.etc), (v) => setC({ ...c, etc: v.split("\n") }), 7)}
          {c.articles.map((a, i) => (
            <div key={i} className="rounded-lg border border-rule p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-ink">{i + 4}.</span>
                <input
                  className={inputCls}
                  value={a.title}
                  onChange={(e) => {
                    const articles = [...c.articles];
                    articles[i] = { ...a, title: e.target.value };
                    setC({ ...c, articles });
                  }}
                />
              </div>
              <textarea
                className={`${inputCls} mt-2`}
                rows={Math.max(2, a.items.length + 1)}
                value={toLines(a.items)}
                onChange={(e) => {
                  const articles = [...c.articles];
                  articles[i] = { ...a, items: e.target.value.split("\n") };
                  setC({ ...c, articles });
                }}
              />
              <p className="mt-1 text-[11px] text-ink-hint">줄마다 한 항(①②…). 번호는 자동으로 붙습니다.</p>
            </div>
          ))}
          {field("마지막 조 끝 항 — 교부 확인 (뒤에 (인)과 근로자 서명이 붙습니다)", c.deliveryConfirm, (v) => setC({ ...c, deliveryConfirm: v }))}
          {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={pending}
              onClick={save}
            >
              조항 문구 저장
            </button>
            <button
              type="button"
              className={btnDanger}
              disabled={pending}
              onClick={() => {
                if (confirm("기본 문구로 되돌릴까요? (저장을 눌러야 반영됩니다)")) setC(DEFAULT_CONTRACT_CLAUSES);
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
