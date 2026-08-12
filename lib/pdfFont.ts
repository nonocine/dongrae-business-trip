// =====================================================================
// 양식 PDF 공용 폰트 — 나눔고딕 로딩 + 글리프 없는 글자 대체.
//   * 강사 근무일지(workLogPdf) · 출석부(attendancePdf) 가 함께 쓴다.
//     둘 다 강사·학생이 직접 쓴 문자열을 그대로 찍으므로 대체 규칙이 같아야 한다.
//   * 통임베드(subset:false)는 각 PDF 유틸에서 embedFont 할 때 지정한다.
//     여기서는 폰트 바이트와 "이 폰트로 그릴 수 있는 글자인지"만 책임진다.
// =====================================================================

// @pdf-lib/fontkit 은 default 만 실제로 내보낸다(named import 는 번들 단계에서 깨진다).
import fontkit, { type Font as FontkitFont } from "@pdf-lib/fontkit";
import { readFileSync } from "fs";
import path from "path";

let _regular: Buffer | null = null;
let _bold: Buffer | null = null;
function fontBytes(file: string): Buffer {
  return readFileSync(path.join(process.cwd(), "lib", "fonts", file));
}
export function regularFont(): Buffer {
  if (!_regular) _regular = fontBytes("NanumGothic-Regular.ttf");
  return _regular;
}
export function boldFont(): Buffer {
  if (!_bold) _bold = fontBytes("NanumGothic-Bold.ttf");
  return _bold;
}

// 나눔고딕이 못 그리는 글자 대체.
//   ①②③ · ㎡ · ℃ 같은 글자를 만나면 pdf-lib 는 말없이 빈칸을 찍는다.
//   빈칸은 "안 썼다"와 구분이 안 되는데 이 문서들은 결재까지 올라간다.
//   그래서 뜻이 통하는 글자로 바꾸고, 그래도 없으면 □ 로 눈에 띄게 남긴다.
let _regularFk: FontkitFont | null = null;
let _boldFk: FontkitFont | null = null;
export function fkFont(isBold: boolean): FontkitFont {
  if (isBold) {
    if (!_boldFk) _boldFk = fontkit.create(boldFont());
    return _boldFk;
  }
  if (!_regularFk) _regularFk = fontkit.create(regularFont());
  return _regularFk;
}

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
