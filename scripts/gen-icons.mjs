// PWA 아이콘 + OG 이미지 생성 — SVG → PNG (sharp)
//   실행: node scripts/gen-icons.mjs
//   * 한글 텍스트는 시스템 폰트(Malgun Gothic 등)로 래스터화됩니다.
import sharp from "sharp";
import { readFileSync } from "node:fs";

// SVG 를 고밀도로 읽어 또렷하게 래스터화.
function svg(path, density = 384) {
  return sharp(readFileSync(path), { density });
}

const jobs = [
  // 앱 아이콘 (512 SVG 기준)
  ["public/icon-512.svg", 512, "public/icon-512.png"],
  ["public/icon-512.svg", 192, "public/icon-192.png"],
  ["public/icon-512.svg", 180, "public/apple-touch-icon.png"],
  ["public/icon-512.svg", 32, "public/favicon.png"],
];

for (const [src, size, out] of jobs) {
  await svg(src)
    .resize(size, size)
    .png()
    .toFile(out);
  console.log(`✓ ${out} (${size}x${size})`);
}

// OG 이미지 (1200x630)
await sharp(readFileSync("public/og-image.svg"), { density: 96 })
  .resize(1200, 630)
  .png()
  .toFile("public/og-image.png");
console.log("✓ public/og-image.png (1200x630)");

console.log("done");
