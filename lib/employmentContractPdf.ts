// =====================================================================
// 근로계약서 PDF — pdf-lib + 나눔고딕 통임베드(subset:false, 증명서와 같은 방식).
//   * 내용은 lib/employmentContracts.buildContractBlocks 가 만든 블록을 그대로
//     그립니다. 화면(ContractView)과 같은 배열이라 문장이 어긋나지 않습니다.
//   * 나눔고딕에는 ①②③ 글리프가 없어(pdf-lib 는 말없이 빈칸을 찍음) 항 번호는
//     원을 직접 그리고 숫자를 넣습니다.
//   * 서명: 근로자 = 직원이 그린 PNG(employee_signature), 사용자 = 관장 도장
//     (employee_profiles.stamp_path) 또는 서명 그림. 둘 다 '(인)' 위에 겹칩니다.
//     교부 확인 항의 (인) 에도 근로자 서명을 한 번 더 넣습니다(원문 양식).
// =====================================================================

import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { regularFont, boldFont, fkFont, fitToFont } from "./pdfFont";
import { CONTRACT_ORG, type ContractBlock } from "./employmentContracts";

const INK = rgb(0.1, 0.1, 0.1);
const LINE = rgb(0.1, 0.1, 0.1);
const LABEL_BG = rgb(0.91, 0.91, 0.91);

const W = 595.28;
const H = 841.89;
const M = 56;
const CW = W - 2 * M;
const BOTTOM = 60;
const SIZE = 10;
const LH = 15.5;

export type ContractSignImages = {
  employee: Uint8Array | null; // PNG
  employer: Uint8Array | null; // PNG/JPG (도장) — 없으면 빈 (인)
};

async function embedImage(pdf: PDFDocument, bytes: Uint8Array | null): Promise<PDFImage | null> {
  if (!bytes || bytes.length < 8) return null;
  try {
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    return isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  } catch {
    return null;
  }
}

