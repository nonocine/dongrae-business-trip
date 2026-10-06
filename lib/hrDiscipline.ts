// =====================================================================
// 상벌·경위서·인사위원회 — 규정 상수와 자동 계산 (순수 모듈)
//   관장 설계 확정(2026-10). 근거: 취업규칙 53·55조, 운영규정 32·40·41조.
//   ⚠️ 규정 값은 여기 한 곳에만 둡니다. 화면·서버가 모두 이 함수로 계산합니다.
//
//   열람 권한(서버 쿼리 단계에서 거름 — lib/hrDisciplineServer):
//     · 징계·상벌·경위서·인사위원회 = 관장·부장(M0)만. hr 직무도 아님.
//     · 포상 = 본인이 입력, 열람·수정은 M0. 본인은 "등록함" 확인만.
//     · 경위서 = 본인이 제출만. 제출 후 내용·검토의견은 M0만. 본인은 "제출함"만.
// =====================================================================

export type DisciplineKind = "warning" | "reprimand" | "pay_cut" | "suspension" | "dismissal";

// 취업규칙 53조 + 운영규정 40조. 가벼운 것부터.
export const DISCIPLINE_KINDS: { value: DisciplineKind; label: string; note: string }[] = [
  { value: "warning", label: "경고", note: "견책 미만. 경고 3회면 견책으로 처리 가능(운영규정 40조 3항)" },
  { value: "reprimand", label: "견책", note: "경위서를 받고 문서로 견책" },
  { value: "pay_cut", label: "감봉", note: "1회 평균임금 1일분의 1/2, 총액은 월 급여총액의 1/10 이내" },
  { value: "suspension", label: "정직", note: "3월 이내, 기간 중 임금 미지급" },
  { value: "dismissal", label: "해고", note: "" },
];
export const DISCIPLINE_LABEL: Record<DisciplineKind, string> = Object.fromEntries(
  DISCIPLINE_KINDS.map((k) => [k.value, k.label])
) as Record<DisciplineKind, string>;

export function isDisciplineKind(v: unknown): v is DisciplineKind {
  return DISCIPLINE_KINDS.some((k) => k.value === v);
}

// 운영규정 32조 — 처분 집행 종료일부터 승진제한 개월. 경고·해고는 없음.
export const PROMOTION_BLOCK_MONTHS: Partial<Record<DisciplineKind, number>> = {
  suspension: 18,
  pay_cut: 12,
  reprimand: 6,
};

// 운영규정 41조 — 재심청구 기한(처분일 + 7일, 1회).
export const APPEAL_DAYS = 7;

// 운영규정 40조 3항 — 경고 누적 기준.
export const WARNING_THRESHOLD = 3;

// 정직 상한(3월).
export const SUSPENSION_MAX_MONTHS = 3;

// 운영규정 30조 포상 종류 — 센터 포상(internal)에서 고릅니다.
export const AWARD_KINDS = ["상장", "상패", "부상", "특별휴가", "위로금"] as const;

// 포상 출처(hr_awards.award_source, 2026-10 인사기록카드 '수상' 탭 일원화).
//   internal = 센터가 수여한 포상(운영규정 30조, 인사고과 반영 대상) — 관장·부장 전용 열람
//   external = 외부 기관 수상(입사 전 포함) — 본인 경력이라 본인·인사 담당도 열람·수정
export type AwardSource = "internal" | "external";
export const AWARD_SOURCE_LABEL: Record<AwardSource, string> = {
  internal: "센터 포상",
  external: "외부 수상",
};
export function toAwardSource(v: unknown): AwardSource {
  return v === "internal" ? "internal" : "external";
}
export const COMMITTEE_AGENDAS = ["징계", "표창", "승진", "기타"] as const;

