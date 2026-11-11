// ERP 동기화 수동 1회 실행(로컬) — Cron 과 같은 lib/erp/sync 를 그대로 돌립니다.
//   실행: npx tsx scripts/erp-sync.ts   (trigger='manual' 로 erp_sync_runs 에 기록)
//   ⚠️ 실제 DB(erp_* 표, employee_profiles.erp_employee_id 빈 칸)에 씁니다.
//   출력은 API 별 건수·성공 여부·오류 코드만(키·금액·계좌·이름 없음).
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";

for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

// `import "server-only"` — Next 밖(tsx)에서는 빈 모듈로.
type Resolve = (request: string, ...rest: unknown[]) => string;
const M = Module as unknown as { _resolveFilename: Resolve };
const orig = M._resolveFilename;
M._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return require.resolve("next/dist/compiled/server-only/empty.js");
  return orig.call(this, request, ...rest);
};

(async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runErpSync, formatErpSyncSummary } = require("../lib/erp/sync") as typeof import("../lib/erp/sync");
  const t0 = Date.now();
  const s = await runErpSync("manual");
  for (const r of s.results)
    console.log(
      `${r.api.padEnd(14)} ${r.ok ? "성공" : "실패"} · 받음 ${r.fetched} · 저장 ${r.upserted} · 사라짐 ${r.removed}` +
        `${r.range ? ` · ${r.range.start}~${r.range.end}` : ""}${r.error ? ` · ${r.error}` : ""}`
    );
  console.log(s.link ? `직원 자동 연결: +${s.link.linked} (모호 ${s.link.ambiguous}, 없음 ${s.link.notFound})` : `직원 연결 오류: ${s.linkError}`);
  console.log(formatErpSyncSummary(s));
  console.log(`소요 ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  process.exit(s.results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
