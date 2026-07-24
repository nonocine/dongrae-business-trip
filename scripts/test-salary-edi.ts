// 4대보험 EDI 파싱·변환 검증 — 실제 7월 급여대장으로 검증된 숫자 케이스.
//   실행: npx tsx scripts/test-salary-edi.ts  (package.json: npm run test:edi)
//
//   cp949(EUC-KR) 인코딩·머리글 7행·이름 매칭·변환 규칙을 종합 검증합니다.
//   - 국민연금: 결정보험료 ÷ 2 (10원 절사)
//   - 건강보험: 첫 고지보험료→국민건강, 둘째→장기요양 (그대로)
//   - 고용보험: 월평균보수월액 × 근로자요율 (10원 절사)
//   - 산재보험: 공제 반영 안 함(안내만)
import {
  parseEdiRows,
  parseEdiBuffer,
  parseCsv,
  decodeEucKr,
  pensionDeduction,
  employmentDeduction,
} from "../lib/salaryEdi";

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

// cp949 인코딩 유틸(TextEncoder 는 utf-8 only 이므로 간이 인코더).
//   ASCII 는 그대로, 한글은 실제 cp949 바이트를 직접 지정한 표를 사용.
const CP949: Record<string, number[]> = {
  허일수: [0xc7, 0xe3, 0xc0, 0xcf, 0xbc, 0xf6],
  박수선: [0xb9, 0xda, 0xbc, 0xf6, 0xbc, 0xb1],
  정소연: [0xc1, 0xa4, 0xbc, 0xd2, 0xbf, 0xac],
  노미현: [0xb3, 0xeb, 0xb9, 0xcc, 0xc7, 0xf6],
  가입자명: [0xb0, 0xa1, 0xc0, 0xd4, 0xc0, 0xda, 0xb8, 0xed],
  성명: [0xbc, 0xba, 0xb8, 0xed],
  주민번호: [0xc1, 0xd6, 0xb9, 0xce, 0xb9, 0xf8, 0xc8, 0xa3],
  순번: [0xbc, 0xf8, 0xb9, 0xf8],
  결정보험료: [0xb0, 0xe1, 0xc1, 0xa4, 0xba, 0xb8, 0xc7, 0xe8, 0xb7, 0xe1],
  고지보험료: [0xb0, 0xed, 0xc1, 0xf6, 0xba, 0xb8, 0xc7, 0xe8, 0xb7, 0xe1],
  월평균보수월액: [
    0xbf, 0xf9, 0xc6, 0xf2, 0xb1, 0xd5, 0xba, 0xb8, 0xbc, 0xf6, 0xbf, 0xf9,
    0xbe, 0xd7,
  ],
  정산사유: [0xc1, 0xa4, 0xbb, 0xea, 0xbb, 0xe7, 0xc0, 0xaf],
  정산: [0xc1, 0xa4, 0xbb, 0xea],
  합계: [0xc7, 0xd5, 0xb0, 0xe8],
};
function enc(s: string): number[] {
  if (CP949[s]) return CP949[s];
  const out: number[] = [];
  for (const ch of s) {
    if (CP949[ch]) out.push(...CP949[ch]);
    else out.push(ch.charCodeAt(0)); // ASCII/숫자/구분자
  }
  return out;
}
// 행 배열 → cp949 CSV 버퍼(상단 6줄 공백 + 7번째 머리글 재현).
function toCp949Csv(rows: string[][], blankTop = 6): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < blankTop; i++) bytes.push(0x0d, 0x0a); // 공백 줄
  rows.forEach((row, ri) => {
    row.forEach((cell, ci) => {
      if (ci > 0) bytes.push(0x2c); // ,
      bytes.push(...enc(cell));
    });
    if (ri < rows.length - 1) bytes.push(0x0d, 0x0a);
  });
  return new Uint8Array(bytes);
}

// ---------------------------------------------------------------------
console.log("=== 순수 변환 규칙 ===");
expectEq("국민연금 허일수 492,940÷2", pensionDeduction(492940), 246470);
expectEq("국민연금 박수선 209,080÷2", pensionDeduction(209080), 104540);
expectEq("국민연금 정소연 204,720÷2", pensionDeduction(204720), 102360);
expectEq("국민연금 홀수 10원 절사", pensionDeduction(492941), 246470);
expectEq("고용보험 노미현 5,103,746×0.009", employmentDeduction(5103746, 0.009), 45930);

