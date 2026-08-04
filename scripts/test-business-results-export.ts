import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { buildBusinessReportDocx, buildBusinessReportWorkbook, calculateBusinessReportTotals, type BusinessReportInput } from "../lib/businessResultsExport";

const input: BusinessReportInput = {
  // 완전한 합성 데이터. 운영 기관명·직원명·실적은 테스트 파일에 넣지 않는다.
  year: 2099, month: 1, orgName: "테스트 기관",
  results: [
    { category: "분류A", program_name: "가상 프로그램 A", sessions: 3, participants: 42, attendance: 116, youth_uses: 116, other_uses: 8, summary: "합성 요약 A", evaluation: "합성 평가 A", status: "submitted", author_name: "사용자 A" },
    { category: "분류B", program_name: "가상 프로그램 B", sessions: 5, participants: 78, attendance: 135, youth_uses: 135, other_uses: 12, summary: "합성 요약 B", evaluation: "합성 평가 B", status: "draft", author_name: "사용자 B" },
  ],
  promotions: [
    { activity_date: "2099-01-12", category: "채널A", title: "가상 홍보 A", count: 2, url: "https://example.com/a", description: "합성 설명 A", author_name: "사용자 A" },
    { activity_date: "2099-01-20", category: "채널B", title: "가상 홍보 B", count: 4, url: "", description: "합성 설명 B", author_name: "사용자 B" },
  ],
};

async function main() {
  const totals = calculateBusinessReportTotals(input);
  if (totals.sessions !== 8 || totals.participants !== 120 || totals.attendance !== 251 || totals.totalUses !== 271 || totals.promotionCount !== 6) throw new Error(`합계 검산 실패: ${JSON.stringify(totals)}`);

  const outputDir = path.resolve("test-output/business-results");
  await mkdir(outputDir, { recursive: true });
  const docx = await buildBusinessReportDocx(input);
  const xlsx = await buildBusinessReportWorkbook(input);
  await writeFile(path.join(outputDir, "2026-06-business-results.docx"), docx);
  await writeFile(path.join(outputDir, "2026-06-business-results.xlsx"), xlsx);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(xlsx) as never);
  const names = wb.worksheets.map((s) => s.name).join(",");
  if (names !== "종합현황,사업실적,홍보대외협력") throw new Error(`시트 검증 실패: ${names}`);
  if (wb.getWorksheet("종합현황")?.getCell("F5").value !== totals.youthRate) throw new Error("청소년 이용률 검증 실패");
  if (wb.getWorksheet("사업실적")?.getCell("H5").formula !== "F5+G5") throw new Error("실별 이용 합계 수식 검증 실패");
  console.log(JSON.stringify({ ok: true, outputDir, totals, sheets: names }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
