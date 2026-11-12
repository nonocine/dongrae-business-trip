"use client";

import { useEffect, useState, useTransition } from "react";
import {
  listContractTerms,
  listInstructorContracts,
  getContractSummary,
  type ProgramRef,
  listInstructorContractLogs,
  openInstructorContractFile,
  resendInstructorContractSms,
  sealInstructorContract,
  sealInstructorContractsBulk,
  voidInstructorContract,
  type ContractListFilter,
} from "@/app/(app)/hr/saems/contractActions";
import ContractEditor from "@/app/(app)/hr/saems/contracts/ContractEditor";
import ContractLinkCopyButton from "@/app/(app)/hr/saems/contracts/ContractLinkCopyButton";
import LinkProgramDialog, { programLabel } from "@/app/(app)/hr/saems/contracts/LinkProgramDialog";
import {
  INSTRUCTOR_CONTRACT_STATUS_LABEL,
  SIGNING_METHOD_LABEL,
  type InstructorContractRow,
  type InstructorContractStatus,
} from "@/lib/instructorContract";
import type { SaemProject } from "@/lib/saem";
import {
  badgeDanger,
  badgeNavy,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  btnDanger,
  btnPrimary,
  btnSecondary,
  cardCls,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

const selCls =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body whitespace-nowrap";
const smBtn = "rounded border border-line px-2 py-1 text-xs text-ink-body hover:bg-surface disabled:opacity-50";

export const STATUS_BADGE: Record<InstructorContractStatus, string> = {
  draft: badgeNeutral,
  sent: badgeWarning,
  instructor_signed: badgeNavy,
  completed: badgeSuccess,
  void: badgeDanger,
};

const ACTION_LABEL: Record<string, string> = {
  created: "작성",
  updated: "수정",
  sent: "발송(본문 확정)",
  sms_sent: "서명 요청 문자",
  sms_resent: "서명 요청 문자 재발송",
  sms_failed: "문자 실패",
  voided: "무효 처리",
  paper_uploaded: "종이 계약서 업로드",
  employer_sealed: "관장 직인 날인",
  file_viewed: "파일 열람",
  file_downloaded: "파일 다운로드",
  link_copied: "링크 복사",
  program_linked: "강좌 연결",
  viewed: "강사 열람",
  signed: "강사 서명",
};

function kst(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ContractsManager({
  projects,
  initialRows,
  isM0,
  saemBase,
  initialStatus = "",
  initialContractId = null,
}: {
  projects: SaemProject[];
  initialRows: InstructorContractRow[];
  isM0: boolean;
  saemBase: string; // 동래샘들 주소 — [링크 복사]용
  // ?filter=seal_pending → "instructor_signed"(날인 대기만). 서버가 이미 그 조건으로 목록을 내려줍니다.
  initialStatus?: ContractListFilter["status"];
  // ?contract=<id> → 그 계약서 창을 바로 엽니다.
  initialContractId?: string | null;
}) {
  const [rows, setRows] = useState(initialRows);
  const [projectId, setProjectId] = useState("");
  const [terms, setTerms] = useState<{ id: string; name: string }[]>([]);
  const [termId, setTermId] = useState("");
  const [status, setStatus] = useState<ContractListFilter["status"]>(initialStatus);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 모두 날인 결과 중 실패한 건(강사·계약번호·사유).
  const [bulkFailed, setBulkFailed] = useState<{ label: string; message: string }[]>([]);
  // 계약서 창 — 기존 계약(contractId) 또는 계약 없는 강좌의 새 계약(programId+instructorId).
  const [editing, setEditing] = useState<{ contractId?: string; programId?: string; instructorId?: string } | null>(
    initialContractId ? { contractId: initialContractId } : null
  );
  const [linking, setLinking] = useState<InstructorContractRow | null>(null);
  const [summary, setSummary] = useState<{ unsignedPrograms: number; noContract: ProgramRef[] } | null>(null);
  const [showNoContract, setShowNoContract] = useState(false);
  const [voiding, setVoiding] = useState<InstructorContractRow | null>(null);
  const [logsOf, setLogsOf] = useState<InstructorContractRow | null>(null);
  // 강좌가 여럿인 계약 — 펼쳐서 강좌 전체 보기.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    (async () => {
      const t = projectId ? await listContractTerms(projectId) : [];
      if (alive) setTerms(t);
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  async function reload(f?: Partial<ContractListFilter>) {
    const filter: ContractListFilter = {
      projectId: f?.projectId ?? projectId,
      termId: f?.termId ?? termId,
      status: f?.status ?? status,
    };
    const [list, sum] = await Promise.all([
      listInstructorContracts(filter),
      getContractSummary({ projectId: filter.projectId, termId: filter.termId }),
    ]);
    setRows(list);
    setSummary(sum);
  }

  // 첫 화면 집계(강좌 단위).
  useEffect(() => {
    let alive = true;
    getContractSummary({}).then((s) => alive && setSummary(s));
    return () => {
      alive = false;
    };
  }, []);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, okText: string) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) return setMsg({ ok: false, text: r.message ?? "실패했습니다." });
      setMsg({ ok: true, text: okText });
      await reload();
    });
  }

  // [모두 날인(n건)] — 지금 목록의 날인 대기 건 전부. 확인창에 강사·계약번호 목록을 보여 줍니다.
  //   서버는 건마다 단건 날인을 그대로 불러 권한·기록이 단건과 같습니다.
  const sealTargets = rows.filter((r) => r.status === "instructor_signed");
  function sealAll() {
    if (!sealTargets.length) return;
    const list = sealTargets.map((r) => `· ${r.instructor_name} — ${r.contract_no}`).join("\n");
    if (!confirm(`다음 ${sealTargets.length}건에 기관 직인을 날인하고 PDF 로 확정할까요?\n\n${list}`)) return;
    const labelOf = new Map(sealTargets.map((r) => [r.id, `${r.instructor_name} (${r.contract_no})`]));
    setMsg(null);
    setBulkFailed([]);
    start(async () => {
      const r = await sealInstructorContractsBulk(sealTargets.map((x) => x.id));
      if (!r.ok) {
        setMsg({ ok: false, text: r.message });
        return;
      }
      const failed = r.results.filter((x) => !x.ok);
      const done = r.results.length - failed.length;
      setBulkFailed(failed.map((x) => ({ label: labelOf.get(x.id) ?? x.id, message: x.message ?? "실패" })));
      setMsg(
        failed.length
          ? { ok: false, text: `${done}건 날인, ${failed.length}건 실패 — 아래 목록을 확인하세요.` }
          : { ok: true, text: `${done}건 모두 날인하고 PDF 를 만들었습니다.` }
      );
      await reload();
    });
  }

  function openFile(id: string, download: boolean) {
    setMsg(null);
    start(async () => {
      const r = await openInstructorContractFile(id, { download });
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      window.open(r.url, "_blank", "noopener");
    });
  }

  // 집계는 강사 수가 아니라 강좌 단위(계약서 1건에 든 강좌를 모두 셈).
  const waitingSeal = new Set(
    rows.filter((r) => r.status === "instructor_signed").flatMap((r) => (r.programs.length ? r.programs.map((p) => p.id) : [`c:${r.id}`]))
  ).size;

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={selCls}
            value={projectId}
            aria-label="사업"
            onChange={(e) => {
              setProjectId(e.target.value);
              setTermId("");
              start(() => reload({ projectId: e.target.value, termId: "" }));
            }}
          >
            <option value="">전체 사업</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            className={selCls}
            value={termId}
            aria-label="학기"
            disabled={!projectId}
            onChange={(e) => {
              setTermId(e.target.value);
              start(() => reload({ termId: e.target.value }));
            }}
          >
            <option value="">전체 학기</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            className={selCls}
            value={status}
            aria-label="상태"
            onChange={(e) => {
              const v = e.target.value as ContractListFilter["status"];
              setStatus(v);
              start(() => reload({ status: v }));
            }}
          >
            <option value="">전체 상태</option>
            <option value="unsigned">미서명(서명 대기)</option>
            {(Object.keys(INSTRUCTOR_CONTRACT_STATUS_LABEL) as InstructorContractStatus[]).map((s) => (
              <option key={s} value={s}>
                {INSTRUCTOR_CONTRACT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <span className="ml-auto text-xs text-ink-muted">
            강좌 기준 · 미서명 <b className="text-warning">{summary?.unsignedPrograms ?? "-"}</b> · 직인 대기{" "}
            <b className="text-navy">{waitingSeal}</b> ·{" "}
            <button
              type="button"
              className="underline decoration-dotted hover:text-ink"
              onClick={() => setShowNoContract((v) => !v)}
              title="채용함·강사 지정 강좌 중 그 강사의 계약서가 없는 강좌"
            >
              계약서 없음 <b className="text-stamp">{summary?.noContract.length ?? "-"}</b>
            </button>
          </span>
        </div>
        <p className="mt-2 text-xs text-ink-hint">
          모든 유급 강좌는 유효 계약서 1건에 들어갑니다. 같은 강사·같은 학기·같은 강사료면 1건으로 묶습니다. 새 계약서는 [프로그램 관리]의 강좌 행, 강사 상세, 아래 &lsquo;계약서 없음&rsquo; 목록에서 만듭니다.
        </p>
        {showNoContract && summary && (
          <div className="mt-3 rounded-lg border border-line p-2">
            {summary.noContract.length === 0 ? (
              <p className="text-xs text-ink-hint">계약서가 없는 강좌가 없습니다.</p>
            ) : (
              <ul className="space-y-1">
                {summary.noContract.map((p) => (
                  <li key={p.programId} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-ink">{programLabel(p)}</span>
                    {p.termPeriod && <span className="text-xs text-ink-hint">{p.termPeriod}</span>}
                    <span className="text-xs text-ink-muted">{p.instructorName} 강사</span>
                    <button
                      type="button"
                      className={`${smBtn} ml-auto`}
                      onClick={() => setEditing({ programId: p.programId, instructorId: p.instructorId })}
                    >
                      계약서 만들기
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}
      {bulkFailed.length > 0 && (
        <ul className={`${noticeError} space-y-0.5`}>
          {bulkFailed.map((f, i) => (
            <li key={i}>
              ✕ {f.label} — {f.message}
            </li>
          ))}
        </ul>
      )}

      {/* 날인 대기 보기(상태 = 직인 대기)일 때 — 관장·부장에게 [모두 날인(n건)]. */}
      {status === "instructor_signed" && isM0 && sealTargets.length > 0 && (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-navy bg-navy-soft px-4 py-3">
          <span className="text-sm font-semibold text-navy">관장 날인 대기 {sealTargets.length}건</span>
          <button type="button" className={`${btnPrimary} ml-auto`} disabled={pending} onClick={sealAll}>
            {pending ? "날인 중…" : `모두 날인(${sealTargets.length}건)`}
          </button>
        </section>
      )}

      <section className={cardCls}>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-hint">계약서가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={thCls}>[사업] 강좌</th>
                  <th className={thCls}>학기</th>
                  <th className={thCls}>계약기간</th>
                  <th className={thCls}>계약번호</th>
                  <th className={thCls}>상태</th>
                  <th className={thCls}>강사</th>
                  <th className={thCls}>방식</th>
                  <th className={thCls}>발송</th>
                  <th className={thCls}>강사 서명</th>
                  <th className={`${thCls} text-right`}>관리</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className={`${tdCls} font-medium text-ink`}>
                      {r.programs.length > 0 ? (
                        <>
                          {r.project_name && <span className="text-ink-muted">[{r.project_name}] </span>}
                          {r.program_name ?? r.programs[0].name}
                          {r.programs.length > 1 && (
                            <button
                              type="button"
                              className="ml-1 text-xs font-normal text-navy hover:underline"
                              aria-expanded={expanded.has(r.id)}
                              onClick={() =>
                                setExpanded((cur) => {
                                  const next = new Set(cur);
                                  if (next.has(r.id)) next.delete(r.id);
                                  else next.add(r.id);
                                  return next;
                                })
                              }
                            >
                              외 {r.programs.length - 1}개 {expanded.has(r.id) ? "▲" : "▼"}
                            </button>
                          )}
                          {expanded.has(r.id) && (
                            <ul className="mt-1 list-disc pl-5 text-xs font-normal text-ink-body">
                              {r.programs.map((p) => (
                                <li key={p.id}>{p.name}</li>
                              ))}
                            </ul>
                          )}
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <span className={badgeWarning}>강좌 미지정</span>
                          {r.status !== "void" && (
                            <button type="button" className={smBtn} onClick={() => setLinking(r)}>
                              강좌 연결
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                    <td className={`${tdCls} text-xs`}>{r.term_name ?? "-"}</td>
                    <td className={`${tdCls} text-xs`}>{r.period || "-"}</td>
                    <td className={`${tdCls} font-mono text-xs`}>{r.contract_no}</td>
                    <td className={tdCls}>
                      <span className={STATUS_BADGE[r.status]} title={r.void_reason ? `사유: ${r.void_reason}` : undefined}>
                        {INSTRUCTOR_CONTRACT_STATUS_LABEL[r.status]}
                      </span>
                      {r.status === "sent" && r.first_viewed_at && (
                        <span className="ml-1 text-[11px] text-ink-hint">열람함</span>
                      )}
                    </td>
                    <td className={tdCls}>{r.instructor_name}</td>
                    <td className={tdCls}>{SIGNING_METHOD_LABEL[r.signing_method]}</td>
                    <td className={`${tdCls} text-xs`}>{kst(r.sent_at)}</td>
                    <td className={`${tdCls} text-xs`}>{kst(r.instructor_signed_at)}</td>
                    <td className={`${tdCls} text-right`}>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {r.signing_method === "electronic" && (
                          <button type="button" className={smBtn} onClick={() => setEditing({ contractId: r.id })}>
                            {r.status === "draft" ? "이어 쓰기" : "내용"}
                          </button>
                        )}
                        {r.status === "sent" && <ContractLinkCopyButton contractId={r.id} saemBase={saemBase} />}
                        {r.status === "sent" && (
                          <button
                            type="button"
                            className={smBtn}
                            disabled={pending}
                            onClick={() => run(() => resendInstructorContractSms(r.id), `${r.instructor_name} 강사에게 서명 요청 문자를 다시 보냈습니다.`)}
                          >
                            서명 요청 다시 보내기
                          </button>
                        )}
                        {r.status === "instructor_signed" && isM0 && (
                          <button
                            type="button"
                            className={`${btnPrimary} !px-2 !py-1 !text-xs`}
                            disabled={pending}
                            onClick={() => {
                              if (!confirm(`${r.instructor_name} 강사 계약서에 기관 직인을 날인하고 PDF 로 확정할까요?`)) return;
                              run(() => sealInstructorContract(r.id), "직인을 날인하고 PDF 를 만들었습니다.");
                            }}
                          >
                            직인 날인
                          </button>
                        )}
                        {(r.has_pdf || r.has_paper) && (
                          <>
                            <button type="button" className={smBtn} disabled={pending} onClick={() => openFile(r.id, false)}>
                              파일 열기
                            </button>
                            <button type="button" className={smBtn} disabled={pending} onClick={() => openFile(r.id, true)}>
                              다운로드
                            </button>
                          </>
                        )}
                        <button type="button" className={smBtn} onClick={() => setLogsOf(r)}>
                          기록
                        </button>
                        {r.status !== "void" && (
                          <button
                            type="button"
                            className="rounded border border-stamp px-2 py-1 text-xs text-stamp hover:bg-stamp-soft"
                            onClick={() => setVoiding(r)}
                          >
                            무효
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <ContractEditor
          canSeal={isM0}
          contractId={editing.contractId ?? null}
          programId={editing.programId ?? null}
          instructorId={editing.instructorId ?? null}
          onClose={() => {
            setEditing(null);
            void reload();
          }}
          onDone={async (text) => {
            setEditing(null);
            setMsg({ ok: true, text });
            await reload();
          }}
        />
      )}
      {voiding && (
        <VoidDialog
          row={voiding}
          onClose={() => setVoiding(null)}
          onDone={async () => {
            setVoiding(null);
            setMsg({ ok: true, text: "무효 처리했습니다." });
            await reload();
          }}
        />
      )}
      {logsOf && <LogsDialog row={logsOf} onClose={() => setLogsOf(null)} />}
      {linking && (
        <LinkProgramDialog
          row={linking}
          onClose={() => setLinking(null)}
          onDone={async () => {
            setLinking(null);
            setMsg({ ok: true, text: "강좌를 연결했습니다." });
            await reload();
          }}
          onExisting={(id, message) => {
            setLinking(null);
            setMsg({ ok: false, text: message });
            setEditing({ contractId: id });
          }}
        />
      )}
    </div>
  );
}

function VoidDialog({ row, onClose, onDone }: { row: InstructorContractRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-card p-5 shadow-lg">
        <h3 className="text-base font-bold text-ink">계약서 무효 처리</h3>
        <p className="mt-1 text-xs text-ink-muted">
          {row.contract_no} · {row.instructor_name}. 무효로 해도 기록·파일은 지우지 않습니다.
        </p>
        <label className="mt-3 block text-[11px] font-semibold text-navy">사유 *</label>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm"
        />
        {err && <p className={`mt-2 ${noticeError}`}>{err}</p>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className={btnDanger}
            disabled={pending || !reason.trim()}
            onClick={() =>
              start(async () => {
                const r = await voidInstructorContract(row.id, reason);
                if (!r.ok) return setErr(r.message);
                onDone();
              })
            }
          >
            {pending ? "처리 중…" : "무효 처리"}
          </button>
          <button type="button" className={btnSecondary} onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

function LogsDialog({ row, onClose }: { row: InstructorContractRow; onClose: () => void }) {
  const [logs, setLogs] = useState<Awaited<ReturnType<typeof listInstructorContractLogs>> | null>(null);
  useEffect(() => {
    let alive = true;
    listInstructorContractLogs(row.id).then((l) => alive && setLogs(l));
    return () => {
      alive = false;
    };
  }, [row.id]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">
            기록 <span className="text-sm font-normal text-ink-muted">{row.contract_no}</span>
          </h3>
          <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:underline">
            닫기
          </button>
        </div>
        {!logs ? (
          <p className="text-sm text-ink-hint">불러오는 중…</p>
        ) : logs.length === 0 ? (
          <p className="text-sm text-ink-hint">기록이 없습니다.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {logs.map((l, i) => (
              <li key={i} className="flex gap-2 border-b border-line/50 py-1">
                <span className="w-24 shrink-0 text-xs text-ink-hint">{kst(l.created_at)}</span>
                <span className="flex-1">{ACTION_LABEL[l.action] ?? l.action}</span>
                <span className="text-xs text-ink-muted">
                  {l.actor_type === "instructor" ? "강사" : l.actor_type === "system" ? "시스템" : l.actor_name ?? "직원"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
