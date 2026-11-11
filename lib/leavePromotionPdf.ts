// =====================================================================
// 연차 사용촉진 — 1차 촉구서 / 2차 지정 통보서 PDF + 연도별 이행 현황 보고서 PDF.
//   pdf-lib + 나눔고딕 통임베드(lib/pdfFont, 다른 서식과 같은 방식). 본문은 발송 때 박제한
//   body_snapshot 그대로 그립니다(일수·기한이 나중에 바뀌어도 서식은 그대로).
// =====================================================================

import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { regularFont, boldFont } from "./pdfFont";
import { CONTRACT_ORG } from "./contractCore";

const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.2, 0.2, 0.2);

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const ch of Array.from(text)) {
    const cand = line + ch;
    if (font.widthOfTextAtSize(cand, size) > maxW && line) {
      out.push(line);
      line = ch === " " ? "" : ch;
    } else line = cand;
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

async function fonts(pdf: PDFDocument) {
  pdf.registerFontkit(fontkit);
  return {
    font: await pdf.embedFont(regularFont(), { subset: false }),
    bold: await pdf.embedFont(boldFont(), { subset: false }),
  };
}

// --- 촉구서·지정 통보서(A4 세로) ---------------------------------------------------
export async function buildPromotionNoticePdf(input: { title: string; body: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const { font, bold } = await fonts(pdf);
  const W = 595.28;
  const H = 841.89;
  const M = 64;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const ensure = (h: number) => {
    if (y - h < M) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };

  const title = input.title;
  const ts = 18;
  page.drawText(title, { x: (W - bold.widthOfTextAtSize(title, ts)) / 2, y: y - ts, size: ts, font: bold, color: INK });
  y -= ts + 30;

  const size = 11;
  const lh = 18;
  for (const raw of input.body.split("\n")) {
    if (!raw.trim()) {
      y -= lh * 0.6;
      continue;
    }
    const indent = /^\d+\.\s/.test(raw) ? 0 : 0;
    const lines = wrap(raw, font, size, W - M * 2 - indent);
    lines.forEach((ln, i) => {
      ensure(lh);
      page.drawText(ln, { x: M + (i > 0 && /^\d+\.\s/.test(raw) ? 14 : 0), y: y - size, size, font, color: INK });
      y -= lh;
    });
  }

  // 발신
  y -= 16;
  ensure(40);
  const sender = `${CONTRACT_ORG.employerTitle}  (인)`;
  page.drawText(sender, { x: W - M - bold.widthOfTextAtSize(sender, 13), y: y - 13, size: 13, font: bold, color: INK });
  y -= 50;

  // 수령 확인란
  ensure(110);
  const boxH = 92;
  page.drawRectangle({ x: M, y: y - boxH, width: W - M * 2, height: boxH, borderColor: LINE, borderWidth: 0.8 });
  page.drawText("수령 확인", { x: M + 12, y: y - 22, size: 11, font: bold, color: INK });
  page.drawText("위 문서를 수령하였음을 확인합니다.", { x: M + 12, y: y - 42, size: 10.5, font, color: INK });
  page.drawText("수령일:        년      월      일", { x: M + 12, y: y - 70, size: 10.5, font, color: INK });
  page.drawText("성명:                        (서명)", { x: W / 2 + 10, y: y - 70, size: 10.5, font, color: INK });
  y -= boxH + 14;
  page.drawText("※ 서명한 수령본은 스캔하여 동업자씨에 올려 보관합니다.", { x: M, y: y - 9, size: 9, font, color: MUTED });
  return pdf.save();
}

// --- 연도별 이행 현황 보고서(A4 가로 표) ---------------------------------------------
export type PromotionReportRow = string[];
export async function buildPromotionReportPdf(input: {
  title: string;
  subtitle: string;
  headers: string[];
  widths: number[]; // 열 너비 비율
  rows: PromotionReportRow[];
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const { font, bold } = await fonts(pdf);
  const W = 841.89;
  const H = 595.28;
  const M = 32;
  const total = input.widths.reduce((a, n) => a + n, 0);
  const cols = input.widths.map((w) => (w / total) * (W - M * 2));
  const size = 7.5;
  const lh = 10;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const header = () => {
    page.drawText(input.title, { x: M, y: y - 14, size: 14, font: bold, color: INK });
    page.drawText(input.subtitle, { x: M, y: y - 30, size: 8.5, font, color: MUTED });
    y -= 42;
    drawRow(input.headers, true);
  };
  const drawRow = (cells: string[], isHead = false) => {
    const f = isHead ? bold : font;
    const wrapped = cells.map((c, i) => wrap(c ?? "", f, size, cols[i] - 6));
    const rh = Math.max(...wrapped.map((w) => w.length)) * lh + 6;
    if (y - rh < M) {
      page = pdf.addPage([W, H]);
      y = H - M;
      header();
    }
    let x = M;
    if (isHead) page.drawRectangle({ x: M, y: y - rh, width: W - M * 2, height: rh, color: rgb(0.92, 0.92, 0.92) });
    wrapped.forEach((lines, i) => {
      lines.forEach((ln, k) => page.drawText(ln, { x: x + 3, y: y - 3 - size - k * lh, size, font: f, color: INK }));
      page.drawRectangle({ x, y: y - rh, width: cols[i], height: rh, borderColor: LINE, borderWidth: 0.4 });
      x += cols[i];
    });
    y -= rh;
  };
  header();
  for (const r of input.rows) drawRow(r);
  return pdf.save();
}
