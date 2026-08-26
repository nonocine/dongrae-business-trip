import {
  instagramKstYmd,
  instagramTitle,
  isInstagramConfigured,
  redact,
  fetchRecentInstagramMedia,
} from "../lib/instagramApi";

// 인스타그램 가져오기 — 토큰 없이 확인할 수 있는 부분만 봅니다.
//   * 실제 API 호출은 INSTAGRAM_ACCESS_TOKEN 이 있어야 하므로, 여기서는
//     ①게시일(UTC→KST) 변환 ②캡션→제목 ③토큰 가림(redact) ④토큰 없을 때의
//     동작을 검증합니다. 합성 데이터만 씁니다.
function eq(actual: unknown, expected: unknown, what: string) {
  if (actual !== expected)
    throw new Error(`${what} 실패 — 기대 ${expected} / 실제 ${actual}`);
}

async function main() {
  // ① ISO8601(UTC) → KST 날짜. 한국 밤 시간 게시물이 전날로 밀리면 안 된다.
  eq(instagramKstYmd("2026-07-15T04:30:00+0000"), "2026-07-15", "낮 게시물");
  eq(instagramKstYmd("2026-07-15T20:10:00+0000"), "2026-07-16", "밤 게시물(날짜 넘김)");
  eq(instagramKstYmd("2026-12-31T15:00:00+0000"), "2027-01-01", "연말 자정 넘김");
  eq(instagramKstYmd("이상한값"), "", "파싱 불가");

  // ② 캡션 → 제목. 첫 줄 40자, 빈 캡션은 날짜로 대체.
  eq(
    instagramTitle("AI 동래 플레이 그라운드 참여자 모집\n\n#동래구청소년센터", "2026-07-15"),
    "AI 동래 플레이 그라운드 참여자 모집",
    "첫 줄 제목",
  );
  eq(
    instagramTitle("\n\n  두 번째 줄이 진짜 제목  \n뒤에 더", "2026-07-15"),
    "두 번째 줄이 진짜 제목",
    "빈 줄 건너뛰기",
  );
  eq(
    instagramTitle("가".repeat(60), "2026-07-15"),
    `${"가".repeat(40)}…`,
    "40자 자르기",
  );
  eq(
    instagramTitle("", "2026-07-15"),
    "인스타그램 게시물 2026-07-15",
    "캡션 없음",
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

  console.log(JSON.stringify({ ok: true, checks: 12 }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
