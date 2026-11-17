// =====================================================================
// 의무교육 수료증 일괄 다운로드 — 여러 직원의 수료증을 PDF 한 부로 합칩니다(서버 전용).
//   * 호출: app/(app)/hr/trainings/certificates/route.ts (권한 확인은 호출부 책임).
//   * 순서: 호출부가 넘긴 순서(= 현황판 표 순서) 그대로. 직원마다 새 장에서 시작합니다.
//   * PDF 수료증은 장을 그대로 복사, 이미지(JPG·PNG)는 A4 한 장에 맞춰 넣습니다
//     (가로로 긴 이미지는 가로 A4). 확장자가 아니라 파일 앞부분(매직 바이트)으로 판별합니다.
//   * 넣지 못한 수료증(암호 걸린 PDF·깨진 파일)은 그 자리에 안내 장을 넣고 failed 로 돌려줍니다.
//   * 표지(선택): 교육명·연도·포함 직원·미등록 직원 명단.
// =====================================================================

import sharp from "sharp";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { embedServerFonts, fitToFont, type PdfFonts } from "@/lib/pdfFont";

const A4: [number, number] = [595.28, 841.89];
const A4_LAND: [number, number] = [841.89, 595.28];
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.42, 0.42, 0.42);
const NAVY = rgb(0.12, 0.23, 0.42);
const RED = rgb(0.65, 0.1, 0.1);

export type BundlePerson = { name: string; rank: string | null };
export type BundleItem = BundlePerson & { bytes: Uint8Array | null };

export type BundleInput = {
  trainingName: string;
  year: number;
  generatedOn: string; // "YYYY-MM-DD"
  cover: boolean;
  items: BundleItem[]; // 수료증 있는 직원 — 표 순서
  missing: BundlePerson[]; // 선택했지만 수료증 미등록
};

type Kind = "pdf" | "jpg" | "png" | "unknown";
function sniff(b: Uint8Array): Kind {
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  // 앞에 쓰레기 바이트가 붙은 PDF 도 있어 첫 1KB 안에서 한 번 더 찾습니다.
  const head = Buffer.from(b.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-") ? "pdf" : "unknown";
}

const label = (p: BundlePerson) => (p.rank ? `${p.name}(${p.rank})` : p.name);

export async function buildCertificateBundle(
  input: BundleInput,
): Promise<{ bytes: Uint8Array; failed: string[] }> {
  const pdf = await PDFDocument.create();
  const fonts = await embedServerFonts(pdf);
  const failed: string[] = [];

  if (input.cover) drawCover(pdf, fonts, input);

  for (const it of input.items) {
    try {
      if (!it.bytes) throw new Error("파일을 읽지 못했습니다");
      const kind = sniff(it.bytes);
      if (kind === "pdf") {
        const src = await PDFDocument.load(it.bytes, { ignoreEncryption: true });
        if (src.isEncrypted) throw new Error("암호가 걸린 PDF");
        const pages = await pdf.copyPages(src, src.getPageIndices());
        if (pages.length === 0) throw new Error("빈 PDF");
        for (const pg of pages) pdf.addPage(pg);
      } else if (kind === "jpg" || kind === "png") {
        // 휴대폰 사진은 EXIF 회전·큰 해상도 → 바로 세우고 줄여서 JPG 로 통일(투명 PNG 는 흰 바탕).
        const jpeg = await sharp(it.bytes)
          .rotate()
          .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 85 })
          .toBuffer();
        const img = await pdf.embedJpg(jpeg);
        const size = img.width > img.height ? A4_LAND : A4;
        const pg = pdf.addPage(size);
        const m = 24;
        const s = Math.min((size[0] - m * 2) / img.width, (size[1] - m * 2) / img.height);
        const w = img.width * s;
        const h = img.height * s;
        pg.drawImage(img, { x: (size[0] - w) / 2, y: (size[1] - h) / 2, width: w, height: h });
      } else {
        throw new Error("PDF·JPG·PNG 가 아닌 파일");
      }
    } catch (e) {
      failed.push(it.name);
      const pg = pdf.addPage(A4);
      const t = (s: string, y: number, size: number, font: PDFFont, color = INK) =>
        pg.drawText(fitToFont(s, fonts.fk(font === fonts.bold)), { x: 56, y, size, font, color });
      t(`${label(it)} — ${input.trainingName}`, A4[1] - 90, 14, fonts.bold);
      t("이 직원의 수료증을 PDF 에 넣지 못했습니다.", A4[1] - 120, 11, fonts.font, RED);
      t(`사유: ${e instanceof Error ? e.message : "알 수 없음"}`, A4[1] - 140, 10, fonts.font, MUTED);
      t("의무교육 현황판에서 원본 수료증을 따로 열어 확인해 주세요.", A4[1] - 158, 10, fonts.font, MUTED);
    }
  }

  pdf.setTitle(`${input.year}년 ${input.trainingName} 수료증`);
  pdf.setCreator("동래구청소년센터 동업자씨");
  return { bytes: await pdf.save(), failed };
}

