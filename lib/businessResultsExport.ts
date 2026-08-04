import ExcelJS from "exceljs";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

export type BusinessResultExportRow = {
  category: string;
  program_name: string;
  sessions: number;
  participants: number;
  attendance: number;
  youth_uses: number;
  other_uses: number;
  summary: string;
  evaluation: string;
  status: "draft" | "submitted";
  author_name: string;
};

export type PromotionExportRow = {
  activity_date: string;
  category: string;
  title: string;
  count: number;
  url: string;
  description: string;
  author_name: string;
};

export type BusinessReportInput = {
  year: number;
  month: number;
  orgName: string;
  results: BusinessResultExportRow[];
  promotions: PromotionExportRow[];
};

export function calculateBusinessReportTotals(input: BusinessReportInput) {
  const result = input.results.reduce(
    (a, r) => ({
      sessions: a.sessions + r.sessions,
      participants: a.participants + r.participants,
      attendance: a.attendance + r.attendance,
      youthUses: a.youthUses + r.youth_uses,
      otherUses: a.otherUses + r.other_uses,
    }),
    { sessions: 0, participants: 0, attendance: 0, youthUses: 0, otherUses: 0 }
  );
  const totalUses = result.youthUses + result.otherUses;
  return {
    ...result,
    totalUses,
    youthRate: totalUses ? result.youthUses / totalUses : 0,
    promotionCount: input.promotions.reduce((sum, row) => sum + row.count, 0),
  };
}

const navy = "17365D";
const paleBlue = "D9EAF7";
const paleGray = "F2F2F2";
const border = { style: BorderStyle.SINGLE, size: 4, color: "A6A6A6" };

function docCell(text: string, options?: { header?: boolean; width?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] }) {
  return new TableCell({
    width: options?.width ? { size: options.width, type: WidthType.DXA } : undefined,
    shading: options?.header ? { fill: paleBlue, type: ShadingType.CLEAR } : undefined,
    margins: { top: 90, bottom: 90, left: 100, right: 100 },
    borders: { top: border, bottom: border, left: border, right: border },
    children: [
      new Paragraph({
        alignment: options?.align ?? AlignmentType.CENTER,
        spacing: { before: 0, after: 0, line: 260 },
        children: [new TextRun({ text: text || "-", bold: options?.header, size: 18, font: "Malgun Gothic" })],
      }),
    ],
  });
}

function docTable(headers: string[], widths: number[], rows: string[][]) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    layout: "fixed",
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => docCell(h, { header: true, width: widths[i] })) }),
      ...rows.map((row) => new TableRow({ children: row.map((v, i) => docCell(v, { width: widths[i], align: i < 2 ? AlignmentType.LEFT : AlignmentType.CENTER })) })),
    ],
  });
}

export async function buildBusinessReportDocx(input: BusinessReportInput): Promise<Uint8Array> {
  const totals = calculateBusinessReportTotals(input);
  const title = `${input.year}년 ${input.month}월 사업 운영 결과보고`;
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 120 },
      children: [new TextRun({ text: title, bold: true, size: 34, color: navy, font: "Malgun Gothic" })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 240 },
      children: [new TextRun({ text: input.orgName, size: 20, font: "Malgun Gothic" })],
    }),
    new Paragraph({ text: "1. 월간 종합현황", heading: HeadingLevel.HEADING_1 }),
    docTable(
      ["등록 사업", "운영", "참가인원", "연인원", "실별 이용", "청소년 이용률", "홍보·협력"],
      [1100, 900, 1100, 1100, 1200, 1300, 1200],
      [[`${input.results.length}개`, `${totals.sessions}회`, `${totals.participants}명`, `${totals.attendance}명`, `${totals.totalUses}명`, `${(totals.youthRate * 100).toFixed(1)}%`, `${totals.promotionCount}회`]]
    ),
    new Paragraph({ text: "2. 분야별 사업실적", heading: HeadingLevel.HEADING_1 }),
    docTable(
      ["분야", "사업명", "횟수", "참가", "연인원", "청소년", "기타", "상태"],
      [1150, 2450, 700, 700, 800, 800, 700, 900],
      input.results.map((r) => [r.category, r.program_name, String(r.sessions), String(r.participants), String(r.attendance), String(r.youth_uses), String(r.other_uses), r.status === "submitted" ? "제출" : "작성 중"])
    ),
    new Paragraph({ text: "3. 주요 내용 및 평가", heading: HeadingLevel.HEADING_1 }),
    docTable(
      ["사업명", "주요 내용", "평가·향후 계획"],
      [2200, 3580, 3580],
      input.results.map((r) => [r.program_name, r.summary, r.evaluation])
    ),
    new Paragraph({ text: "4. 홍보·대외협력", heading: HeadingLevel.HEADING_1 }),
    docTable(
      ["날짜", "구분", "제목", "횟수", "설명"],
      [1200, 1300, 2500, 700, 3660],
      input.promotions.map((r) => [r.activity_date, r.category, r.title, String(r.count), r.description])
    ),
  ];

  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Malgun Gothic", size: 20 }, paragraph: { spacing: { after: 100, line: 280 } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: 25, color: navy, font: "Malgun Gothic" }, paragraph: { spacing: { before: 260, after: 100 }, keepNext: true } },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT }, margin: { top: 900, right: 900, bottom: 900, left: 900, header: 500, footer: 500 } } },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

function styleSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 4, showGridLines: false }];
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  sheet.eachRow((row) => { row.alignment = { vertical: "middle", wrapText: true }; });
}

function applyExcelHeader(row: ExcelJS.Row) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { name: "맑은 고딕", bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${navy}` } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { top: { style: "thin", color: { argb: "FFB8C4D0" } }, bottom: { style: "thin", color: { argb: "FFB8C4D0" } }, left: { style: "thin", color: { argb: "FFB8C4D0" } }, right: { style: "thin", color: { argb: "FFB8C4D0" } } };
  });
}

export async function buildBusinessReportWorkbook(input: BusinessReportInput): Promise<Buffer> {
  const totals = calculateBusinessReportTotals(input);
  const wb = new ExcelJS.Workbook();
  wb.creator = input.orgName;
  wb.created = new Date(Date.UTC(input.year, input.month - 1, 1));

  const summary = wb.addWorksheet("종합현황");
  summary.mergeCells("A1:G1");
  summary.getCell("A1").value = `${input.year}년 ${input.month}월 사업 운영 결과보고`;
  summary.getCell("A1").font = { name: "맑은 고딕", size: 18, bold: true, color: { argb: `FF${navy}` } };
  summary.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  summary.getRow(1).height = 34;
  summary.mergeCells("A2:G2");
  summary.getCell("A2").value = input.orgName;
  summary.getCell("A2").alignment = { horizontal: "right" };
  summary.addRow([]);
  summary.addRow(["등록 사업", "운영 횟수", "참가인원", "연인원", "실별 이용", "청소년 이용률", "홍보·협력"]);
  summary.addRow([input.results.length, totals.sessions, totals.participants, totals.attendance, totals.totalUses, totals.youthRate, totals.promotionCount]);
  applyExcelHeader(summary.getRow(4));
  summary.getRow(5).font = { name: "맑은 고딕", bold: true, size: 12 };
  summary.getRow(5).alignment = { horizontal: "center", vertical: "middle" };
  summary.getCell("F5").numFmt = "0.0%";
  summary.columns = [14, 14, 14, 14, 14, 18, 14].map((width) => ({ width }));
  styleSheet(summary);

  const results = wb.addWorksheet("사업실적");
  results.addRow([`${input.year}년 ${input.month}월 사업실적`]);
  results.mergeCells("A1:M1");
  results.getCell("A1").font = { name: "맑은 고딕", size: 17, bold: true, color: { argb: `FF${navy}` } };
  results.getCell("A1").alignment = { horizontal: "center" };
  results.addRow([]); results.addRow([]);
  results.addRow(["분야", "사업명", "운영 횟수", "참가인원", "연인원", "청소년 이용", "기타 이용", "실별 이용 합계", "주요 내용", "평가·향후 계획", "상태", "작성자", "비고"]);
  input.results.forEach((r) => results.addRow([r.category, r.program_name, r.sessions, r.participants, r.attendance, r.youth_uses, r.other_uses, { formula: `F${results.rowCount + 1}+G${results.rowCount + 1}` }, r.summary, r.evaluation, r.status === "submitted" ? "제출" : "작성 중", r.author_name, ""]));
  const totalRow = results.addRow(["합계", "", { formula: `SUM(C5:C${results.rowCount})` }, { formula: `SUM(D5:D${results.rowCount})` }, { formula: `SUM(E5:E${results.rowCount})` }, { formula: `SUM(F5:F${results.rowCount})` }, { formula: `SUM(G5:G${results.rowCount})` }, { formula: `SUM(H5:H${results.rowCount})` }, "", "", "", "", ""]);
  applyExcelHeader(results.getRow(4));
  totalRow.font = { name: "맑은 고딕", bold: true };
  totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${paleGray}` } };
  results.columns = [14, 24, 11, 11, 11, 12, 11, 14, 34, 34, 11, 12, 12].map((width) => ({ width }));
  results.autoFilter = `A4:M${results.rowCount}`;
  styleSheet(results);

  const promotions = wb.addWorksheet("홍보대외협력");
  promotions.addRow([`${input.year}년 ${input.month}월 홍보·대외협력`]);
  promotions.mergeCells("A1:G1");
  promotions.getCell("A1").font = { name: "맑은 고딕", size: 17, bold: true, color: { argb: `FF${navy}` } };
  promotions.getCell("A1").alignment = { horizontal: "center" };
  promotions.addRow([]); promotions.addRow([]);
  promotions.addRow(["날짜", "구분", "제목", "횟수", "URL", "설명", "작성자"]);
  input.promotions.forEach((r) => promotions.addRow([r.activity_date, r.category, r.title, r.count, r.url, r.description, r.author_name]));
  const promoTotal = promotions.addRow(["합계", "", "", { formula: `SUM(D5:D${promotions.rowCount})` }, "", "", ""]);
  applyExcelHeader(promotions.getRow(4));
  promoTotal.font = { name: "맑은 고딕", bold: true };
  promoTotal.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${paleGray}` } };
  promotions.columns = [14, 16, 28, 10, 34, 42, 14].map((width) => ({ width }));
  promotions.autoFilter = `A4:G${promotions.rowCount}`;
  styleSheet(promotions);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
