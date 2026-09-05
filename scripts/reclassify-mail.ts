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
import { classifyByKeyword } from "../lib/mailKeywordRules";

const CONFIRM = process.argv.includes("--confirm");

// 재분류 대상 카테고리. '방과후' 는 개편 전 이름이라 MailCategory 에 더는
//   없지만, DB 에는 아직 그 값으로 저장된 행이 남아 있습니다.
const TARGET_CATEGORIES = ["방과후", "기타"];

// runMailClassification 내부 BATCH_LIMIT 과 같은 값. 캡을 넘길 수 없으므로
//   스크립트가 이 크기로 잘라 여러 번 호출합니다.
const CHUNK = 30;

type Target = { id: string; subject: string; fromName: string };

async function loadTargets(): Promise<Target[]> {
  const { data, error } = await supabaseAdmin
    .from("mail_messages")
    // 제목·발신자까지 읽는 이유: 미리보기에서 "키워드로 처리 / AI 필요" 를
    //   미리 세어 보여주기 위해서입니다(분류 자체는 순수 함수라 무료).
    .select("id, subject, from_name")
    .in("ai_category", TARGET_CATEGORIES)
    .is("deleted_at", null)
    .order("received_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  const ids = ((data ?? []) as Record<string, unknown>[])
    .map((r) => ({
      id: String(r.id ?? ""),
      subject: String(r.subject ?? ""),
      fromName: String(r.from_name ?? ""),
    }))
    .filter((t) => t.id.length > 0);
  // 대상이 1000건을 넘으면 여기서도 잘립니다(분포 표를 잘랐던 것과 같은 제한).
  //   지금은 374건이라 문제가 없지만, 조용히 일부만 처리되는 것이 최악이므로
  //   경계에 닿으면 알립니다.
  if (ids.length >= PAGE) {
    console.warn(
      `  ⚠️ 대상이 ${PAGE}건 제한에 닿았습니다 — 일부만 조회됐을 수 있습니다.` +
        ` 재분류 후 다시 실행해 남은 건이 없는지 확인해주세요.`,
    );
  }
  return ids;
}

// 전체 분포 — 대상 조회와 같은 조건(deleted_at IS NULL)으로 셉니다.
//   ★ range() 로 페이징하는 이유: PostgREST 는 select() 한 번에 최대 1000행만
//     돌려줍니다. 살아있는 메일이 1000통을 넘은 뒤로 이 표가 조용히 잘려
//     방과후 97→91, 기타 277→262 로 21건 적게 나왔습니다(합계가 정확히
//     1000이면 잘린 것입니다). 조건이 아니라 행 수 제한이 원인이었습니다.
const PAGE = 1000;

async function reportDistribution(label: string): Promise<void> {
  const counts = new Map<string, number>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from("mail_messages")
      .select("ai_category")
      .is("deleted_at", null)
      .range(from, from + PAGE - 1);
    if (error) {
      console.warn(`  (${label} 분포 조회 실패: ${error.message})`);
      return;
    }
    const rows = (data ?? []) as { ai_category: unknown }[];
    for (const r of rows) {
      const c = r.ai_category == null ? "(미분류)" : String(r.ai_category);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  console.log(`\n[${label}]`);
  let total = 0;
  for (const [c, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(12, " ")} ${String(n).padStart(4, " ")}건`);
    total += n;
  }
  console.log(`  ${"합계".padEnd(12, " ")} ${String(total).padStart(4, " ")}건`);
}

async function main() {
  // ★ 키 검사는 --confirm 경로에서만 합니다. 미리보기는 Supabase 만 읽고
  //   API 를 호출하지 않으므로, 키가 없는 로컬에서도 대상 건수는 확인할 수
  //   있어야 합니다("API 호출 0회" 라고 안내해 놓고 키를 요구하면 안 됩니다).
  const targets = await loadTargets();

  // 키워드로 잡히는 건 AI 를 부르지 않습니다(순수 함수라 세어보는 것도 무료).
  const needAi = targets.filter(
    (t) => classifyByKeyword(t.subject, t.fromName) === null,
  );
  const byKeyword = targets.length - needAi.length;

  console.log(
    `재분류 대상: ${targets.length}건 (ai_category = ${TARGET_CATEGORIES.join(" 또는 ")})`,
  );
  console.log(
    `  키워드로 처리 ${byKeyword}건 (AI 호출 없음) / AI 필요 ${needAi.length}건`,
  );
  await reportDistribution("현재 분포");

  if (!CONFIRM) {
    console.log(
      `\n미리보기입니다 — API 를 호출하지 않았습니다.` +
        `\n실제로 돌리려면: npm run reclassify:mail -- --confirm` +
        `\n(Anthropic API 를 ${needAi.length}회 호출합니다. 담당자는 갱신하지 않습니다.)`,
    );
    return;
  }

  if (targets.length === 0) {
    console.log("대상이 없어 종료합니다.");
    return;
  }

  // 키가 없어도 키워드 분류는 돌아갑니다. AI 가 필요한 건이 있을 때만 막습니다.
  if (needAi.length > 0 && !isClassifierConfigured()) {
    throw new Error(
      `ANTHROPIC_API_KEY 가 없습니다. ${needAi.length}건은 AI 가 있어야 분류됩니다.\n` +
        "  .env.local 에 추가하거나(Vercel 환경변수에서 복사), " +
        "키가 있는 환경에서 실행해주세요.",
    );
  }

  console.log(
    `\n재분류를 시작합니다 — API ${needAi.length}회 호출 예정` +
      ` (나머지 ${byKeyword}건은 키워드로 처리).\n`,
  );
  let processed = 0;
  let keywordDone = 0;
  let skipped = 0;
  let done = 0;

  const ids = targets.map((t) => t.id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const result = await runMailClassification({
      ids: chunk,
      force: true, // 이미 분석된 메일이므로 ai_processed_at 조건을 뺍니다
      keepAssignee: true, // ★ assignee_name 미갱신 — 사람이 정한 담당자 보호
      limit: chunk.length,
    });
    processed += result.processed;
    keywordDone += result.byKeyword;
    skipped += result.skipped;
    done += chunk.length;
    console.log(
      `  ${String(done).padStart(4, " ")}/${ids.length} 처리 중 ` +
        `— 성공 ${result.processed}(키워드 ${result.byKeyword}) · 실패 ${result.skipped}`,
    );
    // 크레딧이 바닥나면 남은 묶음은 AI 없이 키워드만 처리됩니다.
    //   조용히 계속 돌면 "다 됐다" 고 오해하므로 여기서 알립니다.
    if (result.creditExhausted) {
      console.warn(
        "\n  ⚠️ Anthropic 크레딧이 부족합니다. 남은 메일은 키워드로 잡히는 것만" +
          " 처리되고, 나머지는 기존 분류 그대로 남습니다(슬랙으로도 알렸습니다).",
      );
    }
  }

  console.log(
    `\n완료 — 성공 ${processed}건(키워드 ${keywordDone} · AI ${processed - keywordDone})` +
      ` · 미처리 ${skipped}건.`,
  );
  if (skipped > 0) {
    console.log(
      "  미처리분은 기존 분류가 그대로 남아 있습니다. 다시 실행하면 재시도합니다.",
    );
  }
  await reportDistribution("재분류 후 분포");
}

main().catch((e) => {
  console.error("재분류 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
