// 연차 사용계획서 — 계산·검증 + 서식 엑셀 레이아웃 검증 (LP-1~LP-3)
//   실행: npx tsx scripts/test-leave-plan.ts  (package.json: npm run test:leave)
//
//   ① lib/leavePlan 의 0.5 단위 계산·검증(합계 불일치 경고 판정 포함)
//   ② 생성된 xlsx 가 원본 서식("미사용 연차유급휴가 계획.xls")의 인쇄영역
//      A~G 레이아웃과 같은 위치에 같은 문구를 담는지(셀 주소 단위로 대조)
import * as XLSX from "xlsx";
import {
  normalizeLeavePlan,
  sumLeavePlan,
  roundHalf,
  formatDays,
  formatPeriod,
  planMismatch,
  validateLeavePlan,
  leavePlanIssueText,
  LEAVE_PLAN_MAX_ROWS,
} from "../lib/leavePlan";
import { buildLeavePlanWorkbook } from "../lib/leavePlanExport";
import {
  HOLIDAYS,
  HOLIDAY_YEARS,
  getHolidayName,
  hasHolidayData,
  isHoliday,
  isRestDay,
  monthCells,
  monthsInRange,
  restDayReason,
} from "../lib/koreanHolidays";

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

async function main() {
  const PERIOD = { start: "2026-01-01", end: "2026-12-31" };

  console.log("\n--- ① 0.5 단위 계산 ---");
  expectEq("roundHalf 2.3 → 2.5", roundHalf(2.3), 2.5);
  expectEq("roundHalf 2.2 → 2", roundHalf(2.2), 2);
  expectEq("roundHalf 음수 → 0", roundHalf(-3), 0);
  expectEq("formatDays 3", formatDays(3), "3");
  expectEq("formatDays 2.5", formatDays(2.5), "2.5");
  expectEq("formatDays null", formatDays(null), "-");
  expectEq(
    "기간 표기",
    formatPeriod(PERIOD.start, PERIOD.end),
    "2026-01-01 ~ 2026-12-31"
  );
  expectEq("기간 한쪽만", formatPeriod(null, "2026-12-31"), "~ 2026-12-31");

  // 0.5 가 6번 = 3 (부동소수 오차 없이).
  const halves = Array.from({ length: 6 }, (_, i) => ({
    date: `2026-03-0${i + 1}`,
    days: 0.5,
  }));
  expectEq("0.5 × 6 = 3", sumLeavePlan(halves), 3);
  expectEq(
    "0.1 오차 없음(0.5+0.5+0.5=1.5)",
    sumLeavePlan(halves.slice(0, 3)),
    1.5
  );

  console.log("\n--- 정규화(깨진 저장분 방어) ---");
  const dirty = [
    { date: "2026-05-02", days: 1 },
    { date: "2026-05-01", days: 0.5 },
    { date: "bad-date", days: 1 }, // 버림
    { date: "2026-05-03", days: 0 }, // 0일 → 버림
    { date: "2026-05-04" }, // days 없음 → 버림
    null, // 버림
    "문자열", // 버림
  ];
  const norm = normalizeLeavePlan(dirty);
  expectEq(
    "유효 2건만 + 날짜 오름차순",
    norm,
    [
      { date: "2026-05-01", days: 0.5 },
      { date: "2026-05-02", days: 1 },
    ]
  );
  expectEq("문자열 jsonb 도 파싱", normalizeLeavePlan(JSON.stringify(norm)), norm);
  expectEq("null → 빈 배열", normalizeLeavePlan(null), []);

  console.log("\n--- 검증 ---");
  expectEq("빈 계획", validateLeavePlan([], PERIOD), [{ kind: "empty" }]);
  expectEq(
    "정상 계획은 이슈 없음",
    validateLeavePlan([{ date: "2026-06-01", days: 1 }], PERIOD),
    []
  );
  expectEq(
    "잔여기간 이전",
    validateLeavePlan([{ date: "2025-12-31", days: 1 }], PERIOD),
    [{ kind: "outOfPeriod", date: "2025-12-31" }]
  );
  expectEq(
    "잔여기간 이후",
    validateLeavePlan([{ date: "2027-01-01", days: 1 }], PERIOD),
    [{ kind: "outOfPeriod", date: "2027-01-01" }]
  );
  expectEq(
    "날짜 중복",
    validateLeavePlan(
      [
        { date: "2026-06-01", days: 1 },
        { date: "2026-06-01", days: 0.5 },
      ],
      PERIOD
    ),
    [{ kind: "duplicateDate", date: "2026-06-01" }]
  );
  const tooMany = Array.from({ length: LEAVE_PLAN_MAX_ROWS + 1 }, (_, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, "0")}`,
    days: 1,
  }));
  expectEq("칸수 초과", validateLeavePlan(tooMany, PERIOD)[0], {
    kind: "tooMany",
    max: LEAVE_PLAN_MAX_ROWS,
  });
  expectEq(
    "기간 미지정이면 날짜 제약 없음",
    validateLeavePlan([{ date: "2099-01-01", days: 1 }], { start: null, end: null }),
    []
  );
  expectEq(
    "이슈 문구",
    leavePlanIssueText({ kind: "outOfPeriod", date: "2025-12-31" }),
    "2025-12-31 은 잔여기간을 벗어납니다."
  );

  console.log("\n--- 합계 불일치 경고 판정 ---");
  expectEq("3 vs 3 → 일치", planMismatch(3, 3), false);
  expectEq("2.5 vs 3 → 불일치", planMismatch(2.5, 3), true);
  expectEq("0.5×6=3 vs 3 → 일치", planMismatch(sumLeavePlan(halves), 3), false);
  expectEq("미사용 미지정이면 비교 안 함", planMismatch(2, null), false);

  // =====================================================================
  console.log("\n--- ② 서식 엑셀 레이아웃(원본 A~G 대조) ---");
  const PLAN = [
    { date: "2026-02-10", days: 1 },
    { date: "2026-03-05", days: 0.5 },
    { date: "2026-04-20", days: 1 },
  ];
  const buf = await buildLeavePlanWorkbook([
    {
      name: "홍길동",
      department: "청소년사업팀",
      year: 2026,
      unused_days: 2.5,
      period_start: PERIOD.start,
      period_end: PERIOD.end,
      plan: PLAN,
      total_days: sumLeavePlan(PLAN),
      submitted_at: "2026-08-01T02:30:00.000Z",
    },
    {
      name: "김미정",
      department: null,
      year: 2026,
      unused_days: 5,
      period_start: PERIOD.start,
      period_end: PERIOD.end,
      plan: [],
      total_days: null,
      submitted_at: null, // 미제출 — 빈 서식으로 출력되어야 한다
    },
  ]);

  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  expectEq("직원당 1시트", wb.SheetNames, ["홍길동", "김미정"]);

  const ws = wb.Sheets["홍길동"];
  const at = (addr: string): string | null => {
    const c = ws[addr];
    return c == null ? null : String(c.v ?? "");
  };

  // 원본과 같은 셀 주소·문구.
  expectEq("A1 붙임서식", at("A1"), "[붙임서식 1]");
  expectEq("A2 제목", at("A2"), "미사용 연차유급휴가 사용계획서");
  expectEq("A3 관련법", at("A3"), "[ 관련 : 근로기준법 제61조의 2항 ]");
  expectEq("A5 성명 라벨", at("A5"), "성  명");
  expectEq("B5 성명 값", at("B5"), "홍길동");
  expectEq("E5 부서 라벨", at("E5"), "부  서");
  expectEq("F5 부서 값", at("F5"), "청소년사업팀");
  expectEq("A7 미사용 라벨", at("A7"), "미사용 연차유급휴가일");
  expectEq("E7 잔여기간 라벨", at("E7"), "미사용 연차유급휴가 잔여기간");
  expectEq("A8 미사용 일수", at("A8"), "2.5");
  expectEq("C8 단위", at("C8"), "일");
  expectEq("E8 기간 시작", at("E8"), "2026-01-01");
  expectEq("F8 물결", at("F8"), "~");
  expectEq("G8 기간 종료", at("G8"), "2026-12-31");
  expectEq("A10 표머리 날짜(좌)", at("A10"), "날 짜");
  expectEq("C10 표머리 기간(좌)", at("C10"), "기간(일)");
  expectEq("E10 표머리 날짜(우)", at("E10"), "날 짜");
  expectEq("G10 표머리 기간(우)", at("G10"), "기간(일)");

  // 계획 3건은 왼쪽 단(11~13행)에 날짜순으로.
  expectEq("11행 날짜", at("A11"), "2026-02-10");
  expectEq("11행 일수", at("C11"), "1일");
  expectEq("12행 날짜", at("A12"), "2026-03-05");
  expectEq("12행 일수", at("C12"), "0.5일");
  expectEq("13행 날짜", at("A13"), "2026-04-20");
  expectEq("13행 일수", at("C13"), "1일");
  expectEq("14행은 빈칸", at("A14"), "");
  expectEq("빈칸도 단위는 남는다(원본 동일)", at("C14"), "일");
  // 오른쪽 단(9~16번째 칸)은 비어 있어야 한다.
  expectEq("우측 단 첫 칸 빈칸", at("E11"), "");

  expectEq("E20 합계 라벨", at("E20"), "합  계");
  expectEq("G20 합계 값", at("G20"), "2.5일");
  expectEq(
    "A22 확인 문구",
    at("A22"),
    "** 회사의 연차휴가 사용촉진을 통보 받았으며 연차휴가를 사용하지 않을 경우,\n 잔여 연차휴가는 자동소멸됨을 인지하였습니다."
  );
  // 제출일 = submitted_at 을 KST 로 변환한 날짜(UTC 02:30 → KST 11:30, 8/1).
  expectEq("A24 제출일", at("A24"), "    2026년        8월        1일");
  expectEq(
    "A26 제출자",
    at("A26"),
    "      제출자 :  홍길동                          (서명  또는  인)"
  );
  expectEq("A28 수신", at("A28"), "동래구청소년센터장귀중");

  // 병합 — 원본과 같은 범위(제목·성명·계획칸·합계 등 대표 몇 개).
  const merges = (ws["!merges"] ?? []).map(
    (m: { s: { c: number; r: number }; e: { c: number; r: number } }) =>
      `${m.s.r},${m.s.c}-${m.e.r},${m.e.c}`
  );
  for (const [label, key] of [
    ["제목 A2:G2", "1,0-1,6"],
    ["성명 값 B5:C5", "4,1-4,2"],
    ["부서 값 F5:G5", "4,5-4,6"],
    ["미사용 라벨 A7:C7", "6,0-6,2"],
    ["미사용 값 A8:B8", "7,0-7,1"],
    ["표머리 날짜 A10:B10", "9,0-9,1"],
    ["계획칸 A11:B11", "10,0-10,1"],
    ["합계 라벨 E20:F20", "19,4-19,5"],
    ["확인문구 A22:G22", "21,0-21,6"],
    ["수신 A28:G28", "27,0-27,6"],
  ] as const) {
    expectEq(`병합 ${label}`, merges.includes(key), true);
  }

  console.log("\n--- 미제출 직원 시트(빈 서식) ---");
  const ws2 = wb.Sheets["김미정"];
  const at2 = (addr: string): string | null => {
    const c = ws2[addr];
    return c == null ? null : String(c.v ?? "");
  };
  expectEq("성명", at2("B5"), "김미정");
  expectEq("부서 없으면 빈칸", at2("F5"), "");
  expectEq("미사용 일수", at2("A8"), "5");
  expectEq("계획 없으면 빈칸", at2("A11"), "");
  expectEq("합계 0일", at2("G20"), "0일");
  expectEq("제출일은 원본 빈 서식", at2("A24"), "    년           월           일");

  console.log("\n--- 제출일은 KST 기준(UTC 앞 10자 그대로 쓰면 하루 밀린다) ---");
  // 2026-08-03 08:00 KST = 2026-08-02T23:00Z. 서식엔 8월 3일이 찍혀야 한다.
  const kstBuf = await buildLeavePlanWorkbook([
    {
      name: "이새벽",
      department: null,
      year: 2026,
      unused_days: 1,
      period_start: null,
      period_end: null,
      plan: [{ date: "2026-08-10", days: 1 }],
      total_days: 1,
      submitted_at: "2026-08-02T23:00:00.000Z",
    },
  ]);
  const kstWs = XLSX.read(new Uint8Array(kstBuf), { type: "array" }).Sheets[
    "이새벽"
  ];
  expectEq(
    "오전 제출도 KST 날짜(8월 3일)",
    String(kstWs["A24"]?.v ?? ""),
    "    2026년        8월        3일"
  );

  console.log("\n--- LP-4 공휴일 달력 ---");
  // 표에 넣은 날짜의 요일이 실제와 맞는지(음력·대체공휴일 오기 방지).
  const W = ["일", "월", "화", "수", "목", "금", "토"];
  const wd = (d: string) =>
    W[new Date(Date.parse(`${d}T00:00:00Z`)).getUTCDay()];
  expectEq("2026 설날 2/17 화요일", [getHolidayName("2026-02-17"), wd("2026-02-17")], ["설날", "화"]);
  expectEq("2026 추석 9/25 금요일", [getHolidayName("2026-09-25"), wd("2026-09-25")], ["추석", "금"]);
  expectEq("2027 설날 2/6 토요일", [getHolidayName("2027-02-06"), wd("2027-02-06")], ["설날", "토"]);
  expectEq("2027 추석 9/15 수요일", [getHolidayName("2027-09-15"), wd("2027-09-15")], ["추석", "수"]);
  expectEq(
    "2026 부처님오신날 5/24",
    getHolidayName("2026-05-24"),
    "부처님오신날"
  );
  expectEq("2027 부처님오신날 5/13", getHolidayName("2027-05-13"), "부처님오신날");

  // 대체공휴일 — 본 공휴일이 주말이면 다음 평일에 붙는다.
  expectEq("3·1절(일) → 3/2 대체", getHolidayName("2026-03-02"), "삼일절 대체공휴일");
  expectEq("광복절(토) → 8/17 대체", getHolidayName("2026-08-17"), "광복절 대체공휴일");
  expectEq("개천절(토) → 10/5 대체", getHolidayName("2026-10-05"), "개천절 대체공휴일");
  expectEq("설 연휴 일요일 → 2/8 대체(2027)", getHolidayName("2027-02-08"), "설날 대체공휴일");
  expectEq("한글날(토) → 10/11 대체(2027)", getHolidayName("2027-10-11"), "한글날 대체공휴일");
  expectEq("성탄절(토) → 12/27 대체(2027)", getHolidayName("2027-12-27"), "성탄절 대체공휴일");
  // 신정·현충일은 대체공휴일 대상이 아니다.
  expectEq("현충일(토, 2026) 대체 없음", getHolidayName("2026-06-08"), null);
  expectEq("현충일(일, 2027) 대체 없음", getHolidayName("2027-06-07"), null);
  expectEq("신정 대체 없음", getHolidayName("2027-01-04"), null);
  // 모든 대체공휴일은 평일이어야 한다.
  const substitutes = Object.entries(HOLIDAYS).filter(([, n]) =>
    n.includes("대체")
  );
  expectEq(
    "대체공휴일은 모두 평일",
    substitutes.filter(([d]) => ["일", "토"].includes(wd(d))).map(([d]) => d),
    []
  );
  // 2026: 삼일절·부처님오신날·광복절·개천절 4건 / 2027: 설날·광복절·개천절·한글날·성탄절 5건
  expectEq("대체공휴일 건수", substitutes.length, 9);
  expectEq(
    "연도별 대체공휴일",
    [2026, 2027].map(
      (y) => substitutes.filter(([d]) => d.startsWith(String(y))).length
    ),
    [4, 5]
  );

  expectEq("평일은 공휴일 아님", isHoliday("2026-07-15"), false);
  expectEq("표에 없는 연도는 공휴일 없음", isHoliday("2030-01-01"), false);
  expectEq("2026·2027만 등록", [...HOLIDAY_YEARS], [2026, 2027]);
  expectEq("hasHolidayData(2026)", hasHolidayData(2026), true);
  expectEq("hasHolidayData(2030)", hasHolidayData(2030), false);

  console.log("\n--- 쉬는 날 판정(붉게 + 확인 경고 대상) ---");
  expectEq("일요일", isRestDay("2026-07-12"), true); // 일
  expectEq("토요일은 아님", isRestDay("2026-07-11"), false); // 토
  expectEq("공휴일(평일)", isRestDay("2026-10-09"), true); // 한글날 금
  expectEq("평일", isRestDay("2026-07-15"), false);
  expectEq("사유: 공휴일", restDayReason("2026-10-09"), "한글날");
  expectEq("사유: 일요일", restDayReason("2026-07-12"), "일요일");
  // 공휴일이면서 일요일이면 둘 다 알려 준다.
  expectEq("사유: 공휴일+일요일", restDayReason("2026-03-01"), "삼일절(일요일)");
  expectEq("사유 없음", restDayReason("2026-07-15"), null);

  console.log("\n--- 달력 셀 ---");
  const feb = monthCells(2026, 2);
  expectEq("2026-02 은 4주 + 앞 빈칸", feb.length % 7, 0);
  expectEq("2월 1일은 일요일이라 앞 빈칸 0", feb[0]?.date, "2026-02-01");
  expectEq("28일까지", feb.filter(Boolean).length, 28);
  const setStrs = feb.filter(Boolean).filter((c) => c!.rest).map((c) => c!.date);
  expectEq(
    "2026-02 쉬는 날 = 일요일 4일 + 설 연휴 3일",
    setStrs,
    [
      "2026-02-01",
      "2026-02-08",
      "2026-02-15",
      "2026-02-16",
      "2026-02-17",
      "2026-02-18",
      "2026-02-22",
    ]
  );
  const oct = monthCells(2026, 10);
  expectEq("10월 1일은 목요일 → 앞 빈칸 4", oct.slice(0, 4).every((c) => c === null), true);
  expectEq("10/9 한글날 표시", oct.find((c) => c?.date === "2026-10-09")?.holiday, "한글날");

  console.log("\n--- 달력 이동 범위 ---");
  expectEq(
    "기간 안의 달만",
    monthsInRange("2026-03-10", "2026-06-05", 2026).map((m) => m.month),
    [3, 4, 5, 6]
  );
  expectEq(
    "연 넘김",
    monthsInRange("2026-11-01", "2027-02-28", 2026).map((m) => `${m.year}-${m.month}`),
    ["2026-11", "2026-12", "2027-1", "2027-2"]
  );
  expectEq(
    "기간 없으면 그 해 12달",
    monthsInRange(null, null, 2026).length,
    12
  );
  expectEq(
    "기간이 뒤집혀도 한 달은 준다",
    monthsInRange("2026-06-01", "2026-01-01", 2026).length,
    1
  );

  console.log("\n--- 동명이인 시트명 ---");
  const dupBuf = await buildLeavePlanWorkbook(
    ["홍길동", "홍길동", "홍길동"].map((name) => ({
      name,
      department: null,
      year: 2026,
      unused_days: 1,
      period_start: null,
      period_end: null,
      plan: [],
      total_days: null,
      submitted_at: null,
    }))
  );
  expectEq(
    "중복 시트명에 번호",
    XLSX.read(new Uint8Array(dupBuf), { type: "array" }).SheetNames,
    ["홍길동", "홍길동(2)", "홍길동(3)"]
  );

  console.log("\n--- 빈 목록 ---");
  const emptyBuf = await buildLeavePlanWorkbook([]);
  const emptyWb = XLSX.read(new Uint8Array(emptyBuf), { type: "array" });
  expectEq("안내 시트 1개", emptyWb.SheetNames, ["계획서"]);

  console.log(`\n${failures === 0 ? "✅ 전부 통과" : `❌ 실패 ${failures}건`}`);
  process.exit(failures === 0 ? 0 : 1);

}
main();
