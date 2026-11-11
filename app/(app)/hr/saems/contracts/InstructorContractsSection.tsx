"use client";

// 강사 상세 — 이 강사의 계약서 목록 + [계약서 만들기]. 관리·날인은 [강사 계약서] 탭에서.
import Link from "next/link";
import { useEffect, useState } from "react";
import { listInstructorContracts } from "@/app/(app)/hr/saems/contractActions";
import ContractEditor from "@/app/(app)/hr/saems/contracts/ContractEditor";
import { STATUS_BADGE } from "@/app/(app)/hr/saems/contracts/ContractsManager";
import {
  INSTRUCTOR_CONTRACT_STATUS_LABEL,
  SIGNING_METHOD_LABEL,
  type InstructorContractRow,
} from "@/lib/instructorContract";
import { btnPrimary, cardCls, noticeSuccess } from "@/lib/ui";

export default function InstructorContractsSection({ instructorId }: { instructorId: string }) {
  const [rows, setRows] = useState<InstructorContractRow[] | null>(null);
  const [editing, setEditing] = useState<{ contractId: string | null } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    setRows(await listInstructorContracts({ instructorId }));
  }
  useEffect(() => {
    let alive = true;
    listInstructorContracts({ instructorId }).then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, [instructorId]);

  return (
    <section className={cardCls}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-ink">강사 계약서 {rows ? `(${rows.length})` : ""}</h3>
        <div className="flex items-center gap-3">
          <Link href="/hr/saems/contracts" className="text-xs text-navy hover:underline">
            계약서 탭에서 관리
          </Link>
          <button type="button" className={btnPrimary} onClick={() => setEditing({ contractId: null })}>
            계약서 만들기
          </button>
        </div>
      </div>
      {msg && <p className={`mb-2 ${noticeSuccess}`}>{msg}</p>}
      {!rows ? (
        <p className="py-4 text-center text-sm text-ink-hint">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-hint">계약서가 없습니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2 text-sm">
              <span className="font-mono text-xs text-ink-muted">{r.contract_no}</span>
              <span className="text-ink">{r.program_name ?? "(강좌 미지정)"}</span>
              {r.term_name && <span className="text-xs text-ink-hint">{r.term_name}</span>}
              <span className="text-xs text-ink-hint">{SIGNING_METHOD_LABEL[r.signing_method]}</span>
              <span className={STATUS_BADGE[r.status]}>{INSTRUCTOR_CONTRACT_STATUS_LABEL[r.status]}</span>
              {r.signing_method === "electronic" && (
                <button
                  type="button"
                  className="ml-auto rounded border border-line px-2 py-0.5 text-xs hover:bg-surface"
                  onClick={() => setEditing({ contractId: r.id })}
                >
                  {r.status === "draft" ? "이어 쓰기" : "내용"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ContractEditor
          instructorId={instructorId}
          contractId={editing.contractId}
          onClose={() => setEditing(null)}
          onDone={async (text) => {
            setEditing(null);
            setMsg(text);
            await reload();
          }}
        />
      )}
    </section>
  );
}
