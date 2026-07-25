// 급여명세서 PDF 생성·매핑 검증 (급여 3차).
//   실행: npx tsx scripts/test-salary-payslip.ts  (npm run test:payslip)
//
//   1) 모델이 payroll_records 값을 그대로 반영하는지(허일수 7월).
//   2) 유효한 PDF 바이트가 생성되는지(%PDF 헤더).
//   3) ★교차 발송 사고 방지 — 여러 직원일 때 각 PDF/파일명이 자기 것인지.
import { writeFileSync } from "fs";
import { buildPayslipModel, buildPayslipPdf } from "../lib/salaryPayslip";
import type { PayItem } from "../lib/salary";

let failures = 0;
function expect(label: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗"} ${label}${cond ? "" : ` — ${detail ?? ""}`}`);
}

// 허일수 2026-07 확정 급여(급여 2차 검증값과 동일).
const heoPay: PayItem[] = [
  { key: "base", label: "기본급", amount: 4756180 },
  { key: "mgmt_allowance", label: "관리업무수당", amount: 428050 },
  { key: "meal_allowance", label: "급식비", amount: 160000 },
  { key: "cert_allowance", label: "지도사자격수당", amount: 50000 },
  { key: "family_allowance", label: "가족수당", amount: 90000 },
  { key: "transport_allowance", label: "교통보조비", amount: 50000 },
];
const heoDeduct: PayItem[] = [
  { key: "income_tax", label: "갑근세", amount: 385960 },
  { key: "resident_tax", label: "주민세", amount: 38590 },
  { key: "pension", label: "국민연금", amount: 246470 },
  { key: "health", label: "국민건강", amount: 214010 },
  { key: "sangjo", label: "상조회비", amount: 15000 },
];
const heoRecord = {
  pay_items: heoPay,
  deduct_items: heoDeduct,
  total_pay: 5534230,
  total_deduct: 900030,
  net_pay: 4634200,
};

async function main() {
  console.log("=== 모델 값 = payroll_records 그대로 (허일수 7월) ===");
  const m = buildPayslipModel(heoRecord, {
    name: "허일수",
    teamLabel: "센터",
    year: 2026,
    month: 7,
  });
  expect("제목", m.title === "2026년 7월 급여명세서", m.title);
  expect("소속", m.org === "센터", m.org);
  expect("지급총액 5,534,230", m.totalPay === 5534230, String(m.totalPay));
  expect("공제금액 900,030", m.totalDeduct === 900030, String(m.totalDeduct));
  expect("차인지급액 4,634,200", m.netPay === 4634200, String(m.netPay));
  expect(
    "파일명",
    m.filename === "2026년7월_급여명세서_허일수.pdf",
    m.filename
  );
  expect("급여 6항목", m.payItems.length === 6, String(m.payItems.length));
  expect("공제 5항목", m.deductItems.length === 5, String(m.deductItems.length));

  console.log("\n=== 0원 항목 미표시 ===");
  const withZero = buildPayslipModel(
    {
      ...heoRecord,
      pay_items: [...heoPay, { key: "overtime", label: "시간외수당", amount: 0 }],
    },
    { name: "허일수", teamLabel: "센터", year: 2026, month: 7 }
  );
  expect(
    "0원 시간외수당 제외",
    !withZero.payItems.some((i) => i.key === "overtime"),
    "0원 항목이 표시됨"
  );

  console.log("\n=== 유효 PDF 바이트 생성 ===");
  const bytes = await buildPayslipPdf(heoRecord, {
    name: "허일수",
    teamLabel: "센터",
    year: 2026,
    month: 7,
  });
  const header = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  expect("%PDF 헤더", header.startsWith("%PDF-"), header);
  expect("바이트 존재", bytes.length > 1000, String(bytes.length));
  // 스냅샷 파일 저장(사용자가 직접 열어볼 수 있게 scratchpad 아닌 무시 위치).
  try {
    writeFileSync("test-results/payslip-허일수-2026-07.pdf", bytes);
    console.log("  (저장: test-results/payslip-허일수-2026-07.pdf)");
  } catch {
    /* test-results 없으면 무시 */
  }

  console.log("\n=== 좌우 행수 다른 케이스 렌더(짧은 단 빈 칸) ===");
  // 공제가 급여보다 많은 케이스(좌1/우7) — 소계가 같은 줄에 맞도록 렌더되는지.
  const lopsided = {
    pay_items: [{ key: "base", label: "기본급", amount: 4756180 }],
    deduct_items: [
      { key: "income_tax", label: "갑근세", amount: 300000 },
      { key: "resident_tax", label: "주민세", amount: 30000 },
      { key: "pension", label: "국민연금", amount: 200000 },
      { key: "health", label: "국민건강", amount: 180000 },
      { key: "longterm_care", label: "장기요양", amount: 24000 },
      { key: "employment_ins", label: "고용보험", amount: 45930 },
      { key: "sangjo", label: "상조회비", amount: 15000 },
    ],
    total_pay: 4756180,
    total_deduct: 794930,
    net_pay: 3961250,
  };
  const lopBytes = await buildPayslipPdf(lopsided, {
    name: "노미현",
    teamLabel: "센터",
    year: 2026,
    month: 7,
  });
  expect(
    "좌1/우7 렌더 %PDF",
    Buffer.from(lopBytes.slice(0, 5)).toString("latin1").startsWith("%PDF-"),
    "헤더 없음"
  );
  expect("좌1/우7 바이트 존재", lopBytes.length > 1000, String(lopBytes.length));
  try {
    writeFileSync("test-results/payslip-노미현-2026-07.pdf", lopBytes);
    console.log("  (저장: test-results/payslip-노미현-2026-07.pdf)");
  } catch {
    /* test-results 없으면 무시 */
  }

  console.log("\n=== ★교차 발송 방지: 각 직원 = 자기 명세서 ===");
  const nomiRecord = {
    pay_items: [{ key: "base", label: "기본급", amount: 4756180 }],
    deduct_items: [{ key: "employment", label: "고용보험", amount: 45930 }],
    total_pay: 4756180,
    total_deduct: 45930,
    net_pay: 4710250,
  };
  const batch = [
    { driverId: "heo", record: heoRecord, name: "허일수", team: "센터" },
    { driverId: "nomi", record: nomiRecord, name: "노미현", team: "센터" },
  ];
  for (const b of batch) {
    const model = buildPayslipModel(b.record, {
      name: b.name,
      teamLabel: b.team,
      year: 2026,
      month: 7,
    });
    expect(
      `${b.name} 파일명에 본인 이름`,
      model.filename.includes(b.name),
      model.filename
    );
    expect(
      `${b.name} 차인지급액 = 본인 레코드`,
      model.netPay === b.record.net_pay,
      String(model.netPay)
    );
  }
  // 서로 값이 섞이지 않았는지 명시 검증.
  const heoModel = buildPayslipModel(heoRecord, {
    name: "허일수",
    teamLabel: "센터",
    year: 2026,
    month: 7,
  });
  const nomiModel = buildPayslipModel(nomiRecord, {
    name: "노미현",
    teamLabel: "센터",
    year: 2026,
    month: 7,
  });
  expect(
    "허일수≠노미현 차인지급액(교차 아님)",
    heoModel.netPay !== nomiModel.netPay,
    "두 명세서 값이 동일(교차 의심)"
  );

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — 검증 ${failures}건 실패`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
