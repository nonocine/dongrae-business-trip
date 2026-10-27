// =====================================================================
// 동래방카 사진 축소본 소급 생성 (2026-10 속도 개선)
//   대상: 축소본(<원본>.thumb.webp, 가로 400px)이 생기기 전에 올린 사진
//         · bk_meals.photo_path       (급식 사진)
//         · bk_post_files(kind=image) (알림장·공지 사진)
//   보호자 앱은 목록·홈에서 축소본을 먼저 쓰고, 없으면 원본을 씁니다 — 이 스크립트를 돌리기
//   전에도 화면은 깨지지 않습니다(느릴 뿐).
//   원본은 건드리지 않습니다. 이미 축소본이 있으면 건너뜁니다.
//
//   실행(프로젝트 루트):
//     미리보기(쓰지 않음):  node --env-file=.env.local --import tsx scripts/backfill-bangka-thumbs.mts
//     실제 반영:            node --env-file=.env.local --import tsx scripts/backfill-bangka-thumbs.mts --apply
// =====================================================================

import { supabaseAdmin } from "../lib/supabaseAdmin";
import { thumbPathOf } from "../lib/bangkaContent";
import { bucket, makeThumb } from "../lib/bangkaMedia";

const apply = process.argv.includes("--apply");

async function exists(path: string): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const { data } = await bucket().list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 1 });
  return (data ?? []).some((o) => o.name === path.slice(slash + 1));
}

const { data: meals, error: e1 } = await supabaseAdmin.from("bk_meals").select("photo_path").not("photo_path", "is", null);
if (e1) throw new Error(e1.message);
const { data: files, error: e2 } = await supabaseAdmin.from("bk_post_files").select("path").eq("kind", "image");
if (e2) throw new Error(e2.message);
const paths = [
  ...((meals ?? []) as { photo_path: string }[]).map((r) => r.photo_path),
  ...((files ?? []) as { path: string }[]).map((r) => r.path),
].filter((p) => p && !p.endsWith(".thumb.webp"));

let made = 0;
let skipped = 0;
let failed = 0;
for (const p of paths) {
  const t = thumbPathOf(p);
  if (await exists(t)) {
    skipped++;
    continue;
  }
  if (!apply) {
    console.log("만들 것:", p, "→", t);
    made++;
    continue;
  }
  const { data, error } = await bucket().download(p);
  if (error || !data) {
    console.log("원본 없음:", p);
    failed++;
    continue;
  }
  try {
    const thumb = await makeThumb(Buffer.from(await data.arrayBuffer()));
    const { error: upErr } = await bucket().upload(t, thumb, { contentType: "image/webp", upsert: true });
    if (upErr) throw new Error(upErr.message);
    console.log("만듦:", t, `${Math.round(thumb.length / 1024)}KB`);
    made++;
  } catch (e) {
    console.log("실패:", p, e instanceof Error ? e.message : e);
    failed++;
  }
}
console.log(`${apply ? "반영" : "미리보기"} — 대상 ${paths.length} · ${apply ? "만듦" : "만들 것"} ${made} · 이미 있음 ${skipped} · 실패 ${failed}`);
