// =====================================================================
// 기관 대장 PDF — 수기 한글 양식("업 무 협 약 체 결 현 황"·"수 상 현 황") 재현.
//   * 표 내용(제목·부제·열·행)은 lib/orgRecords 의 build*Export 가 정하고,
//     여기서는 그리기만 합니다(Word 출력과 같은 표를 씀).
//   * 동아리 결과보고(lib/clubReportPdf)와 같은 pdf-lib + 나눔고딕 통임베드.
//   * 행 높이는 내용 줄 수에 맞춰 늘고, 페이지를 넘기면 머리줄을 다시 그립니다.
// =====================================================================

import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { boldFont, fitToFont, fkFont, regularFont } from "@/lib/pdfFont";
import type { OrgExportTable } from "@/lib/orgRecords";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 48;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 56;
const INK = rgb(0.03, 0.03, 0.03);
const LINE = rgb(0.1, 0.1, 0.1);
const HEAD = rgb(0.9, 0.9, 0.9);
const SIZE = 10;
const LINE_H = SIZE + 4;
const PAD = 5;
const HEAD_H = 26;
const MIN_ROW_H = 26;

const safe = (text: string, bold = false) => fitToFont(text, fkFont(bold));

function wrap(text: string, font: PDFFont, size: number, width: number, bold: boolean): string[] {
  const out: string[] = [];
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  // 띄어쓰기 단위로 채우고, 한 단어가 칸보다 길 때만 글자 단위로 자릅니다.
  for (const para of safe(text, bold).split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (fits(next)) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      line = "";
      for (const ch of word) {
        if (fits(line + ch) || !line) line += ch;
        else {
          out.push(line);
          line = ch;
        }
      }
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

function drawCell(
  page: PDFPage,
  font: PDFFont,
  lines: string[],
  x: number,
  top: number,
  w: number,
  h: number,
  center: boolean,
  fill: boolean,
) {
  page.drawRectangle({
    x,
    y: PAGE_H - top - h,
    width: w,
    height: h,
    color: fill ? HEAD : undefined,
    borderColor: LINE,
    borderWidth: 0.6,
  });
  let y = top + (h - lines.length * LINE_H) / 2 + 2;
  for (const line of lines) {
    const tw = font.widthOfTextAtSize(line, SIZE);
    const dx = center ? x + (w - tw) / 2 : x + PAD;
    page.drawText(line, { x: dx, y: PAGE_H - y - SIZE, size: SIZE, font, color: INK });
    y += LINE_H;
  }
}

export async function buildOrgRecordsPdf(table: OrgExportTable): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(regularFont(), { subset: false });
  const bold = await pdf.embedFont(boldFont(), { subset: false });
  const tableW = PAGE_W - MARGIN_X * 2;
  const colW = table.widths.map((r) => r * tableW);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let top = MARGIN_TOP;

  // 제목 — 가운데, 굵게.
  const title = safe(table.title, true);
  const tSize = 18;
  page.drawText(title, {
    x: (PAGE_W - bold.widthOfTextAtSize(title, tSize)) / 2,
    y: PAGE_H - top - tSize,
    size: tSize,
    font: bold,
    color: INK,
  });
  top += tSize + 22;

  if (table.subtitle) {
    const sub = safe(table.subtitle);
    page.drawText(sub, { x: MARGIN_X, y: PAGE_H - top - 11, size: 11, font: regular, color: INK });
    top += 11 + 10;
  }

  const drawHeader = () => {
    let x = MARGIN_X;
    table.headers.forEach((h, i) => {
      drawCell(page, bold, [safe(h, true)], x, top, colW[i], HEAD_H, true, true);
      x += colW[i];
    });
    top += HEAD_H;
  };
  drawHeader();

  for (const row of table.rows) {
    const cells = row.map((v, i) => wrap(v || "", regular, SIZE, colW[i] - PAD * 2, false));
    const h = Math.max(MIN_ROW_H, Math.max(...cells.map((c) => c.length)) * LINE_H + 10);
    if (top + h > PAGE_H - MARGIN_BOTTOM) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      top = MARGIN_TOP;
      drawHeader();
    }
    let x = MARGIN_X;
    cells.forEach((lines, i) => {
      drawCell(page, regular, lines, x, top, colW[i], h, table.center[i], false);
      x += colW[i];
    });
    top += h;
  }

  if (table.rows.length === 0) {
    drawCell(page, regular, ["해당 기간 기록이 없습니다."], MARGIN_X, top, tableW, MIN_ROW_H, true, false);
  }
  return pdf.save();
}
