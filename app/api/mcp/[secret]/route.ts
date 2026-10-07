import { dongraeMcpHandler } from "@/lib/mcpHandler";
import { mcpSecretMatches, mcpUnauthorized } from "@/lib/mcpAuth";

// Claude 커스텀 커넥터용 MCP 엔드포인트 — 경로 토큰(/api/mcp/<MCP_SECRET>).
//   커넥터 화면에 '요청 헤더' 칸이 없는 계정용입니다. 헤더 방식과 같은 비교
//   함수를 쓰고, 경로(비밀값)는 우리 코드에서 로그로 남기지 않습니다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(
  req: Request,
  { params }: { params: Promise<{ secret: string }> }
): Promise<Response> {
  const { secret } = await params;
  let given: string;
  try {
    given = decodeURIComponent(secret);
  } catch {
    return mcpUnauthorized(); // 잘못된 % 인코딩 — 500 대신 거부
  }
  if (!mcpSecretMatches(given)) return mcpUnauthorized();
  return dongraeMcpHandler(req);
}

export { handle as GET, handle as POST, handle as DELETE };
