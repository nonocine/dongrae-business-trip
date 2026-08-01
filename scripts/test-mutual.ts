// 상조회 규정 금액·장부 집계 검증 + 권한 게이트 정적 검증 (MU-1~MU-2, MU-5)
//   실행: npx tsx scripts/test-mutual.ts  (package.json: npm run test:mutual)
//
//   지시문 검증 항목:
//     · 월 회비 자동 기입 14명 × 15,000 = 210,000 재현
//     · 규정 금액표(경조사) 값
//     · 이월 + 세입 − 세출 = 잔액, 월별 소계, 회비 중복 기입 판정
import {
  MUTUAL_FEE,
  MUTUAL_RULES,
  RETIREMENT_TIERS,
  SNACK_UNIT,
  YEAR_END_BONUS_MIN_BALANCE,
  YEAR_END_BONUS_UNIT,
  birthdaySnackAmount,
  birthdaysWithin,
  buildDescription,
  childbirthAmount,
  closingBalance,
  daysUntilBirthday,
  hasFeeForMonth,
  monthlyFeeAmount,
  monthlyFeeDescription,
  monthlyTotals,
  mutualCategories,
  mutualCategory,
  normalizeMemberStatus,
  sumEntries,
  type LedgerEntryLike,
} from "../lib/mutual";
import { readFileSync } from "node:fs";

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

console.log("\n--- 월 회비 (지시문 검증) ---");
expectEq("회비 단가", MUTUAL_FEE, 15_000);
expectEq("14명 × 15,000 = 210,000", monthlyFeeAmount(14), 210_000);
expectEq(
  "적요 자동 생성",
  monthlyFeeDescription(7, 14),
  "7월 상조회비 (회원 14명)"
);
expectEq("회원 0명 → 0원", monthlyFeeAmount(0), 0);
expectEq("음수 방어", monthlyFeeAmount(-3), 0);
expectEq("13명", monthlyFeeAmount(13), 195_000);
expectEq("15명", monthlyFeeAmount(15), 225_000);

console.log("\n--- 규정 금액표 ---");
const fixed = (key: string): number | null => {
  const r = mutualCategory(key)?.rule;
  return r && r.type === "fixed" ? r.amount : null;
};
expectEq("생일 축하금", fixed("birthday_cash"), 60_000);
expectEq("결혼(본인)", fixed("marriage"), 300_000);
expectEq("조의금 본인·배우자", fixed("death_self_spouse"), 300_000);
expectEq("조의금 부모", fixed("death_parent"), 200_000);
expectEq("조의금 자녀", fixed("death_child"), 200_000);
expectEq("조의금 형제자매", fixed("death_sibling"), 100_000);
expectEq("연말상여 단가", YEAR_END_BONUS_UNIT, 50_000);
expectEq("연말상여 조건 잔액", YEAR_END_BONUS_MIN_BALANCE, 2_000_000);
expectEq("퇴사지원금 1년 이상", RETIREMENT_TIERS[0].amount, 50_000);
expectEq(
  "세입 카테고리",
  mutualCategories("income").map((c) => c.key),
  ["fee", "interest", "cashback", "income_etc"]
);
expectEq(
  "세출 카테고리 수",
  mutualCategories("expense").length,
  MUTUAL_RULES.length - 4
);

console.log("\n--- 생일 간식비 ---");
expectEq("단가", SNACK_UNIT, 5_000);
expectEq("근무 8명 × 5,000", birthdaySnackAmount(8), 40_000);
expectEq("생일자 2명이면 배수", birthdaySnackAmount(8, 2), 80_000);
expectEq("근무 0명 → 0", birthdaySnackAmount(0), 0);
expectEq("생일자 0 입력도 최소 1로", birthdaySnackAmount(6, 0), 30_000);

console.log("\n--- 출산 축하금(두 산정방식) ---");
// 1·2차는 같고 3차부터 갈린다 — 규정이 두 가지로 읽혀 둘 다 둔다.
expectEq("1차 (차수비례)", childbirthAmount(1, "linear"), 100_000);
expectEq("1차 (두배증액)", childbirthAmount(1, "double"), 100_000);
expectEq("2차 (차수비례)", childbirthAmount(2, "linear"), 200_000);
expectEq("2차 (두배증액)", childbirthAmount(2, "double"), 200_000);
expectEq("3차 (차수비례)", childbirthAmount(3, "linear"), 300_000);
expectEq("3차 (두배증액)", childbirthAmount(3, "double"), 400_000);
expectEq("4차 (차수비례)", childbirthAmount(4, "linear"), 400_000);
expectEq("4차 (두배증액)", childbirthAmount(4, "double"), 800_000);
expectEq("0·음수 차수는 1차로", childbirthAmount(0, "linear"), 100_000);
expectEq("차수 상한 8 (두배증액)", childbirthAmount(99, "double"), 100_000 * 2 ** 7);

