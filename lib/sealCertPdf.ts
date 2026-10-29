// =====================================================================
// 직인사용대장 증서 PDF — 수상확인증 실물 틀(노미현 부장 첨부본) 그대로, 1인 1쪽.
//   * A4 세로 · 얇은 사각 테두리 · 왼쪽 위 "발급번호 : 제2026-01호"(굵게) · 가운데 큰 제목(글자 사이 띄움)
//     · ○ 항목(왼쪽 정렬, 콜론 줄 맞춤) · 본문(가운데, 큰 글씨, 자동 줄바꿈) · 날짜(가운데, 굵게)
//     · 맨 아래 "동래구청소년센터장"(크게, 굵게) + 오른쪽 끝에 기관 직인이 글자에 살짝 겹치게.
//   * 글꼴: lib/pdfFont(나눔고딕 통임베드 + 없는 글자 대체) — 계약서·근무일지와 같은 방식.
//   * 직인: lib/orgSeal 의 기존 기관 직인(/hr/seal 에 등록된 것)을 호출 측이 넘겨 줍니다.
//   * 미리보기(결재 전): 번호 자리 "제2026-○○호(승인 시 부여)", 직인 없음, 사선 워터마크.
//   * 발급본은 seal_recipients.snapshot 만으로 만듭니다 → 재출력해도 같은 PDF.
// =====================================================================

