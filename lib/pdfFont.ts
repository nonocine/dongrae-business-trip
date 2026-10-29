// =====================================================================
// 양식 PDF 공용 폰트 — 나눔고딕 로딩 + 글리프 없는 글자 대체.
//   * 강사 근무일지(workLogPdf) · 출석부(attendancePdf) 가 함께 쓴다.
//     둘 다 강사·학생이 직접 쓴 문자열을 그대로 찍으므로 대체 규칙이 같아야 한다.
//   * 통임베드(subset:false)는 각 PDF 유틸에서 embedFont 할 때 지정한다.
//     여기서는 폰트 바이트와 "이 폰트로 그릴 수 있는 글자인지"만 책임진다.
// =====================================================================

// @pdf-lib/fontkit 은 default 만 실제로 내보낸다(named import 는 번들 단계에서 깨진다).
import fontkit, { type Font as FontkitFont } from "@pdf-lib/fontkit";
import type { PDFDocument } from "pdf-lib";
import { embedPdfFonts, type PdfFonts } from "@/lib/pdfFontText";
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

// 글리프 대체·자간은 lib/pdfFontText(브라우저 공용)로 옮겼다 — 기존 import 경로는 유지.
export { fitToFont, spaced, type PdfFonts } from "@/lib/pdfFontText";

// fontkit 객체 캐시 — 글자가 폰트에 있는지 확인용.
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

// 서버에서 새 문서에 나눔고딕을 임베드한다(개별 출력 라우트용).
export function embedServerFonts(pdf: PDFDocument): Promise<PdfFonts> {
  return embedPdfFonts(pdf, { regular: regularFont(), bold: boldFont(), fk: fkFont });
}
