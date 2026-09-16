import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { buildBusinessReportDocx, buildBusinessReportWorkbook, calculateBusinessReportTotals, type BusinessReportInput } from "../lib/businessResultsExport";

const input: BusinessReportInput = {
  // 완전한 합성 데이터. 운영 기관명·직원명·실적은 테스트 파일에 넣지 않는다.
  year: 2099, month: 1, orgName: "테스트 기관",
  results: [
    // 청/기 구분이 있는 신규 행 + 세부표(일자형).
    { category: "분류A", program_name: "가상 프로그램 A", manager_name: "담당 A", sessions: 3, operating_days: 2, participants: 42, participants_youth: 40, participants_other: 2, attendance: 116, attendance_youth: 110, attendance_other: 6, youth_uses: 116, other_uses: 8, status: "submitted", author_name: "사용자 A",
      details: [
        { entry_type: "date", entry_date: "2099-01-05", session_no: null, session_days: null, content: "합성 세부 A1 첫째 줄\n합성 세부 A1 둘째 줄", participants_youth: 20, participants_other: 1, room_youth: 20, room_other: 2 },
        { entry_type: "date", entry_date: "2099-01-06", session_no: null, session_days: null, content: "합성 세부 A2", participants_youth: 20, participants_other: 1, room_youth: 20, room_other: 2 },
      ] },
    // 청/기 구분이 없는 과거 행(계만 존재) — 문서에서 "-"/계 로 표기되어야 한다.
    //   세부표는 회차형 — 첫 열이 운영일수("N일")로 나와야 한다.
    { category: "분류B", program_name: "가상 프로그램 B", sessions: 5, participants: 78, attendance: 135, youth_uses: 135, other_uses: 12, status: "draft", author_name: "사용자 B",
      details: [
        { entry_type: "session", entry_date: null, session_no: 1, session_days: 3, content: "합성 세부 B1", participants_youth: 30, participants_other: 2, room_youth: 30, room_other: 3 },
      ] },
  ],
  promotions: [
    // 홍보내용은 제목·설명이 합쳐진 여러 줄 값 — Word 에서 <w:br/> 로 살아야 한다.
    { activity_date: "2099-01-12", category: "채널A", title: "가상 홍보 A 첫째 줄\n가상 홍보 A 둘째 줄", count: 2, url: "https://example.com/a", deliverable: "합성 결과물 A", author_name: "사용자 A" },
    // 결과물 없는 건(자동 수집과 같은 모양) — 출력물에서 "-" 로 찍혀야 한다.
    { activity_date: "2099-01-20", category: "채널B", title: "가상 홍보 B", count: 4, url: "", deliverable: null, author_name: "사용자 B" },
  ],
  coinPay: [
    { entry_type: "적립", place: "가상 사용처 A", headcount: 30, amount: 3000, note: "" },
    { entry_type: "차감", place: "가상 사용처 B", headcount: 10, amount: 1200, note: "합성 비고" },
  ],
  coinPayCumulative: 1800,
  staffTrainings: [
    // 하루 교육 — 종료일이 시작일과 같으면 '일자' 칸에 날짜 하나만 찍힙니다.
    { training_date: "2099-01-09", training_end_date: "2099-01-09", staff_name: "사용자 A", training_name: "합성 교육 1", location: "온라인", organizer: "합성 주최", hours: "1시간" },
    // 여러 날 교육 — "시작 ~ 종료" 로 찍힙니다.
    { training_date: "2099-01-15", training_end_date: "2099-01-17", staff_name: "사용자 B", training_name: "합성 교육 2", location: "", organizer: "", hours: "" },
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
  // 주요 내용(summary) 열은 삭제됐다 — 실인원 계(N) 다음은 곧바로 상태(O)여야 한다.
  const header = wb.getWorksheet("사업실적")?.getRow(4);
  if (header?.getCell("O").value !== "상태" || header?.getCell("P").value !== "작성자" || header?.getCell("Q").value) throw new Error("사업실적 헤더 검증 실패");
  // 홍보 — 제목·설명이 '홍보내용' 한 열로 합쳐지고 '결과물' 열이 붙었다(A~G 유지).
  const promoSheet = wb.getWorksheet("홍보대외협력");
  const promoHeader = promoSheet?.getRow(4);
  const promoHeaders = ["A", "B", "C", "D", "E", "F", "G"].map((col) => promoHeader?.getCell(col).value);
  if (promoHeaders.join(",") !== "날짜,구분,홍보내용,횟수,결과물,URL,작성자" || promoHeader?.getCell("H").value) throw new Error(`홍보 헤더 검증 실패: ${promoHeaders.join(",")}`);
  if (promoSheet?.getCell("E5").value !== "합성 결과물 A" || promoSheet?.getCell("E6").value !== "-") throw new Error("홍보 결과물 열 검증 실패");
  // 횟수 합계는 종전대로 D열이어야 한다(열이 바뀌어도 수식이 따라오면 안 된다).
  if (!String(promoSheet?.getCell("D7").formula ?? "").startsWith("SUM(D5:D")) throw new Error("홍보 횟수 합계 수식 검증 실패");

  // Word — 주요 내용은 사라지고, 운영내용의 줄바꿈은 <w:br/> 로 보존되어야 한다.
  const zip = await JSZip.loadAsync(Buffer.from(docx));
  const documentXml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  if (documentXml.includes("주요 운영내용") || documentXml.includes("합성 요약")) throw new Error("Word 주요 내용 삭제 검증 실패");
  const first = documentXml.indexOf("합성 세부 A1 첫째 줄");
  const second = documentXml.indexOf("합성 세부 A1 둘째 줄");
  if (first < 0 || second < first || !documentXml.slice(first, second).includes("<w:br")) throw new Error("Word 운영내용 줄바꿈 검증 실패");
  // Word 홍보 표 — 제목·설명 → '홍보내용' 한 열 + '결과물' 열, 줄바꿈은 <w:br/>.
  if (!documentXml.includes("홍보내용") || !documentXml.includes("결과물") || documentXml.includes("합성 설명")) throw new Error("Word 홍보 열 검증 실패");
  const promoFirst = documentXml.indexOf("가상 홍보 A 첫째 줄");
  const promoSecond = documentXml.indexOf("가상 홍보 A 둘째 줄");
  if (promoFirst < 0 || promoSecond < promoFirst || !documentXml.slice(promoFirst, promoSecond).includes("<w:br")) throw new Error("Word 홍보내용 줄바꿈 검증 실패");

  // 신규 데이터가 전혀 없는 입력도 두 포맷 모두 생성되어야 한다.
  await buildBusinessReportDocx(emptyExtras);
  const emptyXlsx = await buildBusinessReportWorkbook(emptyExtras);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(Buffer.from(emptyXlsx) as never);
  if (wb2.worksheets.length !== 5) throw new Error(`빈 신규 데이터 시트 수 검증 실패: ${wb2.worksheets.length}`);

  console.log(JSON.stringify({ ok: true, outputDir, totals, sheets: names }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
