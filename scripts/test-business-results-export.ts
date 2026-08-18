import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { buildBusinessReportDocx, buildBusinessReportWorkbook, calculateBusinessReportTotals, type BusinessReportInput } from "../lib/businessResultsExport";

const input: BusinessReportInput = {
  // 완전한 합성 데이터. 운영 기관명·직원명·실적은 테스트 파일에 넣지 않는다.
  year: 2099, month: 1, orgName: "테스트 기관",
  results: [
    // 청/기 구분이 있는 신규 행 + 세부표(일자형).
    { category: "분류A", program_name: "가상 프로그램 A", manager_name: "담당 A", sessions: 3, operating_days: 2, participants: 42, participants_youth: 40, participants_other: 2, attendance: 116, attendance_youth: 110, attendance_other: 6, youth_uses: 116, other_uses: 8, summary: "합성 요약 A", status: "submitted", author_name: "사용자 A",
      details: [
        { entry_type: "date", entry_date: "2099-01-05", session_no: null, session_days: null, content: "합성 세부 A1", participants_youth: 20, participants_other: 1, room_youth: 20, room_other: 2 },
        { entry_type: "date", entry_date: "2099-01-06", session_no: null, session_days: null, content: "합성 세부 A2", participants_youth: 20, participants_other: 1, room_youth: 20, room_other: 2 },
      ] },
    // 청/기 구분이 없는 과거 행(계만 존재) — 문서에서 "-"/계 로 표기되어야 한다.
    //   세부표는 회차형 — 첫 열이 운영일수("N일")로 나와야 한다.
    { category: "분류B", program_name: "가상 프로그램 B", sessions: 5, participants: 78, attendance: 135, youth_uses: 135, other_uses: 12, summary: "합성 요약 B", status: "draft", author_name: "사용자 B",
      details: [
        { entry_type: "session", entry_date: null, session_no: 1, session_days: 3, content: "합성 세부 B1", participants_youth: 30, participants_other: 2, room_youth: 30, room_other: 3 },
      ] },
  ],
  promotions: [
    { activity_date: "2099-01-12", category: "채널A", title: "가상 홍보 A", count: 2, url: "https://example.com/a", description: "합성 설명 A", author_name: "사용자 A" },
    { activity_date: "2099-01-20", category: "채널B", title: "가상 홍보 B", count: 4, url: "", description: "합성 설명 B", author_name: "사용자 B" },
  ],
  coinPay: [
    { entry_type: "적립", place: "가상 사용처 A", headcount: 30, amount: 3000, note: "" },
    { entry_type: "차감", place: "가상 사용처 B", headcount: 10, amount: 1200, note: "합성 비고" },
  ],
  coinPayCumulative: 1800,
  staffTrainings: [
    { training_date: "2099-01-09", staff_name: "사용자 A", training_name: "합성 교육 1", location: "온라인", organizer: "합성 주최", hours: "1시간" },
    { training_date: "2099-01-15", staff_name: "사용자 B", training_name: "합성 교육 2", location: "", organizer: "", hours: "" },
  ],
};

// 신규 테이블에 데이터가 하나도 없어도 내보내기가 실패하면 안 된다.
const emptyExtras: BusinessReportInput = {
  year: 2099, month: 1, orgName: "테스트 기관",
  results: input.results, promotions: input.promotions,
};

async function main() {
  const totals = calculateBusinessReportTotals(input);
  if (totals.sessions !== 8 || totals.participants !== 120 || totals.attendance !== 251 || totals.totalUses !== 271 || totals.promotionCount !== 6) throw new Error(`합계 검산 실패: ${JSON.stringify(totals)}`);
  if (totals.participantsYouth !== 40 || totals.attendanceYouth !== 110) throw new Error(`청/기 합계 검산 실패: ${JSON.stringify(totals)}`);
  if (totals.coinPayEarn !== 3000 || totals.coinPaySpend !== 1200 || totals.coinPayCumulative !== 1800) throw new Error(`동전PAY 검산 실패: ${JSON.stringify(totals)}`);
  if (totals.staffTrainingCount !== 2) throw new Error(`종사자 교육 건수 검산 실패: ${totals.staffTrainingCount}`);

  const outputDir = path.resolve("test-output/business-results");
  await mkdir(outputDir, { recursive: true });
  const docx = await buildBusinessReportDocx(input);
  const xlsx = await buildBusinessReportWorkbook(input);
  await writeFile(path.join(outputDir, "2026-06-business-results.docx"), docx);
  await writeFile(path.join(outputDir, "2026-06-business-results.xlsx"), xlsx);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(xlsx) as never);
  const names = wb.worksheets.map((s) => s.name).join(",");
  if (names !== "종합현황,사업실적,홍보대외협력,동전PAY,종사자교육") throw new Error(`시트 검증 실패: ${names}`);
  if (wb.getWorksheet("종합현황")?.getCell("H5").value !== totals.youthRate) throw new Error("청소년 이용률 검증 실패");
  if (wb.getWorksheet("사업실적")?.getCell("H5").formula !== "F5+G5") throw new Error("참가인원 계 수식 검증 실패");
  if (wb.getWorksheet("사업실적")?.getCell("N5").formula !== "L5+M5") throw new Error("실인원 계 수식 검증 실패");
  if (wb.getWorksheet("종사자교육")?.getCell("D5").value !== "합성 교육 1") throw new Error("종사자교육 시트 검증 실패");

  // 신규 데이터가 전혀 없는 입력도 두 포맷 모두 생성되어야 한다.
  await buildBusinessReportDocx(emptyExtras);
  const emptyXlsx = await buildBusinessReportWorkbook(emptyExtras);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(Buffer.from(emptyXlsx) as never);
  if (wb2.worksheets.length !== 5) throw new Error(`빈 신규 데이터 시트 수 검증 실패: ${wb2.worksheets.length}`);

  console.log(JSON.stringify({ ok: true, outputDir, totals, sheets: names }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
