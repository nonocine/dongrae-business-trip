// =====================================================================
// 회차 날짜 계산 공용 — 스케줄 2층 구조의 계산 엔진.
//   차시(saem_terms.default_*) = 기본 스케줄(프로그램 모달 프리필용)
//   프로그램(saem_programs.session_*) = 실제 스케줄(진실의 원천)
//   * 순수 계산(DB 접근 없음) — 서버 액션·클라이언트 미리보기가 같이 쓴다.
//   * 날짜는 전부 'YYYY-MM-DD' 문자열, 내부 계산은 UTC 기준(로컬 타임존 무관).
// =====================================================================

const DAY = 86400000;

export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

// 0 일 ~ 6 토. 범위를 벗어난 값은 안전하게 감싼다.
export function normalizeWeekday(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 6; // 기본 토요일(기존 관례)
  return ((Math.round(n) % 7) + 7) % 7;
}

export function weekdayLabel(v: number | null | undefined): string {
  if (v == null) return "-";
  return WEEKDAY_LABELS[normalizeWeekday(v)];
}

const p2 = (n: number) => String(n).padStart(2, "0");

export function msToYmd(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

export function ymdToMs(s: string): number | null {
  const m = (s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : null;
}

// 날짜의 요일(0 일 ~ 6 토). 잘못된 값이면 null.
export function weekdayOf(ymd: string): number | null {
  const ms = ymdToMs(ymd);
  return ms == null ? null : new Date(ms).getUTCDay();
}

// 기준일 이후(그 날 포함) 첫 해당 요일.
export function firstWeekdayOnOrAfter(
  startYmd: string,
  weekday: number
): string | null {
  const startMs = ymdToMs(startYmd);
  if (startMs == null) return null;
  const wd = normalizeWeekday(weekday);
  const dow = new Date(startMs).getUTCDay();
  return msToYmd(startMs + ((((wd - dow) % 7) + 7) % 7) * DAY);
}

export type SessionScheduleInput = {
  start: string; // 1회차 기준일(YYYY-MM-DD)
  weekday: number; // 0 일 ~ 6 토
  weeks: number; // 만들 회차 수
  holidays?: string[]; // 휴강일 — 이 날짜는 건너뛰고 다음 주로 밀린다
};

// 무한 밀림 방지 — 휴강일이 계속 겹쳐도 이 횟수 안에서 끝낸다(약 10년치).
const MAX_STEPS = 520;

// start 이후(포함) 첫 weekday 부터 주 단위로 진행하며 weeks 개를 채운다.
//   휴강일에 걸리는 날은 회차로 세지 않고 다음 주로 밀린다(회차 수는 보장).
//   weeks=1 이면 1회성(그 날짜 하나).
export function buildSessionDates(input: SessionScheduleInput): string[] {
  const weeks = Math.max(0, Math.round(Number(input.weeks) || 0));
  if (weeks <= 0) return [];
  const first = firstWeekdayOnOrAfter(input.start, input.weekday);
  if (first == null) return [];
  const holidays = new Set((input.holidays ?? []).filter(Boolean));

  const out: string[] = [];
  let cur = ymdToMs(first) as number;
  for (let step = 0; step < weeks + MAX_STEPS && out.length < weeks; step++) {
    const d = msToYmd(cur);
    if (!holidays.has(d)) out.push(d);
    cur += 7 * DAY;
  }
  return out;
}

// 마지막 회차 날짜(차시 종료일 계산용).
export function lastSessionDate(dates: string[]): string | null {
  return dates.length ? dates[dates.length - 1] : null;
}

// 문자열 배열 정규화 — 중복·빈값 제거 후 날짜 오름차순.
export function normalizeHolidays(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : [];
  const set = new Set<string>();
  for (const x of arr) {
    const s = String(x ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) set.add(s);
  }
  return [...set].sort();
}
