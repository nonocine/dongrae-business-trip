// 급여 계산 엔진 검증 — 실제 명세서(허일수 2026-05) 재현 테스트.
//   실행: npx tsx scripts/test-salary-calc.ts  (package.json: npm run test:salary)
//
//   목적:
//   1) 지급내역(기본급·관리업무수당·급식비·자격수당·가족수당·교통보조비)과
//      지급총액이 실측과 정확히 일치하는지 — 회귀 가드(불일치 시 실패).
//   2) 원 단위 절사(관리업무수당 428,050 / 주민세 38,590)가 재현되는지.
//   3) 국민연금·건강보험은 연간 고정 보수월액 기반이라 월 지급총액 기준
//      추정치와 차이가 남 — 그 차이를 "정보"로 출력(실패로 취급하지 않음).
import { calcMonthlyPayroll, type SalaryExtra } from "../lib/salary";

// 2026년 salary_config (라이브 DB 조회값).
const CONFIG_2026: Record<string, number> = {
  accident_rate: 0.0072,
  cert_allowance_1: 50000,
  cert_allowance_2: 50000,
  cert_allowance_3: 40000,
  employment_rate: 0.0115,
  health_rate: 0.03595,
  holiday_bonus_rate: 1.2,
  longterm_care_rate: 0.0657,
  meal_allowance: 160000,
  mgmt_allowance_rate: 0.09,
  pension_rate: 0.0475,
  resident_tax_rate: 0.1,
  sangjo_fee: 15000,
  transport_allowance: 50000,
};

// 허일수 2026-05 입력.
const heoExtra: SalaryExtra = {
  family_allowance: 90000,
  cert_level: "1", // 자격수당 50,000 (cert_allowance_1)
  mgmt_target: true, // 관리업무수당 대상
  overtime_target: false,
  sangjo: null, // 기본 sangjo_fee(15,000) 사용
  income_tax: 385960, // 갑근세(명세서 입력값)
};

const result = calcMonthlyPayroll({
  baseSalary: 4756180,
  extra: heoExtra,
  config: CONFIG_2026,
});

const amt = (items: { key: string; amount: number }[], key: string): number =>
  items.find((i) => i.key === key)?.amount ?? 0;

let failures = 0;
function expectEq(label: string, actual: number, expected: number) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "✓" : "✗"} ${label}: ${actual.toLocaleString()} (기대 ${expected.toLocaleString()})`
  );
}

console.log("=== 지급내역 (실측과 정확히 일치해야 함) ===");
expectEq("기본급", amt(result.payItems, "base"), 4756180);
expectEq("관리업무수당(10원 절사)", amt(result.payItems, "mgmt_allowance"), 428050);
expectEq("급식비", amt(result.payItems, "meal_allowance"), 160000);
expectEq("지도사자격수당", amt(result.payItems, "cert_allowance"), 50000);
expectEq("가족수당", amt(result.payItems, "family_allowance"), 90000);
expectEq("교통보조비", amt(result.payItems, "transport_allowance"), 50000);
expectEq("지급총액", result.totalPay, 5534230);

console.log("\n=== 공제내역 (원 단위 절사 검증) ===");
expectEq("갑근세", amt(result.deductItems, "income_tax"), 385960);
expectEq("주민세(10원 절사)", amt(result.deductItems, "resident_tax"), 38590);

console.log(
  "\n=== 국민연금·건강보험: 월 지급총액 기준 추정치 vs 실측 (차이는 정보) ==="
);
const ACTUAL = { pension: 241820, health: 214010 };
const est = {
  pension: amt(result.deductItems, "pension"),
  health: amt(result.deductItems, "health"),
};
for (const key of ["pension", "health"] as const) {
  const diff = est[key] - ACTUAL[key];
  const pct = ((diff / ACTUAL[key]) * 100).toFixed(1);
  console.log(
    `  ${key}: 추정 ${est[key].toLocaleString()} / 실측 ${ACTUAL[key].toLocaleString()} → 차이 ${
      diff >= 0 ? "+" : ""
    }${diff.toLocaleString()} (${pct}%)`
  );
}
console.log(
  `  (참고) 장기요양 ${amt(result.deductItems, "longterm_care").toLocaleString()}, 고용보험 ${amt(
    result.deductItems,
    "employment"
  ).toLocaleString()} — 실측 명세서엔 별도 표기 없음`
);
console.log(
  `  엔진 공제총액 ${result.totalDeduct.toLocaleString()} / 차인지급 ${result.netPay.toLocaleString()} (실측 공제 895,380 / 차인 4,638,850)`
);

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — 하드 검증 ${failures}건 실패`
);
process.exit(failures === 0 ? 0 : 1);
