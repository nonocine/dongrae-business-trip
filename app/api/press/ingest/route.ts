import { hermesTokenMatches, hermesUnauthorized, HERMES_TOKEN_HEADER } from "@/lib/pressIngestAuth";
import { ingestPressItem, type PressIngestResult } from "@/lib/pressIngest";
import { PRESS_BATCH_MAX, validateIngestItem } from "@/lib/press";

// =====================================================================
// 헤르메스 전용 입구 — POST /api/press/ingest (docs/PRESS_AUTOMATION.md 3-3)
//   * 로그인 세션 없이 열립니다. 대신 x-hermes-token 헤더가 HERMES_INGEST_TOKEN
//     과 같아야 하고, 다르거나 미설정이면 본문을 읽기 전에 401 로 끝냅니다.
//     (이 프로젝트에는 인증 미들웨어/proxy 가 없습니다 — 다른 /api 라우트도
//      각자 확인합니다. 그래서 '예외 목록' 없이 이 라우트가 직접 막습니다.)
//   * 본문 두 형식
//       단건: { article, reporter }            → 200 결과 / 400 검증 실패
//       배열: { items: [{article, reporter}] } → 200 { results: [...] } (최대 50건)
//             건별로 검증·처리하고, 실패한 건은 그 칸에 ok:false 와 이유를 담습니다.
//   * 토큰·본문은 로그에 남기지 않습니다. 오류 로그는 DB 오류 문구만.
// =====================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 50건 × 기사 1건(수 KB) 이면 충분합니다.
const MAX_BODY_BYTES = 256 * 1024;

type ItemOutcome =
  | ({ ok: true } & PressIngestResult)
  | { ok: false; status: 400 | 500; error: string };

function badRequest(message: string): Response {
  return Response.json({ error: "bad_request", message }, { status: 400 });
}

async function processOne(raw: unknown): Promise<ItemOutcome> {
  const v = validateIngestItem(raw);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  try {
    return { ok: true, ...(await ingestPressItem(v.item)) };
  } catch (e) {
    console.error("[press-ingest] 처리 실패:", e instanceof Error ? e.message : e);
    return { ok: false, status: 500, error: "저장 중 오류가 났습니다. 다시 보내 주세요." };
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!hermesTokenMatches(req.headers.get(HERMES_TOKEN_HEADER))) {
    return hermesUnauthorized();
  }

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return badRequest("본문이 너무 큽니다.");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return badRequest("본문이 너무 큽니다.");

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return badRequest("JSON 형식이 아닙니다.");
  }

  if (body && typeof body === "object" && !Array.isArray(body) && "items" in body) {
    const items = (body as { items: unknown }).items;
    if (!Array.isArray(items) || items.length === 0) {
      return badRequest("items 는 기사 1건 이상의 배열이어야 합니다.");
    }
    if (items.length > PRESS_BATCH_MAX) {
      return badRequest(`items 는 한 번에 ${PRESS_BATCH_MAX}건까지입니다.`);
    }
    // 같은 기자의 기사가 여러 건일 수 있어 차례로 처리합니다(기사 수 갱신 순서 보장).
    const results: ItemOutcome[] = [];
    for (const raw of items) results.push(await processOne(raw));
    return Response.json({ results });
  }

  const one = await processOne(body);
  if (!one.ok) {
    return Response.json(
      { error: one.status === 400 ? "bad_request" : "server_error", message: one.error },
      { status: one.status }
    );
  }
  return Response.json({ ...one, ok: undefined });
}
