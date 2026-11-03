// 실제 기사 1건 → 홈페이지 비공개(draft) 등록. TEST 키 범위에서만 돕니다.
//   실행: node --env-file=.env.local --env-file=.env.vercel.local --import tsx scripts/press-homepage-draft.mts <press_articles.id>
//   * 대표 이미지(og:image)를 가져와 press-images 에 보관 → draft 등록 → press_articles 에 기록(homepage_scope='test')
//   * 화면 버튼이 생기기 전 시험용. 키 값은 출력하지 않습니다.

import { homepageNewsConfig } from "../lib/homepageNewsPublish";
import { createHomepageDraft, ensureArticleImage } from "../lib/pressHomepage";

const articleId = process.argv[2];
if (!articleId) {
  console.error("사용법: press-homepage-draft.mts <press_articles.id>");
  process.exit(2);
}
const cfg = homepageNewsConfig();
if (!cfg) throw new Error("ONNA_NEWS_API_KEY_TEST 가 없습니다.");
if (cfg.scope !== "test") throw new Error("운영(live) 범위입니다 — 이 스크립트는 TEST 키로만 씁니다. 중단.");
console.log(`범위: ${cfg.scope}`);

const img = await ensureArticleImage(articleId);
console.log(img.path ? `대표 이미지: ${img.path}${img.sourceUrl ? `\n  출처: ${img.sourceUrl}` : ""}` : `대표 이미지 없음: ${img.note}`);

const r = await createHomepageDraft(articleId);
if (!r.ok) {
  console.error(`실패: ${r.message}`);
  process.exit(1);
}
console.log(`${r.kind === "created" ? "새로 등록" : "기존 글 연결"} — no=${r.post.no}, status=${r.post.status}`);
console.log(`admin_url: ${r.post.admin_url}`);
console.log(`image_url: ${r.post.image_url || "(없음)"}`);