import { PDFDocument, degrees, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { boldFont, fitToFont, fkFont, regularFont } from "./pdfFont";
import { spacedTitle, type SealItemValue } from "./sealRegister";

export type SealCertPage = {
  issueLabel: string; // "제2026-01호" 또는 미리보기 "제2026-○○호(승인 시 부여)"
  title: string;
  items: SealItemValue[];
  body: string;
  certDateText: string; // "2026년 10월 17일"
  certifier: string; // "동래구청소년센터장"
};

const INK = rgb(0.08, 0.08, 0.08);
const LINE = rgb(0.15, 0.15, 0.15);
const WATERMARK = rgb(0.82, 0.82, 0.82);

const W = 595.28;
const H = 841.89;
const BORDER = 30; // 테두리 여백
const M = 72; // 글 여백

// 띄어쓰기 기준 줄바꿈 — 한 단어가 줄보다 길면 글자 단위로 자릅니다.
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/(\s+)/).filter((w) => w.length > 0);
    let line = "";
    const push = () => {
      out.push(line.trimEnd());
      line = "";
    };
    for (const w of words) {
      if (/^\s+$/.test(w)) {
        if (line) line += " ";
        continue;
      }
      if (font.widthOfTextAtSize(line + w, size) <= maxW) {
        line += w;
        continue;
      }
      if (line.trim()) push();
      if (font.widthOfTextAtSize(w, size) <= maxW) {
        line = w;
        continue;
      }
      for (const ch of w) {
        if (font.widthOfTextAtSize(line + ch, size) > maxW && line) push();
        line += ch;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

async function embedSeal(pdf: PDFDocument, bytes: Uint8Array): Promise<PDFImage | null> {
  try {
    return await pdf.embedPng(bytes);
  } catch {
    try {
      return await pdf.embedJpg(bytes);
    } catch {
      return null;
    }
  }
}

export async function buildSealCertPdf(
  pages: SealCertPage[],
  opts: { preview: boolean; sealBytes?: Uint8Array | null },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regularFont(), { subset: false });
  const bold = await pdf.embedFont(boldFont(), { subset: false });
  const fitR = (s: string) => fitToFont(s, fkFont(false));
  const fitB = (s: string) => fitToFont(s, fkFont(true));
  const seal = !opts.preview && opts.sealBytes?.length ? await embedSeal(pdf, opts.sealBytes) : null;

  for (const p of pages) {
    const page = pdf.addPage([W, H]);
    // top 기준 좌표로 그리기
    const draw = (s: string, x: number, yTop: number, size: number, f: PDFFont, align: "left" | "center" = "left") => {
      const tw = f.widthOfTextAtSize(s, size);
      page.drawText(s, { x: align === "center" ? x - tw / 2 : x, y: H - yTop - size, size, font: f, color: INK });
    };

    // 바깥 얇은 사각 테두리
    page.drawRectangle({ x: BORDER, y: BORDER, width: W - 2 * BORDER, height: H - 2 * BORDER, borderColor: LINE, borderWidth: 0.8 });

    // 미리보기 워터마크(사선) — 글자 뒤에 깔리게 먼저 그림
    if (opts.preview) {
      const wm = "미리보기 — 직인 없음";
      const size = 46;
      const tw = bold.widthOfTextAtSize(wm, size);
      const rad = (35 * Math.PI) / 180;
      page.drawText(wm, {
        x: W / 2 - (Math.cos(rad) * tw) / 2 + (Math.sin(rad) * size) / 2,
        y: H / 2 - (Math.sin(rad) * tw) / 2 - (Math.cos(rad) * size) / 2,
        size,
        font: bold,
        color: WATERMARK,
        rotate: degrees(35),
        opacity: 0.55,
      });
    }

    // 발급번호(왼쪽 위, 굵게)
    draw(fitB(`발급번호 : ${p.issueLabel}`), M - 14, 66, 12, bold);

    // 제목(가운데, 크게, 글자 사이 띄움). 긴 제목은 글자 크기를 줄여 한 줄에.
    const title = fitB(spacedTitle(p.title));
    let tSize = 36;
    while (tSize > 18 && bold.widthOfTextAtSize(title, tSize) > W - 2 * M) tSize -= 2;
    draw(title, W / 2, 140, tSize, bold, "center");

    // ○ 항목(왼쪽 정렬, 콜론 줄 맞춤) + 본문(가운데, 큰 글씨)
    //   날짜·센터장 줄이 테두리 안에 남도록, 내용이 길면 항목·본문 글자를 함께 줄입니다
    //   (보통 크기 항목 14pt·본문 18pt → 최소 10pt·11pt). 먼저 재 보고 맞는 크기로 그립니다.
    const labels = p.items.map((it) => fitR(`○ ${it.label}`));
    const values = p.items.map((it) => fitR(it.value || "-"));
    const body = fitR(p.body);
    const layout = (itemSize: number, bSize: number, spacing: number) => {
      const labelW = Math.max(0, ...labels.map((l) => font.widthOfTextAtSize(l, itemSize)));
      const colonX = M + labelW + 8;
      const valueX = colonX + font.widthOfTextAtSize(": ", itemSize);
      const itemLines = values.map((v) => wrap(v, font, itemSize, W - M - valueX));
      const itemLh = itemSize + 7;
      const itemGap = itemSize * 2.15 * spacing;
      let y = 240;
      const itemTops = itemLines.map((ls) => {
        const top = y;
        y += itemGap + (ls.length - 1) * itemLh;
        return top;
      });
      const bodyTop = y + 40 * spacing;
      const bodyLines = wrap(body, font, bSize, W - 2 * M - 10);
      const bodyLh = bSize * (spacing < 1 ? 1.5 : 1.9);
      return { itemSize, bSize, colonX, valueX, itemLines, itemLh, itemTops, bodyTop, bodyLines, bodyLh, end: bodyTop + bodyLines.length * bodyLh };
    };
    const BODY_LIMIT = 600;
    let L = layout(14, 18, 1);
    for (let k = 1; L.end > BODY_LIMIT && k <= 8; k++) L = layout(Math.max(10, 14 - k * 0.5), Math.max(11, 18 - k), k >= 4 ? 0.8 : 1);

    p.items.forEach((_, i) => {
      draw(labels[i], M, L.itemTops[i], L.itemSize, font);
      draw(":", L.colonX, L.itemTops[i], L.itemSize, font);
      L.itemLines[i].forEach((ln, j) => draw(ln, L.valueX, L.itemTops[i] + j * L.itemLh, L.itemSize, font));
    });
    L.bodyLines.forEach((ln, j) => draw(ln, W / 2, L.bodyTop + j * L.bodyLh, L.bSize, font, "center"));
    const y = L.end;

    // 날짜(가운데, 굵게) — 보통은 590 자리, 본문이 길면 본문 바로 아래
    const dateY = Math.max(y + 34, 590);
    draw(fitB(p.certDateText), W / 2, dateY, 17, bold, "center");

    // 동래구청소년센터장(크게, 굵게) + 오른쪽 끝 직인 살짝 겹침
    const certY = Math.min(Math.max(dateY + 92, 700), Math.max(735, dateY + 52));
    const certSize = 26;
    const certifier = fitB(p.certifier);
    draw(certifier, W / 2, certY, certSize, bold, "center");
    if (seal) {
      const certW = bold.widthOfTextAtSize(certifier, certSize);
      const s = 74;
      const sx = W / 2 + certW / 2 - s * 0.16; // 마지막 글자에 살짝만 걸치게
      const syTop = certY + certSize / 2 - s / 2;
      page.drawImage(seal, { x: sx, y: H - syTop - s, width: s, height: s, opacity: 0.95 });
    }
  }

  return pdf.save();
}
