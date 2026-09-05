// 공용 메일함 재분류 — 카테고리 개편(7→9) 후 기존 메일 정리용 일회성 스크립트.
//
//   실행: npm run reclassify:mail            (미리보기 — 대상만 세고 끝, API 호출 0)
//         npm run reclassify:mail -- --confirm   (실제 재분류)
//
//   왜 스크립트인가:
//     화면의 [AI 분석] 버튼은 한 통씩이고 `!ai_processed` 일 때만 보입니다.
//     이미 분석된 수백 통을 다시 돌릴 경로가 없어 일회성으로 만듭니다.
//
//   대상: ai_category 가 '방과후'(옛 이름) 또는 '기타' 인 메일.
//     · '방과후' → 방카 / 토요늘봄 으로 갈라야 합니다(사업도 담당자도 다름).
//     · '기타'  → 분류 기준이 없어 떨어진 것이 많아 새 9분류로 다시 봅니다.
//
//   안전장치:
//     · 기본은 미리보기. --confirm 을 줘야 API 를 호출합니다.
//       (대상이 수백 건이라 실수로 두 번 돌면 그만큼 과금됩니다.)
//     · keepAssignee: true — assignee_name 을 절대 건드리지 않습니다.
//       사람이 지정해 둔 담당자를 덮어쓰지 않고, 담당자가 비어 있던 메일이
//       한꺼번에 자동 배정되지도 않습니다. 슬랙 DM 경로도 함께 막힙니다.
//     · 분류기가 모든 실패를 내부에서 삼키므로, 중간에 몇 건 실패해도
//       나머지는 계속 진행됩니다(실패분은 ai_* 가 그대로 남습니다).
import { readFileSync } from "node:fs";

// ★ 반드시 supabaseAdmin·분류기를 "쓰기" 전에 환경변수를 넣어야 합니다.
//   둘 다 lazy(Proxy·함수 내 생성)라 import 시점에는 env 를 읽지 않으므로,
//   모듈 최상단의 이 코드가 먼저 돌면 충분합니다.
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]])
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

import { supabaseAdmin } from "../lib/supabaseAdmin";
import {
  isClassifierConfigured,
  runMailClassification,
} from "../lib/mailClassifier";

const CONFIRM = process.argv.includes("--confirm");

// 재분류 대상 카테고리. '방과후' 는 개편 전 이름이라 MailCategory 에 더는
//   없지만, DB 에는 아직 그 값으로 저장된 행이 남아 있습니다.
const TARGET_CATEGORIES = ["방과후", "기타"];

// runMailClassification 내부 BATCH_LIMIT 과 같은 값. 캡을 넘길 수 없으므로
//   스크립트가 이 크기로 잘라 여러 번 호출합니다.
const CHUNK = 30;

async function loadTargetIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("mail_messages")
    .select("id")
    .in("ai_category", TARGET_CATEGORIES)
    .is("deleted_at", null)
    .order("received_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: unknown }[])
    .map((r) => String(r.id ?? ""))
    .filter((id) => id.length > 0);
}

async function reportDistribution(label: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("mail_messages")
    .select("ai_category")
    .is("deleted_at", null);
  if (error) {
    console.warn(`  (${label} 분포 조회 실패: ${error.message})`);
    return;
  }
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as { ai_category: unknown }[]) {
    const c = r.ai_category == null ? "(미분류)" : String(r.ai_category);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  console.log(`\n[${label}]`);
  for (const [c, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(12, " ")} ${String(n).padStart(4, " ")}건`);
  }
}

async function main() {
  if (!isClassifierConfigured()) {
    throw new Error(
      "ANTHROPIC_API_KEY 가 없습니다. .env.local 을 확인해주세요.",
    );
  }

  const ids = await loadTargetIds();
  console.log(
    `재분류 대상: ${ids.length}건 (ai_category = ${TARGET_CATEGORIES.join(" 또는 ")})`,
  );
  await reportDistribution("현재 분포");

  if (!CONFIRM) {
    console.log(
      `\n미리보기입니다 — API 를 호출하지 않았습니다.` +
        `\n실제로 돌리려면: npm run reclassify:mail -- --confirm` +
        `\n(Anthropic API 를 ${ids.length}회 호출합니다. 담당자는 갱신하지 않습니다.)`,
    );
    return;
  }

  if (ids.length === 0) {
    console.log("대상이 없어 종료합니다.");
    return;
  }

  console.log(`\n재분류를 시작합니다 — API ${ids.length}회 호출 예정.\n`);
  let processed = 0;
  let skipped = 0;
  let done = 0;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const result = await runMailClassification({
      ids: chunk,
      force: true, // 이미 분석된 메일이므로 ai_processed_at 조건을 뺍니다
      keepAssignee: true, // ★ assignee_name 미갱신 — 사람이 정한 담당자 보호
      limit: chunk.length,
    });
    processed += result.processed;
    skipped += result.skipped;
    done += chunk.length;
    console.log(
      `  ${String(done).padStart(4, " ")}/${ids.length} 처리 중 ` +
        `— 이번 묶음 성공 ${result.processed} · 실패 ${result.skipped}`,
    );
  }

  console.log(`\n완료 — 성공 ${processed}건 · 실패 ${skipped}건.`);
  if (skipped > 0) {
    console.log(
      "  실패분은 기존 분류가 그대로 남아 있습니다. 다시 실행하면 재시도합니다.",
    );
  }
  await reportDistribution("재분류 후 분포");
}

main().catch((e) => {
  console.error("재분류 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
