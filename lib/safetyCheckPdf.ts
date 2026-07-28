// =====================================================================
// 청소년수련시설 안전점검표 PDF — 청소년활동 진흥법 시행규칙 [별표 4] 실물 재현.
//   * 실측 치수(관장 제공 공식 빈양식 pdfplumber 측정, A4 595×841pt) 기준.
//   * 6열: 구분 | 번호 | 항목별 | 적합 | 부적합 | 지적사항.
//     ★"해당없음"은 별도 열이 아님 — result='na'는 적합·부적합 빈칸, 지적사항 열에
//       "해당없음" 글자로 표기.
//   * "점검사항"은 적합·부적합·지적사항 3열 위 2단 병합 헤더. 페이지 넘김 시 헤더 반복.
//   * pdf-lib + fontkit + 나눔고딕 통임베드(subset:false). 관인 없음.
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

const INK = rgb(0.1, 0.1, 0.1);
const LINE = rgb(0, 0, 0);
const HEAD_BG = rgb(0.91, 0.91, 0.91); // 헤더 연회색 #E8E8E8 수준

// A4 & 표 실측.
const W = 595;
const H = 841;
// 열 경계 x(좌→우): 69 · 125 · 145 · 418 · 445 · 470 · 521
const X = { cat: 69, no: 125, content: 145, pass: 418, fail: 445, note: 470, end: 521 };
const COL = {
  cat: X.no - X.cat, // 56
  no: X.content - X.no, // 20
  content: X.pass - X.content, // 273
  pass: X.fail - X.pass, // 27
  fail: X.note - X.fail, // 25
  note: X.end - X.note, // 51
};

