"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ContractView from "@/app/components/ContractView";
import InkSignaturePad, { SignaturePreview } from "@/app/components/InkSignaturePad";
import {
  saveContract,
  deleteDraftContract,
  sendContract,
  recallContract,
  voidContract,
  getContractBlocks,
  getEmployerSignOptions,
  employerSignContract,
  downloadContractPdf,
  saveContractClauses,
  type ContractEmployee,
  type ContractInput,
  type EmployerSignInput,
} from "@/app/(app)/hr/contracts/actions";
import {
  CONTRACT_DEFAULTS,
  DEFAULT_CONTRACT_CLAUSES,
  contractStateLabel,
  defaultProbationEnd,
  fmtDot,
  isFinalized,
  kstYmd,
  periodLabel,
  type ContractBlock,
  type ContractClauses,
  type ContractType,
  type EmploymentContract,
} from "@/lib/employmentContracts";
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
  badgeNavy,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  badgeDanger,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

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

type Msg = { ok: boolean; text: string } | null;

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
  contracts: EmploymentContract[];
  employees: ContractEmployee[];
  clauses: ContractClauses;
  isM0: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [msg, setMsg] = useState<Msg>(null);
  const [listMsg, setListMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<{ c: EmploymentContract; blocks: ContractBlock[] } | null>(null);
  const [signTarget, setSignTarget] = useState<EmploymentContract | null>(null);
  const [showVoid, setShowVoid] = useState(false);

  const empById = useMemo(() => new Map(employees.map((e) => [e.driverId, e])), [employees]);
  const selected = form.driverId ? empById.get(form.driverId) ?? null : null;
  const visible = contracts.filter((c) => showVoid || c.status !== "void");

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

  // 시작일이 바뀌면 수습(시작일부터 3개월, 취업규칙 7조)을 다시 깝니다 — 직접 고친 뒤엔 그대로.
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

  function run(fn: () => Promise<{ ok: boolean; message?: string; dmFailed?: string | null }>, okText: string) {
    setListMsg(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setListMsg({ ok: false, text: res.message ?? "실패했습니다." });
        return;
      }
      const dm = "dmFailed" in res && res.dmFailed ? ` (슬랙 알림 실패 — ${res.dmFailed})` : "";
      setListMsg({ ok: true, text: okText + dm });
      router.refresh();
    });
  }

  function openPreview(c: EmploymentContract) {
    setListMsg(null);
    start(async () => {
      const res = await getContractBlocks(c.id);
      if (!res.ok) setListMsg({ ok: false, text: res.message });
      else setPreview({ c, blocks: res.blocks });
    });
  }

  function pdf(c: EmploymentContract) {
    setListMsg(null);
    start(async () => {
      const res = await downloadContractPdf(c.id);
      if (!res.ok) setListMsg({ ok: false, text: res.message });
      else downloadBase64Pdf(res.base64, res.filename);
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
              수습기간 두기 <span className="text-xs text-ink-muted">(취업규칙 7조 — 시작일부터 3개월이 기본)</span>
            </label>
            {form.probation && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>수습 시작</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.probationStart}
                    onChange={(e) => setForm((f) => ({ ...f, probationStart: e.target.value, probationTouched: true }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>
                    수습 종료{" "}
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

      {/* ---------- 목록 ---------- */}
      <section className={panelToneCls("green")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={sectionTitleCls("green")}>계약서 목록 ({visible.length})</h3>
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input type="checkbox" checked={showVoid} onChange={(e) => setShowVoid(e.target.checked)} />
            무효 포함
          </label>
        </div>
        {listMsg && <p className={`mt-3 ${listMsg.ok ? noticeSuccess : noticeError}`}>{listMsg.text}</p>}
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-hint">아직 작성한 근로계약서가 없습니다.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className={tableHeadCls}>
                  <th className="px-2 py-2">직원</th>
                  <th className="px-2 py-2">계약기간</th>
                  <th className="px-2 py-2">상태</th>
                  <th className="px-2 py-2">보냄</th>
                  <th className="px-2 py-2">직원 서명</th>
                  <th className="px-2 py-2">센터장 서명</th>
                  <th className="px-2 py-2">교부(내려받음)</th>
                  <th className="px-2 py-2 text-right">작업</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const fin = isFinalized(c);
                  const badge =
                    c.status === "void"
                      ? badgeDanger
                      : fin
                        ? badgeSuccess
                        : c.status === "draft"
                          ? badgeNeutral
                          : c.status === "sent"
                            ? badgeWarning
                            : badgeNavy;
                  return (
                    <tr key={c.id} className={tableRowCls} data-testid="contract-row">
                      <td className="px-2 py-2 font-medium text-ink">{c.employee_name}</td>
                      <td className="px-2 py-2 text-xs">
                        {fmtDot(c.contract_start)} ~ {c.contract_end ? fmtDot(c.contract_end) : "정함 없음"}
                      </td>
                      <td className="px-2 py-2">
                        <span className={badge}>{contractStateLabel(c)}</span>
                      </td>
                      <td className="px-2 py-2 text-xs">{kstYmd(c.sent_at) ?? "-"}</td>
                      <td className="px-2 py-2 text-xs">{kstYmd(c.employee_signed_at) ?? "-"}</td>
                      <td className="px-2 py-2 text-xs">{kstYmd(c.employer_signed_at) ?? "-"}</td>
                      <td className="px-2 py-2 text-xs">{kstYmd(c.delivered_at) ?? "-"}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap justify-end gap-1">
                          <SmallBtn onClick={() => openPreview(c)} disabled={pending}>내용</SmallBtn>
                          <SmallBtn onClick={() => pdf(c)} disabled={pending}>{fin ? "PDF" : "PDF 미리보기"}</SmallBtn>
                          {c.status === "draft" && (
                            <>
                              <SmallBtn onClick={() => { setForm(formFromContract(c)); setMsg(null); window.scrollTo({ top: 0, behavior: "smooth" }); }} disabled={pending}>
                                수정
                              </SmallBtn>
                              <SmallBtn
                                tone="primary"
                                disabled={pending}
                                onClick={() => {
                                  if (confirm(`${c.employee_name} 님에게 계약서를 보낼까요?\n보내면 지금 조항 문구로 고정되고 직원에게 슬랙 알림이 갑니다.`))
                                    run(() => sendContract(c.id), `${c.employee_name} 님에게 보냈습니다.`);
                                }}
                              >
                                보내기
                              </SmallBtn>
                              <SmallBtn
                                tone="danger"
                                disabled={pending}
                                onClick={() => {
                                  if (confirm("작성 중인 계약서를 삭제할까요?")) run(() => deleteDraftContract(c.id), "삭제했습니다.");
                                }}
                              >
                                삭제
                              </SmallBtn>
                            </>
                          )}
                          {c.status === "sent" && (
                            <SmallBtn
                              disabled={pending}
                              onClick={() => {
                                if (confirm("발송을 취소하고 작성 중으로 되돌릴까요? (직원 화면에서 사라집니다)"))
                                  run(() => recallContract(c.id), "작성 중으로 되돌렸습니다.");
                              }}
                            >
                              발송 취소
                            </SmallBtn>
                          )}
                          {c.status === "signed" && !c.employer_signed_at && isM0 && (
                            <SmallBtn tone="primary" disabled={pending} onClick={() => setSignTarget(c)}>
                              센터장 서명
                            </SmallBtn>
                          )}
                          {(c.status === "sent" || c.status === "signed") && isM0 && (
                            <SmallBtn
                              tone="danger"
                              disabled={pending}
                              onClick={() => {
                                if (confirm(`${c.employee_name} 님 계약서를 무효로 할까요? 기록은 남고 직원 화면에서는 사라집니다.`))
                                  run(() => voidContract(c.id), "무효로 처리했습니다.");
                              }}
                            >
                              무효
                            </SmallBtn>
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
        {!isM0 && (
          <p className="mt-3 text-xs text-ink-muted">센터장 서명과 무효 처리는 관장·부장만 할 수 있습니다.</p>
        )}
      </section>

      {/* ---------- 조항 문구 ---------- */}
      <ClauseEditor initial={clauses} />

      {preview && (
        <Modal title={`${preview.c.employee_name} — 근로계약서 내용`} onClose={() => setPreview(null)}>
          <p className="mb-3 text-xs text-ink-muted">
            화면에서는 주민등록번호 뒷자리를 가립니다. PDF 에는 전체 번호가 들어갑니다.
            {preview.c.status === "draft" ? " 작성 중이라 현행 조항 문구로 보입니다." : " 보낸 시점의 조항 문구로 고정되어 있습니다."}
          </p>
          <div className="rounded-md border border-rule bg-white px-4 py-4">
            <ContractView
              blocks={preview.blocks}
              employeeSigned={!!preview.c.employee_signed_at}
              employerSigned={!!preview.c.employer_signed_at}
            />
          </div>
        </Modal>
      )}

      {signTarget && (
        <EmployerSignDialog
          contract={signTarget}
          onClose={() => setSignTarget(null)}
          onDone={(text) => {
            setSignTarget(null);
            setListMsg({ ok: true, text });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function SmallBtn({
  children,
  onClick,
  disabled,
  tone = "secondary",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "secondary" | "primary" | "danger";
}) {
  const cls =
    tone === "primary"
      ? "bg-navy text-white hover:bg-navy-strong border-navy"
      : tone === "danger"
        ? "border-stamp text-stamp hover:bg-stamp-soft bg-card"
        : "border-line text-ink-body hover:bg-surface bg-card";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-card p-4 shadow-lg sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-base font-bold text-ink">{title}</p>
          <button type="button" onClick={onClose} className={btnSecondary}>
            닫기
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// 센터장 서명 — 관장 도장(stamp_path) 우선, 없거나 원하면 직접 서명.
function EmployerSignDialog({
  contract,
  onClose,
  onDone,
}: {
  contract: EmploymentContract;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [stamp, setStamp] = useState<string | null>(null);
  const [mySig, setMySig] = useState<string | null>(null);
  const [mode, setMode] = useState<"stamp" | "saved" | "drawn">("stamp");
  const [drawn, setDrawn] = useState<string | null>(null);
  const [save, setSave] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    getEmployerSignOptions().then((res) => {
      if (!alive) return;
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      setStamp(res.stamp);
      setMySig(res.mySignature);
      setMode(res.stamp ? "stamp" : res.mySignature ? "saved" : "drawn");
    });
    return () => {
      alive = false;
    };
  }, []);

  const canConfirm = mode === "stamp" ? !!stamp : mode === "saved" ? !!mySig : !!drawn;

  function confirmSign() {
    setErr(null);
    const input: EmployerSignInput =
      mode === "drawn" ? { mode: "drawn", dataUrl: drawn ?? "", save } : { mode };
    start(async () => {
      const res = await employerSignContract(contract.id, input);
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      onDone(
        `${contract.employee_name} 님 계약서 체결 완료 — PDF 를 확정했습니다.` +
          (res.dmFailed ? ` (슬랙 알림 실패 — ${res.dmFailed})` : "")
      );
    });
  }

  const opt = (m: typeof mode, label: string, enabled: boolean) => (
    <label className={`flex items-center gap-2 text-sm ${enabled ? "text-ink-body" : "text-ink-hint"}`}>
      <input type="radio" name="employer-sign" checked={mode === m} disabled={!enabled} onChange={() => setMode(m)} />
      {label}
    </label>
  );

  return (
    <Modal title={`센터장 서명 — ${contract.employee_name}`} onClose={onClose}>
      <p className="text-xs text-ink-muted">
        직원 서명이 끝난 계약서입니다({kstYmd(contract.employee_signed_at)}). 서명하면 PDF 가 확정되어 직원 마이페이지에서
        내려받을 수 있게 됩니다.
      </p>
      <div className="mt-3 space-y-2">
        {opt("stamp", stamp ? "관장 도장으로 서명" : "관장 도장 (등록 안 됨)", !!stamp)}
        {opt("saved", mySig ? "내 저장 서명 사용" : "내 저장 서명 (없음)", !!mySig)}
        {opt("drawn", "직접 그려 서명", true)}
      </div>
      <div className="mt-3">
        {mode === "stamp" && stamp && <SignaturePreview src={stamp} alt="관장 도장" />}
        {mode === "saved" && mySig && <SignaturePreview src={mySig} alt="내 저장 서명" />}
        {mode === "drawn" && (
          <>
            <InkSignaturePad onChange={setDrawn} />
            <label className="mt-2 flex items-center gap-2 text-xs text-ink-body">
              <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
              이 서명을 내 서명으로 저장
            </label>
          </>
        )}
      </div>
      {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" className={`${btnPrimary} flex-1`} disabled={pending || !canConfirm} onClick={confirmSign}>
          {pending ? "처리 중…" : "서명하고 PDF 확정"}
        </button>
        <button type="button" className={btnSecondary} onClick={onClose} disabled={pending}>
          취소
        </button>
      </div>
    </Modal>
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
          {field("2조 수습 문장 (기간 뒤에 붙는 말)", c.probationNote, (v) => setC({ ...c, probationNote: v }))}
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
