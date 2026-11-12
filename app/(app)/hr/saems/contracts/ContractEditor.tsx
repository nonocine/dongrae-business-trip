"use client";

// =====================================================================
// 강사 계약서 만들기 — 강좌 목록·강사 상세·계약서 탭 공용 모달.
//   전자서명: 양식 선택 → 칸 자동 채움(직원 수정) → 미리보기(칸 색 표시) → 저장/발송
//   종이: PDF·이미지 업로드 → 바로 체결 완료
// =====================================================================

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  getContractContext,
  saveInstructorContractDraft,
  sealInstructorContract,
  sendInstructorContract,
  uploadPaperInstructorContract,
  type ContractContext,
  type ContractProgramOption,
  type ContractTemplateOption,
} from "@/app/(app)/hr/saems/contractActions";
import {
  FIELD_LABEL,
  INSTRUCTOR_CONTRACT_EMPLOYER as EMP,
  INSTRUCTOR_CONTRACT_STATUS_LABEL,
  PROGRAM_INFO_BLOCK_MESSAGE,
  TAX_TYPE_LABEL,
  autoFields,
  bodySegments,
  distinctProgramNames,
  usedKeys,
  emptyFields,
  koreanDate,
  missingFields,
  payClause,
  taxClause,
  type ContractFields,
  type ContractPayType,
  type SigningMethod,
  type TaxType,
} from "@/lib/instructorContract";
import { btnPrimary, btnSecondary, noticeError, noticeSuccess, noticeWarning } from "@/lib/ui";
import ContractLinkCopyButton from "@/app/(app)/hr/saems/contracts/ContractLinkCopyButton";

const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const lblCls = "block text-[11px] font-semibold text-navy";

const PAY_LABEL: Record<ContractPayType, string> = {
  hourly: "시간당",
  per_session: "회당",
  revenue_share: "수익배분(직접 입력)",
};

function pickTemplate(templates: ContractTemplateOption[], projectId: string | null): ContractTemplateOption | null {
  return (
    (projectId ? templates.find((t) => t.projectId === projectId) : undefined) ??
    templates.find((t) => t.projectId == null) ??
    templates[0] ??
    null
  );
}

function fieldsFor(
  ctx: ContractContext,
  progs: ContractProgramOption[],
  tpl: ContractTemplateOption | null
): ContractFields {
  const first = progs[0];
  if (!first) return { ...emptyFields(), instructor_name: ctx.instructor.name, contract_date: ctx.today, tax_type: tpl?.defaultTaxType ?? "business_3_3", tax_clause: taxClause(tpl?.defaultTaxType ?? "business_3_3") };
  // 묶음 — 강좌명·근무시간·수업시간은 강좌 전체, 학기·강사료는 첫 강좌(묶음은 같은 학기·같은 강사료).
  return autoFields({
    programs: progs.map((p) => ({
      name: p.name,
      subject: p.subject,
      weekdays: p.weekdays,
      timeStart: p.timeStart,
      timeEnd: p.timeEnd,
      sessionMinutes: p.sessionMinutes,
    })),
    instructorName: ctx.instructor.name,
    termStart: first.termStart,
    termEnd: first.termEnd,
    payType: first.payType,
    hourlyRate: first.hourlyRate,
    sessionFee: first.sessionFee,
    taxType: tpl?.defaultTaxType ?? "business_3_3",
    today: ctx.today,
  });
}

// 새 계약 기본 선택 — 기준 강좌 + 같은 학기·같은 강사료·아직 계약에 안 든 강좌.
function defaultSelection(programs: ContractProgramOption[], anchor: ContractProgramOption | null): string[] {
  if (!anchor) return [];
  const rest = programs.filter(
    (p) => p.id !== anchor.id && p.termId === anchor.termId && p.payKey === anchor.payKey && !p.activeContractId
  );
  return [anchor.id, ...rest.map((p) => p.id)];
}

