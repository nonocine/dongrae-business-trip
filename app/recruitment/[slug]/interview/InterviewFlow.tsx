"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
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
  getInterviewApplicantDetail,
  getMyInterviewScore,
  type InterviewCandidate,
  type InterviewPosting,
  type InterviewApplicantDetail,
  type InterviewDoc,
} from "./actions";
import { INTERVIEW_ITEMS } from "@/lib/recruitmentScore";

// 태블릿 친화 — 큰 글씨, 큰 버튼, 터치 친화(나이 있는 심사위원 가독성 우선).
const tabletInputCls =
  "block w-full rounded-lg border border-line bg-card px-3 py-3 text-lg text-ink-body shadow-sm placeholder:text-ink-hint focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30";
const tabletLabelCls = "block text-base font-bold text-brand-blue";
const tabletBtnPrimary =
  "inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-brand-blue px-7 text-lg font-bold text-white shadow-md transition hover:bg-brand-blue-strong disabled:opacity-60";
const tabletBtnSecondary =
  "inline-flex h-14 items-center justify-center gap-2 rounded-xl border-2 border-line bg-card px-6 text-lg font-semibold text-ink-body shadow-sm transition hover:bg-surface disabled:opacity-60";

// 점수 선택지 정의 — 카드형 라디오 버튼 렌더링에 사용.
//   항목 제목·부제·배점·보기는 INTERVIEW_ITEMS(lib) 단일 기준에서 가져옵니다.
type Choice = { value: number; label: string };

// 생년월일 + 만 나이 표시 — "1990-03-15 (만 36세)". 파싱 실패 시 원문만.
//   브라우저 로컬 기준(채점 화면은 클라이언트 컴포넌트)으로 만 나이를 계산.
function fmtBirthWithAge(birth: string | null | undefined): string {
  const raw = (birth ?? "").trim();
  if (!raw) return "-";
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const now = new Date();
  let age = now.getFullYear() - y;
  const beforeBirthday =
    now.getMonth() + 1 < mo ||
    (now.getMonth() + 1 === mo && now.getDate() < d);
  if (beforeBirthday) age -= 1;
  if (!Number.isFinite(age) || age < 0 || age > 120) return raw;
  return `${raw} (만 ${age}세)`;
}

type Step = "intro" | "list" | "score";

