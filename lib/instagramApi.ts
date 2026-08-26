// =====================================================================
// 인스타그램 게시물 가져오기 — Instagram API with Instagram Login
//   * 센터 계정(@onnainna7942)의 최근 게시물을 읽어 홍보실적 등록 후보로 씁니다.
//     자동 등록이 아니라 "후보 목록"만 만들고, 무엇을 등록할지는 사람이 고릅니다.
//   * 엔드포인트(Meta 문서 기준):
//       GET https://graph.instagram.com/{version}/me/media
//           ?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp
//     - Instagram Basic Display API 는 2024 년에 종료됐고, 지금은 Instagram
//       Login 방식이 같은 graph.instagram.com 호스트를 씁니다.
//     - thumbnail_url 은 VIDEO 에만 옵니다. media_url 은 저작권 신고된 게시물에서
//       빠질 수 있어, 썸네일은 (thumbnail_url → media_url → 없음) 순으로 봅니다.
//     - timestamp 는 ISO 8601(UTC) — 화면·DB 에는 KST 날짜로 바꿔 씁니다.
//   * ⚠️ 토큰(INSTAGRAM_ACCESS_TOKEN)은 서버에서만 읽고, 로그·에러 메시지·화면
//     어디에도 값이 실리지 않게 합니다. 밖으로 나가는 문자열은 redact() 를 한 번
//     통과시킵니다(요청 URL 을 그대로 찍는 코드를 두지 마세요).
//   * 실패는 throw 합니다 — 알림(슬랙)과 달리 사용자가 직접 누른 동작이라 조용히
//     넘기면 안 됩니다. 대신 이 기능만 막히고 다른 화면은 그대로입니다.
//   * 캐시하지 않습니다(누를 때마다 최신 목록).
//   * 서버 전용 모듈("use server" 아님) — 서버 액션이 import 합니다.
// =====================================================================

// Meta 문서 기준 현행 버전. 새 버전이 나오면 이 상수만 올리면 됩니다.
const API_VERSION = "v25.0";
const HOST = "https://graph.instagram.com";
const FIELDS =
  "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp";
// 최근 게시물만 봅니다(Meta 기본 페이지네이션 범위). 더 옛날 것은 수기 입력.
const LIMIT = 25;
const TIMEOUT_MS = 8000;

// 화면에 그대로 보여줄 수 있는 안내 문구(원인 문자열은 항상 redact 통과).
const NOT_CONFIGURED =
  "인스타그램 가져오기가 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.";
const FAILED = "인스타그램 연결에 문제가 있습니다. 관리자에게 문의해 주세요.";

export type InstagramMedia = {
  id: string;
  caption: string;
  // IMAGE | VIDEO | CAROUSEL_ALBUM
  mediaType: string;
  // 목록에 띄울 썸네일. 없을 수 있습니다(저작권 신고·앨범 등).
  thumbnailUrl: string | null;
  permalink: string;
  // ISO 8601 (UTC)
  timestamp: string;
};

// 토큰이 있어야 버튼을 띄웁니다(없으면 아예 안 보이게).
export function isInstagramConfigured(): boolean {
  return Boolean(process.env.INSTAGRAM_ACCESS_TOKEN?.trim());
}

// ⚠️ 밖으로 나가는 모든 문자열의 마지막 방어선 — 토큰 값과 access_token 파라미터를
//    지웁니다. 로그·에러 메시지 어느 쪽이든 이걸 통과시킨 뒤에 씁니다.
export function redact(text: string): string {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  const withoutToken = token ? text.split(token).join("***") : text;
  return withoutToken.replace(/access_token=[^&\s"']+/gi, "access_token=***");
}

const p2 = (n: number) => String(n).padStart(2, "0");

// ISO 8601(UTC) → KST 기준 "YYYY-MM-DD".
//   밤 9시 이후(UTC 기준 같은 날 낮)에 올린 글이 전날로 밀리지 않도록 +9h 합니다.
//   파싱할 수 없으면 빈 문자열(호출부에서 오늘 날짜 등으로 폴백).
export function instagramKstYmd(timestamp: string): string {
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return "";
  const kst = new Date(ms + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${p2(kst.getUTCMonth() + 1)}-${p2(
    kst.getUTCDate(),
  )}`;
}

// 캡션 → 홍보실적 제목. 첫 줄(빈 줄 건너뜀)을 40자까지 씁니다.
//   캡션이 없는 게시물(사진만 올린 경우)은 날짜로 제목을 만듭니다.
const TITLE_MAX = 40;
export function instagramTitle(caption: string, dateYmd: string): string {
  const firstLine =
    caption
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  if (!firstLine) return `인스타그램 게시물 ${dateYmd || ""}`.trim();
  return firstLine.length > TITLE_MAX
    ? `${firstLine.slice(0, TITLE_MAX)}…`
    : firstLine;
}

function toMedia(raw: Record<string, unknown>): InstagramMedia {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  // 썸네일: 동영상은 thumbnail_url, 사진은 media_url. 둘 다 없으면 null.
  const thumb = str(raw.thumbnail_url) || str(raw.media_url);
  return {
    id: str(raw.id),
    caption: str(raw.caption),
    mediaType: str(raw.media_type) || "IMAGE",
    thumbnailUrl: thumb || null,
    permalink: str(raw.permalink),
    timestamp: str(raw.timestamp),
  };
}

// 응답 본문에서 사람이 읽을 수 있는 원인만 뽑습니다(토큰이 섞일 여지 차단).
function errorReason(body: unknown, status: number): string {
  const err = (body as { error?: Record<string, unknown> } | null)?.error;
  if (err) {
    const message = typeof err.message === "string" ? err.message : "";
    const type = typeof err.type === "string" ? err.type : "";
    const code = err.code === undefined ? "" : String(err.code);
    const parts = [message, type && `type ${type}`, code && `code ${code}`]
      .filter(Boolean)
      .join(", ");
    if (parts) return parts;
  }
  return `HTTP ${status}`;
}

// 최근 게시물 목록. 실패는 throw — 호출부(서버 액션)가 메시지를 그대로 씁니다.
export async function fetchRecentInstagramMedia(): Promise<InstagramMedia[]> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  if (!token) throw new Error(NOT_CONFIGURED);

  const url =
    `${HOST}/${API_VERSION}/me/media` +
    `?fields=${encodeURIComponent(FIELDS)}` +
    `&limit=${LIMIT}` +
    `&access_token=${encodeURIComponent(token)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
  } catch (e) {
    // ⚠️ fetch 실패 메시지에 요청 URL 이 섞일 수 있어 반드시 redact 합니다.
    const reason = redact(e instanceof Error ? e.message : "요청 실패");
    console.warn("[instagram] 요청 실패:", reason);
    throw new Error(`${FAILED} (사유: ${reason})`);
  } finally {
    clearTimeout(timer);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok || (body as { error?: unknown } | null)?.error) {
    const reason = redact(errorReason(body, res.status));
    console.warn("[instagram] 응답 오류:", reason);
    throw new Error(`${FAILED} (사유: ${reason})`);
  }

  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => toMedia(row as Record<string, unknown>))
    // permalink 가 없으면 등록해도 링크가 비어 중복 판정도 못 합니다 — 제외.
    .filter((m) => m.id && m.permalink);
}
