"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  badgeNeutral,
  badgeSuccess,
  noticeError,
  noticeSuccess,
  splitRecruitmentFields,
  fieldBadgeCls,
} from "@/lib/ui";
import {
  listInterviewCandidates,
  saveInterviewScore,
  type InterviewCandidate,
  type InterviewPosting,
} from "./actions";

// 태블릿 친화 — 큰 글씨, 큰 버튼, 터치 친화.
const tabletInputCls =
  "block w-full rounded-lg border border-line bg-card px-3 py-2.5 text-base text-ink-body shadow-sm placeholder:text-ink-hint focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30";
const tabletLabelCls = "block text-sm font-bold text-brand-blue";
const tabletBtnPrimary =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-blue px-6 text-base font-bold text-white shadow-md transition hover:bg-brand-blue-strong disabled:opacity-60";
const tabletBtnSecondary =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-line bg-card px-5 text-base font-semibold text-ink-body shadow-sm transition hover:bg-surface disabled:opacity-60";

// 점수 선택지 정의 — 카드형 라디오 버튼 렌더링에 사용.
type Choice = { value: number; label: string };
const Q1_CHOICES: Choice[] = [
  { value: 20, label: "매우적합" },
  { value: 15, label: "적합" },
  { value: 10, label: "양호" },
  { value: 5, label: "보통" },
];
const Q_15_CHOICES: Choice[] = [
  { value: 15, label: "매우적합" },
  { value: 12, label: "적합" },
  { value: 9, label: "양호" },
  { value: 6, label: "보통" },
];

type Step = "intro" | "list" | "score";

export default function InterviewFlow({
  posting,
}: {
  posting: InterviewPosting;
}) {
  // 단계 — intro(서명) → list(후보 선택) → score(채점)
  const [step, setStep] = useState<Step>("intro");

  const [reviewerName, setReviewerName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<InterviewCandidate[]>([]);
  const [selected, setSelected] = useState<InterviewCandidate | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingList, loadListTransition] = useTransition();

  // 채점 시작 → 후보 목록 페치.
  function startScoring() {
    setLoadError(null);
    loadListTransition(async () => {
      try {
        const list = await listInterviewCandidates(
          posting.slug,
          reviewerName.trim()
        );
        setCandidates(list);
        setStep("list");
      } catch (e) {
        setLoadError(
          e instanceof Error
            ? `목록을 불러오지 못했습니다: ${e.message}`
            : "목록을 불러오지 못했습니다."
        );
      }
    });
  }

  function pickCandidate(c: InterviewCandidate) {
    setSelected(c);
    setStep("score");
  }

  // 채점 저장 후 목록으로 돌아옴 + 본인이 채점한 표시.
  async function refreshCandidates() {
    try {
      const list = await listInterviewCandidates(
        posting.slug,
        reviewerName.trim()
      );
      setCandidates(list);
    } catch {
      // refresh 실패는 무시 (조용히)
    }
  }

  const allScored =
    candidates.length > 0 && candidates.every((c) => c.scored);

  return (
    <div className="space-y-5">
      {step === "intro" && (
        <IntroStep
          posting={posting}
          name={reviewerName}
          onNameChange={setReviewerName}
          signature={signature}
          onSignatureChange={setSignature}
          onStart={startScoring}
          loadError={loadError}
          loading={loadingList}
        />
      )}

      {step === "list" && (
        <ListStep
          posting={posting}
          reviewerName={reviewerName}
          candidates={candidates}
          allScored={allScored}
          onPick={pickCandidate}
        />
      )}

      {step === "score" && selected && signature && (
        <ScoreStep
          posting={posting}
          reviewerName={reviewerName}
          signature={signature}
          candidate={selected}
          onBack={() => {
            setSelected(null);
            setStep("list");
          }}
          onSaved={async () => {
            await refreshCandidates();
            setSelected(null);
            setStep("list");
          }}
        />
      )}
    </div>
  );
}