export default function InterviewFlow({
  posting,
  internalJudge = null,
}: {
  posting: InterviewPosting;
  // 서버에서 내부위원(로그인 직원)으로 인증된 경우의 신원. null 이면 외부위원 흐름.
  internalJudge?: { name: string } | null;
}) {
  const isInternal = internalJudge != null;

  // 단계 — intro(이름·서명) → list(후보 선택) → score(채점)
  //   내부위원은 인트로를 건너뛰고 list 부터 시작합니다.
  const [step, setStep] = useState<Step>(isInternal ? "list" : "intro");

  const [reviewerName, setReviewerName] = useState(internalJudge?.name ?? "");
  const [signature, setSignature] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<InterviewCandidate[]>([]);
  const [selected, setSelected] = useState<InterviewCandidate | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingList, loadListTransition] = useTransition();
  // 내부위원 자동 로드 중 여부(외부위원은 항상 false — 인트로에서 명시적으로 시작).
  const [internalLoading, setInternalLoading] = useState(isInternal);

  // 내부위원: 마운트 시 후보 목록을 자동으로 불러옵니다(인트로 단계 없음).
  useEffect(() => {
    if (!isInternal) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listInterviewCandidates(
          posting.slug,
          internalJudge?.name ?? ""
        );
        if (!cancelled) setCandidates(list);
      } catch (e) {
        if (!cancelled) {
          setLoadError(
            e instanceof Error
              ? `목록을 불러오지 못했습니다: ${e.message}`
              : "목록을 불러오지 못했습니다."
          );
        }
      } finally {
        if (!cancelled) setInternalLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInternal]);

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

      {step === "list" &&
        (internalLoading ? (
          <section className="rounded-2xl border-2 border-brand-blue bg-hr-bg p-8 text-center shadow-sm">
            <p className="text-sm text-ink-muted md:text-base">
              면접 대상자를 불러오는 중…
            </p>
          </section>
        ) : (
          <ListStep
            posting={posting}
            reviewerName={reviewerName}
            candidates={candidates}
            allScored={allScored}
            onPick={pickCandidate}
          />
        ))}

      {step === "score" && selected && (isInternal || signature) && (
        <ScoreStep
          key={selected.application_id}
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
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={
                      c.scored
                        ? `${badgeSuccess} text-xs md:text-sm`
                        : `${badgeNeutral} text-xs md:text-sm`
                    }
                  >
                    {c.scored
                      ? c.my_absent
                        ? "채점 완료 · 불참"
                        : `채점 완료 · ${c.my_total ?? 0}/65`
                      : "미채점"}
                  </span>
                  {c.scored && (
                    <span className="text-xs font-semibold text-brand-blue">
                      ✏️ 눌러서 수정
                    </span>
                  )}
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
  signature: string | null;
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
  // 모바일 탭 — 좁은 화면에서 지원서/채점 전환 (넓은 화면은 항상 2단).
  const [tab, setTab] = useState<"app" | "score">("app");
  // 본인 기존 채점 로드 — 있으면 폼 초기값 복원("다시 채점"). 로드 전엔 입력 잠금.
  const [loadingScore, setLoadingScore] = useState(true);
  const [isEditing, setIsEditing] = useState(false);

  // candidate.application_id 가 바뀌면 부모가 key 로 리마운트하므로,
  //   이 effect 는 진입한 지원자 1명에 대해 1회만 본인 점수를 불러옵니다.
  useEffect(() => {
    let cancelled = false;
    getMyInterviewScore(candidate.application_id)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.score) {
          setQ1(res.score.q1);
          setQ2(res.score.q2);
          setQ3(res.score.q3);
          setQ4(res.score.q4);
          setIsAbsent(res.score.is_absent);
          setMemo(res.score.memo ?? "");
          setIsEditing(true);
        }
      })
      .catch(() => {
        // 로드 실패는 신규 채점(빈 폼)으로 진행 — 저장 자체는 가능.
      })
      .finally(() => {
        if (!cancelled) setLoadingScore(false);
      });
    return () => {
      cancelled = true;
    };
  }, [candidate.application_id]);

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
        // 서명은 외부위원만 전송(내부위원은 서명 화면을 건너뜀 → 서버에서도 선택).
        if (signature) fd.set("signature", signature);
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
        setOk(isEditing ? "수정되었습니다." : "저장되었습니다.");
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
    <section className="rounded-2xl border-2 border-brand-blue bg-hr-bg p-4 shadow-sm sm:p-6 md:p-8">
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

      {/* 모바일 탭 — 좁은 화면에서 지원서/채점 전환 */}
      <div className="mt-4 grid grid-cols-2 gap-1.5 rounded-xl bg-brand-blue-soft p-1 lg:hidden">
        <button
          type="button"
          onClick={() => setTab("app")}
          className={mobileTabCls(tab === "app")}
        >
          📄 지원서
        </button>
        <button
          type="button"
          onClick={() => setTab("score")}
          className={mobileTabCls(tab === "score")}
        >
          📝 채점
        </button>
      </div>

      <div className="mt-5 lg:grid lg:grid-cols-[3fr_2fr] lg:gap-6 lg:items-start">
        {/* 좌측: 지원서 (페이지와 함께 스크롤) */}
        <div className={`${tab === "app" ? "block" : "hidden"} lg:block`}>
          <ApplicantDetailPanel
            key={candidate.application_id}
            slug={posting.slug}
            applicationId={candidate.application_id}
          />
        </div>

        {/* 우측: 채점 폼 (넓은 화면에서 sticky) */}
        <div className={`${tab === "score" ? "block" : "hidden"} lg:block`}>
          <div className="space-y-5 lg:sticky lg:top-4">
            {loadingScore ? (
              <p className="py-10 text-center text-sm text-ink-muted">
                기존 채점을 불러오는 중…
              </p>
            ) : (
              <>
            {isEditing && (
              <div className="rounded-xl border-2 border-brand-blue/40 bg-brand-blue-soft px-4 py-3 text-sm font-semibold text-brand-blue-strong">
                ✏️ 이미 채점한 지원자입니다. 점수를 고친 뒤 다시 저장하면
                덮어쓰여요.
              </div>
            )}
            <label className="flex items-center gap-3 rounded-xl border-2 border-line bg-card px-4 py-3.5">
              <input
                type="checkbox"
                checked={isAbsent}
                onChange={(e) => setIsAbsent(e.target.checked)}
                className="h-6 w-6 rounded border-line text-stamp focus:ring-stamp"
              />
              <span className="text-lg font-bold text-ink md:text-xl">
                불참 처리 (전체 0점)
              </span>
            </label>

            {!isAbsent && (
              <div className="space-y-5">
                {INTERVIEW_ITEMS.map((it) => {
                  const value =
                    it.key === "q1"
                      ? q1
                      : it.key === "q2"
                        ? q2
                        : it.key === "q3"
                          ? q3
                          : q4;
                  const onChange =
                    it.key === "q1"
                      ? setQ1
                      : it.key === "q2"
                        ? setQ2
                        : it.key === "q3"
                          ? setQ3
                          : setQ4;
                  return (
                    <ScoreItem
                      key={it.key}
                      title={it.title}
                      sub={it.sub}
                      maxLabel={`배점 ${it.max}`}
                      choices={it.options}
                      value={value}
                      onChange={onChange}
                    />
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between rounded-xl bg-brand-blue-soft px-5 py-5">
              <span className="text-lg font-bold text-brand-blue md:text-xl">
                합계
              </span>
              <span className="text-3xl font-bold text-brand-blue md:text-4xl">
                {total} <span className="text-lg">/ 65</span>
              </span>
            </div>

            <div>
              <label className={tabletLabelCls}>메모 (선택)</label>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                rows={3}
                placeholder="채점 메모 (선택)"
                className={`${tabletInputCls} mt-1.5 resize-y`}
              />
            </div>

            {error && <p className={noticeError}>{error}</p>}
            {ok && <p className={noticeSuccess}>{ok}</p>}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onBack}
                className={tabletBtnSecondary}
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={pending || !allChosen}
                className={`${tabletBtnPrimary} sm:px-10`}
              >
                {pending
                  ? "저장 중…"
                  : isEditing
                    ? "수정 저장"
                    : "채점 완료 및 저장"}
              </button>
            </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// 모바일 탭 버튼 스타일
function mobileTabCls(active: boolean): string {
  return `rounded-lg px-3 py-2.5 text-center text-sm font-bold transition ${
    active ? "bg-brand-blue text-white shadow" : "text-brand-blue"
  }`;
}

// =====================================================================
// 좌측: 지원서 상세 패널
//   * requireExternalJudge 인증 후 supabaseAdmin 으로 조회(서버 액션).
//   * 연락처·이메일·주소·생년월일 등 민감정보는 서버에서 제외하고 내려줍니다.
// =====================================================================
function ApplicantDetailPanel({
  slug,
  applicationId,
}: {
  slug: string;
  applicationId: string;
}) {
  const [detail, setDetail] = useState<InterviewApplicantDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 부모가 applicationId 를 key 로 주어 지원자가 바뀌면 이 패널이 리마운트됩니다.
  //   → 초기 state(loading=true, err/detail=null)가 그대로 적용되므로 effect 안에서
  //     동기 setState 로 리셋할 필요가 없습니다(react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    getInterviewApplicantDetail(applicationId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setDetail(res.detail);
        else setErr(res.message);
      })
      .catch(() => {
        if (!cancelled) setErr("지원서를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  if (loading) {
    return (
      <div className="rounded-2xl border-2 border-line bg-card p-4 md:p-5">
        <p className="py-10 text-center text-sm text-ink-muted">
          지원서를 불러오는 중…
        </p>
      </div>
    );
  }

  if (err) {
    const needLogin = err.includes("로그인");
    return (
      <div className="rounded-2xl border-2 border-line bg-card p-6 text-center">
        <p className="text-sm font-semibold text-stamp">{err}</p>
        {needLogin && (
          <a
            href={`/recruitment/${slug}/judge-login`}
            className={`${tabletBtnPrimary} mt-4 w-full sm:w-auto`}
          >
            외부위원 로그인
          </a>
        )}
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4 rounded-2xl border-2 border-line bg-card p-4 md:p-5">
        {/* 증명사진 — 서류 화면과 동일한 signed URL 방식 */}
        <div className="h-28 w-[88px] shrink-0 overflow-hidden rounded-lg border border-line bg-surface md:h-36 md:w-28">
          {detail.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={detail.photo_url}
              alt={`${detail.name} 증명사진`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-4xl text-ink-hint">
              👤
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-2xl font-bold text-ink md:text-3xl">
            {detail.name}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-sm text-ink-muted md:text-base">지원분야</span>
            {splitRecruitmentFields(detail.field).map((f, i) => (
              <span key={`${f}-${i}`} className={fieldBadgeCls(i)}>
                {f}
              </span>
            ))}
          </div>
          <dl className="mt-3 space-y-1.5 text-base md:text-lg">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 font-semibold text-ink-muted">
                생년월일
              </dt>
              <dd className="min-w-0 break-words font-medium text-ink">
                {fmtBirthWithAge(detail.birth_date)}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 font-semibold text-ink-muted">
                주소
              </dt>
              <dd className="min-w-0 break-words font-medium text-ink">
                {detail.address?.trim() || "-"}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <DetailSection title="학력">
        {detail.education.length === 0 ? (
          <p className="text-sm text-ink-hint">학력 정보가 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {detail.education.map((e, i) => (
              <li key={i} className="rounded-lg bg-surface px-3 py-2 text-sm">
                <span className="font-semibold text-ink">{e.school}</span>
                {e.major && <span className="text-ink-body"> · {e.major}</span>}
                {e.degree && (
                  <span className="ml-1 text-xs text-ink-muted">
                    ({e.degree})
                  </span>
                )}
                {(e.enter_date || e.graduate_date) && (
                  <div className="mt-0.5 text-xs text-ink-hint">
                    {e.enter_date} ~ {e.graduate_date}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection title="경력사항">
        {detail.career.length === 0 ? (
          <p className="text-sm text-ink-hint">경력 사항이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {detail.career.map((c, i) => (
              <li key={i} className="rounded-lg bg-surface px-3 py-2 text-sm">
                <span className="font-semibold text-ink">{c.company}</span>
                {c.department && (
                  <span className="text-ink-body"> · {c.department}</span>
                )}
                {(c.start_date || c.end_date || c.current) && (
                  <div className="mt-0.5 text-xs text-ink-hint">
                    {c.start_date} ~ {c.current ? "재직중" : c.end_date}
                  </div>
                )}
                {c.duties && (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-ink-body">
                    {c.duties}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection title="자기소개서">
        <div className="space-y-3">
          <Statement
            label="지원 동기 및 입사 후 포부"
            value={detail.motivation}
          />
          <Statement label="자기개발 계획" value={detail.self_development} />
          <Statement
            label="직무관련 경력 및 활동 결과"
            value={detail.career_summary}
          />
          <Statement
            label="청소년관 · 직업관 · 삶의 철학"
            value={detail.philosophy}
          />
        </div>
      </DetailSection>

      {detail.documents.length > 0 && (
        <DetailSection title="첨부 서류">
          <div className="space-y-4">
            {detail.documents.map((d) => (
              <DocPreview key={d.key} doc={d} />
            ))}
          </div>
        </DetailSection>
      )}
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border-2 border-line bg-card p-4 md:p-5">
      <h4 className="text-base font-bold tracking-wide text-brand-blue md:text-lg">
        {title}
      </h4>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Statement({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div>
      <p className="text-sm font-bold text-ink-muted md:text-base">{label}</p>
      {value && value.trim() ? (
        <p className="mt-1 whitespace-pre-wrap rounded-lg bg-surface px-3 py-2.5 text-base leading-relaxed text-ink-body">
          {value}
        </p>
      ) : (
        <p className="mt-1 text-sm text-ink-hint">작성된 내용이 없습니다.</p>
      )}
    </div>
  );
}

function DocPreview({ doc }: { doc: InterviewDoc }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{doc.label}</p>
        {doc.url && (
          <a
            href={doc.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs font-semibold text-brand-blue hover:underline"
          >
            새 창 ↗
          </a>
        )}
      </div>
      {!doc.url ? (
        <p className="rounded-lg border border-dashed border-line bg-surface px-3 py-4 text-center text-xs text-ink-hint">
          미제출
        </p>
      ) : doc.kind === "pdf" ? (
        <iframe
          src={doc.url}
          title={doc.label}
          className="h-[420px] w-full rounded-lg border border-line bg-white md:h-[520px]"
        />
      ) : doc.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={doc.url}
          alt={doc.label}
          className="w-full rounded-lg border border-line"
        />
      ) : (
        <a
          href={doc.url}
          target="_blank"
          rel="noreferrer"
          className="block rounded-lg border border-line bg-surface px-3 py-4 text-center text-sm font-semibold text-brand-blue hover:bg-brand-blue-soft"
        >
          파일 열기 ↗
        </a>
      )}
    </div>
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
          <p className="text-lg font-bold text-ink md:text-xl">{title}</p>
          <p className="mt-1 text-sm text-ink-muted md:text-base">{sub}</p>
        </div>
        <span className="shrink-0 rounded-full bg-brand-blue-soft px-3 py-1 text-sm font-semibold text-brand-blue md:text-base">
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
              className={`rounded-xl border-2 px-3 py-4 text-center font-bold shadow-sm transition active:scale-[0.97] md:py-5 ${
                active
                  ? "border-brand-blue bg-brand-blue text-white shadow-md"
                  : "border-line bg-card text-ink-body hover:border-brand-blue hover:bg-brand-blue-soft"
              }`}
            >
              <span className="block text-2xl md:text-3xl">{c.value}</span>
              <span className="mt-0.5 block text-sm font-semibold md:text-base">
                {c.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
