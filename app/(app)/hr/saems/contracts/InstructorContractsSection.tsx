"use client";

// 강사 상세 — 이 강사의 강좌별 계약서. 계약서는 강좌마다 1건(무효 제외)입니다.
//   채용함인데 계약이 없는 강좌는 "계약서 없음" + [계약서 만들기],
//   강좌가 비어 있는 옛 계약(종이 등)은 "강좌 미지정" + [강좌 연결].
//   관리(날인·무효·재발송·파일)는 [강사 계약서] 탭에서.
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getInstructorContractOverview,
  type InstructorProgramContracts,
} from "@/app/(app)/hr/saems/contractActions";
import ContractEditor from "@/app/(app)/hr/saems/contracts/ContractEditor";
import { STATUS_BADGE } from "@/app/(app)/hr/saems/contracts/ContractsManager";
import LinkProgramDialog, { programLabel } from "@/app/(app)/hr/saems/contracts/LinkProgramDialog";
import ContractLinkCopyButton from "@/app/(app)/hr/saems/contracts/ContractLinkCopyButton";
import {
  INSTRUCTOR_CONTRACT_STATUS_LABEL,
  SIGNING_METHOD_LABEL,
  type InstructorContractRow,
} from "@/lib/instructorContract";
import { badgeDanger, badgeWarning, cardCls, noticeError, noticeSuccess } from "@/lib/ui";

const smBtn = "rounded border border-line px-2 py-0.5 text-xs hover:bg-surface";

type Overview = { programs: InstructorProgramContracts[]; unlinked: InstructorContractRow[]; saemBase: string };

export default function InstructorContractsSection({ instructorId }: { instructorId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [editing, setEditing] = useState<{ contractId?: string; programId?: string } | null>(null);
  const [linking, setLinking] = useState<InstructorContractRow | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function reload() {
    setData(await getInstructorContractOverview(instructorId));
  }
  useEffect(() => {
    let alive = true;
    getInstructorContractOverview(instructorId).then((r) => alive && setData(r));
    return () => {
      alive = false;
    };
  }, [instructorId]);

  // 지난 학기 강좌는 계약이 없어도 '계약서 없음'으로 세지 않습니다.
  const noContract = data?.programs.filter((p) => !p.hasActive && !p.program.termEnded).length ?? 0;
  const unsigned = data?.programs.filter((p) => p.contracts.some((c) => c.status === "sent")).length ?? 0;

  return (
    <section className={cardCls}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-ink">
          강사 계약서
          {data && (
            <span className="ml-2 text-xs font-normal text-ink-muted">
              강좌 {data.programs.length} · 미서명 {unsigned} · 계약서 없음 {noContract}
              {data.unlinked.length > 0 && ` · 강좌 미지정 ${data.unlinked.length}`}
            </span>
          )}
        </h3>
        <Link href="/hr/saems/contracts" className="text-xs text-navy hover:underline">
          계약서 탭에서 관리
        </Link>
      </div>
      {msg && <p className={`mb-2 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>}

      {!data ? (
        <p className="py-4 text-center text-sm text-ink-hint">불러오는 중…</p>
      ) : data.programs.length === 0 && data.unlinked.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-hint">맡은 강좌(채용함)와 계약서가 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {data.programs.map(({ program: p, contracts, hasActive }) => (
            <li key={p.programId} className="rounded-lg border border-line p-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-ink">{programLabel(p)}</span>
                {p.termPeriod && <span className="text-xs text-ink-hint">{p.termPeriod}</span>}
                {p.termEnded && <span className="text-[11px] text-ink-hint">지난 학기</span>}
                {!hasActive && !p.termEnded && (
                  <>
                    <span className={badgeDanger}>계약서 없음</span>
                    <button
                      type="button"
                      className={`${smBtn} ml-auto`}
                      onClick={() => setEditing({ programId: p.programId })}
                    >
                      계약서 만들기
                    </button>
                  </>
                )}
              </div>
              {contracts.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {contracts.map((c) => (
                    <ContractLine key={c.id} c={c} saemBase={data.saemBase} onOpen={() => setEditing({ contractId: c.id })} />
                  ))}
                </ul>
              )}
            </li>
          ))}
          {data.unlinked.map((c) => (
            <li key={c.id} className="rounded-lg border border-warning/40 p-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={badgeWarning}>강좌 미지정</span>
                {c.status !== "void" && (
                  <button type="button" className={smBtn} onClick={() => setLinking(c)}>
                    강좌 연결
                  </button>
                )}
              </div>
              <ul className="mt-1">
                <ContractLine c={c} saemBase={data.saemBase} onOpen={() => setEditing({ contractId: c.id })} />
              </ul>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ContractEditor
          instructorId={instructorId}
          programId={editing.programId ?? null}
          contractId={editing.contractId ?? null}
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
    </section>
  );
}

// 한 줄: 계약번호 · 학기 · 계약기간 · 방식 · 상태 · [내용]
function ContractLine({ c, saemBase, onOpen }: { c: InstructorContractRow; saemBase: string; onOpen: () => void }) {
  return (
    <li className={`flex flex-wrap items-center gap-2 text-xs ${c.status === "void" ? "opacity-60" : ""}`}>
      <span className="font-mono text-ink-muted">{c.contract_no}</span>
      {c.term_name && <span className="text-ink-hint">{c.term_name}</span>}
      {c.period && <span className="text-ink-hint">{c.period}</span>}
      <span className="text-ink-hint">{SIGNING_METHOD_LABEL[c.signing_method]}</span>
      <span className={STATUS_BADGE[c.status]} title={c.void_reason ? `사유: ${c.void_reason}` : undefined}>
        {INSTRUCTOR_CONTRACT_STATUS_LABEL[c.status]}
      </span>
      {c.status === "sent" && (
        <span className="ml-auto">
          <ContractLinkCopyButton contractId={c.id} saemBase={saemBase} />
        </span>
      )}
      <button type="button" className={`${smBtn} ${c.status === "sent" ? "" : "ml-auto"}`} onClick={onOpen}>
        {c.status === "draft" ? "이어 쓰기" : "내용"}
      </button>
    </li>
  );
}
