// 기사 원문 페이지 읽기 — 언론사 이름·기자·본문 앞부분. 서버 전용.
//   * 열기는 lib/pressImage.safeFetch(내부망 차단·리다이렉트 검사·크기 제한)를 씁니다.
//   * 문자셋: 응답 헤더 → <meta charset> 순. EUC-KR 언론사가 많습니다.
//   * 기자: 기사에 공개된 "홍길동 기자 hong@..." 형태만 읽습니다. 추측해서 채우지 않습니다.
//     이름만 확실하면 이름만, 둘 다 없으면 null.
//   * 본문은 판정(Haiku) 입력으로 앞 1500자만 씁니다. 저장·공유하지 않습니다.

import { safeFetch, PressImageError } from "@/lib/pressImage";
import { cleanText, decodeHtml } from "./text";

const MAX_HTML = 3 * 1024 * 1024;

export type ArticlePage = {
  finalUrl: string;
  siteName: string | null; // og:site_name 등에서 정리한 언론사 이름
  reporterName: string | null;
  reporterEmail: string | null;
  bodyHead: string; // 본문 앞부분(최대 1500자) — Haiku 입력
  bodyText: string; // 본문 전체 — 검색어가 요약에 없을 때 본문에 있는지 확인용(저장·공유 안 함)
};

function detectCharset(contentType: string, head: Uint8Array): string {
  const fromHeader = contentType.match(/charset=([\w-]+)/i)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const ascii = new TextDecoder("latin1").decode(head.slice(0, 4096));
  const fromMeta =
    ascii.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1] ??
    ascii.match(/content\s*=\s*["'][^"']*charset=([\w-]+)/i)?.[1];
  return (fromMeta ?? "utf-8").toLowerCase();
}

function decodeBody(bytes: Uint8Array, charset: string): string {
  const name = /^(ks_c_5601-1987|euc-kr|cp949|ms949|x-windows-949)$/i.test(charset) ? "euc-kr" : charset;
  try {
    return new TextDecoder(name).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function metaContent(html: string, keys: string[]): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const k = (tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1] ?? "").toLowerCase();
    if (!keys.includes(k)) continue;
    const v = tag.match(/\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i);
    const val = v ? decodeHtml(v[1] ?? v[2] ?? "").trim() : "";
    if (val) return val;
  }
  return null;
}

// "국제신문 - kookje.co.kr", "부산일보 | 부산의 대표 정론지" → 앞부분만
export function cleanSiteName(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.split(/\s+[-|:·]\s+|\s*\|\s*/)[0].trim();
  if (!s || s.length > 30 || /^https?:/i.test(s) || /\.(com|kr|net|co)\b/i.test(s)) return null;
  return s;
}

