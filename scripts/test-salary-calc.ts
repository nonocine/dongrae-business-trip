// 급여 계산 엔진 검증 — 실제 급여대장 재현 테스트.
//   실행: npx tsx scripts/test-salary-calc.ts  (package.json: npm run test:salary)
//
//   4대보험은 요율 계산이 아니라 공단 고지액(extra 입력값)을 그대로 공제하므로,
//   입력값을 넣으면 미리보기가 실제 대장과 "원 단위까지" 일치해야 합니다.
//   0/미입력 항목(예: 허일수 고용보험·장기요양)은 명세서에서 제외되어야 합니다.
import {
  calcMonthlyPayroll,
  normalizeSalaryExtra,
  type SalaryExtra,
} from "../lib/salary";

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

let failures = 0;
function expectEq(label: string, actual: number, expected: number) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "✓" : "✗"} ${label}: ${actual.toLocaleString()} (기대 ${expected.toLocaleString()})`
  );
}
function expectAbsent(
  label: string,
  items: { key: string }[],
  key: string
) {
  const ok = !items.some((i) => i.key === key);
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}: 공제내역에 '${key}' 줄 없음`);
}
const amt = (items: { key: string; amount: number }[], key: string): number =>
  items.find((i) => i.key === key)?.amount ?? 0;

// ---------------------------------------------------------------------
// 케이스 1: 허일수 2026-07 — 기존 저장 데이터(급식/교통 on/off 키 없음)
//   normalizeSalaryExtra 로 로드 시 meal_target·transport_target 이 기본 true 로
//   채워져 급식비·교통보조비가 정상 표시되어야 함(하위호환).
// ---------------------------------------------------------------------
console.log("=== 케이스 1: 허일수 2026-07 (기존 저장 데이터 하위호환) ===");
const heoLegacyRaw = {
  // meal_target / transport_target 키 없음 — 예전에 저장된 형태.
  family_allowance: 90000,
  cert_level: "1",
  mgmt_target: true,
  overtime_target: false,
  sangjo: null,
  income_tax: 385960,
  pension: 246470,
  health: 214010,
  longterm_care: 0,
  employment_ins: 0,
};
const heoExtra = normalizeSalaryExtra(heoLegacyRaw);
expectEq(
  "하위호환: meal_target 기본 true",
  heoExtra.meal_target ? 1 : 0,
  1
);
expectEq(
  "하위호환: transport_target 기본 true",
  heoExtra.transport_target ? 1 : 0,
  1
);
const heo = calcMonthlyPayroll({
  baseSalary: 4756180,
  extra: heoExtra,
  config: CONFIG_2026,
});

console.log("[지급내역]");
expectEq("급식비(하위호환 표시)", amt(heo.payItems, "meal_allowance"), 160000);
expectEq("교통보조비(하위호환 표시)", amt(heo.payItems, "transport_allowance"), 50000);
expectEq("관리업무수당(10원 절사)", amt(heo.payItems, "mgmt_allowance"), 428050);
expectEq("지급총액", heo.totalPay, 5534230);
console.log("[공제내역]");
expectEq("갑근세", amt(heo.deductItems, "income_tax"), 385960);
expectEq("주민세(자동 10%)", amt(heo.deductItems, "resident_tax"), 38590);
expectEq("국민연금(입력)", amt(heo.deductItems, "pension"), 246470);
expectEq("국민건강(입력)", amt(heo.deductItems, "health"), 214010);
expectEq("상조회비", amt(heo.deductItems, "sangjo"), 15000);
expectAbsent("고용보험(0)", heo.deductItems, "employment");
expectAbsent("장기요양(0)", heo.deductItems, "longterm_care");
expectEq("공제총액", heo.totalDeduct, 900030);
expectEq("차인지급액", heo.netPay, 4634200);

// ---------------------------------------------------------------------
// 케이스 2: 노미현 — 고용보험 45,930 입력 시 고용보험 줄이 표시되는지
//   (기본급/기타 실측 전체는 미상 → 핵심 동작만 검증: 입력값 그대로 표시)
// ---------------------------------------------------------------------
console.log("\n=== 케이스 2: 노미현 — 고용보험 입력 표시 ===");
const nomiExtra: SalaryExtra = {
  family_allowance: 0,
  cert_level: "",
  meal_target: true,
  transport_target: true,
  mgmt_target: false,
  overtime_target: true,
  sangjo: null,
  income_tax: 0,
  pension: 213840,
  health: 185820,
  longterm_care: 24070,
  employment_ins: 45930,
};
const nomi = calcMonthlyPayroll({
  baseSalary: 4756180,
  extra: nomiExtra,
  config: CONFIG_2026,
});
expectEq("고용보험(입력 표시)", amt(nomi.deductItems, "employment"), 45930);
expectEq("장기요양(입력 표시)", amt(nomi.deductItems, "longterm_care"), 24070);
// 갑근세 0 → 갑근세/주민세 줄 없음(주민세는 갑근세 기반).
expectAbsent("갑근세(0)", nomi.deductItems, "income_tax");
expectAbsent("주민세(갑근세 0)", nomi.deductItems, "resident_tax");

// ---------------------------------------------------------------------
// 케이스 3: 김준호·한지형 — 자격수당 없음(cert_level ''), 급식/교통 기본 지급
// ---------------------------------------------------------------------
console.log("\n=== 케이스 3: 자격수당 '없음' + 급식/교통 기본 ===");
const noCert = calcMonthlyPayroll({
  baseSalary: 2064690,
  extra: normalizeSalaryExtra({ cert_level: "" }), // 나머지 기본값
  config: CONFIG_2026,
});
expectAbsent("자격수당 미표시", noCert.payItems, "cert_allowance");
expectEq("급식비 기본 지급", amt(noCert.payItems, "meal_allowance"), 160000);
expectEq("교통보조비 기본 지급", amt(noCert.payItems, "transport_allowance"), 50000);

// ---------------------------------------------------------------------
// 케이스 4: 지급 항목 개인 예외 — 급식/교통 해제 시 명세서에서 제외
// ---------------------------------------------------------------------
console.log("\n=== 케이스 4: 급식/교통 대상 해제(예외 직원) ===");
const noMealTransport = calcMonthlyPayroll({
  baseSalary: 2064690,
  extra: normalizeSalaryExtra({ meal_target: false, transport_target: false }),
  config: CONFIG_2026,
});
expectAbsent("급식비 해제 → 미표시", noMealTransport.payItems, "meal_allowance");
expectAbsent(
  "교통보조비 해제 → 미표시",
  noMealTransport.payItems,
  "transport_allowance"
);

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — 검증 ${failures}건 실패`
);
process.exit(failures === 0 ? 0 : 1);
