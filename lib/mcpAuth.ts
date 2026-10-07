import { createHash, timingSafeEqual } from "node:crypto";

// =====================================================================
// MCP 엔드포인트 인증 — 환경변수 MCP_SECRET 과 일치할 때만 통과.
//   * 세션·쿠키와 무관합니다. 토큰만 맞으면 통과하므로, 노출 범위는 도구
//     쪽(lib/mcpTools)에서 읽기 전용·합계 위주로 좁혀 위험을 관리합니다.
//   * 두 경로를 같은 비교 함수로 검사합니다.
//     - POST /api/mcp            Authorization: Bearer <MCP_SECRET>
//     - POST /api/mcp/<MCP_SECRET>  (헤더를 못 보내는 클라이언트용 경로 토큰)
//   * 상수 시간 비교: 양쪽을 SHA-256 으로 같은 길이로 만든 뒤 timingSafeEqual.
//   * MCP_SECRET 이 없거나 32자 미만이면 항상 거부합니다(설정 누락으로
//     빈 값끼리 일치해 열리는 일을 막습니다).
//   * 비밀값·요청 경로를 로그에 남기지 않습니다.
// =====================================================================

const MIN_SECRET_LENGTH = 32;

function digest(v: string): Buffer {
  return createHash("sha256").update(v, "utf8").digest();
}

export function mcpSecretMatches(given: string | null | undefined): boolean {
  const secret = process.env.MCP_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) return false;
  if (!given) return false;
  return timingSafeEqual(digest(given), digest(secret));
}

export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

export function mcpUnauthorized(): Response {
  return Response.json(
    { error: "unauthorized", message: "MCP 토큰이 없거나 맞지 않습니다." },
    { status: 401 }
  );
}