// 본문 텍스트(스크립트·스타일·주석 제거). 기사 영역 태그가 있으면 그 안만.
function articleText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|iframe|svg)\b[\s\S]*?<\/\1>/gi, " ");
  const area =
    stripped.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ??
    stripped.match(/<div[^>]+(?:id|class)\s*=\s*["'][^"']*(?:article[-_]?(?:body|view|txt|content)|news[-_]?(?:body|content|text)|view[-_]?(?:con|content|text)|articleBody|newsct_article|news_bm|user-snb|txt_wrap)[^"']*["'][\s\S]*$/i)?.[0] ??
    stripped;
  return cleanText(area.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n"));
}

// 기자로 보기 어려운 말(이름 자리에 오면 버림)
const NOT_NAME = new Set([
  "취재", "사진", "영상", "인턴", "수습", "객원", "선임", "전문", "기획", "편집", "본지", "특별", "디지털",
  "온라인", "뉴스", "보도", "담당", "인터넷", "지역", "사회부", "기자", "글", "정리", "부산", "동래",
]);
// 기자 메일로 보기 어려운 주소
const GENERIC_MAIL = /^(webmaster|master|admin|news|newsroom|press|jebo|jebo\d*|help|info|contact|desk|editor|ad|copyright|privacy|kookje|busan|yna|reporter|tip|cs|support|biz)@/i;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const NAME = "([가-힣]{2,4})";
const TITLE = "(?:기자|특파원|선임기자|객원기자|수습기자|전문기자|선임기자)";

// 기자 추출 순서 (실측 언론사 8곳 기준 — 국제신문·부산일보·국제뉴스·파이낸셜뉴스·연합뉴스·국토일보·파이낸스투데이·대한경제)
//   1) 메타 태그(author, dable:author, og:article:author …) 이름. "부산=이동훈 기자" → 이동훈.
//      값 안에 메일이 있으면 그 메일(부산일보: "김지영 bbang16@busan.com").
//   2) 이름이 있으면 HTML 에서 그 이름과 가장 가까운(400자 안) 메일 — 머리 기사정보의 mailto 가 여기서 잡힘.
//   3) 메타가 없으면 페이지 글자에서 "홍길동 기자 hong@…" 짝.
//   4) 그래도 없으면 본문 영역의 "홍길동 기자"(이름만).
//   * 바닥글 대표 메일(webmaster@, "mail to", "Copyright" 근처)·광고 스크립트 메일은 버립니다.
//   * 연합뉴스 보도자료(RPR) 배포 기사는 기자가 쓴 기사가 아니라 비워 둡니다.
// "mail to"(띄어 씀)은 바닥글 문구, "mailto:"(붙여 씀)는 기자 링크라 구분합니다.
const FOOTER_CTX = /(mail\s+to\b|copyright|ⓒ|©|이메일\s*[:：]|문의|제보|광고|구독|webmaster|dable|support)/i;
const AUTHOR_KEYS = ["author", "dable:author", "og:article:author", "article:author", "dd:author", "byl", "dc.creator", "twitter:creator"];

function nameFromMeta(raw: string): { name: string | null; email: string | null } {
  if (!raw || /^https?:/i.test(raw)) return { name: null, email: null };
  const email = raw.match(EMAIL)?.[0]?.toLowerCase() ?? null;
  const cleaned = raw
    .replace(EMAIL, " ")
    .replace(/^.*=\s*/, "") // "부산=이동훈 기자"
    .replace(/\s*(기자|특파원|객원기자|선임기자|수습기자|전문기자).*$/, "")
    .trim();
  const name = /^[가-힣]{2,4}$/.test(cleaned) && !NOT_NAME.has(cleaned) ? cleaned : null;
  return { name, email: email && !GENERIC_MAIL.test(email) ? email : null };
}

// HTML 안의 메일들(바닥글·스크립트 제외)과 위치
function mailPositions(html: string): Array<{ email: string; at: number }> {
  const out: Array<{ email: string; at: number }> = [];
  for (const m of html.matchAll(EMAIL)) {
    const email = m[0].toLowerCase();
    if (GENERIC_MAIL.test(email) || /\.(png|jpe?g|gif|webp|svg)$/i.test(email)) continue;
    const before = html.slice(Math.max(0, (m.index ?? 0) - 150), m.index ?? 0);
    if (FOOTER_CTX.test(before)) continue;
    out.push({ email, at: m.index ?? 0 });
  }
  return out;
}

export function extractReporter(
  html: string,
  text: string,
  url = "",
): { name: string | null; email: string | null } {
  if (/yna\.co\.kr\/view\/RPR/i.test(url)) return { name: null, email: null };
  const okName = (n: string | null | undefined) => (n && !NOT_NAME.has(n) ? n : null);
  const mails = mailPositions(html);

  // 1)·2) 메타 이름 → 가장 가까운 메일
  for (const key of AUTHOR_KEYS) {
    const meta = nameFromMeta(metaContent(html, [key]) ?? "");
    if (!meta.name) continue;
    if (meta.email) return meta;
    let best: { email: string; d: number } | null = null;
    for (let i = html.indexOf(meta.name); i >= 0; i = html.indexOf(meta.name, i + 1)) {
      for (const m of mails) {
        const d = Math.abs(m.at - i);
        if (d <= 400 && (!best || d < best.d)) best = { email: m.email, d };
      }
    }
    return { name: meta.name, email: best?.email ?? null };
  }

  // 3) 페이지 글자의 "이름 기자 메일" 짝 (앞에 한글이 붙은 경우 제외: "부산김옥찬" 같은 오인 방지)
  const page = cleanText(html.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " "));
  const pair = new RegExp(`(?<![가-힣])${NAME}\\s*${TITLE}\\s*[\\(\\[<=:/·]?\\s*(${EMAIL.source})`, "g");
  for (const m of page.matchAll(pair)) {
    const n = okName(m[1]);
    const e = m[2].toLowerCase();
    if (n && !GENERIC_MAIL.test(e)) return { name: n, email: e };
  }

  // 4) 본문 영역의 이름만
  const nameOnly = new RegExp(`(?<![가-힣])${NAME}\\s*${TITLE}(?![가-힣])`, "g");
  const names = [...text.matchAll(nameOnly)].map((m) => okName(m[1])).filter((n): n is string => !!n);
  return { name: names.length > 0 ? names[names.length - 1] : null, email: null };
}

export async function readArticlePage(url: string): Promise<ArticlePage> {
  const page = await safeFetch(url, "text/html,application/xhtml+xml", MAX_HTML);
  const html = decodeBody(page.bytes, detectCharset(page.contentType, page.bytes));
  const text = articleText(html);
  const r = extractReporter(html, text, page.url);
  return {
    finalUrl: page.url,
    siteName: cleanSiteName(metaContent(html, ["og:site_name", "twitter:site", "application-name"])),
    reporterName: r.name,
    reporterEmail: r.email,
    bodyHead: text.slice(0, 1500),
    bodyText: text,
  };
}

export { PressImageError as ArticleFetchError };
