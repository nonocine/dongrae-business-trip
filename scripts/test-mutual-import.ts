// 과거 상조회 장부 이관 파서 검증 (MU-4)
//   실행: npx tsx scripts/test-mutual-import.ts [파일경로]
//         (package.json: npm run test:mutual-import)
//   기본 경로: C:\Users\user\Desktop\상조회비 지출현황.xlsx
//
//   지시문 검증 항목:
//     · 2025 시트 세입·세출 합계와 잔액(1,061,360)이 파싱 결과와 일치하는지
//     · 2010·2011 처럼 머리글 행 위치가 다른 변형을 흡수하는지
//   파일이 없으면(다른 PC) 합성 시트로 파서 동작만 검증하고 통과 처리한다.
import { existsSync, readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import {
  parseMutualWorkbook,
  planCarryOvers,
  carryOverEntries,
  unknownCategories,
  yearRuns,
  checkImportRange,
  parseAmount,
  parseEntryDate,
  monthFromDescription,
  inferIncomeCategory,
  inferExpenseCategory,
} from "../lib/mutualImport";
import { sumEntries } from "../lib/mutual";

const FILE =
  process.argv[2] ?? "C:/Users/user/Desktop/상조회비 지출현황.xlsx";

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
const krw = (n: number) => n.toLocaleString("ko-KR");

function main() {
  console.log("\n--- 금액·날짜 파싱 ---");
  expectEq("콤마 금액", parseAmount("266,612"), 266_612);
  expectEq("앞뒤 공백", parseAmount(" 140,000 "), 140_000);
  expectEq("원화 기호", parseAmount("₩50,000 "), 50_000);
  expectEq("숫자 셀", parseAmount(1_061_360), 1_061_360);
  expectEq("빈 값", parseAmount(null), null);
  expectEq("문자만", parseAmount("기한 미달"), null);

  expectEq("신형 날짜", parseEntryDate("2025.01.17", 2025), "2025-01-17");
  expectEq("공백 섞인 날짜", parseEntryDate("2011. 04. 01", 2011), "2011-04-01");
  expectEq("한 자리 일", parseEntryDate("2011.12.7", 2011), "2011-12-07");
  expectEq("2자리 연도", parseEntryDate("10.01.04", 2010), "2010-01-04");
  expectEq("2자리 연도(11)", parseEntryDate("11.02.28", 2011), "2011-02-28");
  expectEq("하이픈", parseEntryDate("2024-01-04", 2024), "2024-01-04");
  expectEq("날짜 아님", parseEntryDate("생일 축하금", 2025), null);

  expectEq("월 추출", monthFromDescription("1월 상조회비"), 1);
  expectEq("월 추출(두 자리)", monthFromDescription("12월 캐쉬백"), 12);
  expectEq("월 없음", monthFromDescription("이월금"), null);
  expectEq("월 없음(예금이자)", monthFromDescription("예금이자"), null);

  console.log("\n--- 카테고리 추론 ---");
  expectEq("상조회비→fee", inferIncomeCategory("7월 상조회비"), "fee");
  expectEq("이자→interest", inferIncomeCategory("7월 이자"), "interest");
  expectEq("캐시백→cashback", inferIncomeCategory("7월 캐시백"), "cashback");
  expectEq("캐쉬백(오타)→cashback", inferIncomeCategory("12월 캐쉬백"), "cashback");
  expectEq("환급→기타", inferIncomeCategory("우편원격교육 환급"), "income_etc");
  expectEq(
    "생일 축하금→birthday_cash",
    inferExpenseCategory("정다영 생일 축하금"),
    "birthday_cash"
  );
  expectEq(
    "생일 간식비→birthday_snack",
    inferExpenseCategory("노미현 생일 간식비"),
    "birthday_snack"
  );
  expectEq(
    "생일파티 다과→birthday_snack",
    inferExpenseCategory("2월 생일파티 다과(이은강, 최필림)"),
    "birthday_snack"
  );
  expectEq(
    "생일선물 상품권→birthday_cash",
    inferExpenseCategory("생일선물 상품권(10장)"),
    "birthday_cash"
  );
  expectEq("퇴사 지원금→retirement", inferExpenseCategory("이화영 퇴사 지원금"), "retirement");
  expectEq("퇴사선물→retirement", inferExpenseCategory("퇴사선물(김현정)"), "retirement");
  expectEq("출산→childbirth", inferExpenseCategory("박지은 출산 축하금"), "childbirth");
  expectEq("결혼→marriage", inferExpenseCategory("이현아 결혼 축의금"), "marriage");
  expectEq("부친상→death_parent", inferExpenseCategory("김소연 부친상 조의금"), "death_parent");
  expectEq("모친상→death_parent", inferExpenseCategory("각우스님 모친상 부의금"), "death_parent");
  expectEq(
    "누님 결혼은 결혼이 우선",
    inferExpenseCategory("박준우 누님 결혼"),
    "marriage"
  );
  // 관계가 불명한 조의금은 세분하지 않고 기타로 둔다(규정 금액 오표기 방지).
  expectEq(
    "관계 불명 조의금→기타",
    inferExpenseCategory("공창복지관 관장님 모친상 부의금"),
    "death_parent"
  );
  expectEq("근조기 구매→기타", inferExpenseCategory("근조기 구매"), "expense_etc");
  expectEq("단체복 자부담→기타", inferExpenseCategory("단체복 제작 자부담금 지원"), "expense_etc");

  // =====================================================================
  console.log("\n--- 실제 파일 파싱 ---");
  if (!existsSync(FILE)) {
    console.log(`⚠ 파일이 없어 실제 시트 검증을 건너뜁니다: ${FILE}`);
    console.log(`\n${failures === 0 ? "✅ (파서 단위만) 통과" : `❌ 실패 ${failures}건`}`);
    process.exit(failures === 0 ? 0 : 1);
  }

  const res = parseMutualWorkbook(new Uint8Array(readFileSync(FILE)));
  expectEq(
    "시트 5개(연도순)",
    res.sheets.map((s) => s.year),
    [2010, 2011, 2023, 2024, 2025]
  );
  expectEq(
    "머리글 행 위치(구형 3행 / 신형 6행)",
    res.sheets.map((s) => s.headerRow),
    [3, 3, 6, 6, 6]
  );

  console.log("\n  연도별 시트값 ↔ 파싱값 대조");
  console.log(
    "  " +
      ["연도", "세입(시트)", "세입(파싱)", "세출(시트)", "세출(파싱)", "잔액(시트)", "잔액(파싱)"]
        .map((h) => h.padStart(12))
        .join("")
  );
  for (const s of res.sheets) {
    console.log(
      "  " +
        [
          String(s.year),
          krw(s.sheetIncomeTotal ?? 0),
          krw(s.parsedIncome),
          krw(s.sheetExpenseTotal ?? 0),
          krw(s.parsedExpense),
          krw(s.sheetBalance ?? 0),
          krw(s.parsedNet),
        ]
          .map((v) => v.padStart(12))
          .join("")
    );
  }

  for (const s of res.sheets) {
    expectEq(`${s.year} 세입 합계 일치`, s.incomeMatches, true);
    expectEq(`${s.year} 세출 합계 일치`, s.expenseMatches, true);
    expectEq(`${s.year} 잔액 일치`, s.balanceMatches, true);
  }

  console.log("\n--- 지시문 검증: 2025 ---");
  const y25 = res.sheets.find((s) => s.year === 2025)!;
  expectEq("2025 세입 합계", y25.parsedIncome, 2_522_740);
  expectEq("2025 세출 합계", y25.parsedExpense, 1_461_380);
  expectEq("2025 잔액 = 1,061,360", y25.parsedNet, 1_061_360);
  expectEq("2025 시트 잔액칸도 1,061,360", y25.sheetBalance, 1_061_360);
  expectEq("2025 이월금 행", y25.carryOverAmount, 1_006_534);

  console.log("\n--- 이월 연결(전년 잔액 = 다음해 이월금) ---");
  const byYear = new Map(res.sheets.map((s) => [s.year, s]));
  const y23 = byYear.get(2023)!;
  for (const [prev, next] of [
    [2010, 2011],
    [2023, 2024],
    [2024, 2025],
  ] as const) {
    expectEq(
      `${prev} 잔액 = ${next} 이월금`,
      byYear.get(prev)!.parsedNet,
      byYear.get(next)!.carryOverAmount
    );
  }

  console.log("\n--- 이월금 정책(중복 방지) ---");
  const plans = planCarryOvers(res.sheets);
  // ⚠ 2023 시트의 이월금 칸은 비어 있다(실제 파일 상태) → 계획 자체가 없다.
  //   즉 2023 은 시작 잔액 0 에서 출발하며, 시트의 잔액 753,941 도 그 전제로 적혀 있다.
  expectEq("2023 이월금 칸은 비어 있음", y23.carryOverAmount, null);
  expectEq(
    "앞 연도 없는 해만 이월금 기입",
    plans.map((p) => [p.year, p.include]),
    [
      [2010, true], // 2009 없음 → 기입
      [2011, false], // 2010 있음 → 자동 계산
      [2024, false], // 2023 있음
      [2025, false], // 2024 있음
    ]
  );
  console.log(
    "  " +
      plans
        .map((p) => `${p.year}:${p.include ? "기입" : "생략"}(${krw(p.amount)})`)
        .join("  ")
  );

  console.log("\n--- 연도 공백(2012~2022) ---");
  expectEq(
    "연속 구간 2개",
    yearRuns(res.sheets.map((s) => s.year)).map((r) => [r.from, r.to]),
    [
      [2010, 2011],
      [2023, 2025],
    ]
  );
  const recent = checkImportRange(res.sheets, [2023, 2024, 2025]);
  expectEq("2023~2025만 고르면 연속", recent.contiguous, true);
  expectEq("경고 없음", recent.message, null);
  const spanning = checkImportRange(res.sheets, [2010, 2011, 2023, 2024, 2025]);
  expectEq("전체를 고르면 끊김 경고", spanning.contiguous, false);
  expectEq("얹히는 금액 = 2011 잔액", spanning.offset, 660_265);
  console.log(`  ${spanning.message}`);

  console.log("\n--- 이관 결과 ---");
  const all = [...res.entries, ...carryOverEntries(plans)];
  expectEq("모르는 카테고리 없음", unknownCategories(all), []);
  expectEq("이관 행 수 > 0", all.length > 0, true);
  console.log(
    `  이관 대상 ${all.length}행 (세입 ${all.filter((e) => e.kind === "income").length} / 세출 ${
      all.filter((e) => e.kind === "expense").length
    })`
  );
  console.log(`  건너뜀 ${res.skipped.length}행 · 경고 ${res.warnings.length}건`);
  for (const w of res.warnings.slice(0, 5)) console.log(`   ⚠ ${w}`);
  for (const s of res.skipped.slice(0, 8))
    console.log(`   – ${s.sheet} ${s.row}행 [${s.side}] ${s.text} → ${s.reason}`);

  // 이관 후 장부 잔액 = 마지막 연도 잔액이어야 한다(이월 정책이 맞물렸는지).
  const finalBalance = sumEntries(all).net;
  const expectedFinal =
    // 2010 이월금 + 2010~2011 순액 + 2023 이월금 + 2023~2025 순액
    byYear.get(2011)!.parsedNet + byYear.get(2025)!.parsedNet;
  expectEq(
    "이관 후 전체 순액 = 2011 잔액 + 2025 잔액",
    finalBalance,
    expectedFinal
  );

  // 연도별 누적 잔액이 시트 잔액과 맞는지(연속 구간 안에서).
  const cum = (upto: number) =>
    sumEntries(all.filter((e) => Number(e.entry_date.slice(0, 4)) <= upto)).net;
  expectEq("2010년까지 누적 = 2010 잔액", cum(2010), byYear.get(2010)!.parsedNet);
  expectEq("2011년까지 누적 = 2011 잔액", cum(2011), byYear.get(2011)!.parsedNet);
  // 2012~2022 공백이 있어 2023 부터는 새 구간(이월금으로 다시 시작).
  expectEq(
    "2023년까지 누적 = 2011 잔액 + 2023 잔액",
    cum(2023),
    byYear.get(2011)!.parsedNet + byYear.get(2023)!.parsedNet
  );
  expectEq(
    "2025년까지 누적 = 2011 잔액 + 2025 잔액",
    cum(2025),
    byYear.get(2011)!.parsedNet + byYear.get(2025)!.parsedNet
  );

  // ★ 핵심 보장: 최근 연속 구간(2023~2025)만 이관하면 장부의 연도별 잔액이
  //   시트에 적힌 잔액과 정확히 같아진다(연도 공백의 영향을 받지 않음).
  console.log("\n--- 2023~2025만 이관했을 때 연도별 잔액 ---");
  const recentYears = new Set([2023, 2024, 2025]);
  const recentPlans = planCarryOvers(
    res.sheets.filter((s) => recentYears.has(s.year))
  );
  const recentAll = [
    ...res.entries.filter((e) => recentYears.has(Number(e.entry_date.slice(0, 4)))),
    ...carryOverEntries(recentPlans),
  ];
  const recentCum = (upto: number) =>
    sumEntries(
      recentAll.filter((e) => Number(e.entry_date.slice(0, 4)) <= upto)
    ).net;
  for (const y of [2023, 2024, 2025]) {
    const sheetBal = byYear.get(y)!.sheetBalance;
    console.log(`  ${y}년 장부 잔액 ${krw(recentCum(y))} / 시트 ${krw(sheetBal ?? 0)}`);
    expectEq(`${y}년 잔액이 시트와 일치`, recentCum(y), sheetBal);
  }
  expectEq("2025 최종 잔액 = 1,061,360", recentCum(2025), 1_061_360);

  // 장부는 이월을 세입에 넣지 않고 따로 계산한다(시트는 세입 첫 행에 포함).
  //   → 장부 세입 + 이월 = 시트 세입 이어야 한다. 엑셀 출력은 이월금 행을
  //     되살리므로 원본 시트와 합계가 같아진다(lib/mutualExport).
  console.log("\n--- 장부(이월 분리) ↔ 시트(이월 포함) 관계 ---");
  for (const y of [2023, 2024, 2025]) {
    const yearIncome = sumEntries(
      recentAll.filter(
        (e) => e.kind === "income" && Number(e.entry_date.slice(0, 4)) === y
      )
    ).income;
    const carry = y === 2023 ? 0 : recentCum(y - 1);
    expectEq(
      `${y} 장부 세입 + 이월 = 시트 세입`,
      yearIncome + carry,
      byYear.get(y)!.sheetIncomeTotal
    );
  }

  console.log("\n--- 머리글 위치 변형 방어(합성) ---");
  // 머리글이 10행에 있는 가공 시트도 읽히는지.
  const aoa: unknown[][] = [];
  for (let i = 0; i < 9; i++) aoa.push([null]);
  aoa.push(["적요", "금액", "날짜", "적요", "금액"]);
  aoa.push(["1월 상조회비", "150,000", "2030.01.15", "홍길동 생일 축하금", "60,000"]);
  aoa.push(["합 계", "150,000", "합 계", null, "60,000"]);
  aoa.push(["※ 12/31 잔액 ", "90,000", null, null, null]);
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(aoa), "2030년");
  const buf2 = XLSX.write(wb2, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const r2 = parseMutualWorkbook(new Uint8Array(buf2));
  expectEq("머리글 10행도 인식", r2.sheets[0]?.headerRow, 10);
  expectEq("합계·잔액 일치", [r2.sheets[0].incomeMatches, r2.sheets[0].expenseMatches, r2.sheets[0].balanceMatches], [true, true, true]);
  expectEq("회비는 25일로", r2.entries.find((e) => e.kind === "income")?.entry_date, "2030-01-25");
  expectEq(
    "세출은 원본 날짜",
    r2.entries.find((e) => e.kind === "expense")?.entry_date,
    "2030-01-15"
  );

  console.log("\n--- 머리글 없는 시트는 건너뛴다 ---");
  const wb3 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb3,
    XLSX.utils.aoa_to_sheet([["아무", "관계", "없는", "시트"]]),
    "메모"
  );
  const r3 = parseMutualWorkbook(
    new Uint8Array(XLSX.write(wb3, { type: "array", bookType: "xlsx" }) as ArrayBuffer)
  );
  expectEq("시트 0개", r3.sheets.length, 0);
  expectEq("경고 1건", r3.warnings.length, 1);

  console.log(`\n${failures === 0 ? "✅ 전부 통과" : `❌ 실패 ${failures}건`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