console.log("\n--- 적요 자동 생성 ---");
expectEq(
  "대상 있으면 템플릿 치환",
  buildDescription("birthday_cash", "홍길동"),
  "홍길동 생일 축하금"
);
expectEq(
  "대상 없으면 카테고리 라벨",
  buildDescription("birthday_cash", null),
  "생일 축하금"
);
expectEq(
  "템플릿 없는 카테고리",
  buildDescription("interest", "홍길동"),
  "이자"
);
expectEq("모르는 카테고리", buildDescription("nope", "홍길동"), "");

console.log("\n--- 장부 집계 ---");
const entries: LedgerEntryLike[] = [
  { entry_date: "2026-01-31", kind: "income", amount: 210_000 },
  { entry_date: "2026-02-28", kind: "income", amount: 210_000 },
  { entry_date: "2026-02-24", kind: "expense", amount: 60_000 },
  { entry_date: "2026-02-24", kind: "expense", amount: 40_000 },
  { entry_date: "2026-03-31", kind: "income", amount: 1_234 }, // 이자
  { entry_date: "2026-12-20", kind: "expense", amount: 700_000 }, // 연말상여
];
const t = sumEntries(entries);
expectEq("세입 합계", t.income, 421_234);
expectEq("세출 합계", t.expense, 800_000);
expectEq("순액", t.net, -378_766);
expectEq("이월 1,000,000 + 순액", closingBalance(1_000_000, t), 621_234);
expectEq("이월 0", closingBalance(0, t), -378_766);
expectEq("빈 장부", sumEntries([]), { income: 0, expense: 0, net: 0 });

const m = monthlyTotals(entries);
expectEq("1월", [m[0].income, m[0].expense, m[0].net], [210_000, 0, 210_000]);
expectEq("2월", [m[1].income, m[1].expense, m[1].net], [210_000, 100_000, 110_000]);
expectEq("3월", [m[2].income, m[2].expense], [1_234, 0]);
expectEq("4월(빈 달)", [m[3].income, m[3].expense, m[3].net], [0, 0, 0]);
expectEq("12월", [m[11].income, m[11].expense, m[11].net], [0, 700_000, -700_000]);
expectEq("12개월", m.length, 12);
expectEq(
  "월별 소계 합 = 전체 합",
  m.reduce((s, r) => s + r.net, 0),
  t.net
);

// 누적 잔액(화면 월별 소계 3행)이 마지막에 잔액과 만나는지.
const carry = 1_061_360;
const running = m.reduce<number[]>((acc, r, i) => {
  acc.push((i === 0 ? carry : acc[i - 1]) + r.net);
  return acc;
}, []);
expectEq("누적 잔액 마지막 = 이월+순액", running[11], closingBalance(carry, t));

console.log("\n--- 회비 중복 기입 판정 ---");
const feeRows = [
  { entry_date: "2026-01-31", kind: "income" as const, category: "fee" },
  { entry_date: "2026-02-28", kind: "income" as const, category: "fee" },
  { entry_date: "2026-03-15", kind: "expense" as const, category: "birthday_cash" },
  { entry_date: "2025-03-31", kind: "income" as const, category: "fee" },
];
expectEq("2026-01 기입됨", hasFeeForMonth(feeRows, 2026, 1), true);
expectEq("2026-02 기입됨", hasFeeForMonth(feeRows, 2026, 2), true);
expectEq("2026-03 미기입(지출만 있음)", hasFeeForMonth(feeRows, 2026, 3), false);
expectEq("연도가 다르면 별개", hasFeeForMonth(feeRows, 2026, 3), false);
expectEq("2025-03 기입됨", hasFeeForMonth(feeRows, 2025, 3), true);

console.log("\n--- 회원 상태 ---");
expectEq("기본 active", normalizeMemberStatus(undefined), "active");
expectEq("paused", normalizeMemberStatus("paused"), "paused");
expectEq("left", normalizeMemberStatus("left"), "left");
expectEq("이상값은 active", normalizeMemberStatus("zzz"), "active");

