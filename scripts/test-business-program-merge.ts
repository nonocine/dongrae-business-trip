// 사업실적 프로그램 합치기 — 같은 달 중복 처리 계획(planMergeDuplicates) 검증.
//   실행: npm run test:program-merge   (DB 없음)
import { planMergeDuplicates, type MergeRowInfo } from "../lib/businessProgramAdmin";

let failed = 0;
function chk(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✔" : "✘"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed += 1;
}

const row = (p: Partial<MergeRowInfo> & { id: string }): MergeRowInfo => ({
  report_year: 2026,
  report_month: 9,
  source_type: null,
  source_key: null,
  status: "draft",
  manual_override: false,
  moved: false,
  ...p,
});

// 9월: 남길 프로그램 자동 행(L1) + 옮겨 온 자동 행(L2) → 둘 다 다시 계산, 경고 없음.
// 10월: 남길 수기 행 + 옮겨 온 자동 행 → 자동 행 다시 계산 + 수기 경고.
// 11월: 옮겨 온 행 1개뿐 → 중복 아님.
// 12월: 원래부터 남길 프로그램에 2행(옮긴 행 없음) → 이번 작업과 무관(무시).
// 8월: 제출된 자동 행 + 옮겨 온 자동 행 → 둘 다 다시 계산 대상(제출 행은 동기화가 숫자 유지) + 경고.
const plan = planMergeDuplicates([
  row({ id: "a", source_type: "rental", source_key: "L1:2026-09" }),
  row({ id: "b", source_type: "rental", source_key: "L2:2026-09", moved: true }),
  row({ id: "c", report_month: 10 }),
  row({ id: "d", report_month: 10, source_type: "rental", source_key: "L2:2026-10", moved: true }),
  row({ id: "e", report_month: 11, moved: true }),
  row({ id: "f", report_month: 12 }),
  row({ id: "g", report_month: 12 }),
  row({ id: "h", report_month: 8, source_type: "rental", source_key: "L1:2026-08", status: "submitted" }),
  row({ id: "i", report_month: 8, source_type: "rental", source_key: "L2:2026-08", moved: true }),
]);

const keys = plan.resync.map((r) => `${r.linkId}:${r.year}-${r.month}`).sort();
chk("중복 달 3개(8·9·10월)", plan.duplicateMonths === 3, String(plan.duplicateMonths));
chk(
  "자동 행 다시 계산 대상",
  keys.join(",") === "L1:2026-8,L1:2026-9,L2:2026-10,L2:2026-8,L2:2026-9",
  keys.join(","),
);
chk("수기 행 경고(10월)", plan.warnings.some((w) => w.startsWith("2026년 10월") && w.includes("수기 행 1개")));
chk("제출 자동 행 경고(8월)", plan.warnings.some((w) => w.startsWith("2026년 8월") && w.includes("제출")));
chk("자동 행끼리(9월)는 경고 없음", !plan.warnings.some((w) => w.startsWith("2026년 9월")));
chk("옮긴 행 없는 12월 무시", !plan.warnings.some((w) => w.startsWith("2026년 12월")));
chk("수기 행은 다시 계산 대상 아님", plan.resync.length === 5);

console.log(failed ? `\n✘ 실패 ${failed}건` : "\n✔ 모두 통과");
process.exit(failed ? 1 : 0);
