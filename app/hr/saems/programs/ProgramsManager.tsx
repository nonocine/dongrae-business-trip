"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  listTerms,
  listPrograms,
  createProject,
  createTerm,
  updateTermStatus,
  copyTerm,
  addProgram,
  updateProgram,
  deleteProgram,
  type ProgramRow,
  type InstructorOption,
  type ProgramInput,
} from "@/app/hr/saems/programActions";
import {
  TERM_STATUS_LABEL,
  formatKRW,
  type SaemProject,
  type SaemTerm,
  type TermStatus,
} from "@/lib/saem";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

const selCls =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body whitespace-nowrap";
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

type Modal =
  | { kind: "project" }
  | { kind: "term" }
  | { kind: "copy" }
  | { kind: "program"; program: ProgramRow | null }
  | null;

export default function ProgramsManager({
  projects,
  instructors,
}: {
  projects: SaemProject[];
  instructors: InstructorOption[];
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [terms, setTerms] = useState<SaemTerm[]>([]);
  const [termId, setTermId] = useState("");
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [, start] = useTransition();

  const term = terms.find((t) => t.id === termId) ?? null;

  // 프로젝트 변경 → 차시 로드.
  useEffect(() => {
    let alive = true;
    (async () => {
      const t = projectId ? await listTerms(projectId) : [];
      if (!alive) return;
      setTerms(t);
      setTermId((cur) => (t.some((x) => x.id === cur) ? cur : t[0]?.id ?? ""));
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  // 차시 변경 → 프로그램 로드.
  useEffect(() => {
    let alive = true;
    (async () => {
      const p = termId ? await listPrograms(termId) : [];
      if (alive) setPrograms(p);
    })();
    return () => {
      alive = false;
    };
  }, [termId]);

  async function reloadPrograms() {
    if (termId) setPrograms(await listPrograms(termId));
  }
  async function reloadTerms(selectId?: string) {
    const t = projectId ? await listTerms(projectId) : [];
    setTerms(t);
    if (selectId) setTermId(selectId);
  }

  function changeStatus(status: TermStatus) {
    if (!termId) return;
    setMsg(null);
    start(async () => {
      const res = await updateTermStatus(termId, status);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setTerms((prev) =>
        prev.map((t) => (t.id === termId ? { ...t, status } : t))
      );
      router.refresh();
    });
  }

  function onDeleteProgram(p: ProgramRow) {
    if (!confirm(`[${p.name}] 프로그램을 삭제할까요?`)) return;
    setMsg(null);
    start(async () => {
      const res = await deleteProgram(p.id);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      await reloadPrograms();
      setMsg({ ok: true, text: "삭제했습니다." });
    });
  }

  return (
    <div className="space-y-5">
      {/* 프로젝트·차시 선택 */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className={selCls}
            aria-label="프로젝트"
          >
            {projects.length === 0 && <option value="">프로젝트 없음</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={termId}
            onChange={(e) => setTermId(e.target.value)}
            className={selCls}
            aria-label="차시"
          >
            {terms.length === 0 && <option value="">차시 없음</option>}
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({TERM_STATUS_LABEL[t.status]})
              </option>
            ))}
          </select>

          {term && (
            <select
              value={term.status}
              onChange={(e) => changeStatus(e.target.value as TermStatus)}
              className={selCls}
              aria-label="차시 상태"
              title="closed 로 바꾸면 동래샘들 홈에서 자동 제외"
            >
              <option value="draft">준비</option>
              <option value="active">진행중</option>
              <option value="closed">종료</option>
            </select>
          )}

          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" onClick={() => setModal({ kind: "project" })} className={btnSecondary}>
              프로젝트 추가
            </button>
            <button type="button" onClick={() => setModal({ kind: "term" })} className={btnSecondary} disabled={!projectId}>
              차시 추가
            </button>
            <button type="button" onClick={() => setModal({ kind: "copy" })} className={btnSecondary} disabled={!termId}>
              차시 복사
            </button>
          </div>
        </div>
        {term && (term.start_date || term.end_date) && (
          <p className="mt-2 text-xs text-ink-hint">
            기간 {term.start_date ?? "-"} ~ {term.end_date ?? "-"}
          </p>
        )}
      </section>

      {msg && (
        <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>
      )}

      {/* 프로그램 목록 */}
      <section className={cardCls}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">
            프로그램 {termId ? `(${programs.length})` : ""}
          </h3>
          <button
            type="button"
            onClick={() => setModal({ kind: "program", program: null })}
            className={btnPrimary}
            disabled={!termId}
          >
            + 프로그램 추가
          </button>
        </div>

        {!termId ? (
          <p className="py-8 text-center text-sm text-ink-hint">차시를 선택하세요.</p>
        ) : programs.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-hint">
            프로그램이 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={thCls}>프로그램</th>
                  <th className={thCls}>강사</th>
                  <th className={thCls}>교시</th>
                  <th className={thCls}>시간</th>
                  <th className={thCls}>장소</th>
                  <th className={`${thCls} text-right`}>정원</th>
                  <th className={`${thCls} text-right`}>수강료</th>
                  <th className={`${thCls} text-right`}>시급</th>
                  <th className={`${thCls} text-right`}>관리</th>
                </tr>
              </thead>
              <tbody>
                {programs.map((p) => (
                  <tr key={p.id} className="border-b border-line/60">
                    <td className={`${tdCls} font-medium text-ink`}>{p.name}</td>
                    <td className={tdCls}>{p.instructorName ?? "-"}</td>
                    <td className={tdCls}>{p.period_no ?? "-"}</td>
                    <td className={`${tdCls} font-mono text-xs`}>
                      {p.time_start ? `${hhmm(p.time_start)}~${hhmm(p.time_end)}` : "-"}
                    </td>
                    <td className={tdCls}>{p.room ?? "-"}</td>
                    <td className={`${tdCls} text-right`}>{p.capacity ?? "-"}</td>
                    <td className={`${tdCls} text-right font-mono`}>
                      {formatKRW(p.tuition)}
                    </td>
                    <td className={`${tdCls} text-right font-mono`}>
                      {formatKRW(p.hourly_rate)}
                    </td>
                    <td className={`${tdCls} text-right`}>
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setModal({ kind: "program", program: p })}
                          className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface"
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteProgram(p)}
                          className="rounded border border-stamp px-2 py-1 text-xs text-stamp hover:bg-stamp-soft"
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal?.kind === "project" && (
        <ProjectModal
          onClose={() => setModal(null)}
          onDone={async (id) => {
            setModal(null);
            setMsg({ ok: true, text: "프로젝트를 추가했습니다." });
            router.refresh();
            void id;
          }}
        />
      )}
      {modal?.kind === "term" && (
        <TermModal
          projectId={projectId}
          onClose={() => setModal(null)}
          onDone={async (id) => {
            setModal(null);
            await reloadTerms(id);
            setMsg({ ok: true, text: "차시를 추가했습니다." });
          }}
        />
      )}
      {modal?.kind === "copy" && (
        <CopyModal
          sourceTermId={termId}
          onClose={() => setModal(null)}
          onDone={async (id, text) => {
            setModal(null);
            await reloadTerms(id);
            setMsg({ ok: true, text });
          }}
        />
      )}
      {modal?.kind === "program" && (
        <ProgramModal
          termId={termId}
          instructors={instructors}
          program={modal.program}
          onClose={() => setModal(null)}
          onDone={async (text) => {
            setModal(null);
            await reloadPrograms();
            setMsg({ ok: true, text });
          }}
        />
      )}
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">{title}</h3>
          <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:underline">
            닫기
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ProjectModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <ModalShell title="프로젝트 추가" onClose={onClose}>
      <label className="block text-[11px] font-semibold text-navy">프로젝트명 *</label>
      <input value={name} onChange={(e) => setName(e.target.value)} className={`${inCls} mt-1`} />
      <label className="mt-3 block text-[11px] font-semibold text-navy">설명</label>
      <input value={desc} onChange={(e) => setDesc(e.target.value)} className={`${inCls} mt-1`} />
      {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={pending}
          className={btnPrimary}
          onClick={() =>
            start(async () => {
              const res = await createProject(name, desc);
              if (!res.ok) return setErr(res.message);
              onDone(res.id);
            })
          }
        >
          {pending ? "추가 중…" : "추가"}
        </button>
        <button type="button" onClick={onClose} className={btnSecondary}>취소</button>
      </div>
    </ModalShell>
  );
}

function TermModal({
  projectId,
  onClose,
  onDone,
}: {
  projectId: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [start1, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startT] = useTransition();
  return (
    <ModalShell title="차시 추가" onClose={onClose}>
      <label className="block text-[11px] font-semibold text-navy">차시명 *</label>
      <input value={name} onChange={(e) => setName(e.target.value)} className={`${inCls} mt-1`} placeholder="예: 4차시" />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-navy">시작일</label>
          <input type="date" value={start1} onChange={(e) => setStart(e.target.value)} className={`${inCls} mt-1`} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-navy">종료일</label>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={`${inCls} mt-1`} />
        </div>
      </div>
      {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={pending}
          className={btnPrimary}
          onClick={() =>
            startT(async () => {
              const res = await createTerm({ projectId, name, startDate: start1, endDate: end });
              if (!res.ok) return setErr(res.message);
              onDone(res.id);
            })
          }
        >
          {pending ? "추가 중…" : "추가"}
        </button>
        <button type="button" onClick={onClose} className={btnSecondary}>취소</button>
      </div>
    </ModalShell>
  );
}

function CopyModal({
  sourceTermId,
  onClose,
  onDone,
}: {
  sourceTermId: string;
  onClose: () => void;
  onDone: (id: string, text: string) => void;
}) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [weeks, setWeeks] = useState("8");
  const [holidays, setHolidays] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <ModalShell title="차시 복사" onClose={onClose}>
      <p className="mb-3 text-xs text-ink-hint">
        선택한 차시의 프로그램(강사·시간·정원·요금)을 새 차시로 복제하고, 시작일부터
        토요일 회차를 자동 생성합니다.
      </p>
      <label className="block text-[11px] font-semibold text-navy">새 차시명 *</label>
      <input value={name} onChange={(e) => setName(e.target.value)} className={`${inCls} mt-1`} placeholder="예: 4차시" />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-navy">시작일 *</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`${inCls} mt-1`} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-navy">주차 수</label>
          <input type="number" min={1} value={weeks} onChange={(e) => setWeeks(e.target.value)} className={`${inCls} mt-1`} />
        </div>
      </div>
      <label className="mt-3 block text-[11px] font-semibold text-navy">
        휴강일(쉼표로 여러 개, YYYY-MM-DD)
      </label>
      <input value={holidays} onChange={(e) => setHolidays(e.target.value)} className={`${inCls} mt-1`} placeholder="2026-09-20, 2026-10-04" />
      {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={pending}
          className={btnPrimary}
          onClick={() =>
            start(async () => {
              const res = await copyTerm({
                sourceTermId,
                name,
                startDate,
                weeks: Number(weeks),
                holidays: holidays
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              });
              if (!res.ok) return setErr(res.message);
              onDone(res.id, `프로그램 ${res.programs}개·회차 ${res.sessions}개를 복사했습니다.`);
            })
          }
        >
          {pending ? "복사 중…" : "복사 생성"}
        </button>
        <button type="button" onClick={onClose} className={btnSecondary}>취소</button>
      </div>
    </ModalShell>
  );
}

function ProgramModal({
  termId,
  instructors,
  program,
  onClose,
  onDone,
}: {
  termId: string;
  instructors: InstructorOption[];
  program: ProgramRow | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [f, setF] = useState({
    name: program?.name ?? "",
    instructor_id: program?.instructor_id ?? "",
    period_no: program?.period_no != null ? String(program.period_no) : "",
    time_start: program?.time_start ? program.time_start.slice(0, 5) : "",
    time_end: program?.time_end ? program.time_end.slice(0, 5) : "",
    target: program?.target ?? "",
    capacity: program?.capacity != null ? String(program.capacity) : "",
    tuition: program?.tuition != null ? String(program.tuition) : "",
    room: program?.room ?? "",
    hourly_rate: program?.hourly_rate != null ? String(program.hourly_rate) : "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (p: Partial<typeof f>) => setF((prev) => ({ ...prev, ...p }));
  const numOrNull = (v: string) => (v === "" ? null : Number(v));

  function submit() {
    setErr(null);
    const input: ProgramInput = {
      name: f.name,
      instructor_id: f.instructor_id || null,
      period_no: numOrNull(f.period_no),
      time_start: f.time_start || null,
      time_end: f.time_end || null,
      target: f.target || null,
      capacity: numOrNull(f.capacity),
      tuition: numOrNull(f.tuition),
      room: f.room || null,
      hourly_rate: numOrNull(f.hourly_rate),
    };
    start(async () => {
      const res = program
        ? await updateProgram(program.id, input)
        : await addProgram(termId, input);
      if (!res.ok) return setErr(res.message);
      onDone(program ? "수정했습니다." : "프로그램을 추가했습니다.");
    });
  }

  return (
    <ModalShell title={program ? "프로그램 수정" : "프로그램 추가"} onClose={onClose}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <FieldP label="프로그램명 *" full>
          <input value={f.name} onChange={(e) => set({ name: e.target.value })} className={inCls} />
        </FieldP>
        <FieldP label="강사">
          <select value={f.instructor_id} onChange={(e) => set({ instructor_id: e.target.value })} className={inCls}>
            <option value="">(미지정)</option>
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </FieldP>
        <FieldP label="교시">
          <input type="number" value={f.period_no} onChange={(e) => set({ period_no: e.target.value })} className={inCls} />
        </FieldP>
        <FieldP label="시작시간">
          <input type="time" value={f.time_start} onChange={(e) => set({ time_start: e.target.value })} className={inCls} />
        </FieldP>
        <FieldP label="종료시간">
          <input type="time" value={f.time_end} onChange={(e) => set({ time_end: e.target.value })} className={inCls} />
        </FieldP>
        <FieldP label="대상">
          <input value={f.target} onChange={(e) => set({ target: e.target.value })} className={inCls} />
        </FieldP>
        <FieldP label="장소">
          <input value={f.room} onChange={(e) => set({ room: e.target.value })} className={inCls} />
        </FieldP>
        <FieldP label="정원">
          <input type="number" value={f.capacity} onChange={(e) => set({ capacity: e.target.value })} className={inCls} />
        </FieldP>
        <FieldP label="수강료">
          <input type="number" value={f.tuition} onChange={(e) => set({ tuition: e.target.value })} className={inCls} />
        </FieldP>
        <FieldP label="시급">
          <input type="number" value={f.hourly_rate} onChange={(e) => set({ hourly_rate: e.target.value })} className={inCls} />
        </FieldP>
      </div>
      {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={submit} disabled={pending} className={btnPrimary}>
          {pending ? "저장 중…" : "저장"}
        </button>
        <button type="button" onClick={onClose} className={btnSecondary}>취소</button>
      </div>
    </ModalShell>
  );
}

function FieldP({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="block text-[11px] font-semibold text-navy">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
