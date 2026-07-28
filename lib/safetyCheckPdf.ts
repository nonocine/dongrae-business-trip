// =====================================================================
// 청소년수련시설 안전점검표 PDF — 실물 점검표 양식 재현.
//   * 머리(점검일시·점검자) / 부문별 표(구분·번호·점검항목·적합/부적합/해당없음
//     체크·지적사항). 적합/해당 표기는 해당 칸에 "○".
//   * pdf-lib + fontkit + 나눔고딕 통임베드(subset:false — 증명서 패턴 동일).
//   * 관인 없음(점검표엔 서명·관인란 없음).
// =====================================================================

import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "fs";
import path from "path";
import {
  groupSafetyItems,
  type SafetyCheck,
  type SafetyItemWithResult,
} from "./safetyCheck";

let _regular: Buffer | null = null;
let _bold: Buffer | null = null;
function fontBytes(file: string): Buffer {
  return readFileSync(path.join(process.cwd(), "lib", "fonts", file));
}
function regularFont(): Buffer {
  if (!_regular) _regular = fontBytes("NanumGothic-Regular.ttf");
  return _regular;
}
function boldFont(): Buffer {
  if (!_bold) _bold = fontBytes("NanumGothic-Bold.ttf");
  return _bold;
}

const NAVY = rgb(0.122, 0.227, 0.373);
const INK = rgb(0.13, 0.15, 0.18);
const LINE = rgb(0.25, 0.25, 0.25);
const HEAD_BG = rgb(0.9, 0.9, 0.9);

export function safetyPdfFilename(check: SafetyCheck): string {
  const mm = String(check.check_month).padStart(2, "0");
  return `청소년수련시설안전점검표_${check.check_year}년${mm}월.pdf`;
}