// =====================================================================
// Step 1: 인트로 — 이름 + 서명 + 시작
// =====================================================================
function IntroStep({
  posting,
  name,
  onNameChange,
  signature,
  onSignatureChange,
  onStart,
  loadError,
  loading,
}: {
  posting: InterviewPosting;
  name: string;
  onNameChange: (v: string) => void;
  signature: string | null;
  onSignatureChange: (v: string | null) => void;
  onStart: () => void;
  loadError: string | null;
  loading: boolean;
}) {
  const [localError, setLocalError] = useState<string | null>(null);

  function handleStart() {
    setLocalError(null);
    if (!name.trim()) {
      setLocalError("심사위원 이름을 입력해주세요.");
      return;
    }
    if (!signature || !signature.startsWith("data:image/")) {
      setLocalError("서명을 입력해주세요.");
      return;
    }
    onStart();
  }

  return (
    <section className="rounded-2xl border-2 border-brand-blue bg-hr-bg p-5 shadow-sm sm:p-6 md:p-8">
      <p className="text-sm font-bold tracking-[0.2em] text-brand-blue md:text-base">
        면접 채점
      </p>
      <h2 className="mt-1 text-lg font-bold text-ink md:text-xl">
        {posting.title}
      </h2>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-ink-muted md:text-base">
        <span className="text-sm md:text-base">채점 분야:</span>
        {splitRecruitmentFields(posting.field).map((f, i) => (
          <span key={`${f}-${i}`} className={fieldBadgeCls(i)}>
            {f}
          </span>
        ))}
      </div>

      <div className="mt-6 space-y-5">
        <div>
          <label className={tabletLabelCls}>심사위원 이름 *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="홍길동"
            className={`${tabletInputCls} mt-1.5`}
          />
        </div>

        <div>
          <label className={tabletLabelCls}>전자 서명 *</label>
          <p className="mt-1 text-xs text-ink-muted md:text-sm">
            손가락이나 마우스로 아래 영역에 서명해주세요.
          </p>
          <SignaturePad
            value={signature}
            onChange={onSignatureChange}
          />
        </div>

        <div className="rounded-xl border-2 border-brand-blue/40 bg-brand-blue-soft px-4 py-3 text-sm leading-relaxed text-brand-blue-strong md:text-base">
          본인은 심사를 함에 있어 사실에 근거하여 객관적이고 공정하게
          심사하겠습니다.
        </div>

        {(localError || loadError) && (
          <p className={noticeError}>{localError ?? loadError}</p>
        )}

        <button
          type="button"
          onClick={handleStart}
          disabled={loading}
          className={`${tabletBtnPrimary} w-full md:w-auto md:px-10`}
        >
          {loading ? "불러오는 중…" : "채점 시작"}
        </button>
      </div>
    </section>
  );
}

