// =====================================================================
// ERP 복무(erp_duties) 표시 규칙 — 순수 함수(화면·서버 공용, DB 접근 없음).
//   * 보여 주는 결재 상태: process_code 1(진행)·3(완료). 0(작성)·2(반려)는 제외.
//   * 유형(type_name): 연가·병가·공가·대휴 = 휴가류, 휴근·초과·야근 = 관장 전용,
//     출장·외근 = 장소 표시, 연수·조퇴 = 그대로.
//   * 직원 화면: 휴가류는 모두 "휴가"(0.5일이면 "휴가(반일)"), 휴근·초과·야근은 숨김.
//     관장(M0) 화면: 원래 유형(0.5일이면 "연가(반일)").
// =====================================================================

export const VISIBLE_PROCESS_CODES = [1, 3] as const;
export const LEAVE_TYPES: ReadonlySet<string> = new Set(["연가", "병가", "공가", "대휴"]);
export const M0_ONLY_TYPES: ReadonlySet<string> = new Set(["휴근", "초과", "야근"]);
export const FIELD_TYPES: ReadonlySet<string> = new Set(["출장", "외근"]);

export const ERP_NOTE = "ERP에서 가져온 정보입니다. 수정은 ERP에서 해 주세요";

// 화면에 쓸 유형 이름. null = 이 사람에게 숨김.
export function dutyDisplayType(type: string | null | undefined, declaredAmount: number | null | undefined, isM0: boolean): string | null {
  const t = (type ?? "").trim() || "기타";
  const half = Number(declaredAmount) === 0.5;
  if (isM0) return LEAVE_TYPES.has(t) && half ? `${t}(반일)` : t;
  if (M0_ONLY_TYPES.has(t)) return null;
  if (LEAVE_TYPES.has(t)) return half ? "휴가(반일)" : "휴가";
  return t;
}

// 부재로 세는 유형 — 직원 화면에 보이는 것 전부(휴근·초과·야근 제외).
export function isAbsenceType(type: string | null | undefined): boolean {
  return !M0_ONLY_TYPES.has((type ?? "").trim());
}

// --- 한국시간 날짜 ---------------------------------------------------------
const KST_MS = 9 * 3600 * 1000;
export function kstYmdOf(iso: string): string {
  return new Date(new Date(iso).getTime() + KST_MS).toISOString().slice(0, 10);
}
export function kstHmOf(iso: string): string {
  return new Date(new Date(iso).getTime() + KST_MS).toISOString().slice(11, 16);
}
export function kstTodayYmd(): string {
  return new Date(Date.now() + KST_MS).toISOString().slice(0, 10);
}
export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// 한국시간 하루의 시작·끝 → UTC ISO(DB 비교용).
export function kstDayStartUtc(ymd: string): string {
  return new Date(`${ymd}T00:00:00+09:00`).toISOString();
}
export function kstDayEndUtc(ymd: string): string {
  return new Date(`${ymd}T23:59:59.999+09:00`).toISOString();
}
// 월요일 시작 주. offset 0 = 이번 주, 1 = 다음 주.
export function weekRange(today: string, offset: number): { start: string; end: string } {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 일 ~ 6 토
  const monday = addDaysYmd(today, -((dow + 6) % 7) + offset * 7);
  return { start: monday, end: addDaysYmd(monday, 6) };
}
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 62; d = addDaysYmd(d, 1)) out.push(d);
  return out;
}
const WD = ["일", "월", "화", "수", "목", "금", "토"];
export function dayLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`;
}
export function monthRange(today: string): { start: string; end: string } {
  const start = `${today.slice(0, 7)}-01`;
  const next = new Date(`${start}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { start, end: addDaysYmd(next.toISOString().slice(0, 10), -1) };
}

// 시간 표기 — 하루 안이면 "09:00~18:00", 여러 날이면 "11/3 09:00~11/5 18:00".
export function dutyTimeText(startAt: string | null, endAt: string | null): string {
  if (!startAt) return "";
  const s = kstHmOf(startAt);
  if (!endAt) return s;
  const sd = kstYmdOf(startAt);
  const ed = kstYmdOf(endAt);
  const e = kstHmOf(endAt);
  if (sd === ed) return `${s}~${e}`;
  const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
  return `${md(sd)} ${s}~${md(ed)} ${e}`;
}

// 복무가 그날(한국시간)에 걸치는지.
export function dutyCoversDay(startAt: string | null, endAt: string | null, ymd: string): boolean {
  if (!startAt) return false;
  const s = kstYmdOf(startAt);
  const e = endAt ? kstYmdOf(endAt) : s;
  return s <= ymd && ymd <= (e < s ? s : e);
}

// --- 색 구분(캘린더 칩·범례) -----------------------------------------------------
export type DutyColorKey = "leave" | "trip" | "field" | "training" | "early" | "overtime" | "other";
export const DUTY_COLOR_LABEL: Record<DutyColorKey, string> = {
  leave: "휴가",
  trip: "출장",
  field: "외근",
  training: "연수·교육",
  early: "조퇴",
  overtime: "휴근·초과·야근",
  other: "기타",
};
// 칩 색(배경·글자·테두리) — Tailwind 기본 팔레트, 밝은 배경 + 진한 글자.
export const DUTY_COLOR_CLASS: Record<DutyColorKey, string> = {
  leave: "bg-emerald-100 text-emerald-900 border-emerald-300",
  trip: "bg-blue-100 text-blue-900 border-blue-300",
  field: "bg-sky-100 text-sky-900 border-sky-300",
  training: "bg-violet-100 text-violet-900 border-violet-300",
  early: "bg-amber-100 text-amber-900 border-amber-300",
  overtime: "bg-rose-100 text-rose-900 border-rose-300",
  other: "bg-slate-100 text-slate-800 border-slate-300",
};
export const DUTY_COLOR_HEX: Record<DutyColorKey, string> = {
  leave: "#10b981",
  trip: "#3b82f6",
  field: "#0ea5e9",
  training: "#8b5cf6",
  early: "#f59e0b",
  overtime: "#f43f5e",
  other: "#94a3b8",
};
export function dutyColorKey(rawType: string | null | undefined): DutyColorKey {
  const t = (rawType ?? "").trim();
  if (LEAVE_TYPES.has(t)) return "leave";
  if (t === "출장") return "trip";
  if (t === "외근") return "field";
  if (t === "연수" || t === "교육") return "training";
  if (t === "조퇴") return "early";
  if (M0_ONLY_TYPES.has(t)) return "overtime";
  return "other";
}
