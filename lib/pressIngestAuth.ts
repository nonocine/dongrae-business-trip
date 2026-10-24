import { createHash, timingSafeEqual } from "node:crypto";

// =====================================================================
// 헤르메스 입구(POST /api/press/ingest) 인증 — 헤더 x-hermes-token 이
//   환경변수 HERMES_INGEST_TOKEN 과 같을 때만 통과. (선례: lib/mcpAuth.ts)
//   * 세션·쿠키와 무관합니다. 대신 입구가 할 수 있는 일은 기자·기사 추가와
//     자동 칸 갱신, 언론보도 실적 1줄뿐입니다(lib/pressIngest.ts).
//   * 상수 시간 비교: 양쪽을 SHA-256 으로 같은 길이로 만든 뒤 timingSafeEqual.
//   * 토큰이 없거나 32자 미만이면 항상 거부합니다(설정 누락으로 빈 값끼리
//     일치해 열리는 일을 막습니다).
//   * 토큰 값은 로그·응답에 남기지 않습니다.
// =====================================================================

export const HERMES_TOKEN_HEADER = "x-hermes-token";
const MIN_TOKEN_LENGTH = 32;

function digest(v: string): Buffer {
  return createHash("sha256").update(v, "utf8").digest();
}

export function hermesTokenMatches(given: string | null | undefined): boolean {
  const token = process.env.HERMES_INGEST_TOKEN ?? "";
  if (token.length < MIN_TOKEN_LENGTH) return false;
  if (!given) return false;
  return timingSafeEqual(digest(given), digest(token));
}

export function hermesUnauthorized(): Response {
  return Response.json(
    { error: "unauthorized", message: "입구 토큰이 없거나 맞지 않습니다." },
    { status: 401 }
  );
}
