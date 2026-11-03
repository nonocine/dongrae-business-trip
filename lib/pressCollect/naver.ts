// 네이버 API HUB 뉴스 검색 — 주력. 서버 전용.
//   * 헤르메스와 같은 주소·헤더: https://naverapihub.apigw.ntruss.com/search/v1/news
//     X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY (환경변수 NAVER_API_HUB_ID / _KEY)
//   * sort=date, display=100. 기준일보다 오래된 결과가 나오면 다음 페이지를 부르지 않습니다.
//   * 키 값은 오류·로그에 넣지 않습니다.

import { PRESS_NAVER_MAX_START, PRESS_NAVER_PAGE_SIZE } from "./config";
import { cleanText } from "./text";

const ENDPOINT = "https://naverapihub.apigw.ntruss.com/search/v1/news";
const TIMEOUT_MS = 15000;

export type NaverNewsItem = {
  query: string;
  title: string;
  description: string;
  link: string; // 네이버 뉴스 주소(n.news.naver.com) 또는 원문
  originallink: string; // 언론사 원문 — 있으면 이것을 저장
  publishedAt: Date | null;
};

export function naverConfigured(): boolean {
  return !!(process.env.NAVER_API_HUB_ID?.trim() && process.env.NAVER_API_HUB_KEY?.trim());
}

export async function searchNaverNews(
  query: string,
  since: Date,
): Promise<{ items: NaverNewsItem[]; calls: number; error: string | null }> {
  const id = process.env.NAVER_API_HUB_ID?.trim();
  const key = process.env.NAVER_API_HUB_KEY?.trim();
  if (!id || !key) return { items: [], calls: 0, error: "네이버 키 없음" };

  const items: NaverNewsItem[] = [];
  let calls = 0;
  for (let start = 1; start <= PRESS_NAVER_MAX_START; start += PRESS_NAVER_PAGE_SIZE) {
    const params = new URLSearchParams({
      // 따옴표 = 정확히 일치. 실측(2026-11-03): "동래구청소년센터" 2,861건 → 64건,
      //   "조선놀이터" 22,193건 → 81건. 헤르메스가 찾은 기사는 그대로 잡히고 잡음·호출 수만 줄어듭니다.
      //   본문에만 있고 요약(description)에는 없는 경우가 있어, 그때는 filter 가 원문을 열어 확인합니다.
      query: `"${query}"`,
      display: String(PRESS_NAVER_PAGE_SIZE),
      start: String(start),
      sort: "date",
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let data: { items?: Array<Record<string, string>> };
    try {
      calls++;
      const res = await fetch(`${ENDPOINT}?${params}`, {
        headers: { "X-NCP-APIGW-API-KEY-ID": id, "X-NCP-APIGW-API-KEY": key },
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!res.ok) return { items, calls, error: `HTTP ${res.status}` };
      data = (await res.json()) as typeof data;
    } catch (e) {
      const reason = e instanceof Error && e.name === "AbortError" ? "시간 초과" : "연결 실패";
      return { items, calls, error: reason };
    } finally {
      clearTimeout(timer);
    }

    const page = data.items ?? [];
    let reachedOld = false;
    for (const it of page) {
      const d = it.pubDate ? new Date(it.pubDate) : null;
      const publishedAt = d && !Number.isNaN(d.getTime()) ? d : null;
      if (publishedAt && publishedAt < since) {
        reachedOld = true;
        continue;
      }
      items.push({
        query,
        title: cleanText(it.title),
        description: cleanText(it.description),
        link: (it.link ?? "").trim(),
        originallink: (it.originallink ?? "").trim(),
        publishedAt,
      });
    }
    if (reachedOld || page.length < PRESS_NAVER_PAGE_SIZE) break;
  }
  return { items, calls, error: null };
}

// 구글에서만 잡힌 기사의 실제 주소 찾기 — 제목 그대로(따옴표) 1회 검색.
export async function findNaverByTitle(title: string): Promise<{ item: NaverNewsItem | null; calls: number }> {
  const id = process.env.NAVER_API_HUB_ID?.trim();
  const key = process.env.NAVER_API_HUB_KEY?.trim();
  if (!id || !key) return { item: null, calls: 0 };
  const params = new URLSearchParams({ query: `"${title.slice(0, 80)}"`, display: "10", start: "1", sort: "sim" });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}?${params}`, {
      headers: { "X-NCP-APIGW-API-KEY-ID": id, "X-NCP-APIGW-API-KEY": key },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return { item: null, calls: 1 };
    const data = (await res.json()) as { items?: Array<Record<string, string>> };
    const it = (data.items ?? [])[0];
    if (!it) return { item: null, calls: 1 };
    const d = it.pubDate ? new Date(it.pubDate) : null;
    return {
      item: {
        query: title,
        title: cleanText(it.title),
        description: cleanText(it.description),
        link: (it.link ?? "").trim(),
        originallink: (it.originallink ?? "").trim(),
        publishedAt: d && !Number.isNaN(d.getTime()) ? d : null,
      },
      calls: 1,
    };
  } catch {
    return { item: null, calls: 1 };
  } finally {
    clearTimeout(timer);
  }
}
