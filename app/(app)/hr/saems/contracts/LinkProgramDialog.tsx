"use client";

// [강좌 연결] — 강좌 미지정 계약(옛 종이 계약 등)에 그 강사가 맡은 강좌를 연결합니다.
//   계약서 1건 = 강좌 여러 개. 작성과 같은 규칙 — 같은 학기·같은 강사료 방식과 금액만 함께 고를 수 있고,
//   다른 유효 계약에 이미 든 강좌는 고를 수 없습니다(그래도 겹치면 서버가 거절하고 기존 계약서 id 를 돌려줌).
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  linkInstructorContractProgram,
  listInstructorProgramOptions,
  type ProgramLinkOption,
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
  const [opts, setOpts] = useState<ProgramLinkOption[] | null>(null);
  const [picks, setPicks] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    listInstructorProgramOptions(row.instructor_id).then((o) => alive && setOpts(o));
    return () => {
      alive = false;
    };
  }, [row.instructor_id]);

  // 학기별로 묶어 보여 줍니다(최신 학기 먼저 — 서버 정렬 순서 유지).
  const groups = useMemo(() => {
    const m = new Map<string, ProgramLinkOption[]>();
    for (const o of opts ?? []) m.set(o.termId, [...(m.get(o.termId) ?? []), o]);
    return [...m.values()];
  }, [opts]);
  const first = (opts ?? []).find((o) => o.programId === picks[0]) ?? null;
  // 이름이 같은 강좌는 요일·시간을 붙여 구분.
  const dupName = useMemo(() => {
    const c = new Map<string, number>();
    for (const o of opts ?? []) c.set(`${o.termId}:${o.programName}`, (c.get(`${o.termId}:${o.programName}`) ?? 0) + 1);
    return c;
  }, [opts]);

  function toggle(id: string) {
    setPicks((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function link() {
    setErr(null);
    start(async () => {
      const r = await linkInstructorContractProgram(row.id, picks);
      if (!r.ok) {
        if (r.existingId) return onExisting(r.existingId, r.message);
        return setErr(r.message);
      }
      onDone();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-card p-5 shadow-lg">
        <h3 className="text-base font-bold text-ink">강좌 연결</h3>
        <p className="mt-1 text-xs text-ink-muted">
          {row.contract_no} · {row.instructor_name}. 이 계약서에 든 강좌를 모두 고르세요(같은 학기·같은 강사료만 함께).
        </p>
        {!opts ? (
          <p className="mt-3 text-sm text-ink-hint">불러오는 중…</p>
        ) : opts.length === 0 ? (
          <p className="mt-3 text-sm text-stamp">이 강사가 맡은 강좌(유급)가 없습니다.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {groups.map((g) => (
              <div key={g[0].termId} className="rounded-md border border-line p-2">
                <p className="mb-1 text-xs font-semibold text-navy">
                  {g[0].projectName ? `[${g[0].projectName}] ` : ""}
                  {g[0].termName ?? "학기 미정"}
                  {g[0].termPeriod && <span className="ml-1 font-normal text-ink-hint">{g[0].termPeriod}</span>}
                </p>
                <ul className="space-y-1">
                  {g.map((o) => {
                    const checked = picks.includes(o.programId);
                    const otherTerm = !!first && first.termId !== o.termId;
                    const payDiff = !!first && !otherTerm && first.payKey !== o.payKey;
                    const disabled = !checked && (o.hasActive || otherTerm || payDiff);
                    const label =
                      (dupName.get(`${o.termId}:${o.programName}`) ?? 0) > 1 && o.timeTag
                        ? `${o.programName} (${o.timeTag})`
                        : o.programName;
                    return (
                      <li key={o.programId} className={`flex flex-wrap items-center gap-2 text-sm ${disabled ? "text-ink-hint" : ""}`}>
                        <label className="flex items-center gap-1.5">
                          <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(o.programId)} />
                          {label}
                        </label>
                        {o.hasActive && <span className="text-[11px]">계약서 있음({o.activeContractNo})</span>}
                        {!o.hasActive && payDiff && <span className="text-[11px]">강사료가 달라 별도 계약</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        {err && <p className={`mt-2 ${noticeError}`}>{err}</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" className={btnPrimary} disabled={pending || !picks.length} onClick={link}>
            {pending ? "연결 중…" : picks.length > 1 ? `강좌 ${picks.length}개 연결` : "연결"}
          </button>
          <button type="button" className={btnSecondary} onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
