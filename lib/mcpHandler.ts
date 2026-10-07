import { createMcpHandler } from "mcp-handler";
import { registerDongraeTools } from "@/lib/mcpTools";

// 동업자씨 MCP 핸들러(Streamable HTTP, stateless) — 두 라우트가 공유합니다.
//   인증은 각 라우트(lib/mcpAuth)에서 먼저 확인한 뒤 이 핸들러로 넘깁니다.
export const dongraeMcpHandler = createMcpHandler(
  (server) => {
    registerDongraeTools(server);
  },
  {
    serverInfo: { name: "dongrae-business", version: "1.0.0" },
    verboseLogs: false,
  }
);
