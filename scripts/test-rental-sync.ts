// 홈페이지 대관예약 동기화 — 라이브 스모크.
//   실행: npm run test:rental
//
//   실제 업체 API 와 실제 Supabase 를 씁니다(읽기 전용 API + upsert).
//   확인 항목:
//     ① 기본 창(오늘-180일 ~ 오늘+185일) 동기화가 ok 로 끝나는가
//     ② rental(시설 대관)·room(청소년 공간) 양쪽이 다 들어왔는가
//        — type=all 을 빼먹으면 room 이 0 이 됩니다
//     ③ 잘린 구간(incomplete)이 없는가
//     ④ 취소(C) 건도 저장됐는가 — 취소 갱신이 되는지의 전제
//     ⑤ 두 번째 실행이 행을 늘리지 않고 synced_at 만 갱신하는가(멱등성)
//
//   ⚠️ 이 스크립트는 예약을 만들거나 고치지 않습니다. 홈페이지가 원본입니다.
//   ※ tsx 가 .ts 를 CJS 로 돌려 top-level await 를 못 쓰므로 main() 으로 감쌉니다.

import { readFileSync } from "node:fs";

let failed = 0;
function chk(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✔" : "✘"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed += 1;
}

async function main() {
  // .env.local 을 process.env 로 — tsx 는 Next 처럼 자동 로드하지 않습니다.
  //   lib/* 를 import 하기 전에 채워야 하므로 아래는 동적 import 를 씁니다.
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }

  const { runRentalSync, defaultRentalWindow, readRentalLastSyncAt } =
    await import("../lib/rentalSync");
  const { supabaseAdmin } = await import("../lib/supabaseAdmin");
  const { RENTAL_TABLE } = await import("../lib/rental");

  const win = defaultRentalWindow();
  console.log(`동기화 창: ${win.start} ~ ${win.end}`);

  // --- ① 1차 동기화 ---
  const t0 = Date.now();
  const first = await runRentalSync();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\n[1차] ok=${first.ok} 호출 ${first.calls}회 · 수신 ${first.fetched}건 · ` +
      `저장 ${first.upserted}건 · ${secs}초`
  );
  if (first.message) console.log(`      message: ${first.message}`);
  console.log(`      byType: ${JSON.stringify(first.byType)}`);

  chk("동기화 성공", first.ok, first.message ?? "");
  chk("저장 건수 > 0", first.upserted > 0, `${first.upserted}건`);

  // --- ② rental / room 양쪽 ---
  //   9월 rental 만 218건이었으므로, all 이면 그보다 훨씬 많아야 정상입니다.
  chk(
    "시설 대관(rental) 수신",
    (first.byType.rental ?? 0) > 0,
    `${first.byType.rental ?? 0}건`
  );
  chk(
    "청소년 공간(room) 수신 — type=all 확인",
    (first.byType.room ?? 0) > 0,
    `${first.byType.room ?? 0}건`
  );

  // --- ③ 잘린 구간 없음 ---
  chk(
    "불완전 구간 없음",
    first.incomplete.length === 0,
    first.incomplete.join(", ") || "없음"
  );

  // --- DB 실측 ---
  const { count: dbCount } = await supabaseAdmin
    .from(RENTAL_TABLE)
    .select("reservation_no", { count: "exact", head: true });
  console.log(`\nDB 총 행수: ${dbCount}`);
  chk(
    "DB 행수 = 저장 건수",
    dbCount === first.upserted,
    `DB ${dbCount} / 저장 ${first.upserted}`
  );

  // 구분·상태 분포를 실제 테이블에서 다시 셉니다(매퍼가 값을 흘리지 않았는지).
  for (const [label, col, val] of [
    ["시설 대관", "reservation_type", "rental"],
    ["청소년 공간", "reservation_type", "room"],
    ["확정(Y)", "status", "Y"],
    ["신청 중(N)", "status", "N"],
    ["취소(C)", "status", "C"],
  ] as const) {
    const { count } = await supabaseAdmin
      .from(RENTAL_TABLE)
      .select("reservation_no", { count: "exact", head: true })
      .eq(col, val);
    console.log(`  ${label}: ${count}건`);
    // ④ 취소 건이 저장돼 있어야 "확정→취소" 갱신이 반영된다는 뜻입니다.
    if (val === "C") {
      chk("취소 건도 저장됨(취소 갱신 전제)", (count ?? 0) > 0, `${count}건`);
    }
  }

  // 매퍼 스모크 — 빈 문자열이 null 로 들어갔는지, 시각 컬럼이 채워졌는지.
  const { data: sample } = await supabaseAdmin
    .from(RENTAL_TABLE)
    .select("*")
    .eq("reservation_type", "room")
    .limit(1)
    .maybeSingle();
  console.log(`\n샘플(room): ${JSON.stringify(sample)}`);
  const s = sample as {
    reservation_no: number;
    synced_at?: string;
    team_name?: unknown;
  } | null;
  chk("synced_at 기록됨", !!s?.synced_at);
  chk("빈 문자열이 아니라 null 로 저장됨(team_name)", s?.team_name !== "");

  const lastAt = await readRentalLastSyncAt();
  console.log(`settings.rental_last_sync_at = ${lastAt}`);
  chk("마지막 동기화 시각 기록됨", !!lastAt);

  // --- ⑤ 멱등성: 다시 돌려도 행이 늘지 않고 synced_at 만 갱신 ---
  const before = s?.synced_at ?? "";
  const second = await runRentalSync();
  const { count: dbCount2 } = await supabaseAdmin
    .from(RENTAL_TABLE)
    .select("reservation_no", { count: "exact", head: true });
  console.log(
    `\n[2차] ok=${second.ok} 저장 ${second.upserted}건 · DB 총 ${dbCount2}행`
  );
  chk("2차도 성공", second.ok, second.message ?? "");
  // 그 사이 홈페이지에 새 신청이 들어올 수 있어 완전한 동수는 요구하지 않습니다.
  chk(
    "재실행이 행을 늘리지 않음(upsert 멱등)",
    Math.abs((dbCount2 ?? 0) - (dbCount ?? 0)) < 50,
    `${dbCount} → ${dbCount2}`
  );

  if (s) {
    const { data: sample2 } = await supabaseAdmin
      .from(RENTAL_TABLE)
      .select("synced_at")
      .eq("reservation_no", s.reservation_no)
      .maybeSingle();
    const after = (sample2 as { synced_at?: string } | null)?.synced_at ?? "";
    chk(
      "기존 행의 synced_at 갱신됨(취소 갱신이 실제로 덮인다는 뜻)",
      !!after && after !== before,
      `${before} → ${after}`
    );
  }

  console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
