// =====================================================================
// 강사 채용 계약서 PDF — pdf-lib + 나눔고딕 통임베드(근로계약서 lib/contractPdf 와 같은 방식).
//   * 본문 = 발송 때 확정한 body_snapshot 그대로(양식이 바뀌어도 불변).
//   * 끝에 체결일 + 갑/을 서명란 표. 갑 대표 (인) 위에 기관 직인, 을 성명 (서명) 위에
//     강사가 동래샘들에서 그린 서명 PNG 를 겹칩니다.
//   * 주민번호는 앞 7자리 + ****** 만(rrn_mask_snapshot).
// =====================================================================

import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { regularFont, boldFont, fkFont, fitToFont } from "./pdfFont";
import { INSTRUCTOR_CONTRACT_EMPLOYER as EMP, koreanDate } from "./instructorContract";

const INK = rgb(0.1, 0.1, 0.1);
const LINE = rgb(0.1, 0.1, 0.1);
const LABEL_BG = rgb(0.91, 0.91, 0.91);
const W = 595.28;
const H = 841.89;
const M = 56;
const BOTTOM = 56;
const SIZE = 10;
const LH = 15.5;

export type InstructorContractPdfInput = {
  title: string;
  body: string;
  contractDate: string | null; // YYYY-MM-DD
  instructorName: string;
  rrnMasked: string; // "000722-3******" 또는 빈칸
  address: string;
  instructorSignature: Uint8Array | null; // PNG
  seal: Uint8Array | null; // 기관 직인 PNG/JPG
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

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  const words = text.split(/(\s+)/);
  let line = "";
  for (const w of words) {
    const cand = line + w;
    if (font.widthOfTextAtSize(cand, size) <= maxW) {
      line = cand;
      continue;
    }
    if (line.trim()) out.push(line.trimEnd());
    line = w.trimStart();
    while (font.widthOfTextAtSize(line, size) > maxW) {
      let cut = line.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxW) cut--;
      out.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  out.push(line.trimEnd());
  return out;
}

export async function buildInstructorContractPdf(input: InstructorContractPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regularFont(), { subset: false });
  const bold = await pdf.embedFont(boldFont(), { subset: false });
  const fkR = fkFont(false);
  const fkB = fkFont(true);
  const signImg = await embedImage(pdf, input.instructorSignature);
  const sealImg = await embedImage(pdf, input.seal);

  let page: PDFPage = pdf.addPage([W, H]);
  let y = M;
  const ensure = (need: number) => {
    if (y + need > H - BOTTOM) {
      page = pdf.addPage([W, H]);
      y = M;
    }
  };
  const safe = (s: string, b = false) => fitToFont(s, b ? fkB : fkR);
  const draw = (x: number, yTop: number, s: string, o: { size?: number; bold?: boolean } = {}) => {
    const size = o.size ?? SIZE;
    page.drawText(safe(s, o.bold), { x, y: H - yTop - size, size, font: o.bold ? bold : font, color: INK });
  };
  const widthOf = (s: string, size = SIZE, b = false) => (b ? bold : font).widthOfTextAtSize(safe(s, b), size);
  const stampOver = (img: PDFImage | null, xCenter: number, yTop: number, maxW: number, maxH: number) => {
    if (!img) return;
    const scale = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: xCenter - w / 2, y: H - yTop - SIZE / 2 - h / 2, width: w, height: h });
  };

  // 제목
  {
    const size = 20;
    const t = input.title.trim() || "강 사 채 용 계 약 서";
    draw((W - widthOf(t, size, true)) / 2, y, t, { size, bold: true });
    y += 40;
  }

  // 본문 — 줄 단위. "제N조(...)" 는 굵게, 앞 공백·※·- 는 들여쓰기.
  const lines = input.body.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "").split("\n");
  for (const raw of lines) {
    if (!raw.trim()) {
      y += LH * 0.5;
      continue;
    }
    const isHeading = /^제\s*\d+\s*조/.test(raw.trim());
    const lead = raw.match(/^\s*/)?.[0].length ?? 0;
    const text = raw.trim();
    const x0 = M + (isHeading ? 0 : 8) + (lead ? 10 : 0) + (/^[-※]/.test(text) && lead ? 2 : 0);
    const xWrap = x0 + (/^(\d+\.|[-※])/.test(text) ? 12 : 0);
    if (isHeading) {
      y += 4;
      ensure(LH * 2);
    }
    const f = isHeading ? bold : font;
    const st = safe(text, isHeading);
    const first = wrap(st, f, SIZE, W - M - x0);
    const firstLine = first[0] ?? "";
    ensure(LH);
    draw(x0, y, firstLine, { bold: isHeading });
    y += LH;
    const rest = st.slice(firstLine.length).trimStart();
    if (rest) {
      for (const ln of wrap(rest, f, SIZE, W - M - xWrap)) {
        ensure(LH);
        draw(xWrap, y, ln, { bold: isHeading });
        y += LH;
      }
    }
  }

  // 체결일 + 서명란 — 한 쪽에 같이 나오도록 공간을 확보합니다.
  const rowH = 24;
  const tableRows = 4;
  ensure(40 + rowH * (tableRows + 1) + 20);
  y += 16;
  const date = koreanDate(input.contractDate) || "        년      월      일";
  draw((W - widthOf(date, 11)) / 2, y, date, { size: 11 });
  y += 30;

  const CW = W - 2 * M;
  const colW = CW / 2;
  const labelW = 62;
  const head = [
    { x: M, text: "갑" },
    { x: M + colW, text: "을" },
  ];
  // 머리 줄
  for (const h of head) {
    page.drawRectangle({ x: h.x, y: H - y - rowH, width: colW, height: rowH, color: LABEL_BG, borderColor: LINE, borderWidth: 0.8 });
    draw(h.x + (colW - widthOf(h.text, 11, true)) / 2, y + (rowH - 11) / 2, h.text, { size: 11, bold: true });
  }
  y += rowH;
  const gap = "  ";
  const left: { label: string; value: string; mark?: "seal" }[] = [
    { label: "기 관 명", value: EMP.orgName },
    { label: "사업자번호", value: EMP.bizNo },
    { label: "주    소", value: EMP.address },
    { label: "대    표", value: `${EMP.title} ${EMP.representative}${gap}(인)`, mark: "seal" },
  ];
  const right: { label: string; value: string; mark?: "sign" }[] = [
    { label: "성    명", value: `${input.instructorName}${gap}(서명)`, mark: "sign" },
    { label: "주민등록번호", value: input.rrnMasked },
    { label: "주    소", value: input.address },
    { label: "", value: "" },
  ];
  for (let i = 0; i < tableRows; i++) {
    for (const [colX, cell] of [
      [M, left[i]],
      [M + colW, right[i]],
    ] as const) {
      page.drawRectangle({ x: colX, y: H - y - rowH, width: labelW, height: rowH, color: LABEL_BG, borderColor: LINE, borderWidth: 0.8 });
      page.drawRectangle({ x: colX + labelW, y: H - y - rowH, width: colW - labelW, height: rowH, borderColor: LINE, borderWidth: 0.8 });
      if (cell.label) {
        const ls = cell.label.length > 5 ? 8 : 9;
        draw(colX + (labelW - widthOf(cell.label, ls)) / 2, y + (rowH - ls) / 2, cell.label, { size: ls });
      }
      const valW = colW - labelW - 10;
      let vs = 9;
      while (vs > 6 && widthOf(cell.value, vs) > valW) vs -= 0.5;
      const vx = colX + labelW + 5;
      const vy = y + (rowH - vs) / 2;
      draw(vx, vy, cell.value, { size: vs });
      if (cell.mark) {
        const markText = cell.mark === "seal" ? "(인)" : "(서명)";
        const markX = vx + widthOf(cell.value, vs) - widthOf(markText, vs) / 2;
        if (cell.mark === "seal") stampOver(sealImg, markX, vy, 36, 36);
        else stampOver(signImg, markX, vy, 64, 26);
      }
    }
    y += rowH;
  }

  return pdf.save();
}
