// =====================================================================
// 한국 공휴일 달력 — LP-4
//   * 음력 계산을 코드로 하지 않고 연도별 확정 날짜를 상수로 둔다. 설·추석은
//     음력이라 알고리즘이 필요하고, 대체공휴일은 시행령 판단이 섞여 오차가
//     생기기 쉽다 — 표를 명시해 두면 검토·수정이 쉽고 틀리면 바로 눈에 띈다.
//   * 대체공휴일 적용 대상(2023 확대 기준): 설·추석 연휴, 어린이날, 3·1절,
//     광복절, 개천절, 한글날, 부처님오신날, 성탄절.
//     제외: 신정(1/1), 현충일(6/6).
//     설·추석 연휴는 '일요일'과 겹칠 때만, 나머지는 토·일 모두 대체 대상.
//   * 순수 모듈(DB·@/ 의존 없음). 연도가 넘어가면 HOLIDAYS 에 표를 추가한다.
// =====================================================================

/** 공휴일 표에 들어 있는 연도. 이 범위 밖 날짜는 "공휴일 아님"으로 답한다. */
export const HOLIDAY_YEARS = [2026, 2027] as const;

// YYYY-MM-DD → 공휴일 이름. 대체공휴일은 이름에 "대체공휴일"을 붙인다.
export const HOLIDAYS: Record<string, string> = {
  // ---------------- 2026 ----------------
  "2026-01-01": "신정",
  // 설날 2/17(화) — 연휴 2/16~2/18. 일요일과 겹치지 않아 대체공휴일 없음.
  "2026-02-16": "설날 연휴",
  "2026-02-17": "설날",
  "2026-02-18": "설날 연휴",
  // 3·1절이 일요일 → 다음 평일 대체.
  "2026-03-01": "삼일절",
  "2026-03-02": "삼일절 대체공휴일",
  "2026-05-05": "어린이날",
  // 부처님오신날이 일요일 → 다음 평일 대체.
  "2026-05-24": "부처님오신날",
  "2026-05-25": "부처님오신날 대체공휴일",
  // 현충일이 토요일이지만 대체공휴일 대상이 아니다.
  "2026-06-06": "현충일",
  // 광복절이 토요일 → 다음 평일 대체.
  "2026-08-15": "광복절",
  "2026-08-17": "광복절 대체공휴일",
  // 추석 9/25(금) — 연휴 9/24~9/26(목·금·토). 일요일 없어 대체 없음.
  "2026-09-24": "추석 연휴",
  "2026-09-25": "추석",
  "2026-09-26": "추석 연휴",
  // 개천절이 토요일 → 다음 평일 대체.
  "2026-10-03": "개천절",
  "2026-10-05": "개천절 대체공휴일",
  "2026-10-09": "한글날",
  "2026-12-25": "성탄절",

  // ---------------- 2027 ----------------
  "2027-01-01": "신정",
  // 설날 2/6(토) — 연휴 2/5~2/7 에 일요일(2/7)이 겹쳐 2/8 대체.
  "2027-02-05": "설날 연휴",
  "2027-02-06": "설날",
  "2027-02-07": "설날 연휴",
  "2027-02-08": "설날 대체공휴일",
  "2027-03-01": "삼일절",
  "2027-05-05": "어린이날",
  "2027-05-13": "부처님오신날",
  // 현충일이 일요일이지만 대체공휴일 대상이 아니다.
  "2027-06-06": "현충일",
  // 광복절이 일요일 → 다음 평일 대체.
  "2027-08-15": "광복절",
  "2027-08-16": "광복절 대체공휴일",
  // 추석 9/15(수) — 연휴 9/14~9/16. 일요일 없어 대체 없음.
  "2027-09-14": "추석 연휴",
  "2027-09-15": "추석",
  "2027-09-16": "추석 연휴",
  // 개천절이 일요일 → 다음 평일 대체.
  "2027-10-03": "개천절",
  "2027-10-04": "개천절 대체공휴일",
  // 한글날이 토요일 → 다음 평일 대체.
  "2027-10-09": "한글날",
  "2027-10-11": "한글날 대체공휴일",
  // 성탄절이 토요일 → 다음 평일 대체.
  "2027-12-25": "성탄절",
  "2027-12-27": "성탄절 대체공휴일",
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(v: unknown): v is string {
  return typeof v === "string" && YMD_RE.test(v);
}

/** 공휴일이면 이름, 아니면 null. 표에 없는 연도는 항상 null. */
export function getHolidayName(date: string): string | null {
  if (!isYmd(date)) return null;
  return HOLIDAYS[date] ?? null;
}

export function isHoliday(date: string): boolean {
  return getHolidayName(date) !== null;
}

/** 공휴일 표가 그 연도를 담고 있는지 — 담고 있지 않으면 화면에서 안내한다. */
export function hasHolidayData(year: number): boolean {
  return (HOLIDAY_YEARS as readonly number[]).includes(year);
}

// --- 요일 ------------------------------------------------------------
//   KST 고정(UTC+9)·DST 없음 → UTC 로 계산해도 요일이 어긋나지 않는다.
export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 0=일 … 6=토. 형식이 아니면 null. */
export function weekdayOf(date: string): number | null {
  if (!isYmd(date)) return null;
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t).getUTCDay();
}