// --- 날짜 -----------------------------------------------------------------
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isYmd(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = v.match(YMD);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
function toUtc(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(ymd: string, n: number): string {
  const d = toUtc(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}
// 월 더하기 — 말일을 넘기면 그 달 말일(8/31 + 6개월 = 2/28).
export function addMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return fromUtc(t);
}
// "2027. 3. 15."
export function fmtDotPlain(ymd: string | null | undefined): string {
  if (!ymd || !isYmd(ymd)) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}. ${m}. ${d}.`;
}

// --- 자동 계산 --------------------------------------------------------------

// 집행 종료일 — 기간이 있는 처분(감봉·정직)은 종료일, 기간이 없으면(견책) 집행 시작일,
//   그것도 없으면 처분일.
export function executionEndOf(d: {
  decided_on: string;
  effective_start?: string | null;
  effective_end?: string | null;
}): string {
  return (isYmd(d.effective_end) && d.effective_end) || (isYmd(d.effective_start) && d.effective_start) || d.decided_on;
}

// 승진제한 만료일(운영규정 32조). 제한이 없는 처분이면 null.
//   "집행 종료일부터 N개월" — 종료일 다음 날부터 N개월째 되는 날의 전날까지 제한이 아니라,
//   규정 문구대로 종료일 + N개월 날짜를 만료일로 저장합니다(그날까지 제한).
export function promotionBlockUntil(d: {
  kind: DisciplineKind;
  decided_on: string;
  effective_start?: string | null;
  effective_end?: string | null;
}): string | null {
  const months = PROMOTION_BLOCK_MONTHS[d.kind];
  if (!months) return null;
  return addMonths(executionEndOf(d), months);
}

// 재심청구 기한(운영규정 41조).
export function appealDueOn(decidedOn: string): string {
  return addDays(decidedOn, APPEAL_DAYS);
}

// 오늘 기준 아직 유효한 승진제한 중 가장 늦은 날. 없으면 null(기한 지나면 자동으로 사라짐).
export function activePromotionBlock(
  rows: { promotion_block_until: string | null }[],
  today: string
): string | null {
  const live = rows
    .map((r) => r.promotion_block_until)
    .filter((d): d is string => !!d && d >= today)
    .sort();
  return live.length ? live[live.length - 1] : null;
}

// 경고 누적 — 3회 이상이면 견책 검토 알림. 자동으로 견책을 만들지 않습니다.
export function warningAlert(rows: { kind: DisciplineKind }[]): { count: number; reached: boolean } {
  const count = rows.filter((r) => r.kind === "warning").length;
  return { count, reached: count >= WARNING_THRESHOLD };
}

// 징계 입력 검증(규정 범위). 위반이면 메시지.
export function validateDiscipline(d: {
  kind: DisciplineKind;
  decided_on: string;
  effective_start?: string | null;
  effective_end?: string | null;
}): string | null {
  if (!isYmd(d.decided_on)) return "처분일을 확인해주세요.";
  if (d.effective_start && !isYmd(d.effective_start)) return "집행 시작일을 확인해주세요.";
  if (d.effective_end && !isYmd(d.effective_end)) return "집행 종료일을 확인해주세요.";
  if (d.effective_start && d.effective_end && d.effective_end < d.effective_start) {
    return "집행 종료일이 시작일보다 빠릅니다.";
  }
  if (d.kind === "suspension") {
    if (!d.effective_start || !d.effective_end) return "정직은 집행 기간(시작·종료)을 넣어야 승진제한을 계산할 수 있습니다.";
    if (d.effective_end > addDays(addMonths(d.effective_start, SUSPENSION_MAX_MONTHS), -1)) {
      return "정직은 3월 이내입니다(취업규칙 53조).";
    }
  }
  if (d.kind === "pay_cut" && !d.effective_end) {
    return "감봉은 집행 종료일(마지막 감봉 월)을 넣어야 승진제한을 계산할 수 있습니다.";
  }
  return null;
}

// --- 행 타입 -----------------------------------------------------------------
export type AwardRow = {
  id: string;
  driver_id: string;
  award_source: AwardSource;
  awarded_on: string;
  title: string;
  awarding_body: string | null;
  award_kind: string | null;
  merit_summary: string | null;
  has_attachment: boolean;
  created_by: string | null;
  created_at: string;
};

export type DisciplineRow = {
  id: string;
  driver_id: string;
  kind: DisciplineKind;
  decided_on: string;
  effective_start: string | null;
  effective_end: string | null;
  reason: string;
  rule_basis: string | null;
  committee_id: string | null;
  notified_on: string | null;
  appeal_due_on: string | null;
  appeal_filed_on: string | null;
  appeal_result: string | null;
  promotion_block_until: string | null;
  has_attachment: boolean;
  created_by: string | null;
  created_at: string;
};

export type IncidentRow = {
  id: string;
  driver_id: string;
  driver_name: string;
  occurred_on: string | null;
  submitted_at: string;
  subject: string;
  content: string;
  has_attachment: boolean;
  requested_by: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  discipline_id: string | null;
};

export type CommitteeRow = {
  id: string;
  held_on: string;
  agenda_type: string | null;
  subject: string;
  members: string[];
  target_driver_id: string | null;
  target_name: string | null;
  resolution: string | null;
  note: string | null;
  has_attachment: boolean;
  created_by: string | null;
};

// 상벌 한 줄(시간순 표시용).
export type TimelineItem =
  | { type: "award"; date: string; award: AwardRow }
  | { type: "discipline"; date: string; discipline: DisciplineRow };

export function buildTimeline(awards: AwardRow[], disciplines: DisciplineRow[]): TimelineItem[] {
  return [
    ...awards.map((a) => ({ type: "award" as const, date: a.awarded_on, award: a })),
    ...disciplines.map((d) => ({ type: "discipline" as const, date: d.decided_on, discipline: d })),
  ].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}