console.log("\n--- 생일 D-day (MU-3) ---");
expectEq("오늘 생일", daysUntilBirthday("1984-02-24", "2026-02-24"), 0);
expectEq("3일 뒤", daysUntilBirthday("1990-02-27", "2026-02-24"), 3);
expectEq("어제 지난 생일 → 내년까지", daysUntilBirthday("1990-02-23", "2026-02-24"), 364);
expectEq("연말→연초 넘김", daysUntilBirthday("1990-01-02", "2025-12-31"), 2);
expectEq("잘못된 날짜", daysUntilBirthday("bad", "2026-02-24"), null);
// 2/29 생일은 평년에 3/1 로 밀지 않고 다음 윤년까지 기다린다.
expectEq(
  "2/29 생일은 평년에 건너뜀",
  daysUntilBirthday("2000-02-29", "2026-02-24"),
  Math.round(
    (Date.UTC(2028, 1, 29) - Date.UTC(2026, 1, 24)) / 86_400_000
  )
);

const members = [
  { name: "김가", birthDate: "1990-02-26" }, // 2일 뒤
  { name: "이나", birthDate: "1988-02-24" }, // 오늘
  { name: "박다", birthDate: "1992-06-01" }, // 범위 밖
  { name: "최라", birthDate: null }, // 생일 없음
  { name: "정마", birthDate: "1995-03-03" }, // 7일 뒤
];
const soon = birthdaysWithin(members, "2026-02-24", 7);
expectEq(
  "7일 내 생일자 (D-day 순)",
  soon.map((b) => [b.name, b.dday, b.monthDay]),
  [
    ["이나", 0, "2/24"],
    ["김가", 2, "2/26"],
    ["정마", 7, "3/3"],
  ]
);
expectEq("범위 0일이면 오늘만", birthdaysWithin(members, "2026-02-24", 0).length, 1);

// =====================================================================
// MU-5. 권한 2층 정적 검증 — 변경 액션이 실수로 조회 게이트를 쓰지 않는지.
//   화면에서 버튼을 숨기는 것은 방어가 아니므로, 서버 액션마다 올바른 게이트가
//   붙어 있는지 소스에서 직접 확인한다(리팩터링 회귀 방지).
// =====================================================================
console.log("\n--- 서버 액션 권한 게이트 ---");

// 조회 전용으로 열어 둔 액션(그 외 export 는 모두 manage 여야 한다).
const VIEW_ONLY: Record<string, string[]> = {
  "app/hr/mutual/memberActions.ts": ["getMemberOverview", "countActiveMembers"],
  "app/hr/mutual/ledgerActions.ts": ["getLedger"],
  "app/hr/mutual/importActions.ts": [],
  "app/hr/mutual/policyActions.ts": ["getMutualPolicy"],
};

for (const [file, viewOnly] of Object.entries(VIEW_ONLY)) {
  const src = readFileSync(file, "utf8");
  // export 된 async 함수 본문을 다음 export 직전까지 잘라 게이트를 확인한다.
  const names = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  for (const name of names) {
    const start = src.indexOf(`export async function ${name}`);
    const nextIdx = names
      .map((n) => src.indexOf(`export async function ${n}`))
      .filter((i) => i > start)
      .sort((a, b) => a - b)[0];
    const body = src.slice(start, nextIdx === undefined ? src.length : nextIdx);
    const hasView = body.includes("requireMutualView(");
    const hasManage = body.includes("requireMutualManage(");
    const shouldBeView = viewOnly.includes(name);
    expectEq(
      `${file.split("/").pop()} ${name} → ${shouldBeView ? "view" : "manage"}`,
      shouldBeView ? hasView && !hasManage : hasManage,
      true
    );
  }
}

// 라우트 핸들러는 레이아웃 가드 밖 → 자체 manage 검증이 있어야 한다.
for (const route of [
  "app/hr/mutual/excel/route.ts",
]) {
  expectEq(
    `${route} 자체 권한 재검증`,
    readFileSync(route, "utf8").includes("requireMutualManage("),
    true
  );
}

// 관리 전용 페이지는 canManage 를 확인해 되돌려보내야 한다.
expectEq(
  "연마감 페이지 canManage 가드",
  readFileSync("app/hr/mutual/closing/page.tsx", "utf8").includes(
    "!access.canManage"
  ),
  true
);

console.log(`\n${failures === 0 ? "✅ 전부 통과" : `❌ 실패 ${failures}건`}`);
process.exit(failures === 0 ? 0 : 1);
