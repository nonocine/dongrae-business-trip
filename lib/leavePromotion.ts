// =====================================================================
// 연차 사용촉진(근로기준법 제61조) — 일정·상태 계산(순수 함수, DB 없음).
//   근거: 근로기준법 제61조, 센터 취업규칙 제28조⑤(회계연도 기준)·제29조.
//   서면 요건(고용노동부 근로기준정책과-3801): 서면은 종이가 원칙, 전자문서는 전자결재체계가
//   갖춰지고 도달이 확인될 때만 예외 → 완료 처리는 '종이 서명 수령본' 또는 'ERP 전자결재 문서'로만.
//   앱·이메일 안내는 보조 기록일 뿐 단독으로 완료가 되지 않습니다.
//
//   track
//     annual     : 회계연도 기준. 사용기한 12/31, 1차 법정기간 7/1~7/10, 직원 회신기한 = 1차 발송일+10일,
//                  2차(사용시기 지정 통보) 기한 10/31.
//     first_year : 입사 1년 미만(employee_profiles.join_date). 최초 1년이 끝나는 날(E) 기준
//                  1차 = E 3개월 전부터 10일 이내, 그 뒤 발생분은 E 1개월 전부터 5일 이내,
//                  2차 = E 1개월 전까지(그 뒤 발생분은 E 10일 전까지).
// =====================================================================

export type PromotionTrack = "annual" | "first_year";
export type PromotionStage = 1 | 2;
export type DeliveryMethod = "paper" | "erp" | "app" | "email";

export const TRACK_LABEL: Record<PromotionTrack, string> = { annual: "회계연도", first_year: "1년 미만" };
export const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
  paper: "종이 서명 수령",
  erp: "ERP 전자결재",
  app: "앱 안내(보조)",
  email: "이메일 안내(보조)",
};
// 화면 한 줄 안내(근거 해석).
export const DELIVERY_GUIDE =
  "서면 통보는 종이가 원칙이고, 전자문서는 전자결재체계가 갖춰지고 도달이 확인될 때만 인정됩니다(고용노동부 근로기준정책과-3801). 그래서 완료는 '종이 서명 수령본' 또는 'ERP 전자결재 문서'로만 처리하며, 앱·이메일은 보조 안내로만 기록합니다.";

export const REPLY_DAYS = 10;

// --- 날짜 ---------------------------------------------------------------
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function addMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}
export const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// --- 일정 -----------------------------------------------------------------
export type PromotionSchedule = {
  track: PromotionTrack;
  periodEnd: string; // 사용기한
  stage1: { start: string; end: string }; // 1차 촉구 법정기간
  stage1Later?: { start: string; end: string }; // 1년 미만 — 그 뒤 발생분
  stage2Due: string; // 2차 지정 통보 기한
  stage2LaterDue?: string; // 1년 미만 — 그 뒤 발생분
};

export function annualSchedule(year: number): PromotionSchedule {
  return {
    track: "annual",
    periodEnd: `${year}-12-31`,
    stage1: { start: `${year}-07-01`, end: `${year}-07-10` },
    stage2Due: `${year}-10-31`,
  };
}

// 최초 1년이 끝나는 날 = 입사일 + 1년 - 1일.
export function firstYearEnd(joinDate: string): string {
  return addDays(addMonths(joinDate, 12), -1);
}
export function firstYearSchedule(joinDate: string): PromotionSchedule {
  const end = firstYearEnd(joinDate);
  const s1 = addMonths(end, -3);
  const s1b = addMonths(end, -1);
  return {
    track: "first_year",
    periodEnd: end,
    stage1: { start: s1, end: addDays(s1, 9) },
    stage1Later: { start: s1b, end: addDays(s1b, 4) },
    stage2Due: addMonths(end, -1),
    stage2LaterDue: addDays(end, -10),
  };
}

// 그 해 이 직원에게 해당하는 track — 그 해 입사자는 first_year 만, 그 밖(전년도 이전 입사·입사일 없음)은 annual 만.
// '첫해' 판정 — 단일 기준: 입사일(join_date)의 연도 = 그 연도(산정 연도).
//   연차 사용촉진 1년 미만 줄·연차수당 first_year_monthly·'첫해' 배지·첫해 칩이 모두 이 함수를 씁니다.
//   (2026-11 확정) 전년도 입사자(예: 2025-07-16)는 그 해에는 회계연도 트랙만입니다.
export function isFirstYear(joinDate: string | null | undefined, year: number): boolean {
  return !!joinDate && joinDate.slice(0, 4) === String(year);
}

export function tracksFor(year: number, joinDate: string | null): PromotionTrack[] {
  return isFirstYear(joinDate, year) ? ["first_year"] : ["annual"];
}

