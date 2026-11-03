// 묶음기사 홍보 실적 백필 — 관장 결정(2026-11-03): 묶음기사도 실적(언론보도)에 넣는다.
//   대상: is_roundup=true, review_status auto·approved, promotion_id 없음.
//   (확인 필요·제외 기사는 넣지 않음 — 승인할 때 연결됩니다.)
//   실적 홍보내용은 "[묶음기사] 제목". 같은 url 실적 행이 이미 있으면 새로 만들지 않고 연결.
//   실행:
//     node --env-file=.env.local --env-file=.env.vercel.local --import tsx scripts/press-roundup-promotions.mts          ← 미리보기(쓰지 않음)
//     node --env-file=.env.local --env-file=.env.vercel.local --import tsx scripts/press-roundup-promotions.mts --apply  ← 실제 연결

import { supabaseAdmin } from "../lib/supabaseAdmin";
import { linkPromotionForArticle } from "../lib/pressIngest";

const apply = process.argv.includes("--apply");
const { data, error } = await supabaseAdmin
  .from("press_articles")
  .select("id,published_at,outlet,title,review_status")
  .eq("is_roundup", true)
  .in("review_status", ["auto", "approved"])
  .is("promotion_id", null)
  .order("published_at");
if (error) throw new Error(error.message);
const rows = (data ?? []) as Array<{ id: string; published_at: string; outlet: string; title: string }>;

console.log(`${apply ? "실제 연결" : "미리보기"} — 대상 ${rows.length}건`);
for (const r of rows) {
  const result = apply ? await linkPromotionForArticle(r.id) : "(미리보기)";
  console.log(`${result} | ${r.published_at} ${r.outlet} | ${r.title.slice(0, 50)}`);
}