// ---------------------------------------------------------------------
// 표지 — 명단이 길면 다음 장으로 이어집니다(표지 장 수는 명단 길이에 따름).
// ---------------------------------------------------------------------
function drawCover(pdf: PDFDocument, fonts: PdfFonts, input: BundleInput) {
  const [W, H] = A4;
  const M = 56;
  let page: PDFPage = pdf.addPage(A4);
  let y = H - 80;
  const safe = (s: string, bold: boolean) => fitToFont(s, fonts.fk(bold));
  const newPage = () => {
    page = pdf.addPage(A4);
    y = H - 70;
  };
  const line = (s: string, size: number, bold = false, color = INK, x = M) => {
    if (y < 60) newPage();
    page.drawText(safe(s, bold), { x, y, size, font: bold ? fonts.bold : fonts.font, color });
    y -= size + 8;
  };

  page.drawText(safe("동래구청소년센터", false), { x: M, y, size: 10, font: fonts.font, color: NAVY });
  y -= 34;
  // 교육명이 길면 글자를 줄여 한 줄에 맞춥니다.
  const title = safe(`${input.year}년 ${input.trainingName}`, true);
  let ts = 22;
  while (ts > 12 && fonts.bold.widthOfTextAtSize(title, ts) > W - M * 2) ts -= 1;
  page.drawText(title, { x: M, y, size: ts, font: fonts.bold, color: INK });
  y -= ts + 10;
  line("수료증 모음", 16, true, NAVY);
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: NAVY });
  y -= 24;
  line(`출력일 ${input.generatedOn}  ·  포함 ${input.items.length}명  ·  미등록 ${input.missing.length}명`, 10, false, MUTED);
  y -= 10;

  const list = (heading: string, people: BundlePerson[], color = INK) => {
    if (y < 100) newPage();
    line(heading, 12, true, color);
    y -= 2;
    if (people.length === 0) {
      line("없음", 10, false, MUTED, M + 8);
      return;
    }
    // 3열 — 순번. 이름(직급). 열 너비를 넘으면 글자를 줄입니다.
    const cols = 3;
    const colW = (W - M * 2 - 8) / cols;
    for (let i = 0; i < people.length; i += cols) {
      if (y < 60) newPage();
      for (let c = 0; c < cols && i + c < people.length; c++) {
        const s = safe(`${i + c + 1}. ${label(people[i + c])}`, false);
        let size = 10.5;
        while (size > 7 && fonts.font.widthOfTextAtSize(s, size) > colW - 6) size -= 0.5;
        page.drawText(s, { x: M + 8 + c * colW, y, size, font: fonts.font, color: INK });
      }
      y -= 18;
    }
    y -= 10;
  };

  list(`포함 직원 (${input.items.length}명) — 아래 순서로 수료증이 이어집니다`, input.items);
  list(`수료증 미등록 (${input.missing.length}명) — 이 묶음에서 빠졌습니다`, input.missing, RED);
}
