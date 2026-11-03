// 수집 공용 문자열 도우미 — 순수 함수만.

const ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
  "&middot;": "·",
  "&hellip;": "…",
  "&lsquo;": "‘",
  "&rsquo;": "’",
  "&ldquo;": "“",
  "&rdquo;": "”",
};

export function decodeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, (m) => (m === "&amp;" ? m : ENTITIES[m.toLowerCase()] ?? m))
    .replace(/&amp;/g, "&");
}

// 태그·엔티티 제거 + 공백 정리 (네이버 title/description 의 <b> 등)
export function cleanText(s: string | null | undefined): string {
  return decodeHtml((s ?? "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

// 공백 무시 포함 검사 — 헤르메스 exact_match 와 같은 규칙.
export function containsLoose(text: string, term: string): boolean {
  return text.includes(term) || text.replace(/\s+/g, "").includes(term.replace(/\s+/g, ""));
}

// 같은 기사 판정용 URL. 추적 쿼리(utm_*, fbclid 등)와 #, 끝 / 를 떼고 호스트 소문자·www 제거.
//   글 번호가 쿼리에 있는 언론사가 많으므로(?idxno=, ?key=) 나머지 쿼리는 유지합니다.
//   http/https 차이도 같은 기사로 봅니다.
const TRACKING = /^(utm_|fbclid$|gclid$|ref$|from$|fromRss$|cmpid$|ncid$|rss$|sns$)/i;
export function urlKey(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k));
    params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const q = params.map(([k, v]) => `${k}=${v}`).join("&");
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${path}${q ? `?${q}` : ""}`;
  } catch {
    return raw.trim();
  }
}

export function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  } catch {
    return "";
  }
}

// 제목 비교 키 — 한글·영문·숫자만, 소문자. 언론사 머리표([단독] 등)는 뗍니다.
export function titleKey(title: string): string {
  return title
    .replace(/^\s*(\[[^\]]{1,12}\]|【[^】]{1,12}】)\s*/g, "")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "");
}

// 글자 2개 묶음 집합의 겹침 정도(0~1) — 같은 행사 묶기에 씁니다.
export function bigramJaccard(a: string, b: string): number {
  const grams = (s: string) => {
    const k = titleKey(s);
    const set = new Set<string>();
    for (let i = 0; i < k.length - 1; i++) set.add(k.slice(i, i + 2));
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

// KST 날짜 문자열
export function kstYmd(d: Date): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