// ---------------------------------------------------------------------
console.log("\n=== cp949 디코딩 + 머리글 7행 파싱 (국민연금) ===");
const pensionCsv = toCp949Csv([
  ["순번", "가입자명", "주민번호", "정산사유", "결정보험료"],
  ["1", "허일수", "000112-3******", "정산", "492940"],
  ["2", "박수선", "000112-3******", "정산", "209080"],
  ["3", "정소연", "000112-3******", "정산", "204720"],
]);
// 디코딩 확인.
const decoded = decodeEucKr(pensionCsv);
expectEq("cp949 디코딩에 '허일수' 포함", decoded.includes("허일수"), true);

const pension = parseEdiBuffer(pensionCsv, "pension", {});
expectEq("국민연금 파싱 인원수", pension.entries.length, 3);
expectEq(
  "국민연금 허일수 공제액",
  pension.entries.find((e) => e.name === "허일수")?.update.pension,
  246470
);
expectEq(
  "국민연금 정소연 공제액",
  pension.entries.find((e) => e.name === "정소연")?.update.pension,
  102360
);

// ---------------------------------------------------------------------
console.log("\n=== 건강보험 — 고지보험료 2열(건강/요양) ===");
// '고지보험료'가 두 번 등장. 첫=국민건강, 둘째=장기요양.
const healthCsv = toCp949Csv([
  ["순번", "성명", "주민번호", "고지보험료", "고지보험료"],
  ["1", "허일수", "000112-3******", "189160", "24850"],
]);
const health = parseEdiRows(
  // parseEdiBuffer 로 해도 되지만 rows 경로도 함께 검증.
  splitCsvForTest(healthCsv),
  "health",
  {}
);
expectEq(
  "건강보험 허일수 국민건강(첫 고지보험료)",
  health.entries[0]?.update.health,
  189160
);
expectEq(
  "건강보험 허일수 장기요양(둘째 고지보험료)",
  health.entries[0]?.update.longterm_care,
  24850
);
expectEq(
  "건강보험 합산 = 실제 대장 국민건강 214,010",
  (health.entries[0]?.update.health ?? 0) +
    (health.entries[0]?.update.longterm_care ?? 0),
  214010
);

// ---------------------------------------------------------------------
console.log("\n=== 고용보험 — 월평균보수월액 × 요율 ===");
const empCsv = toCp949Csv([
  ["순번", "가입자명", "주민번호", "결정보험료", "월평균보수월액", "비고"],
  ["1", "노미현", "000112-3******", "91860", "5103746", ""],
]);
const emp = parseEdiBuffer(empCsv, "employment", { employmentEmpRate: 0.009 });
expectEq(
  "고용보험 노미현 공제액(요율 적용)",
  emp.entries[0]?.update.employment_ins,
  45930
);

// ---------------------------------------------------------------------
console.log("\n=== 산재보험 — 공제 반영 안 함 ===");
const accident = parseEdiBuffer(empCsv, "accident", {});
expectEq("산재보험 entries 비어있음", accident.entries.length, 0);
expectEq("산재보험 안내 경고 존재", accident.warnings.length > 0, true);

// ---------------------------------------------------------------------
console.log("\n=== 집계행/빈행 스킵 ===");
const withTotal = toCp949Csv([
  ["순번", "가입자명", "정산사유", "결정보험료"],
  ["1", "허일수", "정산", "492940"],
  ["", "합계", "", "492940"],
]);
const skipped = parseEdiBuffer(withTotal, "pension", {});
expectEq("합계 행 제외(1명만)", skipped.entries.length, 1);

// ---------------------------------------------------------------------
console.log("\n=== 따옴표로 감싼 천단위 콤마 값 파싱 ===");
// 실제 파일이 값에 콤마를 쓰면 따옴표로 감싸므로 한 필드로 인식되어야 함.
const quoted = parseCsv('순번,가입자명,결정보험료\n1,허일수,"492,940"');
expectEq("따옴표 콤마값이 한 필드", quoted[1], ["1", "허일수", "492,940"]);
const quotedRes = parseEdiRows(quoted, "pension", {});
expectEq(
  "따옴표 콤마값 → 246,470",
  quotedRes.entries[0]?.update.pension,
  246470
);

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — 검증 ${failures}건 실패`);
process.exit(failures === 0 ? 0 : 1);

// CSV 버퍼 → rows (decode + parseCsv) — parseEdiRows 경로 검증용.
function splitCsvForTest(buf: Uint8Array): string[][] {
  return parseCsv(decodeEucKr(buf));
}
