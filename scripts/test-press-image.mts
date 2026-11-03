// 언론보도 대표 이미지(lib/pressImage) 검증 — 저장소·DB 쓰기 없음.
//   실행: node --env-file=.env.local --import tsx scripts/test-press-image.mts
//   * og:image 후보 추출 · JPG 변환(투명 PNG·큰 이미지·작은 아이콘) · 내부망 주소 차단

import sharp from "sharp";
import { extractImageCandidates, fetchArticleImage, PressImageError, toHomepageJpeg } from "../lib/pressImage";

let passed = 0;
function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
  console.log(`  ok  ${msg}`);
}

console.log("og:image 후보");
{
  const html = `<html><head>
    <meta property="og:title" content="제목">
    <meta content="/news/photo/a.jpg?x=1&amp;y=2" property="og:image" />
    <meta name="twitter:image" content="https://cdn.example.com/b.png">
    <link rel="image_src" href="//img.example.com/c.gif">
    <meta property="og:image" content="javascript:alert(1)">
  </head><body><meta property="og:image" content="https://x.com/late.jpg"></body></html>`;
  const c = extractImageCandidates(html, "https://news.example.com/article/1");
  check(c[0] === "https://news.example.com/news/photo/a.jpg?x=1&y=2", "상대 주소·속성 순서·&amp; 처리");
  check(c[1] === "https://cdn.example.com/b.png", "twitter:image 다음 순위");
  check(c[2] === "https://img.example.com/c.gif", "프로토콜 생략 주소(//) 처리");
  check(!c.some((u) => u.startsWith("javascript:")), "javascript: 주소 제외");
  check(extractImageCandidates("<html></html>", "https://a.com/").length === 0, "없으면 빈 목록");
}

console.log("\nJPG 변환");
{
  const big = await sharp({
    create: { width: 4000, height: 3000, channels: 4, background: { r: 0, g: 120, b: 200, alpha: 0.5 } },
  })
    .png()
    .toBuffer();
  const r = await toHomepageJpeg(new Uint8Array(big));
  const meta = await sharp(r.jpeg).metadata();
  check(meta.format === "jpeg", "PNG → JPG");
  check(Math.max(r.width, r.height) <= 1600, `긴 변 1600 이하 (${r.width}x${r.height})`);
  check(r.jpeg.byteLength <= 2_097_152, `2MiB 이하 (${r.jpeg.byteLength} bytes)`);
  check(!meta.hasAlpha, "투명 배경 제거");

  // 무작위 잡음 이미지 — 잘 안 줄어드는 최악의 경우
  const noise = Buffer.alloc(3000 * 3000 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 256) | 0;
  const n = await toHomepageJpeg(
    new Uint8Array(await sharp(noise, { raw: { width: 3000, height: 3000, channels: 3 } }).png().toBuffer()),
  );
  check(n.jpeg.byteLength <= 2_097_152, `잡음 이미지도 2MiB 이하 (${n.jpeg.byteLength} bytes)`);

  const icon = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#000" } }).png().toBuffer();
  await toHomepageJpeg(new Uint8Array(icon)).then(
    () => check(false, "작은 아이콘 거절"),
    (e) => check(e instanceof PressImageError, "작은 아이콘 거절"),
  );
  await toHomepageJpeg(new TextEncoder().encode("<html>not image</html>")).then(
    () => check(false, "이미지 아닌 파일 거절"),
    (e) => check(e instanceof PressImageError, "이미지 아닌 파일 거절"),
  );
}

console.log("\n내부망·잘못된 주소 차단 (네트워크 요청 전에 거절)");
for (const bad of [
  "http://127.0.0.1/",
  "http://localhost/",
  "http://169.254.169.254/latest/meta-data/",
  "http://10.0.0.1/",
  "http://192.168.0.1/",
  "http://[::1]/",
  "http://example.com:8080/",
  "file:///etc/passwd",
  "ftp://example.com/a.jpg",
]) {
  await fetchArticleImage("00000000-0000-0000-0000-000000000000", bad).then(
    () => check(false, `차단: ${bad}`),
    (e) => check(e instanceof PressImageError, `차단: ${bad} — ${(e as Error).message}`),
  );
}

console.log(`\n통과 ${passed}건.`);
