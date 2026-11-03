// =====================================================================
// 홈페이지(onnainna.kr) 언론보도 게시 API — docs/API_홈페이지_보도자료.md, PRESS_AUTOMATION 3-8
//   * 서버 전용 모듈("use server" 아님). 브라우저 코드에서 import 하지 마세요 — 키가 새어 나갑니다.
//   * 이 파일은 API 호출만 합니다. DB(press_articles) 기록은 호출하는 쪽이 합니다.
//   * 키 선택: Vercel Production(VERCEL_ENV=production)에서만 live 키(ONNA_NEWS_API_KEY),
//     그 외(Preview·Development·로컬)는 항상 TEST 키(ONNA_NEWS_API_KEY_TEST).
//     TEST 범위에는 비공개 글만 올라가고 published 는 403 입니다.
//   * 키 값은 로그·오류 메시지·응답 어디에도 넣지 않습니다.
//   * 사이트의 User-Agent 차단 규칙 때문에 "Mozilla/5.0" 을 보냅니다(API 문서 지정값).
//   * 이미지가 있으면 Node 기본 FormData 로 보내고 Content-Type 은 직접 지정하지 않습니다
//     (지정하면 boundary 가 빠져 400 invalid_multipart).
// =====================================================================

export const HOMEPAGE_NEWS_ENDPOINT = "https://www.onnainna.kr/api/newsWrite";
const SITE_ORIGIN = "https://www.onnainna.kr";
const USER_AGENT = "Mozilla/5.0";
const TIMEOUT_MS = 15000;

// API 문서의 한도
export const HOMEPAGE_NEWS_LIMITS = {
  externalId: 100,
  title: 255,
  publisher: 100,
  sourceUrl: 2000,
  summary: 4000,
  imageBytes: 2_097_152,
  jsonBytes: 128 * 1024,
  multipartBytes: 2_228_224,
} as const;

export type HomepageScope = "test" | "live";
export type HomepageNewsStatus = "draft" | "published" | "deleted";

export type HomepageNewsPost = {
  no: number;
  external_id: string;
  status: HomepageNewsStatus;
  title: string;
  publisher: string;
  reported_date: string;
  source_url: string;
  summary: string;
  image_url: string; // 절대 주소로 바꿔 둡니다. 이미지 없으면 ""
  url: string;
  admin_url: string;
};

export type HomepageNewsCreateInput = {
  external_id: string;
  title: string;
  publisher: string;
  reported_date: string; // YYYY-MM-DD
  source_url: string;
  summary: string;
  status?: "draft" | "published";
  image?: { bytes: Uint8Array; filename: string; mime: string } | null;
};

export type HomepageNewsUpdateInput = {
  no: number;
  title?: string;
  publisher?: string;
  reported_date?: string;
  source_url?: string;
  summary?: string;
  status?: "draft" | "published";
  image?: HomepageNewsCreateInput["image"];
};

// 호출 실패. status 0 = 네트워크·타임아웃, -1 = JSON 아닌 응답(서버 차단 화면 등).
export class HomepageNewsError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly no: number | null = null,
    public readonly reference: string | null = null,
  ) {
    super(message);
    this.name = "HomepageNewsError";
  }
  // 같은 external_id 로 다시 보내도 되는 실패인지(문서: 타임아웃·500 은 재시도).
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

// 지금 환경에서 쓸 키와 범위. 키가 없으면 null — 호출부가 "설정 안 됨"으로 보여 줍니다.
export function homepageNewsConfig(): { scope: HomepageScope; key: string } | null {
  const live = process.env.VERCEL_ENV === "production";
  const key = (live ? process.env.ONNA_NEWS_API_KEY : process.env.ONNA_NEWS_API_KEY_TEST)?.trim();
  if (!key) return null;
  return { scope: live ? "live" : "test", key };
}

function absolutize(u: unknown): string {
  if (typeof u !== "string" || u === "") return "";
  return u.startsWith("/") ? SITE_ORIGIN + u : u;
}

function toPost(j: Record<string, unknown>): HomepageNewsPost {
  return {
    no: Number(j.no),
    external_id: String(j.external_id ?? ""),
    status: String(j.status ?? "") as HomepageNewsStatus,
    title: String(j.title ?? ""),
    publisher: String(j.publisher ?? ""),
    reported_date: String(j.reported_date ?? ""),
    source_url: String(j.source_url ?? ""),
    summary: String(j.summary ?? ""),
    image_url: absolutize(j.image_url),
    url: String(j.url ?? ""),
    admin_url: String(j.admin_url ?? ""),
  };
}

type Fields = Record<string, string | number | undefined>;

