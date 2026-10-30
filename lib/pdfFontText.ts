// =====================================================================
// 양식 PDF 글자 처리 — 폰트 파일을 읽지 않는 부분(브라우저에서도 쓴다).
//   * 글리프 없는 글자 대체(fitToFont)·자간(spaced)·폰트 임베드(embedPdfFonts).
//   * 폰트 바이트 로딩(fs)은 lib/pdfFont — 서버 전용. 여기서는 바이트를 받기만 한다.
//   * 일괄 출력(프로그램 관리 "선택 출력")이 브라우저에서 여러 프로그램을 한 문서에
//     그릴 때 폰트를 한 번만 임베드하려고 나눴다(프로그램마다 1.6MB 가 반복되지 않게).
// =====================================================================

import fontkit, { type Font as FontkitFont } from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

// 나눔고딕이 못 그리는 글자 대체.
//   ①②③ · ㎡ · ℃ 같은 글자를 만나면 pdf-lib 는 말없이 빈칸을 찍는다.
//   빈칸은 "안 썼다"와 구분이 안 되는데 이 문서들은 결재까지 올라간다.
//   그래서 뜻이 통하는 글자로 바꾸고, 그래도 없으면 □ 로 눈에 띄게 남긴다.
const CIRCLED_CONSONANTS = "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ"; // ㉠~㉭
const CIRCLED_SYLLABLES = "가나다라마바사아자차카타파하"; // ㉮~㉻
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const UNIT_SUBS: Record<string, string> = {
  "㎏": "kg", "㎎": "mg", "㎍": "ug", "㎜": "mm", "㎝": "cm", "㎞": "km",
  "㎖": "mL", "㎗": "dL", "㎡": "m2", "㎥": "m3", "℃": "°C", "℉": "°F",
  "㈜": "(주)", "ℓ": "L", "№": "No.", "㏊": "ha",
};
function substituteChar(ch: string): string {
  const sub = UNIT_SUBS[ch];
  if (sub) return sub;
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0x2460 && cp <= 0x2473) return `(${cp - 0x2460 + 1})`; // ①~⑳
  if (cp >= 0x2474 && cp <= 0x2487) return `(${cp - 0x2474 + 1})`; // ⑴~⒇
  if (cp >= 0x2488 && cp <= 0x249b) return `${cp - 0x2488 + 1}.`; // ⒈~⒛
  if (cp >= 0x3260 && cp <= 0x326d) return `(${CIRCLED_CONSONANTS[cp - 0x3260]})`;
  if (cp >= 0x326e && cp <= 0x327b) return `(${CIRCLED_SYLLABLES[cp - 0x326e]})`;
  if (cp >= 0x2160 && cp <= 0x216b) return ROMAN[cp - 0x2160];
  if (cp >= 0x2170 && cp <= 0x217b) return ROMAN[cp - 0x2170].toLowerCase();
  return "□";
}
const hasGlyphs = (s: string, fk: FontkitFont) =>
  [...s].every((c) => fk.hasGlyphForCodePoint(c.codePointAt(0) ?? 0));

// 폰트에 있는 글자만 남긴다. 이미 통과한 문자열을 다시 넣어도 그대로다(멱등).
export function fitToFont(s: string, fk: FontkitFont): string {
  let out = "";
  for (const ch of s) {
    if (ch === " " || ch === "\n" || fk.hasGlyphForCodePoint(ch.codePointAt(0) ?? 0)) {
      out += ch;
      continue;
    }
    const sub = substituteChar(ch);
    out += hasGlyphs(sub, fk) ? sub : "□";
  }
  return out;
}

// 자간 넓힌 제목·라벨(예: "강 사 근 무 일 지").
export function spaced(s: string): string {
  return s.split("").join(" ");
}

// 그리기 함수가 받는 폰트 묶음 — 한 문서에 한 번 임베드해 여러 양식이 같이 쓴다.
export type PdfFonts = {
  font: PDFFont;
  bold: PDFFont;
  fk: (isBold: boolean) => FontkitFont;
};

// 통임베드(subset:false) — Vercel 에서 서브셋 시 글리프가 빠지던 문제 대응. 바꾸지 말 것.
export async function embedPdfFonts(
  pdf: PDFDocument,
  src: {
    regular: Uint8Array;
    bold: Uint8Array;
    fk: (isBold: boolean) => FontkitFont;
  }
): Promise<PdfFonts> {
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(src.regular, { subset: false });
  const bold = await pdf.embedFont(src.bold, { subset: false });
  return { font, bold, fk: src.fk };
}
