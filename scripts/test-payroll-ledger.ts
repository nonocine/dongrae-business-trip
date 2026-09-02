import ExcelJS from "exceljs";
import {
  buildLedgerRows,
  ledgerCalcLines,
  type LedgerInstructorInput,
} from "../lib/payrollLedger";
import { buildPayrollLedgerWorkbook } from "../lib/payrollLedgerExport";
import type { SettlementProgramDetail } from "../lib/settlement";

// 강사비 지급대장(회계 제출용) 검증 — DB·주민번호 없이 합성 데이터만 씁니다.
//   ① 행 묶기: "강사 + 과목" 단위. 같은 과목이면 프로그램이 여러 개
//      (기초반·전문반)라도 한 행으로 합산하고, 과목이 다르면 행을 나눈다.
//   ② 산출내역: 시급·1회 시간이 같으면 회차만 더해 한 줄, 다르면 줄바꿈 나열.
//   ③ 엑셀: 합계 SUM 범위가 줄어든 행 수에 맞고, 여러 줄 셀은 wrapText +
//      행 높이가 확보되는지.
//   ⚠️ 주민번호는 합성 더미("000000-0000000")만 씁니다 — 실제 값 금지.

let failed = 0;
function chk(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✔" : "✘"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed += 1;
}

// 시급제 항목 — hours 는 그 프로그램의 총 시간(회차 × 1회 시간).
const h = (
  programId: string,
  name: string,
  rate: number,
  per: number,
  sessions: number
): SettlementProgramDetail => ({
  program_id: programId,
  program_name: name,
  amount: Math.round(rate * per * sessions),
  sessions,
  hours: per * sessions,
  rate,
  method: "hourly",
  deduction_rate: 3.3,
});

// program_id → 과목명(saem_programs.subject).
const subjects = new Map<string, string>([
  ["p1", "비보잉"],
  ["p2", "유튜브"],
  ["p3", "유튜브"],
  ["p4", "컴퓨터"],
  ["p5", "컴퓨터"],
  ["p6", "드럼"],
  ["p7", "드럼"],
]);

const instructors: LedgerInstructorInput[] = [
  {
    // 과목 2종 — 비보잉(1h) / 유튜브 2개(시급 같고 시간 다름 → 2줄).
    name: "김만수",
    rrn: "000000-0000000",
    bankName: "부산",
    bankAccount: "1010-1",
    gross: 680000,
    detail: [
      h("p1", "비보잉 일반", 40000, 1, 7),
      h("p2", "유튜브 기초반", 40000, 1.5, 4),
      h("p3", "유튜브 전문반", 40000, 1, 4),
    ],
  },
  {
    // 같은 과목·같은 시급·같은 시간 → 회차만 합산해 한 줄.
    name: "강보현",
    rrn: "000000-0000000",
    bankName: "농협",
    bankAccount: "302-1",
    gross: 480000,
    detail: [
      h("p4", "컴퓨터 기초반", 40000, 1.5, 4),
      h("p5", "컴퓨터 전문반", 40000, 1.5, 4),
    ],
  },
  {
    // 같은 과목이지만 시급이 다름 → 2줄. 주민번호 미입력 강사이기도 하다.
    name: "최순안",
    rrn: "",
    bankName: "국민",
    bankAccount: "1234-5",
    gross: 700000,
    detail: [
      h("p6", "드럼 기초반", 50000, 2, 4),
      h("p7", "드럼 전문반", 60000, 2, 2),
    ],
  },
];

