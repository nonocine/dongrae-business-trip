// 생년월일 → 초등 학년 계산 검증 (수강생 명단 [학년] 열)
//   실행: npx tsx scripts/test-school-grade.ts  (package.json: npm run test:grade)
//
//   못박는 것:
//     ① 학년 = 학년도 - 출생연도 - 6 (2017년생 → 2026학년도 3학년)
//     ② 학년도는 3월 시작 — 1~2월은 아직 전년도 학년도라 학년이 오르지 않는다.
//     ③ 초등 범위(1~6) 밖은 "미취학"/"중등이상", 값이 없으면 "-"
//     ④ 서버가 UTC 로 돌아도 3/1 경계가 KST 기준으로 판정된다.
import { calcGrade, schoolYearOf } from "../lib/schoolGrade";

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

// KST 기준 시각을 만든다(테스트가 실행 머신 타임존에 흔들리지 않게).
const kst = (iso: string) => new Date(`${iso}+09:00`);

// --- ① 기본 계산 ------------------------------------------------------
const ref2026 = kst("2026-08-11T12:00:00");
expectEq("2017년생 · 2026학년도", calcGrade("2017-05-01", ref2026).label, "3학년");
expectEq("2017년생 · grade 값", calcGrade("2017-05-01", ref2026).grade, 3);
expectEq("2024학년도엔 1학년", calcGrade("2017-05-01", kst("2024-05-01T12:00:00")).label, "1학년");
expectEq("2019년생 · 2026학년도", calcGrade("2019-12-31", ref2026).label, "1학년");
expectEq("2014년생 · 2026학년도", calcGrade("2014-03-02", ref2026).label, "6학년");

// --- ② 학년도 경계(3월 시작) -----------------------------------------
expectEq("2026-01-15 → 2025학년도", schoolYearOf(kst("2026-01-15T12:00:00")), 2025);
expectEq("2026-02-28 → 2025학년도", schoolYearOf(kst("2026-02-28T23:59:00")), 2025);
expectEq("2026-03-01 → 2026학년도", schoolYearOf(kst("2026-03-01T00:00:00")), 2026);
expectEq("2월엔 아직 2학년", calcGrade("2017-05-01", kst("2026-02-15T12:00:00")).label, "2학년");
expectEq("3월 되면 3학년", calcGrade("2017-05-01", kst("2026-03-02T12:00:00")).label, "3학년");

// --- ③ 초등 범위 밖 / 값 없음 ----------------------------------------
expectEq("2020년생 → 미취학", calcGrade("2020-06-01", ref2026).label, "미취학");
expectEq("2020년생 grade=0", calcGrade("2020-06-01", ref2026).grade, 0);
expectEq("2013년생 → 중등이상", calcGrade("2013-04-04", ref2026).label, "중등이상");
expectEq("2013년생 grade=7", calcGrade("2013-04-04", ref2026).grade, 7);
expectEq("null → -", calcGrade(null, ref2026), { label: "-", grade: null });
expectEq("undefined → -", calcGrade(undefined, ref2026), { label: "-", grade: null });
expectEq("빈 문자열 → -", calcGrade("", ref2026), { label: "-", grade: null });
expectEq("형식 오류 → -", calcGrade("2017/05/01", ref2026), { label: "-", grade: null });
expectEq("상식 밖 연도 → -", calcGrade("1800-01-01", ref2026), { label: "-", grade: null });

// --- ④ 타임존·입력형식 ------------------------------------------------
// 3/1 00:30 KST = 2/28 15:30 UTC. 로컬 시각으로 읽으면 학년도가 하루 밀린다.
expectEq(
  "3/1 00:30 KST 는 새 학년도",
  schoolYearOf(new Date("2026-02-28T15:30:00Z")),
  2026
);
expectEq(
  "2/28 23:30 KST 는 이전 학년도",
  schoolYearOf(new Date("2026-02-28T14:30:00Z")),
  2025
);
expectEq("타임스탬프 문자열", calcGrade("2017-05-01T00:00:00Z", ref2026).label, "3학년");
expectEq("Date 객체", calcGrade(kst("2017-05-01T09:00:00"), ref2026).label, "3학년");

console.log(
  failures === 0
    ? "\n전부 통과했습니다."
    : `\n${failures}건 실패했습니다.`
);
process.exit(failures === 0 ? 0 : 1);
