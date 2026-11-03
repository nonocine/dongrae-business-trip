// 홈페이지 언론보도 API 시험 — PRESS_AUTOMATION 3-8 테스트 순서 1~6. TEST 키 전용, DB 접속 없음.
//   실행(두 단계 — 1·3번 글을 관장이 홈페이지 관리자에서 눈으로 확인한 뒤 정리):
//     node --env-file=.env.vercel.local --import tsx scripts/test-homepage-news-api.mts run     <상태파일>
//     node --env-file=.env.vercel.local --import tsx scripts/test-homepage-news-api.mts cleanup <상태파일>
//   run     : 1 create(이미지 없음) · 2 같은 ID 재등록 409 · 3 create(이미지) · 4 update 요약 · 5 published 403
//   cleanup : 6 1번 글 delete → get 404, 3번 글 delete → get 404
//   * 운영(live) 범위면 바로 멈춥니다. 키 값은 출력하지 않습니다.

import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  HomepageNewsError,
  homepageNewsConfig,
  homepageNewsCreate,
  homepageNewsDelete,
  homepageNewsGet,
  homepageNewsUpdate,
} from "../lib/homepageNewsPublish";

const [mode, statePath] = process.argv.slice(2);
if (!mode || !statePath || !["run", "cleanup"].includes(mode)) {
  console.error("사용법: test-homepage-news-api.mts run|cleanup <상태파일>");
  process.exit(2);
}

const cfg = homepageNewsConfig();
if (!cfg) throw new Error("ONNA_NEWS_API_KEY_TEST 가 없습니다 (.env.vercel.local 확인).");
if (cfg.scope !== "test") throw new Error("운영(live) 범위입니다 — 이 시험은 TEST 키로만 합니다. 중단.");
console.log(`범위: ${cfg.scope}`);

let passed = 0;
function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
  console.log(`  ok  ${msg}`);
}

async function expectError(p: Promise<unknown>, status: number): Promise<HomepageNewsError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HomepageNewsError) {
      check(e.status === status, `HTTP ${status} (받음: ${e.status} ${e.code})`);
      return e;
    }
    throw e;
  }
  throw new Error(`FAIL: HTTP ${status} 를 기대했는데 성공했습니다`);
}

type State = { id1: string; no1: number; id3: string; no3: number };

if (mode === "run") {
  const stamp = new Date().toISOString().slice(0, 16);
  const base = {
    title: `[API 시험] 동업자씨 연동 시험 글 ${stamp} — 비공개`,
    publisher: "동업자씨 시험",
    reported_date: "2026-11-03",
    source_url: "https://www.onnainna.kr/",
    summary: "동업자씨 → 홈페이지 보도자료 API 시험 글입니다.\n확인 후 삭제합니다.",
  };

  console.log("\n1) 이미지 없는 create");
  const id1 = `test-${randomUUID()}`;
  const r1 = await homepageNewsCreate({ external_id: id1, ...base });
  check(r1.kind === "created", "201 created");
  check(r1.post.status === "draft", "status=draft");
  check(Number.isInteger(r1.post.no) && r1.post.no > 0, `no=${r1.post.no}`);
  console.log(`     admin_url: ${r1.post.admin_url}`);

  console.log("\n2) 같은 external_id 로 다시 create");
  const r2 = await homepageNewsCreate({ external_id: id1, ...base });
  check(r2.kind === "existing", "409 → 기존 글로 처리");
  check(r2.post.no === r1.post.no, `같은 no 반환 (${r2.post.no})`);

  console.log("\n3) 이미지 포함 create");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <rect width="100%" height="100%" fill="#1f4e79"/>
    <text x="600" y="300" font-size="72" fill="#fff" text-anchor="middle" font-family="sans-serif">API TEST IMAGE</text>
    <text x="600" y="400" font-size="40" fill="#cde" text-anchor="middle" font-family="sans-serif">${stamp}</text>
  </svg>`;
  const jpg = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
  console.log(`     테스트 이미지 ${jpg.byteLength} bytes`);
  const id3 = `test-${randomUUID()}`;
  const r3 = await homepageNewsCreate({
    external_id: id3,
    ...base,
    title: `[API 시험] 이미지 포함 ${stamp} — 비공개`,
    image: { bytes: new Uint8Array(jpg), filename: "test.jpg", mime: "image/jpeg" },
  });
  check(r3.kind === "created", "201 created");
  check(r3.post.image_url.startsWith("https://"), `image_url 있음`);
  console.log(`     admin_url: ${r3.post.admin_url}`);
  console.log(`     image_url: ${r3.post.image_url}`);

  console.log("\n4) update 로 요약 수정");
  const newSummary = `요약 수정 시험 (${stamp})\n둘째 줄`;
  await homepageNewsUpdate({ no: r1.post.no, summary: newSummary });
  const g4 = await homepageNewsGet(r1.post.no);
  check(g4.summary === newSummary, "get 으로 수정된 요약 확인");
  check(g4.title === base.title, "보내지 않은 제목은 그대로");

  console.log("\n5) TEST 키로 published 시도");
  await expectError(homepageNewsUpdate({ no: r1.post.no, status: "published" }), 403);
  const g5 = await homepageNewsGet(r1.post.no);
  check(g5.status === "draft", "여전히 draft");

  const state: State = { id1, no1: r1.post.no, id3, no3: r3.post.no };
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
  console.log(`\n통과 ${passed}건. 상태 저장: ${statePath}`);
  console.log("→ 1번·3번 글을 홈페이지 관리자에서 확인한 뒤 cleanup 을 실행하세요.");
} else {
  const s = JSON.parse(await readFile(statePath, "utf8")) as State;

  console.log(`\n6) 1번 글(no=${s.no1}) delete`);
  const d1 = await homepageNewsDelete(s.no1);
  check(d1.status === "deleted", "200 status=deleted");
  await expectError(homepageNewsGet(s.no1), 404);

  console.log(`\n   3번 글(no=${s.no3}) delete`);
  const d3 = await homepageNewsDelete(s.no3);
  check(d3.status === "deleted", "200 status=deleted");
  await expectError(homepageNewsGet(s.no3), 404);

  console.log(`\n통과 ${passed}건.`);
}
