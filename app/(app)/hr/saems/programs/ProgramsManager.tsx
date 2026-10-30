"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type { BulkDoc } from "@/lib/bulkProgramPdf";
import {
  isYmd,
  kstMonthPeriod,
  periodQuery,
  type WorkLogPeriod,
} from "@/lib/workLogPeriod";
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
} from "@/app/(app)/hr/saems/programActions";
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
  scheduleSummary,
  weekdaysLabel,
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
  start: string; // 1회차 기준일
  weekdays: number[]; // 2026-10 — 여러 요일(주 2회 등). 0 일 ~ 6 토
  weeks: string; // 회차 수
  holidays: string[];
};

// 수업 요일 — 여러 개 고를 수 있는 토글 7개(프로그램 스케줄용).
//   최소 하나는 남깁니다(전부 끄면 회차를 만들 수 없음).
function WeekdayToggles({
  value,
  onChange,
}: {
  value: number[];
  onChange: (v: number[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="수업 요일">
      {WEEKDAY_LABELS.map((label, i) => {
        const on = value.includes(i);
        return (
          <button
            key={i}
            type="button"
            aria-pressed={on}
            onClick={() => {
              if (on && value.length === 1) return;
              onChange(on ? value.filter((d) => d !== i) : [...value, i].sort((a, b) => a - b));
            }}
            className={`h-8 w-8 rounded-md border text-xs font-semibold transition ${
              on
                ? "border-navy bg-navy text-white"
                : "border-line bg-card text-ink-muted hover:bg-surface"
            } ${i === 0 ? "text-stamp" : ""}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

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
  weekdays,
  weeks,
  holidays,
}: {
  start: string;
  weekdays: number[];
  weeks: string;
  holidays: string[];
}) {
  const n = Number(weeks);
  const dates =
    start && Number.isFinite(n) && n > 0
      ? buildSessionDates({
          start,
          weekdays,
          weeks: n,
          holidays,
        })
      : [];
  return (
    <div className="mt-2 rounded-md border border-line bg-surface p-2.5" data-testid="session-preview">
      <p className="text-[11px] font-semibold text-navy">
        생성될 회차 {dates.length > 0 ? `${dates.length}건` : ""}
        {weekdays.length > 0 && (
          <span className="ml-1 font-normal text-ink-muted">
            — {scheduleSummary(weekdays, null)}
            {dates.length > 0 && ` · ${dates[0]} ~ ${dates[dates.length - 1]}`}
          </span>
        )}
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
              <span className="text-ink-hint">({WEEKDAY_LABELS[weekdayOf(d) ?? 0]})</span>
            </li>
          ))}
        </ol>
      )}
      {holidays.length > 0 && (
        <p className="mt-1.5 text-[11px] text-ink-hint">
          휴강일 {holidays.length}건은 건너뛰고 다음 수업일로 밀려 회차 수를 채웁니다.
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
  const [periodOpen, setPeriodOpen] = useState(false);

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
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  setOpen(false);
                  setPeriodOpen(true);
                }}
                data-testid="worklog-open"
              >
                강사 근무일지
                <span className={sub}>강사 서명 자동 · 기간 선택</span>
              </button>
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
      {periodOpen &&
        createPortal(
          <WorkLogPeriodModal programId={programId} onClose={() => setPeriodOpen(false)} />,
          document.body
        )}
    </>
  );
}

// =====================================================================
// 근무일지 기간 선택 — 시작일~종료일(양 끝 포함) + [이번 달][지난달][전체].
//   빈칸 둘 = 전체(지금과 같은 결과). 출석부에는 쓰지 않는다. 규칙은 lib/workLogPeriod.
// =====================================================================
type PeriodInput = { from: string; to: string };
const PERIOD_ALL: PeriodInput = { from: "", to: "" };

function checkPeriod(v: PeriodInput): { period: WorkLogPeriod; error: string | null } {
  if (!v.from && !v.to) return { period: null, error: null };
  if (!v.from || !v.to) return { period: null, error: "시작일과 종료일을 모두 고르세요." };
  if (!isYmd(v.from) || !isYmd(v.to)) return { period: null, error: "날짜 형식이 올바르지 않습니다." };
  if (v.from > v.to) return { period: null, error: "시작일이 종료일보다 늦습니다." };
  return { period: { from: v.from, to: v.to }, error: null };
}

function PeriodPicker({
  value,
  onChange,
  disabled,
}: {
  value: PeriodInput;
  onChange: (v: PeriodInput) => void;
  disabled?: boolean;
}) {
  const quick: { key: string; label: string; v: PeriodInput }[] = [
    { key: "this", label: "이번 달", v: kstMonthPeriod(0) },
    { key: "last", label: "지난달", v: kstMonthPeriod(-1) },
    { key: "all", label: "전체", v: PERIOD_ALL },
  ];
  const { error } = checkPeriod(value);
  const qBtn = "min-h-[44px] rounded-md border px-2 text-sm";
  // 폰 폭에서는 globals.css 가 입력칸 min-height 를 40px 로 덮으므로 44px 는 style 로 준다.
  const dateCls = `${inCls} min-w-0`;
  const dateStyle = { minHeight: 44 };
  return (
    <fieldset disabled={disabled} className="space-y-1.5" data-testid="period-picker">
      <legend className="mb-1 text-[11px] font-semibold text-navy">근무일지 기간</legend>
      <div className="grid grid-cols-3 gap-2">
        {quick.map((q) => {
          const on = q.v.from === value.from && q.v.to === value.to;
          return (
            <button
              key={q.key}
              type="button"
              onClick={() => onChange(q.v)}
              className={`${qBtn} ${on ? "border-navy bg-surface font-semibold text-navy" : "border-line text-ink-body"}`}
              aria-pressed={on}
              data-testid={`period-${q.key}`}
            >
              {q.label}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
        <input
          type="date"
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          className={dateCls}
          style={dateStyle}
          aria-label="시작일"
          data-testid="period-from"
        />
        <span className="text-sm text-ink-hint">~</span>
        <input
          type="date"
          value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          className={dateCls}
          style={dateStyle}
          aria-label="종료일"
          data-testid="period-to"
        />
      </div>
      {error ? (
        <p className="text-[11px] text-stamp" role="alert" data-testid="period-error">
          {error}
        </p>
      ) : (
        <p className="text-[11px] text-ink-hint">
          {value.from
            ? "회차 날짜가 이 기간(양 끝 포함)에 든 회차만 넣습니다. 회차 번호는 그대로입니다."
            : "전체 — 회차 전부가 들어갑니다."}
        </p>
      )}
    </fieldset>
  );
}

// 개별 "출력 ▼ → 강사 근무일지" — 기간을 고르는 작은 창. 기본이 [전체]라 바로 누르면 예전과 같다.
function WorkLogPeriodModal({ programId, onClose }: { programId: string; onClose: () => void }) {
  const [value, setValue] = useState<PeriodInput>(PERIOD_ALL);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { period, error } = checkPeriod(value);

  async function download() {
    setErr(null);
    setBusy(true);
    try {
      const q = periodQuery(period);
      const r = await fetch(`/hr/saems/programs/${programId}/worklog${q ? `?${q}` : ""}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error((await r.text().catch(() => "")).slice(0, 120) || `서버 오류 ${r.status}`);
      const cd = r.headers.get("Content-Disposition") ?? "";
      const m = cd.match(/filename\*=UTF-8''([^;]+)/);
      const filename = m ? decodeURIComponent(m[1]) : "강사근무일지.pdf";
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="강사 근무일지 출력" onClose={busy ? () => {} : onClose}>
      <div className="space-y-3" data-testid="worklog-period-modal">
        <PeriodPicker value={value} onChange={setValue} disabled={busy} />
        {err && <p className={noticeError}>{err}</p>}
        <button
          type="button"
          onClick={download}
          disabled={busy || !!error}
          className={`${btnPrimary} min-h-[44px] w-full sm:min-h-[44px]`}
          data-testid="worklog-download"
        >
          {busy ? "만드는 중…" : period ? "기간 근무일지 PDF 저장" : "전체 근무일지 PDF 저장"}
        </button>
      </div>
    </ModalShell>
  );
}

// =====================================================================
// 선택 출력 — 체크한 프로그램을 PDF 한 파일로(표 순서, 프로그램마다 새 쪽).
//   문서 종류는 개별 "출력 ▼" 메뉴와 같은 3종. 근무일지만 기간을 고를 수 있다(기본 전체).
//   기간 안 회차가 0 인 프로그램은 건너뛴다. 만드는 건 브라우저 — lib/bulkProgramPdf 주석 참고.
//   만든 결과는 문서 종류·기간별로 기억해 두고, 미리보기 ↔ 저장을 오가도 다시 만들지 않는다.
// =====================================================================
// 타입만 가져온다 — pdf-lib 는 버튼을 누를 때 동적 import(첫 화면 번들에 안 싣는다).
type BulkDocKey = BulkDoc;
const BULK_DOCS: { key: BulkDocKey; label: string; sub: string }[] = [
  { key: "worklog", label: "강사 근무일지", sub: "강사 서명 자동 · 프로그램당 A4 1장" },
  { key: "attendance", label: "출석부 · 출결 포함", sub: "체크된 출결이 채워진 출석부" },
  { key: "attendance-blank", label: "출석부 · 빈 양식", sub: "출결 칸이 빈 — 손으로 체크" },
];

function BulkPrintModal({
  items,
  termName,
  projectName,
  onClose,
}: {
  items: { id: string; name: string }[];
  termName: string;
  projectName: string;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<BulkDocKey>("worklog");
  const [periodIn, setPeriodIn] = useState<PeriodInput>(PERIOD_ALL);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [made, setMade] = useState<
    Record<
      string,
      {
        url: string;
        filename: string;
        ok: number;
        failed: { name: string; reason: string }[];
        skipped: string[];
      }
    >
  >({});
  // 기간은 근무일지에만 — 출석부는 늘 전체.
  const { period: pickedPeriod, error: periodError } =
    doc === "worklog" ? checkPeriod(periodIn) : { period: null, error: null };
  const madeKey = `${doc}|${periodQuery(pickedPeriod)}`;
  const cur = made[madeKey];

  async function ensure() {
    if (made[madeKey]) return made[madeKey];
    const lib = await import("@/lib/bulkProgramPdf");
    const r = await lib.buildBulkProgramPdf(
      items,
      doc,
      (done, total) => setProgress({ done, total }),
      pickedPeriod
    );
    if (!r.bytes) {
      const parts: string[] = [];
      if (r.failed.length)
        parts.push(`실패: ${r.failed.map((f) => `${f.name}(${f.reason})`).join(", ")}`);
      if (r.skipped.length)
        parts.push(`기간 안에 회차가 없어 건너뜀: ${r.skipped.join(", ")}`);
      throw new Error(
        r.failed.length
          ? `만들 수 있는 문서가 없었습니다. ${parts.join(" / ")}`
          : `선택한 기간에 회차가 있는 프로그램이 없어 PDF를 만들지 않았습니다. ${parts.join(" / ")}`
      );
    }
    const url = URL.createObjectURL(
      new Blob([r.bytes as BlobPart], { type: "application/pdf" })
    );
    const out = {
      url,
      filename: lib.bulkPdfFilename(doc, termName, projectName, r.ok, pickedPeriod),
      ok: r.ok,
      failed: r.failed,
      skipped: r.skipped,
    };
    setMade((m) => ({ ...m, [madeKey]: out }));
    return out;
  }

  async function run(action: "preview" | "save") {
    setErr(null);
    setBlockedUrl(null);
    // 미리보기 창은 클릭 순간에 열어 둬야 팝업 차단에 안 걸린다 — 만든 뒤 주소만 바꾼다.
    let win: Window | null = null;
    if (action === "preview" && !made[madeKey]) {
      win = window.open("", "_blank");
      win?.document.write(
        '<p style="font-family:sans-serif;padding:16px">PDF를 만드는 중입니다…</p>'
      );
    }
    setBusy(true);
    try {
      const r = await ensure();
      if (action === "preview") {
        if (win) win.location.href = r.url;
        else if (!window.open(r.url, "_blank")) setBlockedUrl(r.url);
      } else {
        const a = document.createElement("a");
        a.href = r.url;
        a.download = r.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (e) {
      win?.close();
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const choice =
    "flex min-h-[44px] cursor-pointer items-start gap-2 rounded-md border px-3 py-2";

  return (
    <ModalShell title={`선택 출력 — ${items.length}건`} onClose={busy ? () => {} : onClose}>
      <div className="space-y-3" data-testid="bulk-print-modal">
        <fieldset disabled={busy} className="space-y-1.5">
          <legend className="mb-1 text-[11px] font-semibold text-navy">문서 종류</legend>
          {BULK_DOCS.map((d) => (
            <label
              key={d.key}
              className={`${choice} ${doc === d.key ? "border-navy bg-surface" : "border-line"}`}
            >
              <input
                type="radio"
                name="bulk-doc"
                className="mt-0.5 h-5 w-5 shrink-0 accent-navy"
                checked={doc === d.key}
                onChange={() => setDoc(d.key)}
              />
              <span className="text-sm text-ink-body">
                {d.label}
                <span className="block text-[11px] text-ink-hint">{d.sub}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {doc === "worklog" && (
          <PeriodPicker value={periodIn} onChange={setPeriodIn} disabled={busy} />
        )}
        <p className="text-[11px] text-ink-hint">
          표 순서대로 한 파일에 묶고, 프로그램마다 새 쪽에서 시작합니다. 각 문서는 개별
          출력과 같은 양식입니다.
        </p>

        {busy && progress && (
          <div aria-live="polite">
            <p className="text-sm text-ink-body">
              {progress.total}건 중 {Math.min(progress.done + 1, progress.total)}건 만드는 중…
            </p>
            <div className="mt-1 h-2 overflow-hidden rounded bg-surface">
              <div
                className="h-full bg-navy transition-all"
                style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
          </div>
        )}
        {busy && !progress && <p className="text-sm text-ink-body">준비 중…</p>}

        {cur && !busy && (
          <p
            className={cur.failed.length || cur.skipped.length ? noticeWarning : noticeSuccess}
            data-testid="bulk-result"
          >
            {cur.ok}건을 한 파일로 만들었습니다.
            {cur.failed.length > 0 && (
              <>
                {" "}
                실패 {cur.failed.length}건 — 빠진 프로그램:{" "}
                {cur.failed.map((f) => `${f.name}(${f.reason})`).join(", ")}
              </>
            )}
            {cur.skipped.length > 0 && (
              <span className="mt-1 block" data-testid="bulk-skipped">
                기간 안에 회차가 없어 건너뜀 {cur.skipped.length}건: {cur.skipped.join(", ")}
              </span>
            )}
          </p>
        )}
        {blockedUrl && (
          <p className={noticeWarning}>
            팝업이 막혔습니다.{" "}
            <a href={blockedUrl} target="_blank" rel="noreferrer" className="underline">
              여기를 눌러 미리보기
            </a>
          </p>
        )}
        {err && <p className={noticeError}>{err}</p>}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={() => run("preview")}
            disabled={busy || !!periodError}
            className={`${btnSecondary} min-h-[44px] sm:min-h-[44px]`}
            data-testid="bulk-preview"
          >
            미리보기(새 창)
          </button>
          <button
            type="button"
            onClick={() => run("save")}
            disabled={busy || !!periodError}
            className={`${btnPrimary} min-h-[44px] sm:min-h-[44px]`}
            data-testid="bulk-save"
          >
            PDF 저장
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

export default function ProgramsManager({
  projects,
  instructors,
  canManage,
  canBulkPrint,
}: {
  projects: SaemProject[];
  instructors: InstructorOption[];
  // false = 열람만. 편성(추가·수정·삭제·회차생성)과 출력(PDF)을 감추고,
  //   수강료·정산 방식 열도 뺀다 — 강사 보수에 해당하는 값이라 서버에서
  //   이미 비워져 온다(listPrograms 주석 참고).
  canManage: boolean;
  // 선택 출력 시험 개방 — lib/bulkPrintAccess(관장 + BULK_PRINT_EMAILS). false 면 체크 칸·버튼을 안 그린다.
  canBulkPrint: boolean;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [terms, setTerms] = useState<SaemTerm[]>([]);
  const [termId, setTermId] = useState("");
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [, start] = useTransition();
  // 선택 출력 — 체크한 프로그램 id. 차시를 바꾸면 비운다(차시 select onChange).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const term = terms.find((t) => t.id === termId) ?? null;
  // 회차 0건은 개별 출력도 막혀 있다 — 같은 기준으로 체크를 막는다.
  const printable = programs.filter((p) => p.sessionCount > 0);
  // 표에서 사라진(삭제·회차 0 이 된) 프로그램은 선택에서 빠지게, 표 순서대로 센다.
  const pickedRows = printable.filter((p) => picked.has(p.id));
  const allPicked = printable.length > 0 && pickedRows.length === printable.length;

  useEffect(() => {
    if (selectAllRef.current)
      selectAllRef.current.indeterminate = pickedRows.length > 0 && !allPicked;
  }, [pickedRows.length, allPicked]);

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function togglePickAll() {
    setPicked(allPicked ? new Set() : new Set(printable.map((p) => p.id)));
  }

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
            onChange={(e) => {
              setTermId(e.target.value);
              setPicked(new Set()); // 다른 차시의 선택이 남지 않게
            }}
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

          {term && canManage && (
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
            {canManage && (
              <>
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
              </>
            )}
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-ink">
            프로그램 {termId ? `(${programs.length})` : ""}
          </h3>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {canBulkPrint && (
              <button
                type="button"
                onClick={() => setBulkOpen(true)}
                className={`${btnSecondary} min-h-[44px] sm:min-h-[44px]`}
                disabled={pickedRows.length === 0}
                title="체크한 프로그램의 근무일지·출석부를 PDF 한 파일로"
                data-testid="bulk-print-open"
              >
                선택 출력 ({pickedRows.length}건)
              </button>
              )}
              <button
                type="button"
                onClick={() => setModal({ kind: "program", program: null })}
                className={`${btnPrimary} min-h-[44px] sm:min-h-[44px]`}
                disabled={!termId}
              >
                + 프로그램 추가
              </button>
            </div>
          )}
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
                  {canBulkPrint && (
                    <th className="w-11 p-0">
                      <label
                        className={`flex h-11 w-11 items-center justify-center ${
                          printable.length ? "cursor-pointer" : "cursor-not-allowed opacity-40"
                        }`}
                        title="출력할 수 있는 프로그램 전체 선택"
                      >
                        <input
                          ref={selectAllRef}
                          type="checkbox"
                          className="h-5 w-5 accent-navy"
                          checked={allPicked}
                          disabled={printable.length === 0}
                          onChange={togglePickAll}
                          aria-label="전체 선택"
                          data-testid="bulk-pick-all"
                        />
                      </label>
                    </th>
                  )}
                  <th className={thCls}>프로그램</th>
                  <th className={thCls}>강사</th>
                  <th className={thCls}>교시</th>
                  <th className={thCls}>시간</th>
                  <th className={thCls}>장소</th>
                  <th className={thCls}>회차</th>
                  <th className={`${thCls} text-right`}>정원</th>
                  {canManage && (
                    <>
                      <th className={`${thCls} text-right`}>수강료</th>
                      <th className={`${thCls} text-right`}>정산 방식</th>
                      <th className={`${thCls} text-right`}>관리</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {programs.map((p) => (
                  <tr key={p.id} className="border-b border-line/60">
                    {canBulkPrint && (
                      <td className="w-11 p-0">
                        <label
                          className={`flex h-11 w-11 items-center justify-center ${
                            p.sessionCount > 0 ? "cursor-pointer" : "cursor-not-allowed opacity-40"
                          }`}
                          title={p.sessionCount > 0 ? undefined : "회차가 없어 출력할 내용이 없습니다"}
                        >
                          <input
                            type="checkbox"
                            className="h-5 w-5 accent-navy"
                            checked={p.sessionCount > 0 && picked.has(p.id)}
                            disabled={p.sessionCount === 0}
                            onChange={() => togglePick(p.id)}
                            aria-label={`${p.name} 선택`}
                            data-testid="bulk-pick"
                            data-program-id={p.id}
                          />
                        </label>
                      </td>
                    )}
                    <td className={`${tdCls} font-medium text-ink`}>{p.name}</td>
                    <td className={tdCls}>{p.instructorName ?? "-"}</td>
                    <td className={tdCls}>{p.period_no ?? "-"}</td>
                    <td className={`${tdCls} font-mono text-xs`}>
                      {p.time_start ? `${hhmm(p.time_start)}~${hhmm(p.time_end)}` : "-"}
                    </td>
                    <td className={tdCls}>{p.room ?? "-"}</td>
                    <td className={tdCls}>
                      {p.sessionCount === 0 ? (
                        canManage ? (
                        <button
                          type="button"
                          onClick={() => setModal({ kind: "sessions", program: p })}
                          className={`${badgeDanger} hover:underline`}
                          title="회차가 없어 강사 계획서·근무일지가 비어 있습니다"
                        >
                          0회차 — 회차 생성
                        </button>
                        ) : (
                          <span className={badgeDanger}>0회차</span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-xs text-ink-body" title={`매주 ${weekdaysLabel(p.session_weekdays)}`}>
                            {scheduleSummary(p.session_weekdays, p.sessionCount)}
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
                    {canManage && (
                      <>
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
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canBulkPrint && bulkOpen && (
        <BulkPrintModal
          items={pickedRows.map((p) => ({ id: p.id, name: p.name }))}
          termName={term?.name ?? ""}
          projectName={projects.find((p) => p.id === projectId)?.name ?? ""}
          onClose={() => setBulkOpen(false)}
        />
      )}
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
            weekdays={[Number(weekday)]}
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
        weekdays={[Number(weekday)]}
        weeks={weeks}
        holidays={holidays}
      />
      <p className="mt-1 text-[11px] text-ink-hint">
        주 2회 이상 프로그램(예: 월·수)은 자기 요일을 그대로 유지하고, 회차 수는 위 회차 수 × 주당 횟수로 만듭니다.
      </p>
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
    const fromDate = program.firstSessionDate ? weekdayOf(program.firstSessionDate) : null;
    const wds = program.session_weekdays.length
      ? program.session_weekdays
      : [fromDate ?? termWeekday];
    const start =
      program.session_start ?? program.firstSessionDate ?? term?.start_date ?? "";
    const weeks =
      program.session_weeks ??
      (program.sessionCount > 0 ? program.sessionCount : term?.default_weeks ?? 8);
    return {
      start,
      weekdays: wds,
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
    weekdays: [termWeekday],
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
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [acceptDiscard, setAcceptDiscard] = useState(false);
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
      session_weekdays: sc.weekdays,
      session_weeks: sc.weeks === "" ? null : Number(sc.weeks),
      session_holidays: sc.holidays,
      acceptDiscard,
    };
    start(async () => {
      if (program) {
        const res = await updateProgram(program.id, input);
        if (!res.ok) {
          // 지워질 내용이 있으면 확인란을 띄웁니다(체크 후 다시 저장).
          if ("needsConfirm" in res && res.needsConfirm) setNeedsConfirm(true);
          return setErr(res.message);
        }
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
            <label className="block text-[11px] font-semibold text-navy">
              요일 <span className="font-normal text-ink-hint">(여러 개 선택 가능)</span>
            </label>
            <div className="mt-1">
              <WeekdayToggles value={sc.weekdays} onChange={(v) => setScf({ weekdays: v })} />
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
          weekdays={sc.weekdays}
          weeks={sc.weeks}
          holidays={sc.holidays}
        />
        {program && (
          <p className={`mt-2 ${noticeWarning}`}>
            {program.lockedCount > 0
              ? `스케줄을 바꾸면 제출·확정된 회차 ${program.lockedCount}건은 그대로 보존하고, 나머지 회차만 새 스케줄로 다시 만듭니다. 보존되는 회차의 날짜가 새 스케줄에 없으면 저장되지 않습니다.`
              : `스케줄을 바꾸면 기존 회차 ${program.sessionCount}건을 지우고 새로 만듭니다. 강사 계획서 등 지워질 내용이 있으면 저장 전에 한 번 더 확인합니다.`}
          </p>
        )}
      </div>

      {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      {needsConfirm && (
        <label className="mt-2 flex items-center gap-2 text-xs text-stamp">
          <input type="checkbox" checked={acceptDiscard} onChange={(e) => setAcceptDiscard(e.target.checked)} />
          위 내용이 지워지는 것을 확인했습니다
        </label>
      )}
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
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [acceptDiscard, setAcceptDiscard] = useState(false);
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
          <label className="block text-[11px] font-semibold text-navy">
            요일 <span className="font-normal text-ink-hint">(여러 개 선택 가능)</span>
          </label>
          <div className="mt-1">
            <WeekdayToggles value={sc.weekdays} onChange={(v) => setScf({ weekdays: v })} />
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
        weekdays={sc.weekdays}
        weeks={sc.weeks}
        holidays={sc.holidays}
      />
      {program.lockedCount > 0 && (
        <p className={`mt-2 ${noticeWarning}`}>
          제출·확정된 회차 {program.lockedCount}건은 보존됩니다.
        </p>
      )}
      {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      {needsConfirm && (
        <label className="mt-2 flex items-center gap-2 text-xs text-stamp">
          <input type="checkbox" checked={acceptDiscard} onChange={(e) => setAcceptDiscard(e.target.checked)} />
          위 내용이 지워지는 것을 확인했습니다
        </label>
      )}
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
                weekdays: sc.weekdays,
                weeks: Number(sc.weeks),
                holidays: sc.holidays,
                acceptDiscard,
              });
              if (!res.ok) {
                if ("needsConfirm" in res && res.needsConfirm) setNeedsConfirm(true);
                return setErr(res.message);
              }
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
