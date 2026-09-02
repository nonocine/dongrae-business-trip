"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  listTerms,
  listPrograms,
  createProject,
  createTerm,
  updateTerm,
  updateTermStatus,
  copyTerm,
  addProgram,
  updateProgram,
  deleteProgram,
  checkProgramDeletable,
  generateProgramSessions,
  type ProgramRow,
  type InstructorOption,
  type ProgramInput,
  type ProgramDeletability,
} from "@/app/hr/saems/programActions";
import {
  TERM_STATUS_LABEL,
  PAY_TYPE_LABEL,
  formatKRW,
  payTypeSummary,
  trimRate,
  type PayType,
  type SaemProject,
  type SaemTerm,
  type TermStatus,
} from "@/lib/saem";
import {
  buildSessionDates,
  firstWeekdayOnOrAfter,
  weekdayOf,
  WEEKDAY_LABELS,
} from "@/lib/saemSchedule";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  badgeDanger,
  badgeNeutral,
  badgeNavy,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

const selCls =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body whitespace-nowrap";
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

// 관리 열 버튼 — 출력(네이비)과 편집(회색)을 색으로도 구분한다.
const outBtn =
  "inline-flex items-center rounded border border-navy/40 px-2 py-1 text-xs text-navy hover:bg-surface";
const outBtnOff =
  "inline-flex items-center rounded border border-line/60 px-2 py-1 text-xs text-ink-hint";
const editBtn =
  "rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface";

type Modal =
  | { kind: "project" }
  | { kind: "term"; term: SaemTerm | null }
  | { kind: "copy" }
  | { kind: "program"; program: ProgramRow | null }
  | { kind: "sessions"; program: ProgramRow }
  | { kind: "delete"; program: ProgramRow; check: ProgramDeletability }
  | null;

// =====================================================================
// 스케줄 입력 공용 — 차시(기본값)·프로그램(실제값)·차시 복사가 같이 쓴다.
// =====================================================================
type ScheduleForm = {
  start: string; // 프로그램·복사에서만 사용(차시 기본값에는 없음)
  weekday: string;
  weeks: string;
  holidays: string[];
};

function WeekdaySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inCls}>
      {WEEKDAY_LABELS.map((label, i) => (
        <option key={i} value={String(i)}>
          {label}요일
        </option>
      ))}
    </select>
  );
}