// 공백 우선 줄바꿈, 한 단어가 폭을 넘으면 글자 단위로 자릅니다.
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/(\s+)/);
    let line = "";
    for (const w of words) {
      const cand = line + w;
      if (font.widthOfTextAtSize(cand, size) <= maxW) {
        line = cand;
        continue;
      }
      if (line.trim()) out.push(line.trimEnd());
      line = w.trimStart();
      // 단어 하나가 한 줄보다 길면 글자로 쪼갭니다.
      while (font.widthOfTextAtSize(line, size) > maxW) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxW) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export async function buildEmploymentContractPdf(
  blocks: ContractBlock[],
  images: ContractSignImages
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regularFont(), { subset: false });
  const bold = await pdf.embedFont(boldFont(), { subset: false });
  const fkR = fkFont(false);
  const fkB = fkFont(true);
  const empImg = await embedImage(pdf, images.employee);
  const bossImg = await embedImage(pdf, images.employer);

  let page: PDFPage = pdf.addPage([W, H]);
  let y = M; // top-origin

  const ensure = (need: number) => {
    if (y + need > H - BOTTOM) {
      page = pdf.addPage([W, H]);
      y = M;
    }
  };
  const draw = (x: number, yTop: number, s: string, o: { size?: number; bold?: boolean } = {}) => {
    const size = o.size ?? SIZE;
    const f = o.bold ? bold : font;
    page.drawText(fitToFont(s, o.bold ? fkB : fkR), {
      x,
      y: H - yTop - size,
      size,
      font: f,
      color: INK,
    });
  };
  const widthOf = (s: string, size = SIZE, b = false) =>
    (b ? bold : font).widthOfTextAtSize(fitToFont(s, b ? fkB : fkR), size);

  // 문단: 첫 줄 x0, 둘째 줄부터 xWrap 에서 시작.
  const paragraph = (text: string, x0: number, xWrap: number, o: { bold?: boolean; size?: number } = {}) => {
    const size = o.size ?? SIZE;
    const f = o.bold ? bold : font;
    const safe = fitToFont(text, o.bold ? fkB : fkR);
    const first = wrap(safe, f, size, W - M - x0);
    const firstLine = first[0] ?? "";
    const rest = safe.slice(firstLine.length).trimStart();
    ensure(LH);
    draw(x0, y, firstLine, o);
    y += LH;
    if (rest) {
      for (const ln of wrap(rest, f, size, W - M - xWrap)) {
        ensure(LH);
        draw(xWrap, y, ln, o);
        y += LH;
      }
    }
  };

  const circledNo = (x: number, yTop: number, n: number) => {
    const r = 5.6;
    const cx = x + r;
    const cy = H - yTop - SIZE / 2 - 0.5;
    page.drawCircle({ x: cx, y: cy, size: r, borderColor: INK, borderWidth: 0.7 });
    const t = String(n);
    const ts = n >= 10 ? 6.5 : 7.5;
    const tw = font.widthOfTextAtSize(t, ts);
    page.drawText(t, { x: cx - tw / 2, y: cy - ts * 0.36, size: ts, font, color: INK });
  };

  const stampOver = (img: PDFImage | null, xCenter: number, yTop: number, maxW: number, maxH: number) => {
    if (!img) return;
    const scale = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: xCenter - w / 2, y: H - yTop - SIZE / 2 - h / 2, width: w, height: h });
  };

  for (const b of blocks) {
    switch (b.kind) {
      case "title": {
        const size = 20;
        const tw = widthOf(b.text, size, true);
        draw((W - tw) / 2, y, b.text, { size, bold: true });
        y += 40;
        break;
      }
      case "heading": {
        y += 6;
        ensure(LH * 2);
        paragraph(b.text, M, M + 12, { bold: true, size: 10.5 });
        y += 2;
        break;
      }
      case "para":
        paragraph(b.text, M + 8, M + 8);
        break;
      case "note":
        paragraph(b.text, M + 8, M + 20);
        break;
      case "item": {
        ensure(LH);
        circledNo(M + 8, y, b.no);
        paragraph(b.text, M + 24, M + 24);
        break;
      }
      case "sub":
        paragraph(b.text, M + 28, M + 36);
        break;
      case "confirm": {
        ensure(LH * 2);
        circledNo(M + 8, y, b.no);
        const mark = "(인)";
        paragraph(`${b.text}  ${mark}`, M + 24, M + 24);
        // 마지막 줄 끝의 (인) 위치를 다시 계산해 서명을 겹칩니다.
        const lastLineTop = y - LH;
        const lines = wrap(fitToFont(`${b.text}  ${mark}`, fkR), font, SIZE, W - M - (M + 24));
        const lastLine = lines[lines.length - 1] ?? "";
        const markX = M + 24 + font.widthOfTextAtSize(lastLine, SIZE) - font.widthOfTextAtSize(mark, SIZE) / 2;
        stampOver(empImg, markX, lastLineTop, 42, 20);
        break;
      }
      case "party": {
        const p = b.party;
        const rowH = 22;
        const sideW = 54;
        const labelW = 76;
        const valW = CW - sideW - labelW;
        ensure(rowH * 5 + 10);
        const rows: { side: string; label: string; value: string }[] = [
          { side: "사용자", label: "기 관 명", value: CONTRACT_ORG.name },
          { side: "사용자", label: "대 표 자", value: CONTRACT_ORG.representative },
          { side: "근로자", label: "성    명", value: p.name },
          { side: "근로자", label: "주민등록번호", value: p.rrn },
          { side: "근로자", label: "주    소", value: p.address },
        ];
        const top = y;
        // 좌측 세로 병합 칸
        const groups = [
          { side: "사용자", n: 2, at: 0 },
          { side: "근로자", n: 3, at: 2 },
        ];
        for (const g of groups) {
          const gy = top + g.at * rowH;
          page.drawRectangle({
            x: M,
            y: H - gy - g.n * rowH,
            width: sideW,
            height: g.n * rowH,
            color: LABEL_BG,
            borderColor: LINE,
            borderWidth: 0.8,
          });
          const tw = widthOf(g.side, SIZE, true);
          draw(M + (sideW - tw) / 2, gy + (g.n * rowH - SIZE) / 2, g.side, { bold: true });
        }
        rows.forEach((r, i) => {
          const ry = top + i * rowH;
          page.drawRectangle({
            x: M + sideW,
            y: H - ry - rowH,
            width: labelW,
            height: rowH,
            color: LABEL_BG,
            borderColor: LINE,
            borderWidth: 0.8,
          });
          page.drawRectangle({
            x: M + sideW + labelW,
            y: H - ry - rowH,
            width: valW,
            height: rowH,
            borderColor: LINE,
            borderWidth: 0.8,
          });
          const size = r.label.length > 5 ? 9 : SIZE;
          const lw = widthOf(r.label, size);
          draw(M + sideW + (labelW - lw) / 2, ry + (rowH - size) / 2, r.label, { size });
          // 값이 길면(주소) 글자 크기를 줄여 한 줄에 맞춥니다.
          let vs = SIZE;
          while (vs > 7 && widthOf(r.value, vs) > valW - 14) vs -= 0.5;
          draw(M + sideW + labelW + 8, ry + (rowH - vs) / 2, r.value, { size: vs });
        });
        y = top + rows.length * rowH + 8;
        break;
      }
      case "sign": {
        ensure(130);
        y += 18;
        const dw = widthOf(b.date, 11);
        draw((W - dw) / 2, y, b.date, { size: 11 });
        y += 40;
        const xLabel = W / 2 - 10;
        const mark = "(인)";
        const markX = W - M - widthOf(mark, 11);
        const rowsSign: { label: string; img: PDFImage | null }[] = [
          { label: `근로자 : ${b.employeeName}`, img: empImg },
          { label: `고용자 : ${CONTRACT_ORG.employerTitle}`, img: bossImg },
        ];
        for (const r of rowsSign) {
          draw(xLabel, y, r.label, { size: 11 });
          draw(markX, y, mark, { size: 11 });
          stampOver(r.img, markX + widthOf(mark, 11) / 2, y, 70, 34);
          y += 38;
        }
        break;
      }
    }
  }

  return pdf.save();
}