export function isSunday(date: string): boolean {
  return weekdayOf(date) === 0;
}
export function isSaturday(date: string): boolean {
  return weekdayOf(date) === 6;
}

/** 연차 계획에서 "붉게 + 확인 경고" 대상 — 일요일 또는 공휴일. */
export function isRestDay(date: string): boolean {
  return isSunday(date) || isHoliday(date);
}

/** 그 날이 왜 쉬는 날인지 한 줄로. 아니면 null. */
export function restDayReason(date: string): string | null {
  const holiday = getHolidayName(date);
  if (holiday && isSunday(date)) return `${holiday}(일요일)`;
  if (holiday) return holiday;
  if (isSunday(date)) return "일요일";
  return null;
}

// --- 달력 그리기 ------------------------------------------------------
export type CalendarCell = {
  date: string; // YYYY-MM-DD
  day: number; // 1~31
  weekday: number; // 0=일
  holiday: string | null;
  sunday: boolean;
  saturday: boolean;
  rest: boolean; // 일요일 또는 공휴일
};

/** 한 달치 셀 — 1일 앞의 빈칸은 null 로 채워 7열 그리드에 그대로 꽂는다. */
export function monthCells(
  year: number,
  month: number
): (CalendarCell | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = first.getUTCDay();
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (CalendarCell | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const weekday = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    const holiday = getHolidayName(date);
    cells.push({
      date,
      day: d,
      weekday,
      holiday,
      sunday: weekday === 0,
      saturday: weekday === 6,
      rest: weekday === 0 || holiday !== null,
    });
  }
  // 마지막 주를 7칸으로 맞춘다.
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** 기간(YYYY-MM-DD) 안에 든 달 목록 — 달력 이동 범위를 제한하는 데 쓴다. */
export function monthsInRange(
  start: string | null,
  end: string | null,
  fallbackYear: number
): { year: number; month: number }[] {
  const s = isYmd(start ?? "") ? (start as string) : `${fallbackYear}-01-01`;
  const e = isYmd(end ?? "") ? (end as string) : `${fallbackYear}-12-31`;
  let y = Number(s.slice(0, 4));
  let m = Number(s.slice(5, 7));
  const ey = Number(e.slice(0, 4));
  const em = Number(e.slice(5, 7));
  const out: { year: number; month: number }[] = [];
  // 방어: 기간이 뒤집혀 있으면 시작 달 하나만.
  if (y > ey || (y === ey && m > em)) return [{ year: y, month: m }];
  while (y < ey || (y === ey && m <= em)) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    // 안전 상한(기간이 비정상적으로 길어도 멈춘다).
    if (out.length > 36) break;
  }
  return out;
}
