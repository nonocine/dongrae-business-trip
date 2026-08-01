// 강사비 정산 계산 검증 (ST-4 프로그램별 공제 + ST-5 수강료 분배제)
//   실행: npx tsx scripts/test-settlement.ts  (package.json: npm run test:settle)
//
//   지시문 검증 케이스를 그대로 못박습니다.
//     ① 13명 × 88,000 × 70% = 800,800 / 공제 3.3% = 26,420(10원 절사)
//        / 차인지급 774,380
//     ② 혼합: 한 강사가 hourly + revenue_share 두 프로그램일 때
//        프로그램별 공제 후 합산
//   lib/settlement.ts 는 동업자씨·동래샘들 양쪽이 같은 파일을 쓴다(해시 일치).
import {
  calcInstructorSettlement,
  calcRevenueShareAmount,
  calcProgramDeduction,
  truncateTo10,
  detailMethod,
  calcFormula,
  deductionRateLabel,
  uniqueDeductionRates,
  type SettlementSessionInput,
  type SettlementRevenueInput,
} from "../lib/settlement";

let failures = 0;
function expectEq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "✓" : "✗"} ${label}: ${JSON.stringify(actual)}${
      ok ? "" : ` (기대 ${JSON.stringify(expected)})`
    }`
  );
}

// 바이올린 — 13명 × 88,000 × 70%, 공제 3.3%.
const VIOLIN: SettlementRevenueInput = {
  program_id: "pv",
  program_name: "바이올린 교실",
  deduction_rate: 3.3,
  enrolled: 13,
  tuition: 88000,
  share_rate: 70,
};

console.log("\n--- ① 분배제 단위 검증(지시문 숫자) ---");
expectEq("기준 금액", calcRevenueShareAmount(13, 88000, 70), 800800);
expectEq("공제 원본(절사 전)", calcProgramDeduction(800800, 3.3), 26426.4);
expectEq("10원 절사", truncateTo10(26426.4), 26420);

const r1 = calcInstructorSettlement([], [VIOLIN]);
expectEq("지급액(gross)", r1.gross_amount, 800800);
expectEq("공제액", r1.deduction_amount, 26420);
expectEq("차인지급(net)", r1.net_amount, 774380);
expectEq("대표 공제율", r1.deduction_rate, 3.3);
expectEq("조정 아님", r1.adjusted, false);
expectEq("detail 1건", r1.detail.length, 1);
expectEq("method", r1.detail[0].method, "revenue_share");
expectEq(
  "detail 값",
  {
    enrolled: r1.detail[0].enrolled,
    tuition: r1.detail[0].tuition,
    share_rate: r1.detail[0].share_rate,
    amount: r1.detail[0].amount,
  },
  { enrolled: 13, tuition: 88000, share_rate: 70, amount: 800800 }
);
// 표시용 프로그램 공제는 원 미만 절사(ST-4 규칙) — 항목값보다 6원 크다.
expectEq("표시용 프로그램 공제", r1.detail[0].deduction_amount, 26426);
expectEq("시급제 전용 필드 없음", r1.detail[0].sessions, undefined);
expectEq("산출내역 문구", calcFormula(r1.detail[0]), "13명 × 88,000 × 70%");

console.log("\n--- 오케스트라(다른 인원·수강료) ---");
const orch = calcInstructorSettlement(
  [],
  [
    {
      program_id: "po",
      program_name: "오케스트라",
      deduction_rate: 3.3,
      enrolled: 24,
      tuition: 120000,
      share_rate: 70,
    },
  ]
);
// 24 × 120,000 = 2,880,000 × 0.7 = 2,016,000. 공제 66,528 → 66,520.
expectEq("gross", orch.gross_amount, 2016000);
expectEq("공제", orch.deduction_amount, 66520);
expectEq("net", orch.net_amount, 2016000 - 66520);

console.log("\n--- 반올림 경계 ---");
// 7명 × 55,555 = 388,885 × 70% = 272,219.5 → round = 272,220 (0.5 는 올림).
expectEq("0.5 반올림", calcRevenueShareAmount(7, 55555, 70), 272220);
// 내림 경계도 확인: 3명 × 33,333 = 99,999 × 70% = 69,999.3 → 69,999.
expectEq("0.3 내림", calcRevenueShareAmount(3, 33333, 70), 69999);
expectEq("인원 0명 → 0원", calcRevenueShareAmount(0, 88000, 70), 0);
const zero = calcInstructorSettlement([], [{ ...VIOLIN, enrolled: 0 }]);
expectEq("0명 항목 gross/net", [zero.gross_amount, zero.net_amount], [0, 0]);

console.log("\n--- 시급제 회귀(ST-4 그대로) ---");
const hourlySessions: SettlementSessionInput[] = Array.from(
  { length: 4 },
  () => ({
    program_id: "ph",
    program_name: "핑퐁 탁구교실",
    hourly_rate: 40000,
    deduction_rate: 3.3,
    work_hours: 3,
  })
);
const h = calcInstructorSettlement(hourlySessions);
// 12h × 40,000 = 480,000. 공제 15,840 → 절사 후에도 15,840.
expectEq("gross", h.gross_amount, 480000);
expectEq("공제", h.deduction_amount, 15840);
expectEq("net", h.net_amount, 464160);
expectEq("method hourly", h.detail[0].method, "hourly");
expectEq("회차/시간", [h.detail[0].sessions, h.detail[0].hours], [4, 12]);
expectEq("산출내역 문구", calcFormula(h.detail[0]), "4회 × 3h × 40,000");
expectEq("분배제 필드 없음", h.detail[0].enrolled, undefined);
// method 없는 과거 항목은 hourly 로 본다.
expectEq(
  "method 없으면 hourly",
  detailMethod({ program_name: "x", amount: 1, sessions: 1, hours: 1, rate: 1 }),
  "hourly"
);

console.log("\n--- ② 혼합(hourly + revenue_share) ---");
// 같은 강사: 탁구(시급제, 공제 3.3%) + 바이올린(분배제, 공제 3.3%).
const mixed = calcInstructorSettlement(hourlySessions, [VIOLIN]);
expectEq("detail 2건", mixed.detail.length, 2);
expectEq(
  "detail 정렬(가나다)",
  mixed.detail.map((d) => d.program_name),
  ["바이올린 교실", "핑퐁 탁구교실"]
);
expectEq("gross = 480,000 + 800,800", mixed.gross_amount, 1280800);
// 공제 원본 = 15,840 + 26,426.4 = 42,266.4 → 10원 절사 = 42,260.
expectEq("공제(합계에 절사 1회)", mixed.deduction_amount, 42260);
expectEq("net", mixed.net_amount, 1280800 - 42260);
// 프로그램별 표시용 공제의 단순 합(42,266)은 항목값(42,260)보다 6원 크다 — 정상.
expectEq(
  "표시용 프로그램 공제 합",
  mixed.detail.reduce((s, d) => s + (d.deduction_amount ?? 0), 0),
  42266
);
expectEq("두 방식 합이 개별 합과 일치", mixed.gross_amount, h.gross_amount + r1.gross_amount);

console.log("\n--- 혼합 + 서로 다른 공제율 ---");
const mixed2 = calcInstructorSettlement(
  hourlySessions, // 3.3%
  [{ ...VIOLIN, deduction_rate: 8.8 }]
);
// 15,840 + (800,800 × 8.8% = 70,470.4) = 86,310.4 → 86,310.
expectEq("공제", mixed2.deduction_amount, 86310);
expectEq("대표 공제율(최고)", mixed2.deduction_rate, 8.8);
expectEq("사용된 공제율", uniqueDeductionRates(mixed2.detail), [3.3, 8.8]);
expectEq("공제율 표시", deductionRateLabel(mixed2.detail, 0), "3.3/8.8");

console.log("\n--- 담당자 조정(분배제만) ---");
// 인원만 조정: 13 → 11명.
const adjEnrolled = calcInstructorSettlement(
  [],
  [{ ...VIOLIN, adjusted_enrolled: 11 }]
);
expectEq("인원 조정 gross", adjEnrolled.gross_amount, calcRevenueShareAmount(11, 88000, 70));
expectEq("인원 조정 = 677,600", adjEnrolled.gross_amount, 677600);
expectEq("조정 플래그", adjEnrolled.adjusted, true);
expectEq("detail.adjusted", adjEnrolled.detail[0].adjusted, true);
expectEq("표시 인원", adjEnrolled.detail[0].enrolled, 11);
expectEq(
  "원래 자동값 보존(툴팁 근거)",
  [adjEnrolled.detail[0].auto_enrolled, adjEnrolled.detail[0].auto_amount],
  [13, 800800]
);
expectEq("문구에 (조정)", calcFormula(adjEnrolled.detail[0]), "11명 × 88,000 × 70% (조정)");
// 공제도 조정 금액 기준: 677,600 × 3.3% = 22,360.8 → 22,360.
expectEq("조정 후 공제", adjEnrolled.deduction_amount, 22360);
expectEq("조정 후 net", adjEnrolled.net_amount, 677600 - 22360);

// 금액 직접 지정: 인원 계산을 무시한다.
const adjAmount = calcInstructorSettlement(
  [],
  [{ ...VIOLIN, adjusted_amount: 750000 }]
);
expectEq("금액 조정 gross", adjAmount.gross_amount, 750000);
expectEq("금액 조정 시 인원 표시는 자동값 유지", adjAmount.detail[0].enrolled, 13);
// 750,000 × 3.3% = 24,750 → 절사 후 24,750.
expectEq("금액 조정 공제", adjAmount.deduction_amount, 24750);
expectEq("금액 조정 net", adjAmount.net_amount, 725250);

// 금액이 인원보다 우선.
const adjBoth = calcInstructorSettlement(
  [],
  [{ ...VIOLIN, adjusted_enrolled: 11, adjusted_amount: 750000 }]
);
expectEq("금액 우선", adjBoth.gross_amount, 750000);
expectEq("인원 표시는 조정 인원", adjBoth.detail[0].enrolled, 11);

// null 조정은 자동값 그대로(조정 아님).
const noAdj = calcInstructorSettlement(
  [],
  [{ ...VIOLIN, adjusted_enrolled: null, adjusted_amount: null }]
);
expectEq("null 조정은 자동", [noAdj.gross_amount, noAdj.adjusted], [800800, false]);
expectEq("adjusted 키 없음", "adjusted" in noAdj.detail[0], false);

// 음수·소수 방어.
const guard = calcInstructorSettlement(
  [],
  [{ ...VIOLIN, adjusted_enrolled: -5 }]
);
expectEq("음수 인원 → 0", guard.detail[0].enrolled, 0);
const guard2 = calcInstructorSettlement(
  [],
  [{ ...VIOLIN, adjusted_amount: 1000.6 }]
);
expectEq("소수 금액 → 반올림", guard2.gross_amount, 1001);

console.log("\n--- 혼합 + 조정 ---");
const mixedAdj = calcInstructorSettlement(hourlySessions, [
  { ...VIOLIN, adjusted_amount: 700000 },
]);
expectEq("gross", mixedAdj.gross_amount, 480000 + 700000);
// 15,840 + 23,100 = 38,940.
expectEq("공제", mixedAdj.deduction_amount, 38940);
expectEq("항목 조정 플래그", mixedAdj.adjusted, true);
expectEq(
  "시급제 항목은 조정 아님",
  mixedAdj.detail.find((d) => d.method === "hourly")?.adjusted,
  undefined
);

console.log("\n--- 프로그램 2개 분배제(공제 절사 1회) ---");
const twoRev = calcInstructorSettlement([], [
  VIOLIN,
  { ...VIOLIN, program_id: "pv2", program_name: "가야금 교실", enrolled: 5, tuition: 66000 },
]);
// 800,800 + round(5×66,000×0.7=231,000) = 1,031,800.
// 공제 26,426.4 + 7,623 = 34,049.4 → 34,040.
expectEq("gross", twoRev.gross_amount, 1031800);
expectEq("공제", twoRev.deduction_amount, 34040);
expectEq("net", twoRev.net_amount, 1031800 - 34040);

console.log("\n--- 빈 입력 ---");
const none = calcInstructorSettlement([], []);
expectEq(
  "전부 0",
  [none.gross_amount, none.deduction_amount, none.net_amount, none.detail.length],
  [0, 0, 0, 0]
);

console.log(`\n${failures === 0 ? "✅ 전부 통과" : `❌ 실패 ${failures}건`}`);
process.exit(failures === 0 ? 0 : 1);
