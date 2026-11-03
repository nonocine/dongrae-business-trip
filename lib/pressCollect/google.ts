// 구글 뉴스 RSS 검색 — 보충. 키 없음. 서버 전용.
//   * https://news.google.com/rss/search?q="검색어" when:7d&hl=ko&gl=KR&ceid=KR:ko
//   * 링크는 news.google.com 경유 주소입니다. 실제 언론사 주소 찾기는 run 단계에서
//     (① 네이버 제목 검색 → ② 리다이렉트 따라가기 → ③ batchexecute 변환 → 실패하면 needs_check).
//   * 막히거나 오류가 나면 그 검색어만 건너뜁니다(호출부가 기록).

import { cleanText, decodeHtml } from "./text";

const TIMEOUT_MS = 12000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

export type GoogleNewsItem = {
  query: string;
  title: string; // " - 언론사" 꼬리를 뗀 제목
  link: string; // news.google.com/rss/articles/...
  outlet: string; // <source> 언론사 이름
  outletUrl: string; // <source url="..."> 언론사 홈 주소
  publishedAt: Date | null;
};

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return "";
  const cdata = m[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return decodeHtml(cdata ? cdata[1] : m[1]).trim();
}

export function parseGoogleNewsRss(xml: string, query: string): GoogleNewsItem[] {
  const out: GoogleNewsItem[] = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const source = b.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
    const outlet = source ? cleanText(source[2]) : "";
    const outletUrl = source ? (source[1].match(/url="([^"]+)"/i)?.[1] ?? "") : "";
    let title = cleanText(tag(b, "title"));
    if (outlet && title.endsWith(` - ${outlet}`)) title = title.slice(0, -(outlet.length + 3)).trim();
    const d = new Date(tag(b, "pubDate"));
    out.push({
      query,
      title,
      link: tag(b, "link"),
      outlet,
      outletUrl,
      publishedAt: Number.isNaN(d.getTime()) ? null : d,
    });
  }
  return out;
}

// windowOp: 최근 N일이면 "when:7d", 기간 비교 시험이면 "after:2026-09-01"
export async function searchGoogleNews(
  query: string,
  windowOp: string,
): Promise<{ items: GoogleNewsItem[]; error: string | null }> {
  const q = `"${query}" ${windowOp}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return { items: [], error: `HTTP ${res.status}` };
    const ctype = res.headers.get("content-type") ?? "";
    const xml = await res.text();
    if (!/xml|rss/i.test(ctype) && !xml.trimStart().startsWith("<?xml")) {
      return { items: [], error: "RSS 아님(차단 화면 추정)" };
    }
    return { items: parseGoogleNewsRss(xml, query), error: null };
  } catch (e) {
    return { items: [], error: e instanceof Error && e.name === "AbortError" ? "시간 초과" : "연결 실패" };
  } finally {
    clearTimeout(timer);
  }
}

// --- 구글 경유 주소 → 언론사 주소 (batchexecute) --------------------------
//   구글 뉴스 화면이 쓰는 내부 호출(공식 API 아님 — 공개 도구들이 쓰는 방식).
//   1) news.google.com/rss/articles/<id> 페이지에서 서명(data-n-a-sg)·시각(data-n-a-ts)을 읽고
//   2) batchexecute(Fbv4je, garturlreq)로 실제 주소를 받습니다.
//   구글이 방식을 바꾸면 null — 부르는 쪽이 needs_check 로 저장합니다. 절대 throw 하지 않습니다.
const BATCH_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute";

async function fetchText(url: string, init: RequestInit = {}): Promise<{ status: number; text: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": UA, ...(init.headers ?? {}) },
      signal: ctrl.signal,
      cache: "no-store",
    });
    // 지나치게 큰 응답은 읽지 않습니다(정상 응답은 수십 KB).
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > 2 * 1024 * 1024) return null;
    return { status: res.status, text: await res.text() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function decodeGoogleNewsLink(link: string): Promise<string | null> {
  let id: string;
  try {
    const u = new URL(link);
    if (!/(^|\.)news\.google\.com$/.test(u.hostname)) return null;
    id = u.pathname.split("/").filter(Boolean).pop() ?? "";
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return null;
  } catch {
    return null;
  }
  const page = await fetchText(`https://news.google.com/rss/articles/${id}`);
  if (!page || page.status !== 200) return null;
  const sg = page.text.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = page.text.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts || !/^\d+$/.test(ts)) return null;

  const inner = JSON.stringify([
    "garturlreq",
    [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id,
    Number(ts),
    sg,
  ]);
  const body = "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]));
  const r = await fetchText(BATCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
  });
  if (!r || r.status !== 200) return null;
  // 응답: )]}'\n\n[["wrb.fr","Fbv4je","[\"garturlres\",\"https://...\",1]",...],...]
  //   바깥 JSON → [0][2] 문자열 → 다시 JSON → [1] 이 주소(= 등 이스케이프 포함).
  try {
    const start = r.text.indexOf("[[");
    if (start < 0) return null;
    const outer = JSON.parse(r.text.slice(start)) as unknown[][];
    const row = outer.find((x) => Array.isArray(x) && x[0] === "wrb.fr" && x[1] === "Fbv4je");
    if (!row || typeof row[2] !== "string") return null;
    const res = JSON.parse(row[2]) as unknown[];
    if (res[0] !== "garturlres" || typeof res[1] !== "string") return null;
    const out = new URL(res[1]);
    if (out.protocol !== "http:" && out.protocol !== "https:") return null;
    if (/(^|\.)google\.com$/.test(out.hostname)) return null;
    return out.toString();
  } catch {
    return null;
  }
}
