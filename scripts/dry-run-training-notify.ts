// 의무교육 알림 dry-run — 실제 발송 없이 무엇이 나갈지 출력합니다.
//   실행: node --import tsx scripts/dry-run-training-notify.ts [시작일 YYYY-MM-DD] [일수]
//
//   (a) 시작일 기준 직원별 대상 교육·개인 기한·상태 표
//   (b) 시작일부터 N일(기본 7일) 매일 Cron 이 돈다고 보고 날짜별 DM 계획
//       — 앞날에 "보낸" 것으로 친 키를 다음 날에 넘겨 중복방지를 흉내 냅니다.
//   (c) 공개 채널 요약 문구(화요일)
//
//   ⚠️ dryRun: 슬랙·DB 어디에도 쓰지 않습니다(성범죄경력조회·상조회 포함).

import { readFileSync } from "node:fs";

async function main() {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  const { runTrainingReminder, formatEvalTable } = await import(
    "../lib/trainingReminder"
  );
  const { kstTodayYmd, addDaysYmd } = await import("../lib/trainings");

  const start = process.argv[2] ?? kstTodayYmd();
  const days = Number(process.argv[3] ?? 7);

  const first = await runTrainingReminder({ dryRun: true, today: start });
  console.log(`=== (a) 직원별 대상 교육·개인 기한·상태 (${start}) ===`);
  console.log(formatEvalTable(first.rows));

  console.log(`\n=== (b)(c) ${start}부터 ${days}일, 매일 Cron 시뮬레이션 ===`);
  const sent = new Set<string>();
  for (let i = 0; i < days; i++) {
    const day = addDaysYmd(start, i);
    const s = await runTrainingReminder({
      dryRun: true,
      today: day,
      assumeSentKeys: sent,
    });
    console.log(`\n────────── ${day}${s.weekly ? " (화)" : ""} ──────────`);
    if (s.publicSummary) {
      console.log(
        s.publicSummary.post
          ? `[공개 채널]\n${s.publicSummary.text}`
          : `[공개 채널] 올리지 않음 — ${s.publicSummary.skipReason}`,
      );
    }
    if (s.dms.length === 0) console.log("(DM 없음)");
    for (const d of s.dms) {
      console.log(`\n▶ DM(${d.kind}) → ${d.to}\n${d.text}`);
      for (const k of d.keys) sent.add(k);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
