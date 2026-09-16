import {
  isInstagramConfigured,
  redact,
  fetchRecentInstagramMedia,
} from "../lib/instagramApi";
import { kstYmdFromIso, promotionContent } from "../lib/promotionImport";
import { parseNaverBlogFeed } from "../lib/naverBlogApi";
import { parseHomepageNewsFeed } from "../lib/homepageNewsApi";

// 홍보실적 자동 수집 — 토큰·네트워크 없이 확인할 수 있는 부분만 봅니다.
//   * 실제 API 호출은 INSTAGRAM_ACCESS_TOKEN 이 있어야 하므로, 여기서는
//     ①게시일(→KST) 변환 ②원문→홍보내용 ③토큰 가림(redact) ④토큰 없을 때의 동작
//     ⑤블로그 RSS 파싱 ⑥홈페이지 보도자료 RSS 파싱을 검증합니다.
//     합성 데이터만 씁니다.
//   * ①② 는 인스타그램·블로그(·밴드) 공용 규칙(lib/promotionImport)이라 두
//     채널의 입력 형식을 함께 넣어 봅니다.
function eq(actual: unknown, expected: unknown, what: string) {
  if (actual !== expected)
    throw new Error(`${what} 실패 — 기대 ${expected} / 실제 ${actual}`);
}