// 휴강일 — 날짜 하나씩 추가/삭제.
function HolidayPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [pick, setPick] = useState("");
  function add() {
    if (!pick) return;
    if (!value.includes(pick)) onChange([...value, pick].sort());
    setPick("");
  }
  return (
    <div>
      <div className="flex gap-2">
        <input
          type="date"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className={inCls}
        />
        <button type="button" onClick={add} disabled={!pick} className={btnSecondary}>
          추가
        </button>
      </div>
      {value.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {value.map((d) => (
            <li
              key={d}
              className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] text-ink-muted"
            >
              {d}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== d))}
                className="text-stamp hover:underline"
                aria-label={`${d} 삭제`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// 생성될 회차 날짜 실시간 미리보기(급여 미리보기 패턴).
function SessionPreview({
  start,
  weekday,
  weeks,
  holidays,
}: {
  start: string;
  weekday: string;
  weeks: string;
  holidays: string[];
}) {
  const n = Number(weeks);
  const dates =
    start && Number.isFinite(n) && n > 0
      ? buildSessionDates({
          start,
          weekday: Number(weekday),
          weeks: n,
          holidays,
        })
      : [];
  return (
    <div className="mt-2 rounded-md border border-line bg-surface p-2.5">
      <p className="text-[11px] font-semibold text-navy">
        생성될 회차 {dates.length > 0 ? `${dates.length}건` : ""}
      </p>
      {dates.length === 0 ? (
        <p className="mt-1 text-[11px] text-ink-hint">
          시작일과 회차 수를 입력하면 날짜가 표시됩니다.
        </p>
      ) : (
        <ol className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
          {dates.map((d, i) => (
            <li key={d} className="font-mono text-[11px] text-ink-body">
              <span className="text-ink-hint">{i + 1}.</span> {d}
            </li>
          ))}
        </ol>
      )}
      {holidays.length > 0 && (
        <p className="mt-1.5 text-[11px] text-ink-hint">
          휴강일 {holidays.length}건은 건너뛰고 다음 주로 밀려 회차 수를 채웁니다.
        </p>
      )}
    </div>
  );
}

// =====================================================================
// PDF 출력 메뉴 — 근무일지 / 출석부(출결 포함·빈 양식).
//   버튼을 따로 두면 관리 열이 표 밖으로 밀린다. 실측: 버튼 2개(근무일지·출석부)
//   + 수정·삭제면 글자를 줄이고 여백을 깎아도 표가 67px 넘쳐 삭제가 잘렸다.
//   그래서 출력 3종을 메뉴 하나로 접고, 관리 열을 [출력 ▼ | 수정 삭제] 한 줄로 둔다.
//   표가 overflow-x-auto 라 일반 드롭다운은 잘린다 → portal + fixed 좌표로 띄운다
//   (비품관리 AssetManager 의 ⋯ 메뉴와 같은 방식). 목록 끝 행에서는 위로 편다.
// =====================================================================
const MENU_W = 216;
const MENU_H = 148;

function OutputMenu({ programId }: { programId: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const below = r.bottom + 4;
      const top =
        below + MENU_H > window.innerHeight
          ? Math.max(8, r.top - MENU_H - 4) // 아래가 좁으면 버튼 위로
          : below;
      const left = Math.min(
        Math.max(8, r.right - MENU_W),
        window.innerWidth - MENU_W - 8
      );
      setPos({ top, left });
    }
    setOpen((o) => !o);
  }

  const item =
    "block w-full px-3 py-1.5 text-left text-xs text-ink-body hover:bg-surface";
  const sub = "mt-0.5 block text-[10px] text-ink-hint";
  const sheet = `/hr/saems/programs/${programId}/attendance-sheet`;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className={outBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        title="PDF 출력 — 근무일지 / 출석부"
      >
        출력
        <span aria-hidden className="ml-1 text-[8px]">
          ▼
        </span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)}>
            <div
              role="menu"
              className="absolute overflow-hidden rounded-lg border border-line bg-card py-1 shadow-lg"
              style={{ top: pos.top, left: pos.left, width: MENU_W }}
              onClick={(e) => e.stopPropagation()}
            >
              <a
                href={`/hr/saems/programs/${programId}/worklog`}
                role="menuitem"
                className={item}
                onClick={() => setOpen(false)}
              >
                강사 근무일지
                <span className={sub}>강사 서명 자동 · A4 1장</span>
              </a>
              <div className="my-1 border-t border-line/70" />
              <a href={sheet} role="menuitem" className={item} onClick={() => setOpen(false)}>
                출석부 · 출결 포함
                <span className={sub}>체크된 출결이 채워진 출석부</span>
              </a>
              <a
                href={`${sheet}?blank=1`}
                role="menuitem"
                className={item}
                onClick={() => setOpen(false)}
              >
                출석부 · 빈 양식
                <span className={sub}>출결 칸이 빈 — 손으로 체크</span>
              </a>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

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

  // 삭제 — 서버 판정을 먼저 받아 모달로 결과를 보여준다(조용한 실패 없음).
  function onDeleteProgram(p: ProgramRow) {
    setMsg(null);
    start(async () => {
      const check = await checkProgramDeletable(p.id);
      setModal({ kind: "delete", program: p, check });
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
            <button type="button" onClick={() => setModal({ kind: "term", term: null })} className={btnSecondary} disabled={!projectId}>
              차시 추가
            </button>
            <button
              type="button"
              onClick={() => term && setModal({ kind: "term", term })}
              className={btnSecondary}
              disabled={!term}
              title="기간·기본 스케줄 수정(기존 회차는 그대로)"
            >
              차시 수정
            </button>
            <button type="button" onClick={() => setModal({ kind: "copy" })} className={btnSecondary} disabled={!termId}>
              차시 복사
            </button>
          </div>
        </div>
        {term && (term.start_date || term.end_date || term.default_weeks != null) && (
          <p className="mt-2 text-xs text-ink-hint">
            기간 {term.start_date ?? "-"} ~ {term.end_date ?? "-"}
            {term.default_weeks != null && (
              <>
                {" · 기본 스케줄 "}
                {WEEKDAY_LABELS[term.default_weekday ?? 6]}요일 ·{" "}
                {term.default_weeks}회
                {term.default_holidays.length > 0 &&
                  ` · 휴강 ${term.default_holidays.length}건`}
              </>
            )}
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
                  <th className={thCls}>회차</th>
                  <th className={`${thCls} text-right`}>정원</th>
                  <th className={`${thCls} text-right`}>수강료</th>
                  <th className={`${thCls} text-right`}>정산 방식</th>
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
                    <td className={tdCls}>
                      {p.sessionCount === 0 ? (
                        <button
                          type="button"
                          onClick={() => setModal({ kind: "sessions", program: p })}
                          className={`${badgeDanger} hover:underline`}
                          title="회차가 없어 강사 계획서·근무일지가 비어 있습니다"
                        >
                          0회차 — 회차 생성
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-xs text-ink-body">
                            {p.sessionCount}회
                          </span>
                          {p.lockedCount > 0 && (
                            <span className={badgeNeutral} title="제출·확정·정산된 회차">
                              확정 {p.lockedCount}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className={`${tdCls} text-right`}>{p.capacity ?? "-"}</td>
                    <td className={`${tdCls} text-right font-mono`}>
                      {formatKRW(p.tuition)}
                    </td>
                    <td className={`${tdCls} text-right`}>
                      <span
                        className={
                          p.pay_type === "revenue_share" ? badgeNavy : badgeNeutral
                        }
                        title={
                          p.pay_type === "revenue_share"
                            ? "등록 인원 × 수강료 × 분배율"
                            : "확정 근무일지 시간 × 시급"
                        }
                      >
                        {payTypeSummary(p)}
                      </span>
                    </td>
                    <td className={`${tdCls} text-right`}>
                      {/* 출력(PDF) | 편집(수정·삭제) — 구분선으로 나눈 한 줄. */}
                      <div className="flex items-center justify-end gap-1">
                        {p.sessionCount > 0 ? (
                          <OutputMenu programId={p.id} />
                        ) : (
                          <span
                            className={outBtnOff}
                            title="회차가 없어 출력할 내용이 없습니다"
                          >
                            출력
                          </span>
                        )}
                        <span aria-hidden className="h-4 w-px bg-line" />
                        <button
                          type="button"
                          onClick={() => setModal({ kind: "program", program: p })}
                          className={editBtn}
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
          term={modal.term}
          onClose={() => setModal(null)}
          onDone={async (id, text) => {
            setModal(null);
            await reloadTerms(id);
            setMsg({ ok: true, text });
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
          term={term}
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
      {modal?.kind === "sessions" && (
        <SessionsModal
          program={modal.program}
          term={term}
          onClose={() => setModal(null)}
          onDone={async (text) => {
            setModal(null);
            await reloadPrograms();
            setMsg({ ok: true, text });
          }}
        />
      )}
      {modal?.kind === "delete" && (
        <DeleteProgramModal
          program={modal.program}
          check={modal.check}
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

// =====================================================================
// SA-15. 삭제 안내 — 가능하면 확인, 불가하면 사유와 해제 절차를 보여준다.
// =====================================================================
function DeleteProgramModal({
  program,
  check,
  onClose,
  onDone,
}: {
  program: ProgramRow;
  check: ProgramDeletability;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // 불가 사유 — 0건인 항목은 나열하지 않는다.
  const reasons: string[] = [];
  if (check.submittedLogs > 0)
    reasons.push(`제출된 근무일지 ${check.submittedLogs}건`);
  if (check.confirmedLogs > 0)
    reasons.push(`확정된 근무일지 ${check.confirmedLogs}건`);
  if (check.settlementLinks > 0)
    reasons.push(
      `정산에 묶인 회차 ${check.settlementLinks}건` +
        (check.confirmedSettlementLinks > 0
          ? ` (그중 확정 정산 ${check.confirmedSettlementLinks}건)`
          : "")
    );

  if (!check.deletable) {
    return (
      <ModalShell title="삭제할 수 없습니다" onClose={onClose}>
        <p className="text-sm text-ink-body">
          <b>{program.name}</b> 은 정산 근거가 되는 기록이 있어 삭제할 수 없습니다.
        </p>
        <ul className="mt-3 space-y-1 rounded-md border border-stamp/40 bg-stamp-soft p-3">
          {reasons.map((r) => (
            <li key={r} className="text-sm text-stamp">
              • {r}
            </li>
          ))}
        </ul>
        <div className="mt-3 rounded-md border border-line bg-surface p-3">
          <p className="text-[11px] font-semibold text-navy">정리하려면</p>
          <p className="mt-1 text-xs text-ink-body">
            정산 확정취소(관장) → 정산 삭제 → 일지 확정취소 → (필요시 일지
            초기화) → 프로그램 삭제
          </p>
          <p className="mt-1 text-[11px] text-ink-muted">
            정산 확정취소 외에는 강사관리 담당자가 직접 가능합니다.
          </p>
          <p className="mt-1.5 text-[11px] text-ink-hint">
            기록을 남겨야 한다면 삭제하지 말고 프로그램을 그대로 두세요. 회차만
            정리하려면 프로그램 수정에서 스케줄을 바꾸면 미제출 회차만 정리됩니다.
          </p>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>
            닫기
          </button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="프로그램 삭제" onClose={onClose}>
      <p className="text-sm text-ink-body">
        <b>{program.name}</b> 을 삭제할까요?
      </p>
      <p className="mt-2 text-xs text-ink-muted">
        제출·확정된 근무일지와 정산 연결이 없어 삭제할 수 있습니다.
        {check.sessionCount > 0
          ? ` 회차 ${check.sessionCount}건이 함께 삭제됩니다.`
          : " 삭제할 회차는 없습니다."}
      </p>
      {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={pending}
          className={btnDanger}
          onClick={() =>
            start(async () => {
              setErr(null);
              const res = await deleteProgram(program.id);
              if (!res.ok) {
                // 서버 재판정에서 막혔으면 사유까지 그대로 보여준다.
                setErr(
                  res.deletability
                    ? `${res.message} (제출 ${res.deletability.submittedLogs} · 확정 ${res.deletability.confirmedLogs} · 정산 연결 ${res.deletability.settlementLinks})`
                    : res.message
                );
                return;
              }
              onDone(
                `삭제했습니다.${
                  res.deletedSessions > 0
                    ? ` (회차 ${res.deletedSessions}건 함께 삭제)`
                    : ""
                }`
              );
            })
          }
        >
          {pending ? "삭제 중…" : "삭제"}
        </button>
        <button type="button" onClick={onClose} className={btnSecondary}>
          취소
        </button>
      </div>
    </ModalShell>
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
  term,
  onClose,
  onDone,
}: {
  projectId: string;
  term: SaemTerm | null; // null 이면 추가, 있으면 수정
  onClose: () => void;
  onDone: (id: string, text: string) => void;
}) {
  const [name, setName] = useState(term?.name ?? "");
  const [start1, setStart] = useState(term?.start_date ?? "");
  const [end, setEnd] = useState(term?.end_date ?? "");
  const [weekday, setWeekday] = useState(
    String(term?.default_weekday ?? 6)
  );
  const [weeks, setWeeks] = useState(
    term?.default_weeks != null ? String(term.default_weeks) : "8"
  );
  const [holidays, setHolidays] = useState<string[]>(term?.default_holidays ?? []);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startT] = useTransition();

  // 기본 스케줄이 만들 날짜 — 차시 시작일 기준으로 참고용 표시.
  const previewStart = start1
    ? firstWeekdayOnOrAfter(start1, Number(weekday)) ?? ""
    : "";

  return (
    <ModalShell title={term ? "차시 수정" : "차시 추가"} onClose={onClose}>
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

      <div className="mt-4 rounded-lg border border-line p-3">
        <p className="text-[11px] font-semibold text-navy">
          기본 스케줄 (기본값 — 프로그램마다 변경 가능)
        </p>
        <p className="mt-0.5 text-[11px] text-ink-hint">
          프로그램을 추가할 때 이 값이 채워집니다. 실제 회차는 프로그램별 스케줄이
          결정합니다.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-navy">요일</label>
            <div className="mt-1">
              <WeekdaySelect value={weekday} onChange={setWeekday} />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-navy">회차 수</label>
            <input type="number" min={1} value={weeks} onChange={(e) => setWeeks(e.target.value)} className={`${inCls} mt-1`} />
          </div>
        </div>
        <label className="mt-3 block text-[11px] font-semibold text-navy">휴강일</label>
        <div className="mt-1">
          <HolidayPicker value={holidays} onChange={setHolidays} />
        </div>
        {previewStart && (
          <SessionPreview
            start={previewStart}
            weekday={weekday}
            weeks={weeks}
            holidays={holidays}
          />
        )}
      </div>

      {term && (
        <p className={`mt-3 ${noticeWarning}`}>
          기본값만 바뀝니다. 이미 만든 프로그램의 회차는 그대로 유지됩니다.
        </p>
      )}
      {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={pending}
          className={btnPrimary}
          onClick={() =>
            startT(async () => {
              const payload = {
                name,
                startDate: start1,
                endDate: end,
                defaultWeekday: Number(weekday),
                defaultWeeks: weeks === "" ? null : Number(weeks),
                defaultHolidays: holidays,
              };
              if (term) {
                const res = await updateTerm(term.id, payload);
                if (!res.ok) return setErr(res.message);
                onDone(term.id, "차시를 수정했습니다.");
                return;
              }
              const res = await createTerm({ projectId, ...payload });
              if (!res.ok) return setErr(res.message);
              onDone(res.id, "차시를 추가했습니다.");
            })
          }
        >
          {pending ? "저장 중…" : term ? "저장" : "추가"}
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
  const [weekday, setWeekday] = useState("6");
  const [weeks, setWeeks] = useState("8");
  const [holidays, setHolidays] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <ModalShell title="차시 복사" onClose={onClose}>
      <p className="mb-3 text-xs text-ink-hint">
        선택한 차시의 프로그램(강사·시간·정원·요금)을 새 차시로 복제하고, 아래 스케줄로
        회차를 자동 생성합니다.
      </p>
      <label className="block text-[11px] font-semibold text-navy">새 차시명 *</label>
      <input value={name} onChange={(e) => setName(e.target.value)} className={`${inCls} mt-1`} placeholder="예: 4차시" />
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-[11px] font-semibold text-navy">시작일 *</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`${inCls} mt-1`} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-navy">요일</label>
          <div className="mt-1">
            <WeekdaySelect value={weekday} onChange={setWeekday} />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-navy">회차 수</label>
          <input type="number" min={1} value={weeks} onChange={(e) => setWeeks(e.target.value)} className={`${inCls} mt-1`} />
        </div>
      </div>
      <label className="mt-3 block text-[11px] font-semibold text-navy">휴강일</label>
      <div className="mt-1">
        <HolidayPicker value={holidays} onChange={setHolidays} />
      </div>
      <SessionPreview
        start={startDate}
        weekday={weekday}
        weeks={weeks}
        holidays={holidays}
      />
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
                weekday: Number(weekday),
                weeks: Number(weeks),
                holidays,
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

// 프로그램 스케줄 초기값 — 수정이면 프로그램 값, 추가면 차시 기본값에서 프리필.
//   구 프로그램(스케줄 컬럼 비어 있음)은 실제 회차에서 역산해 채운다.
function initialSchedule(
  program: ProgramRow | null,
  term: SaemTerm | null
): ScheduleForm {
  const termWeekday = term?.default_weekday ?? 6;
  if (program) {
    // 자기 스케줄이 이미 있으면 그 값을 그대로 신뢰한다(휴강일을 비워 둔 것도 의도).
    const hasOwn =
      program.session_start != null || program.session_weeks != null;
    const wd =
      program.session_weekday ??
      (program.firstSessionDate ? weekdayOf(program.firstSessionDate) : null) ??
      termWeekday;
    const start =
      program.session_start ?? program.firstSessionDate ?? term?.start_date ?? "";
    const weeks =
      program.session_weeks ??
      (program.sessionCount > 0 ? program.sessionCount : term?.default_weeks ?? 8);
    return {
      start,
      weekday: String(wd),
      weeks: String(weeks),
      holidays: hasOwn
        ? program.session_holidays
        : program.session_holidays.length
          ? program.session_holidays
          : term?.default_holidays ?? [],
    };
  }
  // 추가 — 시작일 기본값은 차시 시작일 이후 첫 기본요일.
  const start = term?.start_date
    ? firstWeekdayOnOrAfter(term.start_date, termWeekday) ?? ""
    : "";
  return {
    start,
    weekday: String(termWeekday),
    weeks: String(term?.default_weeks ?? 8),
    holidays: term?.default_holidays ?? [],
  };
}

function ProgramModal({
  termId,
  term,
  instructors,
  program,
  onClose,
  onDone,
}: {
  termId: string;
  term: SaemTerm | null;
  instructors: InstructorOption[];
  program: ProgramRow | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [sc, setSc] = useState<ScheduleForm>(() =>
    initialSchedule(program, term)
  );
  const setScf = (p: Partial<ScheduleForm>) => setSc((prev) => ({ ...prev, ...p }));
  const [f, setF] = useState({
    name: program?.name ?? "",
    subject: program?.subject ?? "",
    instructor_id: program?.instructor_id ?? "",
    period_no: program?.period_no != null ? String(program.period_no) : "",
    time_start: program?.time_start ? program.time_start.slice(0, 5) : "",
    time_end: program?.time_end ? program.time_end.slice(0, 5) : "",
    target: program?.target ?? "",
    capacity: program?.capacity != null ? String(program.capacity) : "",
    tuition: program?.tuition != null ? String(program.tuition) : "",
    room: program?.room ?? "",
    hourly_rate: program?.hourly_rate != null ? String(program.hourly_rate) : "",
    deduction_rate:
      program?.deduction_rate != null ? String(program.deduction_rate) : "3.3",
    pay_type: (program?.pay_type ?? "hourly") as PayType,
    // 분배율 기본 70 — 분배제로 바꿀 때 바로 쓸 수 있게 미리 채운다.
    share_rate:
      program?.share_rate != null ? trimRate(program.share_rate) : "70",
  });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (p: Partial<typeof f>) => setF((prev) => ({ ...prev, ...p }));
  const numOrNull = (v: string) => (v === "" ? null : Number(v));

  function submit() {
    setErr(null);
    const input: ProgramInput = {
      name: f.name,
      subject: f.subject || null,
      instructor_id: f.instructor_id || null,
      period_no: numOrNull(f.period_no),
      time_start: f.time_start || null,
      time_end: f.time_end || null,
      target: f.target || null,
      capacity: numOrNull(f.capacity),
      tuition: numOrNull(f.tuition),
      room: f.room || null,
      hourly_rate: numOrNull(f.hourly_rate),
      deduction_rate: numOrNull(f.deduction_rate),
      pay_type: f.pay_type,
      share_rate: numOrNull(f.share_rate),
      session_start: sc.start || null,
      session_weekday: sc.weekday === "" ? null : Number(sc.weekday),
      session_weeks: sc.weeks === "" ? null : Number(sc.weeks),
      session_holidays: sc.holidays,
    };
    start(async () => {
      if (program) {
        const res = await updateProgram(program.id, input);
        if (!res.ok) return setErr(res.message);
        const s = res.sync;
        onDone(
          s
            ? `수정했습니다. 회차 ${s.created}건 생성` +
                (s.deleted ? `·${s.deleted}건 삭제` : "") +
                (s.kept ? `·제출·확정분 ${s.kept}건 보존` : "")
            : "수정했습니다."
        );
        return;
      }
      const res = await addProgram(termId, input);
      if (!res.ok) return setErr(res.message);
      onDone(`프로그램을 추가했습니다. 회차 ${res.sessions}건 생성.`);
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
        <FieldP label="과목">
          <input
            value={f.subject}
            onChange={(e) => set({ subject: e.target.value })}
            placeholder="예: 비보잉"
            className={inCls}
          />
          <p className="mt-1 text-[10px] text-ink-hint">
            강사비 지급대장에 들어갑니다. 비우면 프로그램명이 대신 나갑니다.
          </p>
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
        {/* ST-5. 정산 방식 — 시급/분배율 중 쓰는 칸만 보여 준다. */}
        <FieldP label="정산 방식 *">
          <select
            value={f.pay_type}
            onChange={(e) => set({ pay_type: e.target.value as PayType })}
            className={inCls}
          >
            <option value="hourly">{PAY_TYPE_LABEL.hourly}</option>
            <option value="revenue_share">{PAY_TYPE_LABEL.revenue_share}</option>
          </select>
        </FieldP>
        {f.pay_type === "revenue_share" ? (
          <FieldP label="강사 비율(%)">
            <input
              type="number"
              step="0.01"
              min={0}
              max={100}
              value={f.share_rate}
              onChange={(e) => set({ share_rate: e.target.value })}
              className={inCls}
            />
            <p className="mt-1 text-[11px] text-ink-hint">
              등록 인원 × 수강료 × 비율. 근무일지 확정과 무관하게 산출됩니다.
            </p>
          </FieldP>
        ) : (
          <FieldP label="시급">
            <input type="number" value={f.hourly_rate} onChange={(e) => set({ hourly_rate: e.target.value })} className={inCls} />
          </FieldP>
        )}
        <FieldP label="공제율(%)">
          <input
            type="number"
            step="0.1"
            value={f.deduction_rate}
            onChange={(e) => set({ deduction_rate: e.target.value })}
            className={inCls}
          />
          <p className="mt-1 text-[11px] text-ink-hint">
            원천징수. 사업소득 3.3%가 기본.
          </p>
        </FieldP>
      </div>

      {/* 실제 스케줄 — 이 값으로 회차(근무일지·계획서 칸)가 만들어진다. */}
      <div className="mt-4 rounded-lg border border-line p-3">
        <p className="text-[11px] font-semibold text-navy">스케줄 (회차 생성)</p>
        <p className="mt-0.5 text-[11px] text-ink-hint">
          차시 기본값이 채워져 있습니다. 이 프로그램만 다르면 여기서 바꾸세요.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-[11px] font-semibold text-navy">
              시작일(1회차)
            </label>
            <input
              type="date"
              value={sc.start}
              onChange={(e) => setScf({ start: e.target.value })}
              className={`${inCls} mt-1`}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-navy">요일</label>
            <div className="mt-1">
              <WeekdaySelect
                value={sc.weekday}
                onChange={(v) => setScf({ weekday: v })}
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-navy">회차 수</label>
            <input
              type="number"
              min={1}
              value={sc.weeks}
              onChange={(e) => setScf({ weeks: e.target.value })}
              className={`${inCls} mt-1`}
            />
          </div>
        </div>
        <label className="mt-3 block text-[11px] font-semibold text-navy">휴강일</label>
        <div className="mt-1">
          <HolidayPicker
            value={sc.holidays}
            onChange={(v) => setScf({ holidays: v })}
          />
        </div>
        <SessionPreview
          start={sc.start}
          weekday={sc.weekday}
          weeks={sc.weeks}
          holidays={sc.holidays}
        />
        {program && (
          <p className={`mt-2 ${noticeWarning}`}>
            {program.lockedCount > 0
              ? `스케줄을 바꾸면 제출·확정된 회차 ${program.lockedCount}건은 그대로 보존하고, 나머지 회차만 새 스케줄로 다시 만듭니다. 회차 번호는 날짜순으로 재정렬됩니다.`
              : `스케줄을 바꾸면 기존 회차 ${program.sessionCount}건을 모두 지우고 새로 만듭니다. (제출·확정된 회차가 없어 안전합니다)`}
          </p>
        )}
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

// 회차 0건 프로그램 구제 — 스케줄만 받아 회차를 생성한다.
function SessionsModal({
  program,
  term,
  onClose,
  onDone,
}: {
  program: ProgramRow;
  term: SaemTerm | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [sc, setSc] = useState<ScheduleForm>(() => initialSchedule(program, term));
  const setScf = (p: Partial<ScheduleForm>) => setSc((prev) => ({ ...prev, ...p }));
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <ModalShell title={`회차 생성 — ${program.name}`} onClose={onClose}>
      <p className="text-xs text-ink-hint">
        이 프로그램에 회차가 {program.sessionCount}건입니다. 스케줄을 지정하면 회차를
        만들고, 강사의 계획서·근무일지 칸이 생깁니다.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-[11px] font-semibold text-navy">
            시작일(1회차) *
          </label>
          <input
            type="date"
            value={sc.start}
            onChange={(e) => setScf({ start: e.target.value })}
            className={`${inCls} mt-1`}
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-navy">요일</label>
          <div className="mt-1">
            <WeekdaySelect value={sc.weekday} onChange={(v) => setScf({ weekday: v })} />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-navy">회차 수 *</label>
          <input
            type="number"
            min={1}
            value={sc.weeks}
            onChange={(e) => setScf({ weeks: e.target.value })}
            className={`${inCls} mt-1`}
          />
        </div>
      </div>
      <label className="mt-3 block text-[11px] font-semibold text-navy">휴강일</label>
      <div className="mt-1">
        <HolidayPicker value={sc.holidays} onChange={(v) => setScf({ holidays: v })} />
      </div>
      <SessionPreview
        start={sc.start}
        weekday={sc.weekday}
        weeks={sc.weeks}
        holidays={sc.holidays}
      />
      {program.lockedCount > 0 && (
        <p className={`mt-2 ${noticeWarning}`}>
          제출·확정된 회차 {program.lockedCount}건은 보존됩니다.
        </p>
      )}
      {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={pending}
          className={btnPrimary}
          onClick={() =>
            start(async () => {
              setErr(null);
              const res = await generateProgramSessions(program.id, {
                start: sc.start,
                weekday: Number(sc.weekday),
                weeks: Number(sc.weeks),
                holidays: sc.holidays,
              });
              if (!res.ok) return setErr(res.message);
              onDone(`회차 ${res.sync.created}건을 생성했습니다.`);
            })
          }
        >
          {pending ? "생성 중…" : "회차 생성"}
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
