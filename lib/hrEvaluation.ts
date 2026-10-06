// =====================================================================
// 인사평가(근무성적평정) — 기간·재료 타입·요약 문구·총점 (순수 모듈)
//   근거: 운영규정 33조(근무·교육훈련·경력 + 공로 훈장·포상 가점), 31조(승진 종합평가),
//         32조(징계 중·제한기간 중 승진 불가).
//   ⚠️ 점수를 자동으로 매기지 않습니다 — 센터의 평정 기준표가 규정에 없습니다.
//     시스템은 재료를 모아 요약하고, 각 항목 점수·등급은 평정자(관장)가 넣습니다.
//     자동인 것은 총점 합산 하나뿐입니다.
//   ⚠️ 열람은 관장·부장(M0)만 — 본인·인사 담당도 불가(lib/hrEvaluationServer 게이트).
// =====================================================================

export type PeriodHalf = "H1" | "H2" | "YEAR";
export const PERIOD_HALVES: { value: PeriodHalf; label: string }[] = [
  { value: "H1", label: "상반기(1~6월)" },
  { value: "H2", label: "하반기(7~12월)" },
  { value: "YEAR", label: "연간" },
];
export const PERIOD_LABEL: Record<PeriodHalf, string> = { H1: "상반기", H2: "하반기", YEAR: "연간" };
export function isPeriodHalf(v: unknown): v is PeriodHalf {
  return v === "H1" || v === "H2" || v === "YEAR";
}

// 평정 기간(양 끝 포함).
export function periodRange(year: number, half: PeriodHalf): { from: string; to: string } {
  if (half === "H1") return { from: `${year}-01-01`, to: `${year}-06-30` };
  if (half === "H2") return { from: `${year}-07-01`, to: `${year}-12-31` };
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

// 등급 — 규정에 기준표가 없어 자유 입력. 흔히 쓰는 것을 제안만 합니다.
export const GRADE_SUGGESTIONS = ["수", "우", "미", "양", "가"];

// "4시간" "1.5" "2시간 30분" → 시간(소수). 못 읽으면 0.
export function parseHours(v: string | null | undefined): number {
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const h = s.match(/(\d+(?:\.\d+)?)\s*(?:시간|h|H)?/);
  let hours = h ? Number(h[1]) : 0;
  const m = s.match(/(\d+)\s*분/);
  if (m && /시간/.test(s)) hours += Number(m[1]) / 60;
  else if (m && !/시간/.test(s)) hours = Number(m[1]) / 60;
  return Number.isFinite(hours) ? Math.round(hours * 10) / 10 : 0;
}

// --- 재료(스냅샷) ---------------------------------------------------------------
export type MandatoryItem = { name: string; base: string | null; hours: number; completed: boolean; completedAt: string | null };
export type StaffItem = { name: string; date: string | null; hours: number; organizer: string | null };
export type CareerItem = { company: string; department: string; period: string; duties: string };
export type AwardItem = { date: string; title: string; body: string | null; kind: string | null; source: "internal" | "external" };
export type DisciplineItem = { date: string; kind: string; label: string; reason: string; blockUntil: string | null };

export type EvaluationMaterials = {
  period: { year: number; half: PeriodHalf; from: string; to: string };
  collectedAt: string; // ISO
  service: {
    joinDate: string | null;
    years: number | null; // 기간 말일 기준 근속(년, 소수 1자리)
    department: string | null;
    title: string | null;
    duty: string | null;
    rank: string | null;
    appointmentsInPeriod: { date: string; text: string }[];
  };
  training: {
    mandatory: { target: number; completed: number; hours: number; items: MandatoryItem[] };
    staff: { count: number; hours: number; items: StaffItem[] };
  };
  career: CareerItem[];
  awards: { internal: AwardItem[]; external: AwardItem[]; internalInPeriod: number; externalInPeriod: number };
  disciplines: { items: DisciplineItem[]; inPeriod: number; blockUntil: string | null; warnings: number };
};

export type Revision = { at: string; by: string; before: Partial<EvaluationScores>; after: Partial<EvaluationScores> };

export type EvaluationSnapshot = Partial<EvaluationMaterials> & { revisions?: Revision[] };

// --- 요약 한 줄 ----------------------------------------------------------------
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const hrs = (h: number) => `${Math.round(h * 10) / 10}시간`;

export function trainingSummary(t: EvaluationMaterials["training"]): string {
  const m = t.mandatory;
  const mand = m.target > 0 ? `의무교육 ${m.completed}/${m.target} 이수(${pct(m.completed, m.target)}%)` : "의무교육 대상 없음";
  const staff = t.staff.count > 0 ? `종사자교육 ${t.staff.count}건 ${hrs(t.staff.hours)}` : "종사자교육 0건";
  return `${mand} · ${staff}`;
}

export function serviceSummary(s: EvaluationMaterials["service"]): string {
  const yrs = s.years != null ? `근속 ${s.years}년` : "입사일 미기재";
  const where = [s.department, s.title].filter(Boolean).join(" ") || "발령기록 없음";
  return `${yrs} · ${where}${s.duty ? `(${s.duty})` : ""}`;
}

export function awardSummary(a: EvaluationMaterials["awards"]): string {
  return `센터 포상 ${a.internal.length}건(이 기간 ${a.internalInPeriod}건) · 외부 수상 ${a.external.length}건(이 기간 ${a.externalInPeriod}건)`;
}

export function disciplineSummary(d: EvaluationMaterials["disciplines"]): string {
  if (d.items.length === 0) return "징계 없음";
  return `징계 ${d.items.length}건(이 기간 ${d.inPeriod}건)${d.warnings ? ` · 경고 ${d.warnings}회` : ""}`;
}

// --- 점수 ---------------------------------------------------------------------
export type EvaluationScores = {
  score_duty: number | null;
  score_training: number | null;
  score_career: number | null;
  bonus_award: number | null;
  penalty_discipline: number | null;
  grade: string | null;
  evaluator_note: string | null;
};

// 총점 = 근무 + 교육훈련 + 경력 + 포상 가점 − 징계 감점. 비어 있는 칸은 0.
export function totalScore(s: Pick<EvaluationScores, "score_duty" | "score_training" | "score_career" | "bonus_award" | "penalty_discipline">): number {
  const n = (v: number | null) => (v == null || !Number.isFinite(v) ? 0 : v);
  const t = n(s.score_duty) + n(s.score_training) + n(s.score_career) + n(s.bonus_award) - Math.abs(n(s.penalty_discipline));
  return Math.round(t * 100) / 100;
}

export function fmtDot(ymd: string | null | undefined): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}. ${m}. ${d}.`;
}
