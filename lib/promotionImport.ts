// =====================================================================
// 홍보실적 자동 수집 공용 유틸 — 인스타그램·블로그(·밴드 승인 후)가 함께 씁니다.
//   * 채널마다 API 는 다르지만 "게시일로 월을 정하고, 첫 줄 40자로 제목을 만든다"
//     는 규칙은 같습니다. 그 규칙만 여기에 모읍니다.
//   * DB 는 모릅니다(순수 함수) — 등록된 링크 조회 같은 DB 작업은 서버 액션
//     (app/business-results/actions.ts) 쪽에 둡니다. 그래야 토큰·네트워크 없이
//     scripts/test-instagram-import.ts 로 규칙만 검증할 수 있습니다.
// =====================================================================

const p2 = (n: number) => String(n).padStart(2, "0");

// 게시일 문자열 → KST 기준 "YYYY-MM-DD".
//   * 밤 9시 이후(UTC 기준 같은 날 낮)에 올린 글이 전날로 밀리지 않도록 +9h 합니다.
//   * 이름은 ISO 지만 Date.parse 가 읽는 형식이면 됩니다 — 인스타그램은 ISO 8601
//     (2026-07-15T20:10:00+0000), 네이버 블로그 RSS 는 RFC 822
//     (Wed, 02 Sep 2026 14:58:18 +0900) 로 옵니다. 둘 다 오프셋이 들어 있어
//     Date.parse 가 정확한 UTC 로 바꿔주므로 +9h 를 두 번 더하지 않습니다.
//   * 파싱할 수 없으면 빈 문자열(호출부에서 오늘 날짜 등으로 폴백).
export function kstYmdFromIso(timestamp: string): string {
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return "";
  const kst = new Date(ms + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${p2(kst.getUTCMonth() + 1)}-${p2(
    kst.getUTCDate(),
  )}`;
}

// 원문 → 홍보실적 제목. 첫 줄(빈 줄 건너뜀)을 40자까지 씁니다.
//   * 인스타그램은 캡션(여러 줄), 블로그는 RSS 제목(한 줄)이 들어옵니다.
//   * 원문이 비어 있으면 fallbackLabel + 날짜로 제목을 만듭니다
//     (사진만 올린 인스타그램 게시물 등).
const TITLE_MAX = 40;
export function promotionTitle(
  text: string,
  dateYmd: string,
  fallbackLabel: string,
): string {
  const firstLine =
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  if (!firstLine) return `${fallbackLabel} ${dateYmd || ""}`.trim();
  return firstLine.length > TITLE_MAX
    ? `${firstLine.slice(0, TITLE_MAX)}…`
    : firstLine;
}
