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
const LINE = rgb(0.2, 0.2, 0.2); // 검정에 가까운 테두리
const HEAD_BG = rgb(0.88, 0.88, 0.88); // 표 머리 회색
const SECTION_BG = rgb(0.83, 0.86, 0.9); // 부문 제목 음영(네이비 톤 옅게)

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
      borderWidth: opts.border ? 0.8 : 0,
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

  const headerRowH = 20;
  const bottom = H - M;

  // 표 머리행 — 페이지마다 반복.
  const drawTableHeader = () => {
    const cells: [number, number, string][] = [
      [colX.cat, cCat, "구분"],
      [colX.no, cNo, "번호"],
      [colX.content, cContent, "점검항목"],
      [colX.pass, cChk, "적합"],
      [colX.fail, cChk, "부적합"],
      [colX.na, cChk, "해당없음"],
      [colX.note, cNote, "지적사항"],
    ];
    for (const [x, w] of cells)
      rect(x, yTop, w, headerRowH, { fill: HEAD_BG, border: true });
    for (const [x, w, label] of cells)
      text(x + w / 2, yTop + (headerRowH - 8) / 2, label, {
        size: label.length >= 3 ? 7 : 8.5,
        bold: true,
        align: "center",
      });
    yTop += headerRowH;
  };

  // 부문 제목 행(음영).
  const sectionRowH = 16;
  const drawSectionRow = (title: string) => {
    rect(M, yTop, contentW, sectionRowH, { fill: SECTION_BG, border: true });
    text(M + 6, yTop + (sectionRowH - 8.5) / 2, `【${title}】`, {
      size: 8.5,
      bold: true,
      color: INK,
    });
    yTop += sectionRowH;
  };

  const lineH = 10;
  const padY = 4;
  const CONTENT_SIZE = 7.5;
  const NOTE_SIZE = 7;

  // 폭 기준 줄바꿈(최대 maxLines 줄).
  const wrap = (s: string, maxW: number, size: number, maxLines: number): string[] => {
    if (!s) return [];
    const lines: string[] = [];
    let cur = "";
    for (const ch of s) {
      const test = cur + ch;
      if (font.widthOfTextAtSize(test, size) > maxW && cur) {
        lines.push(cur);
        cur = ch;
        if (lines.length >= maxLines) return lines;
      } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines.slice(0, maxLines);
  };

  const rowHeightOf = (it: SafetyItemWithResult): {
    h: number;
    contentLines: string[];
    noteLines: string[];
  } => {
    const contentLines = wrap(it.content, cContent - 8, CONTENT_SIZE, 3);
    const noteLines = it.note ? wrap(it.note, cNote - 6, NOTE_SIZE, 3) : [];
    const maxLines = Math.max(contentLines.length, noteLines.length, 1);
    return { h: Math.max(18, maxLines * lineH + padY * 2), contentLines, noteLines };
  };

  const breakPage = (sectionTitle: string | null) => {
    page = pdf.addPage([W, H]);
    yTop = M;
    drawTableHeader();
    if (sectionTitle) drawSectionRow(sectionTitle);
  };

  // 항목 한 행 그리기(구분 셀 제외 — 구분은 카테고리 단위 병합으로 별도).
  const drawItemRow = (
    it: SafetyItemWithResult,
    rowH: number,
    contentLines: string[],
    noteLines: string[]
  ) => {
    rect(colX.no, yTop, cNo, rowH, { border: true });
    rect(colX.content, yTop, cContent, rowH, { border: true });
    rect(colX.pass, yTop, cChk, rowH, { border: true });
    rect(colX.fail, yTop, cChk, rowH, { border: true });
    rect(colX.na, yTop, cChk, rowH, { border: true });
    rect(colX.note, yTop, cNote, rowH, { border: true });

    text(colX.no + cNo / 2, yTop + rowH / 2 - 4, String(it.item_no), {
      size: 8,
      align: "center",
    });
    contentLines.forEach((ln, li) => {
      text(colX.content + 4, yTop + padY + li * lineH, ln, { size: CONTENT_SIZE });
    });
    // 결과별 ○ — result 값에 따라 정확한 열에.
    const markX =
      it.result === "fail" ? colX.fail : it.result === "na" ? colX.na : colX.pass;
    text(markX + cChk / 2, yTop + rowH / 2 - 5, "○", {
      size: 11,
      bold: true,
      align: "center",
      color: NAVY,
    });
    // 지적사항 — 결과 무관, 값 있으면 출력.
    noteLines.forEach((ln, li) => {
      text(colX.note + 3, yTop + padY + li * lineH, ln, { size: NOTE_SIZE });
    });
  };

  // --- 렌더 ---
  drawTableHeader();
  const groups = groupSafetyItems(items);
  for (const g of groups) {
    // 부문 제목(자리 없으면 개행 후).
    if (yTop + sectionRowH + 18 > bottom) breakPage(null);
    drawSectionRow(g.section);

    for (const cat of g.categories) {
      let idx = 0;
      while (idx < cat.items.length) {
        // 최소 한 행은 현재 페이지에 들어가도록 보장.
        const firstH = rowHeightOf(cat.items[idx]).h;
        if (yTop + firstH > bottom) breakPage(g.section);

        const runStartY = yTop;
        while (idx < cat.items.length) {
          const it = cat.items[idx];
          const { h, contentLines, noteLines } = rowHeightOf(it);
          if (yTop + h > bottom) break; // 페이지 참 → 이 런 종료
          drawItemRow(it, h, contentLines, noteLines);
          yTop += h;
          idx++;
        }
        // 구분(category) 셀 — 이번 페이지 런 전체를 세로 병합처럼 한 칸으로.
        rect(colX.cat, runStartY, cCat, yTop - runStartY, { border: true });
        text(colX.cat + 4, runStartY + 6, cat.category, {
          size: 7,
          maxW: cCat - 8,
        });

        if (idx < cat.items.length) breakPage(g.section); // 다음 페이지로 이어감
      }
    }
  }

  return pdf.save();
}