async function call(
  fields: Fields,
  image?: HomepageNewsCreateInput["image"],
): Promise<{ status: number; json: Record<string, unknown> }> {
  const cfg = homepageNewsConfig();
  if (!cfg) {
    throw new HomepageNewsError(401, "not_configured", "홈페이지 게시 키가 설정되지 않았습니다.");
  }

  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    clean[k] = typeof v === "number" ? String(v) : v;
  }

  const headers: Record<string, string> = { "X-API-Key": cfg.key, "User-Agent": USER_AGENT };
  let body: BodyInit;
  if (image) {
    if (image.bytes.byteLength > HOMEPAGE_NEWS_LIMITS.imageBytes) {
      throw new HomepageNewsError(413, "image_too_large", "이미지가 2MiB를 넘습니다.");
    }
    const form = new FormData();
    for (const [k, v] of Object.entries(clean)) form.set(k, v);
    form.set("image", new Blob([image.bytes as BlobPart], { type: image.mime }), image.filename);
    body = form; // Content-Type 은 fetch 가 boundary 와 함께 붙입니다.
  } else {
    // no 는 문서상 정수입니다.
    const json: Record<string, string | number> = { ...clean };
    if (clean.no !== undefined) json.no = Number(clean.no);
    body = JSON.stringify(json);
    headers["Content-Type"] = "application/json; charset=utf-8";
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(HOMEPAGE_NEWS_ENDPOINT, {
      method: "POST",
      headers,
      body,
      signal: ctrl.signal,
      cache: "no-store",
    });
  } catch (e) {
    const reason = e instanceof Error && e.name === "AbortError" ? "응답 시간 초과" : "연결 실패";
    throw new HomepageNewsError(0, "network", `홈페이지에 연결하지 못했습니다(${reason}).`);
  } finally {
    clearTimeout(timer);
  }

  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.toLowerCase().includes("application/json")) {
    // 웹서버 차단 규칙에 걸리면 JSON 대신 오류 화면이 옵니다.
    throw new HomepageNewsError(-1, "blocked", `홈페이지 서버가 요청을 거절했습니다(HTTP ${res.status}).`);
  }
  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new HomepageNewsError(-1, "bad_json", `홈페이지 응답을 읽지 못했습니다(HTTP ${res.status}).`);
  }
  if (!res.ok || json.ok === false) {
    throw new HomepageNewsError(
      res.status,
      String(json.error ?? "error"),
      String(json.message ?? `HTTP ${res.status}`),
      typeof json.no === "number" ? json.no : null,
      typeof json.reference === "string" ? json.reference : null,
    );
  }
  return { status: res.status, json };
}

export async function homepageNewsGet(no: number): Promise<HomepageNewsPost> {
  return toPost((await call({ action: "get", no })).json);
}

// 등록. 결과 kind:
//   created  — 새로 만들어짐(201)
//   existing — 같은 external_id 글이 이미 있음(409) → 그 글을 get 으로 읽어 돌려줌
// 타임아웃·500 이면 같은 external_id 로 한 번 더 보냅니다(문서 규칙 — 두 번 생기지 않음).
export async function homepageNewsCreate(
  input: HomepageNewsCreateInput,
): Promise<{ kind: "created" | "existing"; post: HomepageNewsPost }> {
  const fields: Fields = {
    action: "create",
    external_id: input.external_id,
    title: input.title,
    publisher: input.publisher,
    reported_date: input.reported_date,
    source_url: input.source_url,
    summary: input.summary,
    status: input.status ?? "draft",
  };
  for (let attempt = 0; ; attempt++) {
    try {
      const { json } = await call(fields, input.image);
      return { kind: "created", post: toPost(json) };
    } catch (e) {
      if (e instanceof HomepageNewsError && e.status === 409 && e.no !== null) {
        return { kind: "existing", post: await homepageNewsGet(e.no) };
      }
      if (e instanceof HomepageNewsError && e.retryable && attempt === 0) continue;
      throw e;
    }
  }
}

// 수정 — 보낸 칸만 바뀝니다. 이미지를 안 보내면 기존 이미지 유지.
export async function homepageNewsUpdate(input: HomepageNewsUpdateInput): Promise<HomepageNewsPost> {
  const { image, ...rest } = input;
  return toPost((await call({ action: "update", ...rest }, image)).json);
}

// 내리기 — 논리 삭제. 다시 지워도 200.
export async function homepageNewsDelete(no: number): Promise<{ no: number; status: string }> {
  const { json } = await call({ action: "delete", no });
  return { no: Number(json.no ?? no), status: String(json.status ?? "deleted") };
}

// 화면에 보여줄 한 줄 사유.
export function homepageNewsErrorText(e: unknown): string {
  if (!(e instanceof HomepageNewsError)) return "홈페이지 게시 중 알 수 없는 오류가 났습니다.";
  switch (e.status) {
    case 401:
      return "홈페이지 게시 키가 없거나 맞지 않습니다. 관장에게 알려 주세요.";
    case 403:
      return "이 환경에서는 공개 전환을 할 수 없습니다(테스트 키이거나 권한 없음).";
    case 404:
      return "홈페이지에서 글을 찾을 수 없습니다(삭제됐거나 범위 밖).";
    case 413:
      return "보낸 내용이나 이미지가 너무 큽니다.";
    case 415:
      return "이미지 형식을 받지 않습니다(JPG·PNG·GIF만).";
    default:
      return e.status >= 400 && e.status < 500
        ? `홈페이지가 거절했습니다: ${e.message}`
        : e.message;
  }
}
