// =====================================================================
// 홈페이지 보도자료 가져오기 — 공개 RSS
//   * 센터 홈페이지 보도자료 게시판(onnainna.kr/community/news_board)의 글을
//     읽어 홍보실적으로 등록합니다. 네이버 블로그와 같은 원칙 —
//     [가져오기] 한 번에 아직 등록 안 된 것이 전부 들어가고, 사람이 고르지 않습니다.
//   * 구조는 lib/naverBlogApi.ts 와 같습니다. 파서만 이 피드 실물에 맞췄습니다.
//   * RSS 는 공개 주소라 토큰·인증이 없습니다. 그래서 인스타그램과 달리
//     "설정됨" 판정이 필요 없고 버튼도 항상 보입니다.
//   * 실패는 throw 합니다 — 사용자가 직접 누른 동작이라 조용히 넘기면 안 됩니다.
//     대신 이 기능만 막히고 다른 화면은 그대로입니다.
//   * 캐시하지 않습니다(누를 때마다 최신 목록).
//   * 서버 전용 모듈("use server" 아님) — 서버 액션이 import 합니다.
//   * 게시일(pubDate)은 RFC 822(+0900) 로 옵니다. 월 배정은 공용 규칙
//     (lib/promotionImport.ts 의 kstYmdFromIso)에 맡깁니다.
//
//   ★ 이 피드는 최근 20건만 내려줍니다(실측 2026-09-10: item 20개, 게시판
//     총 187번글까지 존재). 그래서 [가져오기]로 들어오는 건수가 게시판 전체보다
//     적은 것이 정상입니다. 과거분 소급 등록은 이번 범위가 아니며, 필요하면
//     별건으로 게시판 페이지를 훑는 방식을 검토해야 합니다(RSS 로는 안 됩니다).
// =====================================================================

const FEED_URL = "https://www.onnainna.kr/community/news_rss";
const TIMEOUT_MS = 8000;

// 이 피드는 User-Agent 로 요청을 걸러냅니다 — curl 기본 UA 는 403 이고,
//   UA 를 아무 값이나 넣으면 200 입니다(실측). Node fetch 는 기본 UA 를
//   보내 지금은 그냥도 통하지만, 서버쪽 차단 목록이나 런타임 기본값이
//   바뀌면 조용히 403 이 될 자리라 우리 UA 를 명시해 둡니다.
const USER_AGENT = "dongrae-business-trip/1.0 (+https://www.onnainna.kr)";

// 화면에 그대로 보여줄 수 있는 안내 문구.
const FAILED = "홈페이지 보도자료 연결에 문제가 있습니다. 관리자에게 문의해 주세요.";

export type HomepageNewsItem = {
  // 중복 방지 키. 이 피드는 guid 가 isPermaLink="true" 로 link 와 같은
  //   주소입니다(예: .../news_board_view?no=187).
  guid: string;
  title: string;
  // 홍보실적 url 로 저장할 주소 — 중복 판정도 이 값으로 합니다.
  link: string;
  // RFC 822 (예: "Fri, 04 Sep 2026 17:40:30 +0900")
  pubDate: string;
};

// XML 엔티티·CDATA 를 벗겨 사람이 읽는 문자열로.
//   (lib/naverBlogApi.ts unwrap 과 동일 규칙)
function unwrap(raw: string): string {
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  const text = cdata ? cdata[1] : raw;
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // &amp; 는 다른 엔티티를 되살린 뒤 마지막에 풀어야 이중 디코딩이 안 됩니다.
    .replace(/&amp;/g, "&")
    .trim();
}

// <item> 블록에서 태그 하나를 뽑습니다. 첫 매치만 씁니다.
function tagText(block: string, name: string): string {
  const m = block.match(
    new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"),
  );
  return m ? unwrap(m[1]) : "";
}

// 주소 정규화.
//   ★ 블로그(lib/naverBlogApi.ts canonicalLink)와 결정적으로 다릅니다:
//     블로그는 추적 쿼리(?fromRss=true)를 떼야 했지만, 이 피드는 글 번호가
//     쿼리에 들어 있습니다(.../news_board_view?no=187). 쿼리를 떼면 20건이
//     전부 같은 주소(.../news_board_view)로 접혀 ①서로 다른 글이 중복으로
//     걸러지고 ②첫 1건만 등록됩니다. 그래서 쿼리는 절대 건드리지 않습니다.
//   해시(#)만 떼어냅니다 — 글을 가리키는 값이 아니고, 붙어 오면 같은 글이
//     다른 주소로 보여 중복 판정이 빗나갑니다.
function normalizeLink(link: string): string {
  return link.split("#")[0].trim();
}

// 최근 글 목록. 실패는 throw — 호출부(서버 액션)가 메시지를 그대로 씁니다.
export async function fetchHomepageNewsFeed(): Promise<HomepageNewsItem[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(FEED_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml" },
      signal: ctrl.signal,
      cache: "no-store",
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : "요청 실패";
    console.warn("[homepage-news] 요청 실패:", reason);
    throw new Error(`${FAILED} (사유: ${reason})`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    console.warn("[homepage-news] 응답 오류:", res.status);
    throw new Error(`${FAILED} (사유: HTTP ${res.status})`);
  }

  const xml = await res.text();
  return parseHomepageNewsFeed(xml);
}

// XML → 글 목록. 네트워크와 떼어놔야 테스트할 수 있어 따로 뺐습니다.
//   * <channel> 에도 title·link·pubDate 가 있어 반드시 <item> 안에서만 찾습니다.
//   * description 은 쓰지 않습니다. 지금은 빈 값으로 오지만, 나중에 본문이
//     채워졌을 때 그 안의 <link>·<title> 이 파싱을 흔들지 않도록 먼저 지웁니다.
//   * enclosure·media:content·media:thumbnail 은 닫는 태그가 없는 자기완결
//     태그라 tagText 정규식(<x>…</x>)에 걸리지 않습니다 — 따로 손대지 않습니다.
export function parseHomepageNewsFeed(xml: string): HomepageNewsItem[] {
  const items: HomepageNewsItem[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1].replace(
      /<description\b[^>]*>[\s\S]*?<\/description>/gi,
      "",
    );
    const link = normalizeLink(tagText(block, "link"));
    const rawGuid = normalizeLink(tagText(block, "guid"));
    // 중복 방지 키 — guid 가 있으면 guid, 없으면 link.
    //   단, 저장되는 곳이 business_promotions.url(중복 판정 컬럼이자 화면의
    //   링크)이므로 주소 형태일 때만 guid 를 씁니다. 업체가 guid 를 주소가
    //   아닌 내부 식별자로 바꾸면 링크가 깨지므로 그때는 link 로 물러납니다.
    const guid = /^https?:\/\//i.test(rawGuid) ? rawGuid : link;
    const title = tagText(block, "title");
    // 주소가 없으면 등록해도 중복 판정을 못 합니다 — 제외(블로그·인스타와 동일).
    if (!guid) continue;
    items.push({
      guid,
      title,
      link: guid,
      pubDate: tagText(block, "pubDate"),
    });
  }
  return items;
}
