import { dongraeMcpHandler } from "@/lib/mcpHandler";
import { bearerToken, mcpSecretMatches, mcpUnauthorized } from "@/lib/mcpAuth";

// Claude 커스텀 커넥터용 MCP 엔드포인트 — Authorization: Bearer <MCP_SECRET>.
//   기존 서버 함수(lib 로더)를 재사용하므로 Node 런타임입니다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request): Promise<Response> {
  if (!mcpSecretMatches(bearerToken(req))) return mcpUnauthorized();
  return dongraeMcpHandler(req);
}

export { handle as GET, handle as POST, handle as DELETE };
