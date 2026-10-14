// =====================================================================
// 기관 대장 Word(편집용) — PDF 와 같은 표(lib/orgRecords build*Export)를 docx 로.
//   동아리 결과보고 Word(lib/clubReportDocx)와 같은 docx 패키지·맑은 고딕.
// =====================================================================

import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { OrgExportTable } from "@/lib/orgRecords";

const FONT = "맑은 고딕";
const TABLE_W = 9638; // A4 폭 11906 - 좌우 여백 1134*2
const LINE = { style: BorderStyle.SINGLE, size: 6, color: "111111" };
const borders = {
  top: LINE,
  bottom: LINE,
  left: LINE,
  right: LINE,
  insideHorizontal: LINE,
  insideVertical: LINE,
};

function para(text: string, opts: { bold?: boolean; size?: number; center?: boolean; after?: number } = {}) {
  return new Paragraph({
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { after: opts.after ?? 0, line: 276 },
    children: text.split(/\r?\n/).map(
      (t, i) => new TextRun({ text: t, bold: opts.bold, size: opts.size ?? 20, font: FONT, break: i > 0 ? 1 : undefined }),
    ),
  });
}

function cell(text: string, width: number, center: boolean, head = false) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    shading: head ? { type: ShadingType.CLEAR, color: "auto", fill: "E6E6E6" } : undefined,
    children: [para(text, { bold: head, center })],
  });
}

export async function buildOrgRecordsDocx(table: OrgExportTable): Promise<Buffer> {
  const widths = table.widths.map((r) => Math.round(r * TABLE_W));
  const rows = [
    new TableRow({
      tableHeader: true,
      children: table.headers.map((h, i) => cell(h, widths[i], true, true)),
    }),
    ...table.rows.map(
      (r) => new TableRow({ cantSplit: true, children: r.map((v, i) => cell(v, widths[i], table.center[i])) }),
    ),
  ];
  const children: Array<Paragraph | Table> = [para(table.title, { bold: true, size: 36, center: true, after: 360 })];
  if (table.subtitle) children.push(para(table.subtitle, { size: 22, after: 160 }));
  children.push(
    new Table({
      layout: TableLayoutType.FIXED,
      width: { size: TABLE_W, type: WidthType.DXA },
      columnWidths: widths,
      borders,
      rows,
    }),
  );
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 20, color: "111111" } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