const WD = ["일", "월", "화", "수", "목", "금", "토"];
function weekday(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return WD[d.getUTCDay()];
}

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

  let page = pdf.addPage([W, H]);

  // top-origin 헬퍼.
  const text = (
    x: number,
    yTop: number,
    s: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      align?: "left" | "center";
      cellW?: number; // align center 시 셀 폭(중앙 = x + cellW/2)
    } = {}
  ) => {
    const size = opts.size ?? 9;
    const f: PDFFont = opts.bold ? bold : font;
    const tw = f.widthOfTextAtSize(s, size);
    let dx = x;
    if (opts.align === "center") dx = x + (opts.cellW ?? 0) / 2 - tw / 2;
    page.drawText(s, {
      x: dx,
      y: H - yTop - size,
      size,
      font: f,
      color: opts.color ?? INK,
    });
  };
  const rect = (
    x: number,
    yTop: number,
    w: number,
    h: number,
    opts: { fill?: ReturnType<typeof rgb>; border?: boolean } = {}
  ) => {
    page.drawRectangle({
      x,
      y: H - yTop - h,
      width: w,
      height: h,
      color: opts.fill,
      borderColor: opts.border ? LINE : undefined,
      borderWidth: opts.border ? 0.5 : 0,
    });
  };
  const underline = (cx: number, yTop: number, w: number) => {
    page.drawLine({
      start: { x: cx - w / 2, y: H - yTop },
      end: { x: cx + w / 2, y: H - yTop },
      thickness: 0.8,
      color: INK,
    });
  };

  // 폭 기준 줄바꿈.
  const wrap = (
    s: string,
    maxW: number,
    size: number,
    maxLines: number,
    f: PDFFont = font
  ): string[] => {
    if (!s) return [];
    const out: string[] = [];
    let cur = "";
    for (const ch of s) {
      const test = cur + ch;
      if (f.widthOfTextAtSize(test, size) > maxW && cur) {
        out.push(cur);
        cur = ch;
        if (out.length >= maxLines) return out;
      } else cur = test;
    }
    if (cur) out.push(cur);
    return out.slice(0, maxLines);
  };

  // === 상단 헤더(첫 페이지) ===
  text(X.cat, 82, "■ 청소년활동 진흥법 시행규칙 [별표 4] <개정 2019. 8. 28.>", {
    size: 9,
  });
  const title = "청소년수련시설 안전점검표(제8조의2 관련)";
  text(W / 2, 123, title, { size: 12, bold: true, align: "center", cellW: 0 });
  underline(W / 2, 123 + 12 + 3, bold.widthOfTextAtSize(title, 12));

  const dateStr = (() => {
    const on = check.checked_on;
    const m = on?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m)
      return `${Number(m[1])}년 ${Number(m[2])}월 ${Number(m[3])}일 ( ${weekday(on!)} )`;
    return `${check.check_year}년   월   일 (   )`;
  })();
  text(X.cat, 160, `◆ 점검일시 : ${dateStr}`, { size: 11 });
  text(X.cat, 191, `◆ 점 검 자 : ${check.inspector ?? ""}`, { size: 11 });

  // 표 렌더 커서.
  let yTop = 214;
  const bottom = H - 40;

  // === 표 헤더행(2단) — 페이지 넘김 시 반복 ===
  const headerH = 22;
  const tierH = 11;
  const drawTableHeader = () => {
    // 구분·번호·항목별: 전체 높이 병합.
    rect(X.cat, yTop, COL.cat, headerH, { fill: HEAD_BG, border: true });
    rect(X.no, yTop, COL.no, headerH, { fill: HEAD_BG, border: true });
    rect(X.content, yTop, COL.content, headerH, { fill: HEAD_BG, border: true });
    // 점검사항: 상단 병합 + 하단 3열.
    rect(X.pass, yTop, COL.pass + COL.fail + COL.note, tierH, {
      fill: HEAD_BG,
      border: true,
    });
    rect(X.pass, yTop + tierH, COL.pass, tierH, { fill: HEAD_BG, border: true });
    rect(X.fail, yTop + tierH, COL.fail, tierH, { fill: HEAD_BG, border: true });
    rect(X.note, yTop + tierH, COL.note, tierH, { fill: HEAD_BG, border: true });
    // 라벨.
    const midY = yTop + (headerH - 9) / 2;
    text(X.cat, midY, "구 분", { size: 9, bold: true, align: "center", cellW: COL.cat });
    text(X.no, midY, "번호", { size: 9, bold: true, align: "center", cellW: COL.no });
    text(X.content, midY, "항 목 별", {
      size: 9,
      bold: true,
      align: "center",
      cellW: COL.content,
    });
    text(X.pass, yTop + (tierH - 8) / 2, "점검사항", {
      size: 8.5,
      bold: true,
      align: "center",
      cellW: COL.pass + COL.fail + COL.note,
    });
    const subY = yTop + tierH + (tierH - 7.5) / 2;
    text(X.pass, subY, "적합", { size: 8, bold: true, align: "center", cellW: COL.pass });
    text(X.fail, subY, "부적합", { size: 7.5, bold: true, align: "center", cellW: COL.fail });
    text(X.note, subY, "지적사항", { size: 7.5, bold: true, align: "center", cellW: COL.note });
    yTop += headerH;
  };

  const breakPage = () => {
    page = pdf.addPage([W, H]);
    yTop = 48;
    drawTableHeader();
  };

  // 데이터 행 계산.
  const CONTENT_SIZE = 9;
  const lineH = 11;
  const vpad = 6;
  const rowMetrics = (it: SafetyItemWithResult) => {
    const contentLines = wrap(it.content, COL.content - 8, CONTENT_SIZE, 5);
    // 지적사항 텍스트.
    let noteText = "";
    if (it.result === "na") noteText = it.note ? `해당없음 / ${it.note}` : "해당없음";
    else if (it.note) noteText = it.note;
    const noteLines = noteText ? wrap(noteText, COL.note - 6, 7.5, 5) : [];
    const lines = Math.max(contentLines.length, noteLines.length, 1);
    const h = Math.max(23, lines * lineH + vpad * 2);
    return { h, contentLines, noteLines };
  };

  const drawItemRow = (
    it: SafetyItemWithResult,
    h: number,
    contentLines: string[],
    noteLines: string[],
    showNo: boolean
  ) => {
    rect(X.no, yTop, COL.no, h, { border: true });
    rect(X.content, yTop, COL.content, h, { border: true });
    rect(X.pass, yTop, COL.pass, h, { border: true });
    rect(X.fail, yTop, COL.fail, h, { border: true });
    rect(X.note, yTop, COL.note, h, { border: true });

    if (showNo)
      text(X.no, yTop + h / 2 - 4.5, String(it.item_no), {
        size: 9,
        align: "center",
        cellW: COL.no,
      });
    const cStart = yTop + (h - contentLines.length * lineH) / 2;
    contentLines.forEach((ln, i) => {
      text(X.content + 4, cStart + i * lineH, ln, { size: CONTENT_SIZE });
    });
    if (it.result === "pass")
      text(X.pass, yTop + h / 2 - 5.5, "○", {
        size: 11,
        bold: true,
        align: "center",
        cellW: COL.pass,
      });
    else if (it.result === "fail")
      text(X.fail, yTop + h / 2 - 5.5, "○", {
        size: 11,
        bold: true,
        align: "center",
        cellW: COL.fail,
      });
    // 지적사항(해당없음 포함).
    const nStart = yTop + (h - noteLines.length * lineH) / 2;
    noteLines.forEach((ln, i) => {
      text(X.note + 3, nStart + i * lineH, ln, { size: 7.5 });
    });
  };

  // === 부문별 렌더 ===
  const groups = groupSafetyItems(items);
  for (const g of groups) {
    // 부문 제목(자리 없으면 개행 — 헤더만 반복, 제목은 새 페이지 상단에).
    const titleSize = g.section.includes("건축") ? 12 : 11;
    if (yTop + titleSize + 8 + headerH + 24 > bottom) {
      page = pdf.addPage([W, H]);
      yTop = 48;
    }
    text(X.cat, yTop, `□ ${g.section}`, { size: titleSize, bold: true });
    yTop += titleSize + 7;

    drawTableHeader();

    for (const cat of g.categories) {
      const showNo = cat.items.length > 1; // 단일 항목이면 번호 생략
      let idx = 0;
      while (idx < cat.items.length) {
        const firstH = rowMetrics(cat.items[idx]).h;
        if (yTop + firstH > bottom) breakPage();

        const runStartY = yTop;
        while (idx < cat.items.length) {
          const it = cat.items[idx];
          const { h, contentLines, noteLines } = rowMetrics(it);
          if (yTop + h > bottom) break;
          drawItemRow(it, h, contentLines, noteLines, showNo);
          yTop += h;
          idx++;
        }
        // 구분 셀(이 페이지 런 전체 세로 병합).
        const mergedH = yTop - runStartY;
        rect(X.cat, runStartY, COL.cat, mergedH, { border: true });
        const catLines = wrap(cat.category, COL.cat - 6, 8, 5);
        const catStart = runStartY + (mergedH - catLines.length * 10) / 2;
        catLines.forEach((ln, i) => {
          text(X.cat, catStart + i * 10, ln, {
            size: 8,
            align: "center",
            cellW: COL.cat,
          });
        });

        if (idx < cat.items.length) breakPage();
      }
    }

    yTop += 10; // 부문 간 간격
  }

  return pdf.save();
}