export function scheduleFor(track: PromotionTrack, year: number, joinDate: string | null): PromotionSchedule {
  return track === "first_year" && joinDate ? firstYearSchedule(joinDate) : annualSchedule(year);
}

// --- 상태 -----------------------------------------------------------------
export type StepState = "done" | "waiting" | "progress" | "soon" | "overdue";
export const STEP_LABEL: Record<StepState, string> = {
  done: "완료",
  waiting: "대기",
  progress: "진행",
  soon: "기한 임박",
  overdue: "기한 경과",
};
export const SOON_DAYS = 14;

// 기한(due)과 완료 여부로 상태. start 이전이면 '대기'.
export function stepState(opts: { done: boolean; due: string | null; start?: string | null; today: string }): StepState {
  if (opts.done) return "done";
  if (opts.start && opts.today < opts.start) return "waiting";
  if (!opts.due) return "progress";
  const left = daysBetween(opts.today, opts.due);
  if (left < 0) return "overdue";
  if (left <= SOON_DAYS) return "soon";
  return "progress";
}

// 완료 = 종이 서명 수령본 또는 ERP 전자결재 문서 연결. 앱·이메일은 완료가 아님.
export function noticeCompleted(n: {
  delivery_method: string | null;
  signed_receipt_path: string | null;
  erp_document_id: number | string | null;
}): boolean {
  if (n.delivery_method === "paper") return !!n.signed_receipt_path;
  if (n.delivery_method === "erp") return n.erp_document_id != null && String(n.erp_document_id) !== "";
  return false;
}

// --- 본문(촉구서·지정 통보서) ---------------------------------------------------
export function koreanYmd(ymd: string | null | undefined): string {
  if (!ymd || !isYmd(ymd)) return "";
  return `${ymd.slice(0, 4)}년 ${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일`;
}
const days = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function stage1Body(p: {
  name: string;
  department: string | null;
  year: number;
  track: PromotionTrack;
  unusedDays: number;
  unusedBasis: string; // "ERP 기준 11월 11일 07:00"
  periodEnd: string;
  issueDate: string;
}): string {
  const replyDue = addDays(p.issueDate, REPLY_DAYS);
  return [
    `수신: ${p.name}${p.department ? ` (${p.department})` : ""}`,
    "",
    `근로기준법 제61조${p.track === "first_year" ? " 제2항" : " 제1항"} 및 취업규칙 제28조 제5항·제29조에 따라 귀하의 미사용 연차유급휴가 사용을 아래와 같이 촉구합니다.`,
    "",
    `1. 미사용 연차유급휴가 일수: ${days(p.unusedDays)}일 (${p.unusedBasis})`,
    `2. 연차유급휴가 사용기한: ${koreanYmd(p.periodEnd)}`,
    `3. 이 촉구서를 받은 날부터 10일 이내(${koreanYmd(replyDue)}까지)에 미사용 휴가의 사용 시기를 정하여 연차유급휴가 사용계획서를 제출하여 주시기 바랍니다.`,
    `4. 기한 내에 사용 시기를 정하여 통보하지 않으면 센터가 사용 시기를 정하여 서면으로 통보합니다. 이와 같이 촉구·지정하였음에도 사용하지 않은 휴가는 사용기한이 지나면 소멸하며 금전으로 보상하지 않습니다(근로기준법 제61조).`,
    "",
    koreanYmd(p.issueDate),
  ].join("\n");
}

export function stage2Body(p: {
  name: string;
  department: string | null;
  year: number;
  track: PromotionTrack;
  unusedDays: number;
  unusedBasis: string;
  periodEnd: string;
  designatedDates: string[];
  issueDate: string;
}): string {
  const list = [...p.designatedDates].sort();
  return [
    `수신: ${p.name}${p.department ? ` (${p.department})` : ""}`,
    "",
    `근로기준법 제61조${p.track === "first_year" ? " 제2항" : " 제1항"} 및 취업규칙 제28조 제5항·제29조에 따라, 사용 촉구에도 사용 시기를 정하지 않은 미사용 연차유급휴가의 사용 시기를 아래와 같이 지정하여 통보합니다.`,
    "",
    `1. 미사용 연차유급휴가 일수: ${days(p.unusedDays)}일 (${p.unusedBasis})`,
    `2. 지정 사용일(${list.length}일): ${list.map((d) => koreanYmd(d)).join(", ") || "-"}`,
    `3. 연차유급휴가 사용기한: ${koreanYmd(p.periodEnd)}`,
    "4. 지정된 날에 출근하여 근로를 제공하더라도 센터는 노무 수령을 거부하며, 사용하지 않은 휴가는 사용기한이 지나면 소멸하고 금전으로 보상하지 않습니다(근로기준법 제61조).",
    "",
    koreanYmd(p.issueDate),
  ].join("\n");
}
