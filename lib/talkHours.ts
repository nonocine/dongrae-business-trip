import { getHolidayName } from "@/lib/koreanHolidays";

// =====================================================================
// 방카톡 운영시간(요청 10번) — 순수 모듈(서버·브라우저 공용, DB 의존 없음).
//   동래방카 lib/talkHours.ts 와 같은 내용이어야 한다(두 앱이 같은 판단을 해야 함).
//   * 한국 시간 기준: 요일 ∈ weekdays, 공휴일·추가로 막을 날 아님, open_time ≤ 지금 < close_time.
//   * 시각은 epoch ms 로 받는다 — 서버가 UTC 여도 KST 로 바꿔 판단.
// =====================================================================

export type TalkHours = {
  weekdays: number[]; // 0=일 … 6=토
  open_time: string; // "HH:MM" 또는 "HH:MM:SS"
  close_time: string;
  block_holidays: boolean;
  extra_closed_dates: string[];
  closed_notice: string;
};

export const DEFAULT_TALK_HOURS: TalkHours = {
  weekdays: [1, 2, 3, 4, 5],
  open_time: "13:00",
  close_time: "20:00",
  block_holidays: true,
  extra_closed_dates: [],
  closed_notice:
    "방카톡은 평일 오후 1시부터 8시까지 쓸 수 있습니다. 급한 결석은 공결 신청을 이용하시거나 센터로 전화해 주세요.",
};

const KST = 9 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const p2 = (n: number) => String(n).padStart(2, "0");
const WD = ["일", "월", "화", "수", "목", "금", "토"];

// "HH:MM[:SS]" → 분. 형식이 틀리면 null.
export function toMinutes(t: string | null | undefined): number | null {
  const m = (t ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h <= 24 && mi < 60 ? h * 60 + mi : null;
}

// KST 날짜·요일·분.
function kstParts(ms: number) {
  const k = new Date(ms + KST);
  return {
    ymd: `${k.getUTCFullYear()}-${p2(k.getUTCMonth() + 1)}-${p2(k.getUTCDate())}`,
    wd: k.getUTCDay(),
    minutes: k.getUTCHours() * 60 + k.getUTCMinutes(),
  };
}

// KST "YYYY-MM-DD" + 분 → epoch ms.
function kstMs(ymd: string, minutes: number): number {
  return Date.parse(`${ymd}T00:00:00Z`) - KST + minutes * 60 * 1000;
}

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

// 그 날(KST) 이 운영하는 날인지 — 요일·공휴일·추가로 막을 날.
export function isOperatingDay(h: TalkHours, ymd: string): boolean {
  const wd = new Date(Date.parse(`${ymd}T00:00:00Z`)).getUTCDay();
  if (!h.weekdays.includes(wd)) return false;
  if (h.block_holidays && getHolidayName(ymd)) return false;
  if (h.extra_closed_dates.includes(ymd)) return false;
  return true;
}

// 지금 보호자가 쓸 수 있는지.
export function isTalkOpen(h: TalkHours, nowMs: number): boolean {
  const open = toMinutes(h.open_time);
  const close = toMinutes(h.close_time);
  if (open == null || close == null) return false;
  const { ymd, minutes } = kstParts(nowMs);
  return isOperatingDay(h, ymd) && open <= minutes && minutes < close;
}

// 다음에 열리는 시각(epoch ms). 60일 안에 없으면 null.
export function nextOpenMs(h: TalkHours, nowMs: number): number | null {
  const open = toMinutes(h.open_time);
  if (open == null) return null;
  const { ymd, minutes } = kstParts(nowMs);
  for (let i = 0; i < 60; i++) {
    const day = addDaysYmd(ymd, i);
    if (!isOperatingDay(h, day)) continue;
    if (i === 0 && minutes >= open) continue;
    return kstMs(day, open);
  }
  return null;
}

// 분 → "오후 1시", "오전 9시 30분".
export function timeLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}시${m ? ` ${m}분` : ""}`;
}

// 다음 운영 시작 — "오늘 오후 1시" / "내일(목) 오후 1시" / "11월 3일(월) 오후 1시".
export function nextOpenLabel(h: TalkHours, nowMs: number): string | null {
  const at = nextOpenMs(h, nowMs);
  if (at == null) return null;
  const today = kstParts(nowMs).ymd;
  const t = kstParts(at);
  const time = timeLabel(t.minutes);
  if (t.ymd === today) return `오늘 ${time}`;
  if (t.ymd === addDaysYmd(today, 1)) return `내일(${WD[t.wd]}) ${time}`;
  return `${Number(t.ymd.slice(5, 7))}월 ${Number(t.ymd.slice(8, 10))}일(${WD[t.wd]}) ${time}`;
}

// 운영 요일·시각 한 줄 — "월~금 오후 1시~오후 8시" / "월·수·금 …".
export function hoursSummary(h: TalkHours): string {
  const days = [...h.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const order = days.map((d) => (d + 6) % 7); // 월=0 … 일=6
  const run = order.length > 2 && order.every((v, i) => i === 0 || v === order[i - 1] + 1);
  const dayText = days.length === 0 ? "운영 요일 없음" : run ? `${WD[days[0]]}~${WD[days[days.length - 1]]}` : days.map((d) => WD[d]).join("·");
  const open = toMinutes(h.open_time);
  const close = toMinutes(h.close_time);
  return open == null || close == null ? dayText : `${dayText} ${timeLabel(open)}~${timeLabel(close)}`;
}

// 미답변 강조 기준(결정 3) — 보호자가 쓴 날 다음 운영일이 끝나는 시각.
//   운영시간 밖(밤·주말)에 들어온 글도 "그다음 운영일 끝"까지는 기다린다.
export function staleDeadlineMs(h: TalkHours, sinceMs: number): number | null {
  const close = toMinutes(h.close_time);
  if (close == null) return null;
  const { ymd } = kstParts(sinceMs);
  for (let i = 1; i <= 60; i++) {
    const day = addDaysYmd(ymd, i);
    if (isOperatingDay(h, day)) return kstMs(day, close);
  }
  return null;
}

// 지금 시각(epoch ms) — 서버 컴포넌트가 렌더 중 Date.now() 를 직접 부르지 않게.
export function currentMs(): number {
  return Date.now();
}
