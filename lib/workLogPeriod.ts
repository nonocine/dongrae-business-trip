// =====================================================================
// 강사 근무일지 "기간 선택" — 브라우저·서버 공용(순수 함수만).
//   * 기간 = { from, to } (YYYY-MM-DD, 양 끝 포함). null = 전체(지금과 같은 결과).
//   * saem_sessions.session_date 는 DB date 형식("YYYY-MM-DD")이라 문자열로 비교한다
//     — Date 로 바꾸지 않으니 시간대 때문에 하루 밀리는 일이 없다.
//     날짜 없는 회차는 기간을 지정하면 빠진다(전체일 때만 들어간다).
//   * 회차 번호(session_no)는 손대지 않는다 — 거른 뒤에도 원래 번호·순서 그대로.
//   * [이번 달]·[지난달]은 한국시간(UTC+9, DST 없음) 오늘 기준.
//   * 출석부에는 쓰지 않는다(근무일지 전용).
// =====================================================================

export type WorkLogPeriod = { from: string; to: string } | null;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// 형식과 실제 달력 날짜까지 본다(2026-02-30 은 거절).
export function isYmd(s: string): boolean {
  const m = s.match(YMD_RE);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}

// 라우트용 — from·to 둘 다 없으면 전체. 하나만 있거나 형식이 틀리거나 순서가 거꾸로면 오류.
export function parsePeriodParams(
  sp: URLSearchParams
): { ok: true; period: WorkLogPeriod } | { ok: false; error: string } {
  const from = sp.get("from");
  const to = sp.get("to");
  if (from == null && to == null) return { ok: true, period: null };
  if (from == null || to == null)
    return { ok: false, error: "from 과 to 는 함께 주어야 합니다." };
  if (!isYmd(from) || !isYmd(to))
    return { ok: false, error: "from·to 는 YYYY-MM-DD 형식이어야 합니다." };
  if (from > to) return { ok: false, error: "시작일이 종료일보다 늦습니다." };
  return { ok: true, period: { from, to } };
}

export function periodQuery(p: WorkLogPeriod): string {
  return p ? `from=${p.from}&to=${p.to}` : "";
}

export function periodLabel(p: NonNullable<WorkLogPeriod>): string {
  return `${p.from}~${p.to}`;
}

export function filterSessionsByPeriod<
  T extends { session_date: string | null },
>(sessions: T[], p: WorkLogPeriod): T[] {
  if (!p) return sessions;
  return sessions.filter((s) => {
    const d = s.session_date?.slice(0, 10);
    return !!d && d >= p.from && d <= p.to;
  });
}

// --- 빠른 버튼 ---
const p2 = (n: number) => String(n).padStart(2, "0");

export function kstToday(now: Date = new Date()): string {
  const k = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${k.getUTCFullYear()}-${p2(k.getUTCMonth() + 1)}-${p2(k.getUTCDate())}`;
}

// offset 0 = 이번 달, -1 = 지난달. 말일은 Date.UTC(y, m, 0) 로 구한다.
export function kstMonthPeriod(
  offset: number,
  now: Date = new Date()
): NonNullable<WorkLogPeriod> {
  const [y, m] = kstToday(now).split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const fy = first.getUTCFullYear();
  const fm = first.getUTCMonth() + 1;
  const last = new Date(Date.UTC(fy, fm, 0)).getUTCDate();
  return { from: `${fy}-${p2(fm)}-01`, to: `${fy}-${p2(fm)}-${p2(last)}` };
}
