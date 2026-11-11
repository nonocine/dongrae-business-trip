import "server-only";

// =====================================================================
// 온나인나 ERP 조회 API 클라이언트 — 서버 전용, GET(조회)만.
//   * 주소: {ERP_API_BASE}{api}?{params}  (예: .../api/employees?page_size=20)
//   * 인증: X-API-Key 헤더. 회계 API(transactions·expenditures)는 회계 키,
//     나머지는 일반 키. 키는 .env.local(ERP_API_KEY_GENERAL / ERP_API_KEY_ACCOUNTING)에만 둡니다.
//     ⚠️ 키를 로그·오류 문구·화면에 절대 싣지 않습니다(이 파일은 키를 헤더에만 씁니다).
//   * 응답: { result, count, truncated, next_cursor, data[], ... }.
//     truncated=true 면 next_cursor 를 cursor 로 넘겨 다음 페이지를 받습니다.
//     codes 는 data 대신 구역별 배열(budget_codes·departments …)로 옵니다 — body 를 그대로 씁니다.
//   * 오류: { result:"error", code, message } → ErpError(code). 문자열의 &#39; 등은 명세대로
//     ERP 가 이미 바꿔 보내므로 여기서 다시 풀지 않습니다.
//   * 기간 파라미터: start_date / end_date(YYYY-MM-DD, 둘 다 필요). 페이지: page_size(1~500)·cursor.
//     모르는 파라미터는 ERP 가 400 INVALID_PARAMETER 로 거절합니다.
// =====================================================================

export type ErpApi =
  | "employees"
  | "duties"
  | "leaveBalances"
  | "schedules"
  | "transactions"
  | "expenditures"
  | "rentals"
  | "codes"
  | "documents";

const ACCOUNTING_APIS: ReadonlySet<ErpApi> = new Set<ErpApi>(["transactions", "expenditures"]);

export class ErpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(`[ERP ${status} ${code}] ${message}`);
    this.name = "ErpError";
    this.status = status;
    this.code = code;
  }
}

export type ErpParams = Record<string, string | number | undefined | null>;

export type ErpPage<T = Record<string, unknown>> = {
  status: number;
  body: Record<string, unknown>; // 응답 전체(메타·codes 구역 포함)
  data: T[]; // data 배열(없으면 [])
  count: number;
  truncated: boolean;
  nextCursor: string | null; // 다음 페이지 cursor(없으면 null)
};

function config(api: ErpApi): { base: string; key: string } {
  const base = (process.env.ERP_API_BASE ?? "").trim();
  const key = (ACCOUNTING_APIS.has(api) ? process.env.ERP_API_KEY_ACCOUNTING : process.env.ERP_API_KEY_GENERAL) ?? "";
  if (!base) throw new ErpError(0, "CONFIG", "ERP_API_BASE 가 설정되지 않았습니다.");
  if (!key.trim())
    throw new ErpError(
      0,
      "CONFIG",
      ACCOUNTING_APIS.has(api) ? "ERP 회계 API 키가 설정되지 않았습니다." : "ERP 일반 API 키가 설정되지 않았습니다."
    );
  return { base: base.endsWith("/") ? base : `${base}/`, key: key.trim() };
}

function cursorOf(v: unknown): string | null {
  if (v == null || v === "" || v === false) return null;
  if (typeof v === "string" || typeof v === "number") return String(v);
  return null; // 객체 등 — 다음 페이지 없음으로 봅니다.
}

// 한 페이지 조회.
export async function erpGet<T = Record<string, unknown>>(
  api: ErpApi,
  params: ErpParams = {},
  opts: { timeoutMs?: number } = {}
): Promise<ErpPage<T>> {
  const { base, key } = config(api);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") qs.set(k, String(v));
  const url = `${base}${api}${qs.size ? `?${qs.toString()}` : ""}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { "X-API-Key": key, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
    });
  } catch (e) {
    throw new ErpError(0, "NETWORK", e instanceof Error ? e.message : "ERP 에 연결하지 못했습니다.");
  }

  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    const j = JSON.parse(text);
    body = j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!body) throw new ErpError(res.status, res.ok ? "NON_JSON" : `HTTP_${res.status}`, "ERP 응답을 읽지 못했습니다.");
  if (body.result === "error" || !res.ok) {
    throw new ErpError(
      res.status,
      typeof body.code === "string" ? body.code : `HTTP_${res.status}`,
      typeof body.message === "string" ? body.message : "ERP 오류"
    );
  }
  const data = Array.isArray(body.data) ? (body.data as T[]) : [];
  const truncated = body.truncated === true;
  return {
    status: res.status,
    body,
    data,
    count: typeof body.count === "number" ? body.count : data.length,
    truncated,
    nextCursor: truncated ? cursorOf(body.next_cursor) : null,
  };
}

// 여러 페이지를 이어 받습니다(next_cursor). maxPages 에서 멈추면 truncated=true 로 알려 줍니다.
export async function erpGetAll<T = Record<string, unknown>>(
  api: ErpApi,
  params: ErpParams = {},
  opts: { pageSize?: number; maxPages?: number; timeoutMs?: number } = {}
): Promise<{ data: T[]; pages: number; truncated: boolean }> {
  const pageSize = opts.pageSize ?? 500;
  const maxPages = opts.maxPages ?? 50;
  const out: T[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    const r: ErpPage<T> = await erpGet<T>(api, { ...params, page_size: pageSize, cursor }, { timeoutMs: opts.timeoutMs });
    out.push(...r.data);
    if (!r.truncated || !r.nextCursor) return { data: out, pages: page, truncated: false };
    // 같은 cursor 가 다시 오면 무한 반복을 막습니다.
    if (seen.has(r.nextCursor)) return { data: out, pages: page, truncated: true };
    seen.add(r.nextCursor);
    cursor = r.nextCursor;
  }
  return { data: out, pages: maxPages, truncated: true };
}