// =====================================================================
// 서명 캔버스 — Pointer Events 로 마우스·터치 통합.
// =====================================================================
function SignaturePad({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [dirty, setDirty] = useState(false);

  // 캔버스 크기 — 컨테이너 너비에 맞춰 1회 설정.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = 200;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 2.2;
    }
  }, []);

  function pointerPos(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: ReactPointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!dirty) setDirty(true);
  }

  function end(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      // 펜이 떨어진 시점에 base64 PNG 추출.
      onChange(canvas.toDataURL("image/png"));
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2.2;
    setDirty(false);
    onChange(null);
  }

  return (
    <div className="mt-1.5">
      <div className="rounded-xl border-2 border-line bg-white">
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          className="block w-full touch-none rounded-xl"
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <p className="text-xs text-ink-hint md:text-sm">
          {value ? "✓ 서명 완료" : "서명이 필요합니다"}
        </p>
        <button
          type="button"
          onClick={clear}
          className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface md:text-sm"
        >
          서명 지우기
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// Step 2: 후보 목록
// =====================================================================
function ListStep({
  posting,
  reviewerName,
  candidates,
  allScored,
  onPick,
}: {
  posting: InterviewPosting;
  reviewerName: string;
  candidates: InterviewCandidate[];
  allScored: boolean;
  onPick: (c: InterviewCandidate) => void;
}) {
  return (
    <section className="rounded-2xl border-2 border-brand-blue bg-hr-bg p-5 shadow-sm sm:p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-bold tracking-[0.2em] text-brand-blue md:text-base">
            면접 채점
          </p>
          <h2 className="mt-1 text-lg font-bold text-ink md:text-xl">
            {posting.title}
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted md:text-base">
            심사위원: <span className="font-semibold">{reviewerName}</span>
          </p>
        </div>
        {allScored && (
          <span className={`${badgeSuccess} text-sm`}>
            ✓ 전체 채점 완료
          </span>
        )}
      </div>

      {candidates.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-line bg-card p-6 text-center text-sm text-ink-muted md:text-base">
          면접 대상자가 없습니다. 서류 합격자가 지정되면 여기에 표시됩니다.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {candidates.map((c, idx) => (
            <li key={c.application_id}>
              <button
                type="button"
                onClick={() => onPick(c)}
                className={`flex w-full items-center justify-between rounded-xl border-2 px-4 py-4 text-left shadow-sm transition active:scale-[0.98] md:px-5 md:py-5 ${
                  c.scored
                    ? "border-success bg-success-soft hover:border-success"
                    : "border-line bg-card hover:border-brand-blue hover:bg-brand-blue-soft"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink-muted md:text-sm">
                    #{idx + 1}
                  </p>
                  <p className="mt-0.5 text-lg font-bold text-ink md:text-xl">
                    {c.name}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-ink-muted md:text-sm">
                    {c.applicant_number}
                  </p>
                </div>
                <span
                  className={
                    c.scored
                      ? `${badgeSuccess} text-xs md:text-sm`
                      : `${badgeNeutral} text-xs md:text-sm`
                  }
                >
                  {c.scored ? "채점 완료" : "미채점"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// =====================================================================
// Step 3: 채점 화면
// =====================================================================
function ScoreStep({
  posting,
  reviewerName,
  signature,
  candidate,
  onBack,
  onSaved,
}: {
  posting: InterviewPosting;
  reviewerName: string;
  signature: string;
  candidate: InterviewCandidate;
  onBack: () => void;
  onSaved: () => Promise<void>;
}) {
  const [q1, setQ1] = useState<number | null>(null);
  const [q2, setQ2] = useState<number | null>(null);
  const [q3, setQ3] = useState<number | null>(null);
  const [q4, setQ4] = useState<number | null>(null);
  const [isAbsent, setIsAbsent] = useState(false);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = isAbsent ? 0 : (q1 ?? 0) + (q2 ?? 0) + (q3 ?? 0) + (q4 ?? 0);
  const allChosen =
    isAbsent || (q1 != null && q2 != null && q3 != null && q4 != null);

  function handleSave() {
    setError(null);
    setOk(null);
    if (!allChosen) {
      setError("모든 항목을 선택하거나 ‘불참’ 처리해주세요.");
      return;
    }
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("slug", posting.slug);
        fd.set("application_id", candidate.application_id);
        fd.set("reviewer_name", reviewerName);
        fd.set("signature", signature);
        fd.set("is_absent", isAbsent ? "true" : "false");
        if (!isAbsent) {
          fd.set("q1", String(q1 ?? 0));
          fd.set("q2", String(q2 ?? 0));
          fd.set("q3", String(q3 ?? 0));
          fd.set("q4", String(q4 ?? 0));
        }
        fd.set("memo", memo);
        const res = await saveInterviewScore(fd);
        if (!res.ok) {
          setError(res.message);
          return;
        }
        setOk("저장되었습니다.");
        // 잠시 메시지 보여주고 목록으로.
        setTimeout(async () => {
          await onSaved();
        }, 500);
      } catch (e) {
        setError(
          e instanceof Error
            ? `저장 실패: ${e.message}`
            : "저장 중 알 수 없는 오류가 발생했습니다."
        );
      }
    });
  }

  return (
    <section className="rounded-2xl border-2 border-brand-blue bg-hr-bg p-5 shadow-sm sm:p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b-2 border-brand-blue/30 pb-4">
        <div>
          <p className="text-sm font-bold tracking-[0.2em] text-brand-blue md:text-base">
            면접 채점
          </p>
          <h2 className="mt-1 text-2xl font-bold text-ink md:text-3xl">
            {candidate.name}
          </h2>
          <p className="mt-0.5 font-mono text-xs text-ink-muted md:text-sm">
            {candidate.applicant_number}
          </p>
        </div>
        <button type="button" onClick={onBack} className={tabletBtnSecondary}>
          ← 목록으로
        </button>
      </div>

      <div className="mt-5">
        <label className="flex items-center gap-3 rounded-xl border-2 border-line bg-card px-4 py-3">
          <input
            type="checkbox"
            checked={isAbsent}
            onChange={(e) => setIsAbsent(e.target.checked)}
            className="h-5 w-5 rounded border-line text-stamp focus:ring-stamp"
          />
          <span className="text-base font-bold text-ink md:text-lg">
            불참 처리 (전체 0점)
          </span>
        </label>
      </div>

      {!isAbsent && (
        <div className="mt-5 space-y-5">
          <ScoreItem
            title="① 청소년활동 운영의 이해도 및 업무수행 능력"
            sub="업무관련 지식 · 의사소통 능력 · 관계형성 능력 · 운영계획"
            maxLabel="배점 20"
            choices={Q1_CHOICES}
            value={q1}
            onChange={setQ1}
          />
          <ScoreItem
            title="② 교육자적 자질과 인생·직업·사회관"
            sub="교육자적 소양 · 용모·표정·인상 · 사고방식·성품"
            maxLabel="배점 15"
            choices={Q_15_CHOICES}
            value={q2}
            onChange={setQ2}
          />
          <ScoreItem
            title="③ 성실성"
            sub="근로의식 · 책임의식 · 성취욕구"
            maxLabel="배점 15"
            choices={Q_15_CHOICES}
            value={q3}
            onChange={setQ3}
          />
          <ScoreItem
            title="④ 업무에 대한 적극성"
            sub="입사 후 목표 · 달성의지 · 고난극복 경험"
            maxLabel="배점 15"
            choices={Q_15_CHOICES}
            value={q4}
            onChange={setQ4}
          />
        </div>
      )}

      <div className="mt-6 flex items-center justify-between rounded-xl bg-brand-blue-soft px-5 py-4">
        <span className="text-base font-bold text-brand-blue md:text-lg">
          합계
        </span>
        <span className="text-2xl font-bold text-brand-blue md:text-3xl">
          {total} <span className="text-base">/ 65</span>
        </span>
      </div>

      <div className="mt-5">
        <label className={tabletLabelCls}>메모 (선택)</label>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={3}
          placeholder="채점 메모 (선택)"
          className={`${tabletInputCls} mt-1.5 resize-y`}
        />
      </div>

      {error && <p className={`mt-4 ${noticeError}`}>{error}</p>}
      {ok && <p className={`mt-4 ${noticeSuccess}`}>{ok}</p>}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onBack} className={tabletBtnSecondary}>
          취소
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !allChosen}
          className={`${tabletBtnPrimary} sm:px-10`}
        >
          {pending ? "저장 중…" : "채점 완료 및 저장"}
        </button>
      </div>
    </section>
  );
}

// =====================================================================
// 채점 항목 — 카드형 라디오
// =====================================================================
function ScoreItem({
  title,
  sub,
  maxLabel,
  choices,
  value,
  onChange,
}: {
  title: string;
  sub: string;
  maxLabel: string;
  choices: Choice[];
  value: number | null;
  onChange: (n: number) => void;
}) {
  return (
    <div className="rounded-xl border-2 border-line bg-card p-4 md:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-bold text-ink md:text-lg">{title}</p>
          <p className="mt-1 text-xs text-ink-muted md:text-sm">{sub}</p>
        </div>
        <span className="shrink-0 rounded-full bg-brand-blue-soft px-2.5 py-0.5 text-xs font-semibold text-brand-blue md:text-sm">
          {maxLabel}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {choices.map((c) => {
          const active = value === c.value;
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => onChange(c.value)}
              className={`rounded-xl border-2 px-3 py-3 text-center font-bold shadow-sm transition active:scale-[0.97] md:py-4 ${
                active
                  ? "border-brand-blue bg-brand-blue text-white shadow-md"
                  : "border-line bg-card text-ink-body hover:border-brand-blue hover:bg-brand-blue-soft"
              }`}
            >
              <span className="block text-lg md:text-xl">{c.value}</span>
              <span className="mt-0.5 block text-xs font-semibold md:text-sm">
                {c.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
