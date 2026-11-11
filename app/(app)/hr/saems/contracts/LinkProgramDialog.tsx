"use client";

// [강좌 연결] — 강좌 미지정 계약(옛 종이 계약 등)에 그 강사가 맡은 강좌를 연결합니다.
//   이미 유효 계약이 있는 강좌를 고르면 서버가 거절하고 기존 계약서 id 를 돌려줍니다.
import { useEffect, useState, useTransition } from "react";
import {
  linkInstructorContractProgram,
  listInstructorProgramOptions,
  type ProgramRef,
} from "@/app/(app)/hr/saems/contractActions";
import type { InstructorContractRow } from "@/lib/instructorContract";
import { btnPrimary, btnSecondary, noticeError } from "@/lib/ui";

export function programLabel(p: { projectName: string | null; programName: string; termName: string | null }): string {
  return `${p.projectName ? `[${p.projectName}] ` : ""}${p.programName}${p.termName ? ` · ${p.termName}` : ""}`;
}

export default function LinkProgramDialog({
  row,
  onClose,
  onDone,
  onExisting,
}: {
  row: InstructorContractRow;
  onClose: () => void;
  onDone: () => void;
  onExisting: (contractId: string, message: string) => void; // 중복 — 기존 계약서로 이동
}) {
  const [opts, setOpts] = useState<(ProgramRef & { hasActive: boolean })[] | null>(null);
  const [pick, setPick] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    listInstructorProgramOptions(row.instructor_id).then((o) => alive && setOpts(o));
    return () => {
      alive = false;
    };
  }, [row.instructor_id]);

  function link() {
    setErr(null);
    start(async () => {
      const r = await linkInstructorContractProgram(row.id, pick);
      if (!r.ok) {
        if (r.existingId) return onExisting(r.existingId, r.message);
        return setErr(r.message);
      }
      onDone();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-card p-5 shadow-lg">
        <h3 className="text-base font-bold text-ink">강좌 연결</h3>
        <p className="mt-1 text-xs text-ink-muted">
          {row.contract_no} · {row.instructor_name}. 이 강사가 맡은 강좌 중에서 고르세요.
        </p>
        {!opts ? (
          <p className="mt-3 text-sm text-ink-hint">불러오는 중…</p>
        ) : opts.length === 0 ? (
          <p className="mt-3 text-sm text-stamp">이 강사가 맡은 강좌(채용함)가 없습니다.</p>
        ) : (
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="mt-3 block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm"
          >
            <option value="" disabled>
              강좌를 고르세요
            </option>
            {opts.map((o) => (
              <option key={o.programId} value={o.programId}>
                {programLabel(o)}
                {o.hasActive ? " — 계약서 있음" : ""}
              </option>
            ))}
          </select>
        )}
        {err && <p className={`mt-2 ${noticeError}`}>{err}</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" className={btnPrimary} disabled={pending || !pick} onClick={link}>
            {pending ? "연결 중…" : "연결"}
          </button>
          <button type="button" className={btnSecondary} onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