async function main() {
  // ① 게시일 → KST 날짜. 한국 밤 시간 게시물이 전날로 밀리면 안 된다.
  eq(kstYmdFromIso("2026-07-15T04:30:00+0000"), "2026-07-15", "낮 게시물");
  eq(kstYmdFromIso("2026-07-15T20:10:00+0000"), "2026-07-16", "밤 게시물(날짜 넘김)");
  eq(kstYmdFromIso("2026-12-31T15:00:00+0000"), "2027-01-01", "연말 자정 넘김");
  eq(kstYmdFromIso("이상한값"), "", "파싱 불가");
  // 블로그 RSS 는 RFC 822(+0900) — 이미 KST 라 하루가 밀리면 안 된다.
  eq(
    kstYmdFromIso("Wed, 02 Sep 2026 14:58:18 +0900"),
    "2026-09-02",
    "RSS 게시일(RFC 822)",
  );
  eq(
    kstYmdFromIso("Thu, 31 Dec 2026 23:59:00 +0900"),
    "2026-12-31",
    "RSS 자정 직전",
  );

  // ② 원문 → 홍보내용. 캡션 전체를 줄바꿈까지 그대로, 원문이 비면 라벨+날짜.
  //   (제목·설명 통합 전에는 첫 줄 40자로 잘랐습니다 — 김민정 9/16.)
  eq(
    promotionContent(
      "AI 동래 플레이 그라운드 참여자 모집\n\n#동래구청소년센터",
      "2026-07-15",
      "인스타그램 게시물",
    ),
    "AI 동래 플레이 그라운드 참여자 모집\n\n#동래구청소년센터",
    "캡션 전체를 홍보내용으로",
  );
  eq(
    promotionContent(
      "\n\n  앞뒤 빈 줄은 덜어낸다  \n가운데 줄바꿈은 유지",
      "2026-07-15",
      "인스타그램 게시물",
    ),
    "앞뒤 빈 줄은 덜어낸다  \n가운데 줄바꿈은 유지",
    "앞뒤 빈 줄 정리",
  );
  eq(
    promotionContent("가".repeat(60), "2026-07-15", "인스타그램 게시물"),
    "가".repeat(60),
    "길어도 자르지 않는다",
  );
  eq(
    promotionContent("", "2026-07-15", "인스타그램 게시물"),
    "인스타그램 게시물 2026-07-15",
    "캡션 없음",
  );
  eq(
    promotionContent("   \n \n ", "2026-07-15", "인스타그램 게시물"),
    "인스타그램 게시물 2026-07-15",
    "공백뿐인 캡션",
  );
  eq(
    promotionContent("", "2026-07-15", "블로그 게시물"),
    "블로그 게시물 2026-07-15",
    "제목 없음(블로그 라벨)",
  );

  // ③ ⚠️ 토큰이 문자열에 섞여도 밖으로 나가지 않아야 한다.
  process.env.INSTAGRAM_ACCESS_TOKEN = "IGQVJTESTtoken1234";
  eq(
    redact("요청 실패: https://graph.instagram.com/v25.0/me/media?access_token=IGQVJTESTtoken1234"),
    "요청 실패: https://graph.instagram.com/v25.0/me/media?access_token=***",
    "URL 속 토큰 가림",
  );
  eq(redact("토큰 IGQVJTESTtoken1234 만료"), "토큰 *** 만료", "토큰 값 가림");
  eq(isInstagramConfigured(), true, "설정됨 판정");

  // ④ 토큰이 없으면 이 기능만 막힌다(앱 전체는 영향 없음).
  delete process.env.INSTAGRAM_ACCESS_TOKEN;
  eq(isInstagramConfigured(), false, "미설정 판정");
  let message = "";
  try {
    await fetchRecentInstagramMedia();
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  if (!message.includes("설정되지 않았습니다"))
    throw new Error(`토큰 미설정 안내 실패 — ${message}`);

  // ⑤ 블로그 RSS 파싱. 실제 피드 모양을 줄여 만든 합성 XML 입니다.
  //    * <channel> 에도 title·link·pubDate 가 있어 <item> 것만 잡아야 한다.
  //    * link 의 추적 쿼리(?fromRss=...)를 떼야 중복 판정이 맞는다.
  //    * description 안의 <img>·<title> 이 파싱을 흔들면 안 된다.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title><![CDATA[동래구청소년센터]]></title>
  <link><![CDATA[https://blog.naver.com/onnainna?fromRss=true]]></link>
  <pubDate>Wed, 02 Sep 2026 14:58:18 +0900</pubDate>
  <item>
    <category><![CDATA[방과후아카데미]]></category>
    <title><![CDATA[8월 폭풍성장DAY_아토피&amp;천식 예방교육]]></title>
    <link><![CDATA[https://blog.naver.com/onnainna/224393521848?fromRss=true&trackingCode=rss]]></link>
    <guid>https://blog.naver.com/onnainna/224393521848</guid>
    <description><![CDATA[본문 <img src="x.jpg"> <title>가짜제목</title> 끝]]></description>
  </item>
  <item>
    <category><![CDATA[언론보도]]></category>
    <title>엔티티 &lt;테스트&gt;</title>
    <link><![CDATA[https://blog.naver.com/onnainna/224385962164?fromRss=true]]></link>
    <guid>https://blog.naver.com/onnainna/224385962164</guid>
    <pubDate>Fri, 21 Aug 2026 19:53:02 +0900</pubDate>
  </item>
</channel></rss>`;
  const items = parseNaverBlogFeed(xml);
  eq(items.length, 2, "RSS item 개수(channel 은 제외)");
  eq(
    items[0].link,
    "https://blog.naver.com/onnainna/224393521848",
    "link 추적 쿼리 제거",
  );
  eq(items[0].link, items[0].guid, "정규화한 link = guid");
  eq(items[0].title, "8월 폭풍성장DAY_아토피&천식 예방교육", "CDATA·엔티티 해제");
  eq(items[0].category, "방과후아카데미", "블로그 자체 분류");
  eq(items[1].title, "엔티티 <테스트>", "CDATA 아닌 제목의 엔티티 해제");
  eq(
    kstYmdFromIso(items[1].pubDate),
    "2026-08-21",
    "RSS 게시일 → 활동일",
  );
  // pubDate 가 없는 item 도 죽지 않고, 등록 시 오늘 날짜로 폴백된다.
  eq(items[0].pubDate, "", "pubDate 없음");
  eq(parseNaverBlogFeed("<rss><channel></channel></rss>").length, 0, "빈 피드");

  // ⑥ 홈페이지 보도자료 RSS 파싱. 실제 피드(2026-09-10 수신)를 줄여 만든
  //    합성 XML — enclosure·media:* 자기완결 태그와 <guid isPermaLink> 포함.
  //    ★ 블로그와 결정적으로 다른 점: 글 번호가 쿼리(?no=)에 있어 쿼리를
  //      떼면 모든 글이 같은 주소로 접힙니다. 그 회귀를 여기서 잡습니다.
  const newsXml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>동래구청소년센터 공지사항</title>
  <link>https://www.onnainna.kr/community/news_board</link>
  <atom:link href="https://www.onnainna.kr/community/news_rss" rel="self" type="application/rss+xml" />
  <pubDate>Thu, 10 Sep 2026 17:51:25 +0900</pubDate>
  <item>
    <title>부산 청소년들의 쉼터! 부산 동래구 청소년 센터</title>
    <link>https://www.onnainna.kr/community/news_board_view?no=187</link>
    <guid isPermaLink="true">https://www.onnainna.kr/community/news_board_view?no=187</guid>
    <pubDate>Fri, 04 Sep 2026 17:40:30 +0900</pubDate>
    <description></description>
    <enclosure url="https://www.onnainna.kr/user_file/news/260904/a.png" type="image/png" length="0" />
    <media:content url="https://www.onnainna.kr/user_file/news/260904/a.png" medium="image" type="image/png" />
    <media:thumbnail url="https://www.onnainna.kr/user_file/news/260904/a.png" />
  </item>
  <item>
    <title>[국제신문] 동래구청소년센터, 고창군 청소년 기관과 교류</title>
    <link>https://www.onnainna.kr/community/news_board_view?no=186#top</link>
    <guid isPermaLink="true">https://www.onnainna.kr/community/news_board_view?no=186</guid>
    <pubDate>Wed, 08 Jul 2026 11:29:34 +0900</pubDate>
  </item>
  <item>
    <title>guid 없이 link 만 있는 글</title>
    <link>https://www.onnainna.kr/community/news_board_view?no=185</link>
    <pubDate>Sat, 20 Jun 2026 15:39:41 +0900</pubDate>
  </item>
</channel></rss>`;
  const news = parseHomepageNewsFeed(newsXml);
  eq(news.length, 3, "보도자료 item 개수(channel 은 제외)");
  eq(
    news[0].link,
    "https://www.onnainna.kr/community/news_board_view?no=187",
    "글 번호 쿼리(?no=)가 보존됨",
  );
  // 20건이 같은 주소로 접히는 사고를 막는 회귀 검사 — 링크가 서로 달라야 합니다.
  eq(new Set(news.map((n) => n.link)).size, 3, "글마다 주소가 다름");
  eq(news[0].guid, news[0].link, "guid = 저장 주소");
  eq(
    news[0].title,
    "부산 청소년들의 쉼터! 부산 동래구 청소년 센터",
    "보도자료 제목",
  );
  eq(news[1].link, news[1].guid, "해시(#top)는 떼고 guid 를 씁니다");
  eq(
    news[1].link,
    "https://www.onnainna.kr/community/news_board_view?no=186",
    "해시 제거 후 주소",
  );
  // guid 가 없으면 link 로 물러납니다(지시문 ② 규칙).
  eq(
    news[2].guid,
    "https://www.onnainna.kr/community/news_board_view?no=185",
    "guid 없으면 link 를 키로",
  );
  eq(kstYmdFromIso(news[0].pubDate), "2026-09-04", "보도자료 게시일 → 활동일");
  eq(
    promotionContent(news[1].title, "2026-07-08", "보도자료"),
    "[국제신문] 동래구청소년센터, 고창군 청소년 기관과 교류",
    "보도자료 제목 → 홍보내용",
  );
  eq(parseHomepageNewsFeed("<rss><channel></channel></rss>").length, 0, "빈 보도자료 피드");

  console.log(JSON.stringify({ ok: true, checks: 37 }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
