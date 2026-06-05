// =====================================================================
// 결정적 KST 날짜/시간 포맷 — SSR↔CSR 하이드레이션 불일치 방지
//   * toLocaleString(locale) 은 서버(Node ICU)·브라우저 ICU 차이로 같은 시각을
//     다른 day-period(오후 vs PM)·구분자(공백 vs NBSP)로 렌더해 클라이언트
//     컴포넌트에서 하이드레이션 mismatch(렌더 에러)를 일으킵니다.
//   * 한국(KST)은 UTC+9 고정·DST 없음 → UTC ms 에 +9h 후 getUTC* 로 읽으면
//     어느 런타임에서도 동일한 문자열이 보장됩니다. (ExternalJudgesManager 의
//     formatDate 와 동일한 접근을 공용화)
// =====================================================================

function kstParts(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return {
    y: kst.getUTCFullYear(),
    mo: kst.getUTCMonth() + 1,
    da: kst.getUTCDate(),
    h: kst.getUTCHours(),
    mi: kst.getUTCMinutes(),
  };
}

const p2 = (n: number) => String(n).padStart(2, "0");

// "YYYY.MM.DD HH:mm" (24시간). year:false 면 "MM.DD HH:mm".
export function fmtKstDateTime(
  iso: string | null | undefined,
  opts: { year?: boolean } = {}
): string {
  const p = kstParts(iso);
  if (!p) return "-";
  const date =
    opts.year === false
      ? `${p2(p.mo)}.${p2(p.da)}`
      : `${p.y}.${p2(p.mo)}.${p2(p.da)}`;
  return `${date} ${p2(p.h)}:${p2(p.mi)}`;
}

// "YYYY.MM.DD" (시각 없음).
export function fmtKstDate(iso: string | null | undefined): string {
  const p = kstParts(iso);
  if (!p) return "-";
  return `${p.y}.${p2(p.mo)}.${p2(p.da)}`;
}