async function main() {
  const rows = buildLedgerRows(instructors, subjects);

  console.log("--- 생성된 행 ---");
  for (const r of rows)
    console.log(
      `  ${r.seq}. ${r.name} / ${r.subject} / ${r.amount.toLocaleString()}원 / ${JSON.stringify(r.calc)}`
    );

  console.log("\n--- ① 행 묶기 ---");
  // detail 7건 → 김만수 2행 + 강보현 1행 + 최순안 1행 = 4행.
  chk("항목 7건이 4행으로 묶임", rows.length === 4, `실제 ${rows.length}행`);
  chk("연번이 1..4 연속", rows.every((r, i) => r.seq === i + 1));

  const comp = rows.find((r) => r.name === "강보현")!;
  chk("같은 과목 금액 합산 240,000+240,000", comp.amount === 480000, `${comp.amount}`);
  chk("한 과목은 항목 확정값(gross) 사용", comp.amount === 480000);

  const kim = rows.filter((r) => r.name === "김만수");
  chk("과목이 다르면 행 분리(비보잉/유튜브)", kim.length === 2, kim.map((r) => r.subject).join(","));
  const yt = kim.find((r) => r.subject === "유튜브")!;
  chk("묶음 금액 240,000+160,000", yt.amount === 400000, `${yt.amount}`);
  const bb = kim.find((r) => r.subject === "비보잉")!;
  chk("과목 다른 행은 자기 금액만", bb.amount === 280000, `${bb.amount}`);
  chk(
    "여러 과목 합이 강사 총액과 같음",
    bb.amount + yt.amount === 680000,
    `${bb.amount + yt.amount}`
  );

  console.log("\n--- ② 산출내역 ---");
  chk("시급·시간 같으면 회차 합산 한 줄", comp.calc === "40,000원*1.5H*8회", JSON.stringify(comp.calc));
  chk(
    "시간이 다르면 2줄",
    yt.calc === "40,000원*1.5H*4회\n40,000원*1H*4회",
    JSON.stringify(yt.calc)
  );
  const drum = rows.find((r) => r.name === "최순안")!;
  chk(
    "시급이 다르면 2줄",
    drum.calc === "50,000원*2H*4회\n60,000원*2H*2회",
    JSON.stringify(drum.calc)
  );
  chk("정수 시간은 '1H'", bb.calc === "40,000원*1H*7회", JSON.stringify(bb.calc));
  chk("소수 시간은 '1.5H'", comp.calc.includes("1.5H"));

  // 과목 미입력(program_id 매핑 없음) → program_name 폴백.
  const fallback = buildLedgerRows(
    [{ ...instructors[1], detail: [h("zz", "폴백프로그램", 30000, 2, 3)] }],
    subjects
  );
  chk("과목 없으면 program_name 폴백", fallback[0].subject === "폴백프로그램", fallback[0].subject);

  // 분배제 — 합치지 않고 항목별 한 줄.
  const rev: SettlementProgramDetail = {
    program_name: "바이올린",
    amount: 800800,
    method: "revenue_share",
    enrolled: 13,
    tuition: 88000,
    share_rate: 70,
    deduction_rate: 3.3,
  };
  chk("분배제 표기", ledgerCalcLines([rev]) === "13명*88,000원*70%", ledgerCalcLines([rev]));
  chk("내역 없으면 빈 문자열", ledgerCalcLines([]) === "");

  console.log("\n--- ③ 엑셀 ---");
  const buf = await buildPayrollLedgerWorkbook({
    title: "3차시 강사비(보조금)",
    projectName: "동래미래 아카데미",
    period_start: "2026-07-04",
    period_end: "2026-08-29",
    rows,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  const ws = wb.getWorksheet("지급대장")!;

  const lastData = 6 + rows.length; // 데이터는 7행부터
  const totalRow = ws.getRow(lastData + 1);
  for (const [col, idx] of [
    ["F", 6],
    ["G", 7],
    ["H", 8],
    ["I", 9],
    ["J", 10],
  ] as const) {
    const f = (totalRow.getCell(idx).value as { formula?: string })?.formula;
    chk(`합계 ${col} 범위가 ${col}7:${col}${lastData}`, f === `SUM(${col}7:${col}${lastData})`, f);
  }

  const ytRow = 7 + rows.indexOf(yt);
  chk("여러 줄 셀 wrapText", ws.getCell(ytRow, 5).alignment?.wrapText === true);
  chk("여러 줄 행 높이 확보(2줄 = 30)", ws.getRow(ytRow).height === 30, String(ws.getRow(ytRow).height));
  const bbRow = 7 + rows.indexOf(bb);
  chk("한 줄 행은 높이 미지정(엑셀 자동)", ws.getRow(bbRow).height === undefined);

  // 행 단위 공제 수식은 자기 행을 참조해야 한다.
  const g = (ws.getCell(ytRow, 7).value as { formula?: string })?.formula;
  chk(`${ytRow}행 소득세 수식`, g === `F${ytRow}*0.03`, g);

  if (failed > 0) throw new Error(`${failed}건 실패`);
  console.log(`\n✅ 전부 통과 (${rows.length}행)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
