// =====================================================================
// 네이버 블로그 게시물 가져오기 — 공개 RSS
//   * 센터 블로그(blog.naver.com/onnainna)의 최근 글을 읽어 홍보실적으로
//     등록합니다. 인스타그램과 같은 원칙 — [가져오기] 한 번에 아직 등록 안 된
//     것이 전부 들어가고, 사람이 고르지 않습니다.
//   * RSS 는 공개 주소라 토큰·인증이 없습니다. 그래서 인스타그램과 달리
//     "설정됨" 판정이 필요 없고 버튼도 항상 보입니다.
//   * 실패는 throw 합니다 — 사용자가 직접 누른 동작이라 조용히 넘기면 안 됩니다.
//     대신 이 기능만 막히고 다른 화면은 그대로입니다.
//   * 캐시하지 않습니다(누를 때마다 최신 목록).
//   * 서버 전용 모듈("use server" 아님) — 서버 액션이 import 합니다.
//   * 게시일(pubDate)은 RFC 822(+0900) 로 옵니다. 월 배정은 공용 규칙
//     (lib/promotionImport.ts 의 kstYmdFromIso)에 맡깁니다.
// =====================================================================

const FEED_URL = "https://rss.blog.naver.com/onnainna.xml";
const TIMEOUT_MS = 8000;

// 화면에 그대로 보여줄 수 있는 안내 문구.
const FAILED = "네이버 블로그 연결에 문제가 있습니다. 관리자에게 문의해 주세요.";

export type NaverBlogItem = {
  // 글 고유값. RSS 에서는 쿼리 없는 정규 주소로 옵니다.
  guid: string;
  title: string;
  // 홍보실적 url 로 저장할 주소 — 아래 canonicalLink() 로 정규화한 값입니다.
  link: string;
  // RFC 822 (예: "Wed, 02 Sep 2026 14:58:18 +0900")
  pubDate: string;
  // 블로그 자체 분류(방과후아카데미·언론보도 등). 홍보실적 구분과는 별개이고
  //   지금은 저장하지 않습니다 — 나중에 쓸 수 있어 그대로 넘겨둡니다.
  category: string;
};

// XML 엔티티·CDATA 를 벗겨 사람이 읽는 문자열로.
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

// RSS 의 link 에는 유입경로 추적 쿼리(?fromRss=true&trackingCode=rss)가 붙어
//   옵니다. 중복 판정이 url 문자열 일치 기준이라, 이걸 그대로 저장하면
//   ①직원이 수기로 붙여넣은 같은 글의 주소와 다른 값이 되고 ②네이버가
//   추적 파라미터를 바꾸면 같은 글이 다시 등록됩니다. 쿼리·해시를 떼어
//   정규 주소(= guid 와 같은 형태)로 맞춥니다.
function canonicalLink(link: string): string {
  return link.split("#")[0].split("?")[0].trim();
}

// 최근 글 목록. 실패는 throw — 호출부(서버 액션)가 메시지를 그대로 씁니다.
export async function fetchNaverBlogFeed(): Promise<NaverBlogItem[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(FEED_URL, { signal: ctrl.signal, cache: "no-store" });
  } catch (e) {
    const reason = e instanceof Error ? e.message : "요청 실패";
    console.warn("[naver-blog] 요청 실패:", reason);
    throw new Error(`${FAILED} (사유: ${reason})`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    console.warn("[naver-blog] 응답 오류:", res.status);
    throw new Error(`${FAILED} (사유: HTTP ${res.status})`);
  }

  const xml = await res.text();
  return parseNaverBlogFeed(xml);
}

// XML → 글 목록. 네트워크와 떼어놔야 테스트할 수 있어 따로 뺐습니다.
//   * <channel> 에도 title·link·pubDate 가 있어 반드시 <item> 안에서만 찾습니다.
//   * description 은 쓰지 않습니다(사진 태그가 섞여 있음). 그 안의 <img>·<title>
//     같은 태그가 파싱을 흔들지 않도록 아예 먼저 지웁니다.
export function parseNaverBlogFeed(xml: string): NaverBlogItem[] {
  const items: NaverBlogItem[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1].replace(
      /<description\b[^>]*>[\s\S]*?<\/description>/gi,
      "",
    );
    const link = canonicalLink(tagText(block, "link"));
    const guid = tagText(block, "guid") || link;
    const title = tagText(block, "title");
    // link 가 없으면 등록해도 중복 판정을 못 합니다 — 제외(인스타그램과 동일).
    if (!link) continue;
    items.push({
      guid,
      title,
      link,
      pubDate: tagText(block, "pubDate"),
      category: tagText(block, "category"),
    });
  }
  return items;
}