export default function ContractEditor({
  instructorId,
  programId,
  contractId,
  onClose,
  onDone,
  canSeal = false,
}: {
  // 관장·부장(M0) — 강사 서명이 끝난 계약서면 창 맨 위에 [직인 날인](서버가 다시 확인).
  canSeal?: boolean;
  instructorId?: string | null;
  programId?: string | null;
  contractId?: string | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [ctx, setCtx] = useState<ContractContext | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [method, setMethod] = useState<SigningMethod>("electronic");
  // 고른 강좌(첫 강좌 = 대표 강좌)와 보고 있는 학기.
  const [selIds, setSelIds] = useState<string[]>([]);
  const [termSel, setTermSel] = useState<string>("");
  const [tplId, setTplId] = useState<string>("");
  const [f, setF] = useState<ContractFields>(emptyFields());
  const [draftId, setDraftId] = useState<string | null>(contractId ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sentInfo, setSentInfo] = useState<{ id: string; smsError: string | null } | null>(null);
  // 지금 열고 있는 대상. 같은 강좌 계약서가 이미 있으면 그 계약서로 바꿔 엽니다.
  const [target, setTarget] = useState({ instructorId, programId, contractId });
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getContractContext(target);
      if (!alive) return;
      if (!r.ok) return setLoadErr(r.message);
      setLoadErr(null);
      setErr(null);
      setCtx(r);
      if (r.existing) {
        setDraftId(r.existing.id);
        setMethod(r.existing.signingMethod);
        setSelIds(r.existing.programIds);
        setTermSel(r.programs.find((p) => p.id === r.existing!.programIds[0])?.termId ?? r.programs[0]?.termId ?? "");
        setTplId(r.existing.templateId ?? pickTemplate(r.templates, null)?.id ?? "");
        setF(r.existing.fields);
        if (r.existing.openedExisting)
          setNotice(
            `이 강좌의 계약서가 이미 있어 새로 만들지 않고 기존 계약서(${r.existing.contractNo}, ${INSTRUCTOR_CONTRACT_STATUS_LABEL[r.existing.status]})를 열었습니다.`
          );
        return;
      }
      setDraftId(null);
      // 새 계약 — 지정된 강좌, 없으면 아직 계약이 없는 첫 강좌.
      const prog =
        r.programs.find((p) => p.id === target.programId) ??
        r.programs.find((p) => !p.activeContractId) ??
        null;
      const tpl = pickTemplate(r.templates, prog?.projectId ?? null);
      const sel = defaultSelection(r.programs, prog);
      setSelIds(sel);
      setTermSel(prog?.termId ?? r.programs[0]?.termId ?? "");
      setTplId(tpl?.id ?? "");
      setF(fieldsFor(r, sel.map((id) => r.programs.find((p) => p.id === id)!).filter(Boolean), tpl));
    })();
    return () => {
      alive = false;
    };
  }, [target]);

  // 이미 있는 계약서로 옮겨 엽니다(강좌 선택·저장 중 중복 발견 시).
  function openExisting(id: string, message: string) {
    setNotice(message);
    setCtx(null);
    setTarget({ instructorId: null, programId: null, contractId: id });
  }

  const selProgs = useMemo(
    () => selIds.map((id) => ctx?.programs.find((p) => p.id === id)).filter((p): p is ContractProgramOption => !!p),
    [selIds, ctx]
  );
  const prog = selProgs[0] ?? null; // 대표 강좌
  const progId = prog?.id ?? "";
  const tpl = ctx?.templates.find((t) => t.id === tplId) ?? null;
  const readOnly = !!ctx?.existing && ctx.existing.status !== "draft";
  const missing = useMemo(() => (tpl ? missingFields(f, tpl.body) : []), [f, tpl]);
  const used = useMemo(() => new Set(tpl ? usedKeys(tpl.body) : []), [tpl]);
  // 유급 강좌 정보가 덜 됐으면(강좌명 2자 미만·강사료 금액 없음) 발송을 막습니다.
  const infoIssues = selProgs.flatMap((p) => p.infoIssues.map((x) => (selProgs.length > 1 ? `${p.name}: ${x}` : x)));
  const set = (p: Partial<ContractFields>) => setF((prev) => ({ ...prev, ...p }));

  // 학기 목록(강사가 맡은 유급 강좌의 학기, 최신 먼저)과 지금 학기의 후보 강좌.
  const termOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of ctx?.programs ?? [])
      if (!m.has(p.termId)) m.set(p.termId, `${p.projectName ? `[${p.projectName}] ` : ""}${p.termName || "학기 미정"}`);
    return [...m];
  }, [ctx]);
  const termProgs = useMemo(() => (ctx?.programs ?? []).filter((p) => p.termId === termSel), [ctx, termSel]);
  const nameOf = useMemo(() => distinctProgramNames(termProgs), [termProgs]);

  // 선택이 바뀌면 묶음 기준으로 칸을 다시 채웁니다(원천징수·체결일·차시 꼬리는 유지).
  function applySelection(ids: string[]) {
    if (!ctx) return;
    setSelIds(ids);
    const progs = ids.map((id) => ctx.programs.find((p) => p.id === id)).filter((p): p is ContractProgramOption => !!p);
    const t = tpl ?? pickTemplate(ctx.templates, progs[0]?.projectId ?? null);
    if (!tpl && t) setTplId(t.id);
    setF((prev) => ({
      ...fieldsFor(ctx, progs, t),
      tax_type: prev.tax_type,
      tax_clause: prev.tax_clause,
      contract_date: prev.contract_date || ctx.today,
      round_label: prev.round_label,
    }));
  }
  function toggleProgram(id: string) {
    const next = selIds.includes(id) ? selIds.filter((x) => x !== id) : [...selIds, id];
    applySelection(next);
  }
  function changeTerm(id: string) {
    if (!ctx) return;
    setTermSel(id);
    const anchor = ctx.programs.find((p) => p.termId === id && (!p.activeContractId || p.activeContractId === draftId)) ?? null;
    applySelection(defaultSelection(ctx.programs, anchor));
  }
  function changePay(t: ContractPayType) {
    set({ pay_type: t, pay_clause: payClause(t, { hourly_rate: prog?.hourlyRate ?? null, session_fee: prog?.sessionFee ?? null }) });
  }
  function changeTax(t: TaxType) {
    set({ tax_type: t, tax_clause: taxClause(t) });
  }

  function save(thenSend: boolean) {
    if (!ctx) return;
    setErr(null);
    setInfo(null);
    start(async () => {
      const saved = await saveInstructorContractDraft({
        id: draftId,
        instructorId: ctx.instructor.id,
        programIds: selIds,
        templateId: tplId,
        fields: f,
      });
      if (!saved.ok) {
        if (saved.existingId) return openExisting(saved.existingId, saved.message);
        return setErr(saved.message);
      }
      setDraftId(saved.id);
      if (!thenSend) {
        onDone("계약서를 저장했습니다(작성 중).");
        return;
      }
      const sent = await sendInstructorContract(saved.id);
      if (!sent.ok) return setErr(sent.message);
      // 바로 닫지 않고 발송 완료 안내창을 띄웁니다([링크 복사] 포함).
      setSentInfo({ id: saved.id, smsError: sent.smsError });
    });
  }

  function closeAfterSend() {
    if (!sentInfo) return;
    onDone(
      sentInfo.smsError
        ? `발송 처리했지만 문자를 보내지 못했습니다(${sentInfo.smsError}). [링크 복사]로 직접 전달하세요.`
        : "계약서를 보냈습니다. 강사에게 서명 요청 문자를 보냈습니다."
    );
  }

  function uploadPaper() {
    if (!ctx) return;
    setErr(null);
    if (!selIds.length) return setErr("강좌를 고르세요.");
    if (!file) return setErr("파일을 선택하세요.");
    const fd = new FormData();
    fd.set("instructor_id", ctx.instructor.id);
    for (const id of selIds) fd.append("program_id", id);
    fd.set("file", file);
    start(async () => {
      const r = await uploadPaperInstructorContract(fd);
      if (!r.ok) {
        if (r.existingId) return openExisting(r.existingId, r.message);
        return setErr(r.message);
      }
      onDone("종이 계약서를 올렸습니다(체결 완료).");
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-bold text-ink">
            {ctx?.existing ? `강사 계약서 ${ctx.existing.contractNo}` : "계약서 만들기"}
            {ctx && <span className="ml-2 text-sm font-normal text-ink-muted">{ctx.instructor.name} 강사</span>}
            {ctx?.existing && (
              <span className="ml-2 text-xs font-normal text-ink-hint">
                ({INSTRUCTOR_CONTRACT_STATUS_LABEL[ctx.existing.status]})
              </span>
            )}
          </h3>
          <button type="button" onClick={sentInfo ? closeAfterSend : onClose} className="text-sm text-ink-muted hover:underline">
            닫기
          </button>
        </div>

        {/* 날인 대기(강사 서명 완료) — 스크롤 없이 바로 누르도록 창 맨 위에 둡니다. */}
        {canSeal && ctx?.existing?.status === "instructor_signed" && !sentInfo && (
          <div className="sticky top-0 z-10 -mx-5 -mt-1 mb-3 flex flex-wrap items-center gap-2 border-y border-navy bg-navy-soft px-5 py-2.5">
            <span className="text-sm font-semibold text-navy">강사 서명 완료 — 관장 직인 날인 대기</span>
            <button
              type="button"
              className={`${btnPrimary} ml-auto`}
              disabled={pending}
              onClick={() => {
                if (!ctx?.existing) return;
                if (!confirm(`${ctx.instructor.name} 강사 계약서에 기관 직인을 날인하고 PDF 로 확정할까요?`)) return;
                const id = ctx.existing.id;
                start(async () => {
                  const r = await sealInstructorContract(id);
                  if (!r.ok) return setErr(r.message);
                  onDone("직인을 날인하고 PDF 를 만들었습니다.");
                });
              }}
            >
              {pending ? "날인 중…" : "직인 날인"}
            </button>
          </div>
        )}
        {err && canSeal && ctx?.existing?.status === "instructor_signed" && <p className={`mb-3 ${noticeError}`}>{err}</p>}

        {loadErr && <p className={noticeError}>{loadErr}</p>}
        {notice && <p className={`mb-3 ${noticeWarning}`}>{notice}</p>}
        {!ctx && !loadErr && <p className="py-8 text-center text-sm text-ink-hint">불러오는 중…</p>}

        {/* 발송 완료 안내창 */}
        {ctx && sentInfo && (
          <div className="space-y-3">
            <p className={sentInfo.smsError ? noticeWarning : noticeSuccess}>
              {sentInfo.smsError
                ? `발송 처리했지만 서명 요청 문자를 보내지 못했습니다(${sentInfo.smsError}). 아래 [링크 복사]로 강사에게 직접 전달하세요.`
                : `${ctx.instructor.name} 강사에게 서명 요청 문자를 보냈습니다. 카톡 등으로 따로 알리려면 [링크 복사]를 쓰세요.`}
            </p>
            <div className="flex flex-wrap gap-2">
              <ContractLinkCopyButton contractId={sentInfo.id} saemBase={ctx.saemBase} className={btnPrimary} />
              <button type="button" className={btnSecondary} onClick={closeAfterSend}>
                확인
              </button>
            </div>
          </div>
        )}

        {ctx && !sentInfo && readOnly && (
          <>
            {ctx.existing?.status === "sent" && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <ContractLinkCopyButton contractId={ctx.existing.id} saemBase={ctx.saemBase} />
                <span className="text-[11px] text-ink-hint">강사 본인이 동래샘들에 로그인해야 열립니다.</span>
              </div>
            )}
            <p className="mb-2 text-xs text-ink-muted">
              강좌:{" "}
              {(ctx.existing?.programIds ?? [])
                .map((id) => ctx.programs.find((p) => p.id === id)?.name ?? "(목록에 없는 강좌)")
                .join(", ") || "강좌 미지정"}
              <span className="ml-1 text-ink-hint">— 보낸 뒤에는 강좌를 바꿀 수 없습니다.</span>
            </p>
            <ReadOnlyView ctx={ctx} />
          </>
        )}

        {ctx && !sentInfo && !readOnly && (
          <>
            {!ctx.existing && (
              <div className="mb-3 flex flex-wrap gap-4 text-sm">
                {(["electronic", "paper"] as const).map((m) => (
                  <label key={m} className="flex items-center gap-1.5">
                    <input type="radio" checked={method === m} onChange={() => setMethod(m)} />
                    {m === "electronic" ? "전자서명(동래샘들로 서명 요청)" : "종이 계약서 업로드"}
                  </label>
                ))}
              </div>
            )}

            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className={lblCls}>강좌 * (같은 학기·같은 강사료면 1건으로 묶음)</label>
                  {termOptions.length > 1 && (
                    <select
                      value={termSel}
                      onChange={(e) => changeTerm(e.target.value)}
                      className={`${inCls} !w-auto !py-1 text-xs`}
                      aria-label="학기"
                    >
                      {termOptions.map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {ctx.programs.length === 0 ? (
                  <p className="mt-1 text-[11px] text-stamp">
                    이 강사가 맡은 강좌(유급)가 없습니다. 강좌에 먼저 강사를 지정하세요.
                  </p>
                ) : (
                  <ul className={`mt-1 space-y-1 rounded-md border p-2 ${selIds.length ? "border-line" : "border-stamp"}`}>
                    {termProgs.map((p) => {
                      const checked = selIds.includes(p.id);
                      const occupied = !!p.activeContractId && p.activeContractId !== draftId;
                      const anchorKey = selProgs[0]?.payKey ?? null;
                      const payDiff = !checked && anchorKey != null && p.payKey !== anchorKey;
                      const disabled = occupied || payDiff;
                      return (
                        <li key={p.id} className={`flex flex-wrap items-center gap-2 text-sm ${disabled ? "text-ink-hint" : ""}`}>
                          <label className="flex items-center gap-1.5">
                            <input type="checkbox" checked={checked} disabled={disabled && !checked} onChange={() => toggleProgram(p.id)} />
                            <span>
                              {nameOf.get(p.id) ?? p.name}
                              {selIds[0] === p.id && selIds.length > 1 && (
                                <span className="ml-1 text-[10px] text-navy">대표</span>
                              )}
                            </span>
                          </label>
                          {occupied && (
                            <>
                              <span className="text-[11px]">
                                계약서 있음({p.activeContractNo}
                                {p.activeStatus ? ` · ${INSTRUCTOR_CONTRACT_STATUS_LABEL[p.activeStatus]}` : ""})
                              </span>
                              <button
                                type="button"
                                className="text-[11px] text-navy hover:underline"
                                onClick={() => openExisting(p.activeContractId!, `「${p.name}」 강좌가 든 계약서를 열었습니다.`)}
                              >
                                열기
                              </button>
                            </>
                          )}
                          {!occupied && payDiff && <span className="text-[11px]">강사료가 달라 별도 계약</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {method === "electronic" && (
                <div className="sm:col-span-2 sm:max-w-sm">
                  <label className={lblCls}>양식</label>
                  <select value={tplId} onChange={(e) => setTplId(e.target.value)} className={`${inCls} mt-1`}>
                    {ctx.templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.projectId ? "" : " (공통)"}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {method === "paper" ? (
              <div className="rounded-lg border border-line p-3">
                <p className="text-xs text-ink-muted">
                  서명·날인이 끝난 종이 계약서를 스캔한 PDF 또는 사진을 올리면 바로 &lsquo;체결 완료&rsquo;로 저장됩니다.
                </p>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="mt-2 block text-sm"
                />
                {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
                <div className="mt-3 flex gap-2">
                  <button type="button" className={btnPrimary} disabled={pending || !file || !progId} onClick={uploadPaper}>
                    {pending ? "올리는 중…" : "업로드"}
                  </button>
                  <button type="button" className={btnSecondary} onClick={onClose}>
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* 칸 입력 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-ink">칸 채우기</p>
                    <button
                      type="button"
                      className="text-xs text-navy hover:underline"
                      onClick={() => setF(fieldsFor(ctx, selProgs, tpl))}
                      title="강좌·학기 값으로 다시 채웁니다(직접 고친 내용은 사라짐)"
                    >
                      강좌 값으로 다시 채우기
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <TextField k="program_name" f={f} set={set} missing={missing} />
                    <TextField k="round_label" f={f} set={set} missing={missing} placeholder="예: ' 1차시' (비워도 됨)" />
                    <TextField k="instructor_name" f={f} set={set} missing={missing} />
                    <TextField k="field_label" f={f} set={set} missing={missing} placeholder="예: 뉴스포츠" />
                    <TextField k="start_date" f={f} set={set} missing={missing} placeholder="2026년 11월 7일" />
                    <TextField k="end_date" f={f} set={set} missing={missing} placeholder="2026년 12월 26일" />
                  </div>
                  {/* 새 양식은 근무시간·수업시간 '조항', 예전 양식은 근무시간·분 — 양식에 있는 칸만 보입니다. */}
                  {used.has("schedule_clause") && <AreaField k="schedule_clause" f={f} set={set} missing={missing} />}
                  {used.has("session_clause") && <AreaField k="session_clause" f={f} set={set} missing={missing} />}
                  {used.has("schedule") && (
                    <TextField k="schedule" f={f} set={set} missing={missing} placeholder="매주 토요일 10:00부터 11:30까지 (1시간 30분)" />
                  )}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {used.has("session_minutes") && <TextField k="session_minutes" f={f} set={set} missing={missing} placeholder="90" />}
                    <div>
                      <label className={lblCls}>{FIELD_LABEL.contract_date}</label>
                      <input
                        type="date"
                        value={f.contract_date}
                        onChange={(e) => set({ contract_date: e.target.value })}
                        className={`${inCls} mt-1 ${missing.includes("contract_date") ? "border-stamp" : ""}`}
                      />
                    </div>
                    <div>
                      <label className={lblCls}>강사료 방식</label>
                      <select value={f.pay_type} onChange={(e) => changePay(e.target.value as ContractPayType)} className={`${inCls} mt-1`}>
                        {(Object.keys(PAY_LABEL) as ContractPayType[]).map((k) => (
                          <option key={k} value={k}>
                            {PAY_LABEL[k]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={lblCls}>원천징수</label>
                      <select value={f.tax_type} onChange={(e) => changeTax(e.target.value as TaxType)} className={`${inCls} mt-1`}>
                        {(Object.keys(TAX_TYPE_LABEL) as TaxType[]).map((k) => (
                          <option key={k} value={k}>
                            {TAX_TYPE_LABEL[k]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <AreaField k="pay_clause" f={f} set={set} missing={missing} placeholder={f.pay_type === "revenue_share" ? "수익배분 문장을 직접 입력하세요" : undefined} />
                  <AreaField k="tax_clause" f={f} set={set} missing={missing} />

                  {(!ctx.instructor.rrnMasked || !ctx.instructor.address || !ctx.instructor.hasPhone) && (
                    <p className={noticeWarning}>
                      {[
                        !ctx.instructor.rrnMasked && "주민번호 앞자리",
                        !ctx.instructor.address && "주소",
                        !ctx.instructor.hasPhone && "휴대전화",
                      ]
                        .filter(Boolean)
                        .join("·")}
                      이(가) 강사 정보에 없습니다. 발송 순간의 강사 정보가 계약서에 확정되니 강사 상세에서 먼저 채우세요.
                      {!ctx.instructor.hasPhone && " (휴대전화가 없으면 서명 요청 문자를 보낼 수 없습니다.)"}
                    </p>
                  )}
                </div>

                {/* 미리보기 */}
                <div>
                  <p className="mb-1 text-xs font-bold text-ink">
                    미리보기 <span className="font-normal text-ink-hint">— 강사가 볼 화면. 색칠된 곳이 채운 칸, 붉은 칸은 비어 있음</span>
                  </p>
                  {tpl ? (
                    <Preview ctx={ctx} title={tpl.title} body={tpl.body} f={f} />
                  ) : (
                    <p className={noticeError}>사용할 수 있는 양식이 없습니다.</p>
                  )}
                </div>
              </div>
            )}

            {method === "electronic" && (
              <>
                {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
                {info && <p className={`mt-3 ${noticeSuccess}`}>{info}</p>}
                {infoIssues.length > 0 && (
                  <p className={`mt-3 ${noticeWarning}`}>
                    {PROGRAM_INFO_BLOCK_MESSAGE}. ({infoIssues.join(", ")}) [프로그램 관리]에서 강좌를 고친 뒤 다시 여세요.
                  </p>
                )}
                {missing.length > 0 && (
                  <p className="mt-3 text-xs text-stamp">
                    빈 칸: {missing.map((k) => FIELD_LABEL[k]).join(", ")} — 모두 채워야 발송할 수 있습니다.
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={pending || missing.length > 0 || !tpl || !progId || infoIssues.length > 0}
                    onClick={() => save(true)}
                    title="본문을 확정하고 강사에게 서명 요청 문자를 보냅니다"
                  >
                    {pending ? "처리 중…" : "발송"}
                  </button>
                  <button type="button" className={btnSecondary} disabled={pending || !tpl || !progId} onClick={() => save(false)}>
                    저장(작성 중)
                  </button>
                  <button type="button" className={btnSecondary} onClick={onClose}>
                    취소
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TextField({
  k,
  f,
  set,
  missing,
  placeholder,
}: {
  k: Exclude<keyof ContractFields, "pay_type" | "tax_type" | "contract_date">;
  f: ContractFields;
  set: (p: Partial<ContractFields>) => void;
  missing: string[];
  placeholder?: string;
}) {
  return (
    <div>
      <label className={lblCls}>{FIELD_LABEL[k]}</label>
      <input
        value={f[k]}
        placeholder={placeholder}
        onChange={(e) => set({ [k]: e.target.value } as Partial<ContractFields>)}
        className={`${inCls} mt-1 ${missing.includes(k) ? "border-stamp" : ""}`}
      />
    </div>
  );
}

function AreaField({
  k,
  f,
  set,
  missing,
  placeholder,
}: {
  k: "pay_clause" | "tax_clause" | "schedule_clause" | "session_clause";
  f: ContractFields;
  set: (p: Partial<ContractFields>) => void;
  missing: string[];
  placeholder?: string;
}) {
  return (
    <div>
      <label className={lblCls}>{FIELD_LABEL[k]}</label>
      <textarea
        rows={Math.max(2, f[k].split("\n").length)}
        value={f[k]}
        placeholder={placeholder}
        onChange={(e) => set({ [k]: e.target.value } as Partial<ContractFields>)}
        className={`${inCls} mt-1 ${missing.includes(k) ? "border-stamp" : ""}`}
      />
    </div>
  );
}

// 강사 화면과 같은 모양 — 본문 + 체결일 + 갑/을.
function Preview({ ctx, title, body, f }: { ctx: ContractContext; title: string; body: string; f: ContractFields }) {
  const segs = bodySegments(body.replace(/^\n+/, ""), f);
  return (
    <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-line bg-white p-4 text-[13px] leading-relaxed text-ink-body">
      <p className="mb-3 text-center text-lg font-bold tracking-widest text-ink">{title}</p>
      <div className="whitespace-pre-wrap">
        {segs.map((s, i) =>
          s.field ? (
            <span
              key={i}
              title={FIELD_LABEL[s.field as keyof typeof FIELD_LABEL] ?? s.field}
              className={s.empty ? "rounded bg-stamp-soft px-1 text-stamp" : "rounded bg-navy-soft px-0.5 text-navy"}
            >
              {s.empty ? `[${FIELD_LABEL[s.field as keyof typeof FIELD_LABEL] ?? s.field}]` : s.text}
            </span>
          ) : (
            <span key={i}>{s.text}</span>
          )
        )}
      </div>
      <PartyBlock
        date={koreanDate(f.contract_date)}
        name={ctx.instructor.name}
        rrn={ctx.instructor.rrnMasked}
        address={ctx.instructor.address}
      />
    </div>
  );
}

function PartyBlock({ date, name, rrn, address }: { date: string; name: string; rrn: string; address: string }) {
  return (
    <>
      <p className={`mt-4 text-center ${date ? "" : "text-stamp"}`}>{date || "[체결일]"}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
        <div className="rounded border border-line p-2">
          <p className="mb-1 font-bold">갑</p>
          <p>기관명: {EMP.orgName}</p>
          <p>사업자번호: {EMP.bizNo}</p>
          <p>주소: {EMP.address}</p>
          <p>
            대표: {EMP.title} {EMP.representative} (인)
          </p>
        </div>
        <div className="rounded border border-line p-2">
          <p className="mb-1 font-bold">을</p>
          <p>성명: {name} (서명)</p>
          <p className={rrn ? "" : "text-stamp"}>주민등록번호: {rrn || "미등록"}</p>
          <p className={address ? "" : "text-stamp"}>주소: {address || "미등록"}</p>
        </div>
      </div>
    </>
  );
}

// 보낸 뒤 — 확정된 본문만 보여 줍니다(수정 불가).
function ReadOnlyView({ ctx }: { ctx: ContractContext }) {
  const ex = ctx.existing!;
  if (ex.signingMethod === "paper")
    return <p className="text-sm text-ink-muted">종이 계약서입니다. 목록의 [파일 열기]로 확인하세요.</p>;
  return (
    <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-white p-4 text-[13px] leading-relaxed text-ink-body">
      <p className="mb-3 text-center text-lg font-bold tracking-widest text-ink">{ex.titleSnapshot}</p>
      <div className="whitespace-pre-wrap">{(ex.bodySnapshot ?? "").replace(/^\n+/, "")}</div>
      <PartyBlock
        date={koreanDate(ex.fields.contract_date)}
        name={ex.nameSnapshot ?? ctx.instructor.name}
        rrn={ex.rrnSnapshot ?? ""}
        address={ex.addressSnapshot ?? ""}
      />
      <p className="mt-3 text-[11px] text-ink-hint">
        발송 때 확정된 본문·인적사항입니다(이후 양식·강사 정보가 바뀌어도 그대로).
      </p>
    </div>
  );
}
