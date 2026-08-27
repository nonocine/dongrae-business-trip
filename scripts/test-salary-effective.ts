// 호봉표 발효월(effective_from) 규칙 검증.
//   실행: npx tsx scripts/test-salary-effective.ts (package.json: npm run test:effective)
//
//   임금 인상이 연중에 발효되므로 호봉표는 (year, grade, step, effective_from)
//   단위입니다. 급여월 1일 기준으로 유효한 **최신** 발효분을 골라야 하고,
//   그래야 8월 인상분이 7월 명세서로 소급되지 않습니다.
//   아래 단가는 라이브 DB 조회값(6급 2호봉·7급 1호봉)입니다.
import {
  currentEffectiveFrom,
  payrollEffectiveDate,
  pickEffectiveBase,
  pickEffectiveRow,
} from "../lib/salary";

let failures = 0;
function expectEq(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${actual} (기대 ${expected})`);
}

// 2026년 6급 2호봉 — 1월 발효(구 단가) / 8월 발효(신 단가) 두 세트.
const grade6step2 = [
  { effective_from: "2026-01-01", base_salary: 2064690 },
  { effective_from: "2026-08-01", base_salary: 2097100 },
];

console.log("=== 급여월 기준 기본급 선택 ===");
expectEq(
  "1월 급여 → 구 단가",
  pickEffectiveBase(grade6step2, payrollEffectiveDate(2026, 1)),
  2064690,
);
expectEq(
  "7월 급여 → 구 단가(소급 없음)",
  pickEffectiveBase(grade6step2, payrollEffectiveDate(2026, 7)),
  2064690,
);
expectEq(
  "8월 급여 → 신 단가",
  pickEffectiveBase(grade6step2, payrollEffectiveDate(2026, 8)),
  2097100,
);
expectEq(
  "12월 급여 → 신 단가 유지",
  pickEffectiveBase(grade6step2, payrollEffectiveDate(2026, 12)),
  2097100,
);

console.log("\n=== 기준일 문자열 ===");
expectEq("1자리 월 0 채움", payrollEffectiveDate(2026, 8), "2026-08-01");
expectEq("두 자리 월", payrollEffectiveDate(2026, 12), "2026-12-01");

console.log("\n=== 경계·예외 ===");
// 발효 전 달만 있는 경우 — 쓸 단가가 없으면 null(호출부는 '기본급 없음' 처리).
expectEq(
  "발효 전이면 null",
  pickEffectiveBase(
    [{ effective_from: "2026-08-01", base_salary: 2097100 }],
    payrollEffectiveDate(2026, 7),
  ),
  null,
);
expectEq("빈 목록이면 null", pickEffectiveBase([], "2026-08-01"), null);
// 발효월이 비어 있는 옛 행은 항상 유효한 것으로 본다(하위호환).
expectEq(
  "발효월 없는 옛 행은 그대로 사용",
  pickEffectiveBase(
    [{ effective_from: "", base_salary: 2001410 }],
    payrollEffectiveDate(2026, 3),
  ),
  2001410,
);
// 발효월이 같은 날 시작하는 달은 그 달부터 적용(경계 포함).
expectEq(
  "발효월 당월은 신 단가",
  pickEffectiveRow(grade6step2, "2026-08-01")?.effective_from,
  "2026-08-01",
);

console.log("\n=== 화면에 보일 발효분(편집 대상) ===");
const rows = [
  { effective_from: "2026-01-01" },
  { effective_from: "2026-08-01" },
];
expectEq("8월 이후 오늘 → 8월 발효분", currentEffectiveFrom(rows, "2026-08-27"), "2026-08-01");
expectEq("7월 오늘 → 1월 발효분", currentEffectiveFrom(rows, "2026-07-15"), "2026-01-01");
expectEq(
  "전부 미래면 가장 이른 것으로 폴백",
  currentEffectiveFrom([{ effective_from: "2027-01-01" }], "2026-08-27"),
  "2027-01-01",
);
expectEq("행이 없으면 null", currentEffectiveFrom([], "2026-08-27"), null);

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — 검증 ${failures}건 실패`);
process.exit(failures === 0 ? 0 : 1);
