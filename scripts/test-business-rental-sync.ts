// 홈페이지 대관 → 사업실적 자동 반입 — 라이브 검증.
//   실행: node --import tsx scripts/test-business-rental-sync.ts [--apply-month=YYYY-MM]
//
//   ① dryRun + ignoreStartMonth 로 2026년 7·8·9월 "동래점빵 다있소" 계산값이
//      기존 수기 실적(김혜지 입력)과 같은지 — 7월 4일·400명 / 8월 4일·403명 /
//      9월 3일·324명.
//   ② 같은 dryRun 에서 7~9월이 규칙 a(skippedExistingManual)로 판정되는지
//      — 실제 실행 때 수기 실적과 중복 생성되지 않아야 합니다.
//   ③ --apply-month 를 주면 그 달을 실제로 1회 실행해 요약을 출력합니다.
//
//   ⚠️ ①② 는 아무것도 쓰지 않습니다(dryRun).

import { readFileSync } from "node:fs";

let failed = 0;
function chk(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✔" : "✘"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed += 1;
}

async function main() {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  const { syncRentalToBusinessResults, formatRentalSyncSummary } = await import(
    "../lib/businessRentalSync"
  );

  const expected: Record<number, { days: number; persons: number }> = {
    7: { days: 4, persons: 400 },
    8: { days: 4, persons: 403 },
    9: { days: 3, persons: 324 },
  };
  for (const month of [7, 8, 9]) {
    const s = await syncRentalToBusinessResults({
      year: 2026,
      month,
      dryRun: true,
      ignoreStartMonth: true,
    });
    console.log(formatRentalSyncSummary(s));
    const item = s.items.find((i) => i.programName.includes("다있소"));
    console.log(JSON.stringify(item));
    const e = expected[month];
    chk(
      `2026-${month} 다있소 계산값 ${e.days}일·${e.persons}명`,
      item?.operating_days === e.days && item?.participants === e.persons,
      `실제 ${item?.operating_days}일·${item?.participants}명 (횟수 ${item?.sessions})`,
    );
    chk(
      `2026-${month} 규칙 a(skippedExistingManual)`,
      item?.action === "skippedExistingManual",
      `판정 ${item?.action}`,
    );
    chk(`2026-${month} 오류 없음`, s.errors.length === 0, s.errors.join(" / "));
  }

  const apply = process.argv
    .find((a) => a.startsWith("--apply-month="))
    ?.split("=")[1];
  if (apply) {
    const [y, m] = apply.split("-").map(Number);
    const s = await syncRentalToBusinessResults({ year: y, month: m });
    console.log(`[실제 실행] ${formatRentalSyncSummary(s)}`);
    console.log(JSON.stringify(s, null, 2));
    chk(`${apply} 실제 실행 오류 없음`, s.errors.length === 0, s.errors.join(" / "));
  }

  console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