export async function buildSafetyCheckPdf(
  check: SafetyCheck,
  items: SafetyItemWithResult[]
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regularFont(), { subset: false });
  const bold = await pdf.embedFont(boldFont(), { subset: false });

  // A4 세로.
  const W = 595.28;
  const H = 841.89;
  const M = 34;
  const contentW = W - 2 * M;

  let page = pdf.addPage([W, H]);
  let yTop = M;

  const text = (
    x: number,
    y: number,
    s: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      align?: "left" | "center" | "right";
      maxW?: number;
    } = {}
  ) => {
    const size = opts.size ?? 8;
    const f: PDFFont = opts.bold ? bold : font;
    let str = s;
    // 폭 초과 시 말줄임(간단 처리).
    if (opts.maxW) {
      while (str.length > 1 && f.widthOfTextAtSize(str, size) > opts.maxW) {
        str = str.slice(0, -1);
      }
      if (str !== s && str.length > 1) str = str.slice(0, -1) + "…";
    }
    const tw = f.widthOfTextAtSize(str, size);
    let dx = x;
    if (opts.align === "right") dx = x - tw;
    else if (opts.align === "center") dx = x - tw / 2;
    page.drawText(str, {
      x: dx,
      y: H - y - size,
      size,
      font: f,
      color: opts.color ?? INK,
    });
  };
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    opts: { fill?: ReturnType<typeof rgb>; border?: boolean } = {}
  ) => {
    page.drawRectangle({
      x,
      y: H - y - h,
      width: w,
      height: h,
      color: opts.fill,
      borderColor: opts.border ? LINE : undefined,
      borderWidth: opts.border ? 0.6 : 0,
    });
  };

  // 컬럼 레이아웃: 구분 | 번호 | 점검항목 | 적합 | 부적합 | 해당없음 | 지적사항
  const cNo = 26;
  const cChk = 30; // 적합/부적합/해당없음 각
  const cNote = 96;
  const cCat = 74;
  const cContent = contentW - cCat - cNo - cChk * 3 - cNote;
  const colX = {
    cat: M,
    no: M + cCat,
    content: M + cCat + cNo,
    pass: M + cCat + cNo + cContent,
    fail: M + cCat + cNo + cContent + cChk,
    na: M + cCat + cNo + cContent + cChk * 2,
    note: M + cCat + cNo + cContent + cChk * 3,
  };

  // --- 제목 ---
  text(W / 2, yTop, "청소년수련시설 안전점검표", {
    size: 15,
    bold: true,
    align: "center",
    color: NAVY,
  });
  yTop += 24;
  text(
    W / 2,
    yTop,
    `${check.check_year}년 ${check.check_month}월`,
    { size: 10, align: "center", color: INK }
  );
  yTop += 20;

  // --- 머리(점검일시·점검자) ---
  const headH = 20;
  rect(M, yTop, contentW, headH, { border: true });
  text(M + 6, yTop + 6, `점검일시: ${check.checked_on ?? "-"}`, { size: 9 });
  text(M + contentW / 2 + 6, yTop + 6, `점검자: ${check.inspector ?? "-"}`, {
    size: 9,
  });
  yTop += headH + 8;

  const headerRowH = 18;
  const drawTableHeader = () => {
    rect(colX.cat, yTop, contentW, headerRowH, { fill: HEAD_BG, border: true });
    // 세로 구분선(셀 테두리).
    rect(colX.cat, yTop, cCat, headerRowH, { border: true });
    rect(colX.no, yTop, cNo, headerRowH, { border: true });
    rect(colX.content, yTop, cContent, headerRowH, { border: true });
    rect(colX.pass, yTop, cChk, headerRowH, { border: true });
    rect(colX.fail, yTop, cChk, headerRowH, { border: true });
    rect(colX.na, yTop, cChk, headerRowH, { border: true });
    rect(colX.note, yTop, cNote, headerRowH, { border: true });
    const ty = yTop + 5;
    text(colX.cat + cCat / 2, ty, "구분", { size: 8, bold: true, align: "center" });
    text(colX.no + cNo / 2, ty, "번호", { size: 8, bold: true, align: "center" });
    text(colX.content + cContent / 2, ty, "점검항목", { size: 8, bold: true, align: "center" });
    text(colX.pass + cChk / 2, ty, "적합", { size: 8, bold: true, align: "center" });
    text(colX.fail + cChk / 2, ty, "부적합", { size: 7.5, bold: true, align: "center" });
    text(colX.na + cChk / 2, ty, "해당\n없음", { size: 7, bold: true, align: "center" });
    yTop += headerRowH;
  };

  const ensureSpace = (need: number) => {
    if (yTop + need > H - M) {
      page = pdf.addPage([W, H]);
      yTop = M;
      drawTableHeader();
    }
  };

  // 항목 행 높이 — 내용 길이에 따라 2줄 허용.
  const lineH = 10;
  const padY = 4;
  const wrapContent = (s: string, maxW: number): string[] => {
    const f = font;
    const size = 7.5;
    const lines: string[] = [];
    let cur = "";
    for (const ch of s) {
      const test = cur + ch;
      if (f.widthOfTextAtSize(test, size) > maxW && cur) {
        lines.push(cur);
        cur = ch;
        if (lines.length >= 2) break; // 최대 2줄
      } else cur = test;
    }
    if (cur && lines.length < 3) lines.push(cur);
    return lines.slice(0, 3);
  };

  drawTableHeader();

  const groups = groupSafetyItems(items);
  for (const g of groups) {
    // 부문 헤더 줄.
    ensureSpace(16);
    rect(M, yTop, contentW, 15, { fill: HEAD_BG, border: true });
    text(M + 6, yTop + 4, `【${g.section}】`, { size: 8.5, bold: true, color: NAVY });
    yTop += 15;

    for (const cat of g.categories) {
      for (let i = 0; i < cat.items.length; i++) {
        const it = cat.items[i];
        const contentLines = wrapContent(it.content, cContent - 8);
        const rowH = Math.max(18, contentLines.length * lineH + padY * 2);
        ensureSpace(rowH);

        // 셀 테두리.
        rect(colX.cat, yTop, cCat, rowH, { border: true });
        rect(colX.no, yTop, cNo, rowH, { border: true });
        rect(colX.content, yTop, cContent, rowH, { border: true });
        rect(colX.pass, yTop, cChk, rowH, { border: true });
        rect(colX.fail, yTop, cChk, rowH, { border: true });
        rect(colX.na, yTop, cChk, rowH, { border: true });
        rect(colX.note, yTop, cNote, rowH, { border: true });

        // 구분(각 카테고리 첫 행에만 표기).
        if (i === 0) {
          text(colX.cat + 4, yTop + rowH / 2 - 4, cat.category, {
            size: 7,
            maxW: cCat - 8,
          });
        }
        text(colX.no + cNo / 2, yTop + rowH / 2 - 4, String(it.item_no), {
          size: 8,
          align: "center",
        });
        contentLines.forEach((ln, li) => {
          text(colX.content + 4, yTop + padY + li * lineH, ln, { size: 7.5 });
        });
        // 결과 체크(○).
        const mark = (cx: number) =>
          text(cx + cChk / 2, yTop + rowH / 2 - 5, "○", {
            size: 10,
            bold: true,
            align: "center",
            color: NAVY,
          });
        if (it.result === "pass") mark(colX.pass);
        else if (it.result === "fail") mark(colX.fail);
        else mark(colX.na);
        // 지적사항.
        if (it.note) {
          text(colX.note + 3, yTop + padY, it.note, { size: 7, maxW: cNote - 6 });
        }
        yTop += rowH;
      }
    }
  }

  return pdf.save();
}
