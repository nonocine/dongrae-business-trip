// =====================================================================
// 직인사용대장 증서 PDF — 수상확인증 실물 틀(노미현 부장 첨부본) 그대로, 1인 1쪽.
//   * A4 세로 · 얇은 사각 테두리 · 왼쪽 위 "발급번호 : 제2026-01호"(굵게) · 가운데 큰 제목(글자 사이 띄움)
//     · ○ 항목(왼쪽 정렬, 콜론 줄 맞춤) · 본문(가운데, 큰 글씨, 자동 줄바꿈) · 날짜(가운데, 굵게)
//     · 맨 아래 "동래구청소년센터장"(크게, 굵게) + 오른쪽 끝에 기관 직인이 글자에 살짝 겹치게.
//   * 글꼴: lib/pdfFont(나눔고딕 통임베드 + 없는 글자 대체) — 계약서·근무일지와 같은 방식.
//   * 직인: lib/orgSeal 의 기존 기관 직인(/hr/seal 에 등록된 것)을 호출 측이 넘겨 줍니다.
//   * 미리보기(결재 전): 번호 자리 "제2026-○○호(승인 시 부여)", 직인 없음, 사선 워터마크.
//   * 발급본은 seal_recipients.snapshot 만으로 만듭니다 → 재출력해도 같은 PDF.
//   * 사용자가 넣는 글자 칸(제목·○ 항목 이름/값·대상자 이름·본문 등)은 고정 크기가 아니라 자동 맞춤(fitText·fitBox):
//     칸 폭을 넘으면 원래 크기의 70%까지 줄이고, 그래도 넘으면 어절(안 되면 글자) 단위로 2줄까지 접어
//     칸 가운데에 맞춥니다. 그래도 안 들어가는 아주 긴 글만 70%보다 더 줄입니다 — 글자를 버리지 않음.
//     미리보기·발급본이 같은 함수를 씁니다.
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

// 자동 맞춤 결과 — 이 크기로 이 줄들을 그립니다.
export type Fitted = { size: number; lines: string[] };
const MIN_RATIO = 0.7; // 줄일 수 있는 최소 = 원래 크기의 70%
const FLOOR = 5; // 70%로도 줄 수 안에 못 넣는 아주 긴 글만 여기까지 더 줄임

// base → 70% 까지 내려가는 크기(마지막은 정확히 70%)
function sizesDown(base: number, step: number): number[] {
  const min = base * MIN_RATIO;
  const out: number[] = [];
  for (let s = base; s > min + 1e-6; s -= step) out.push(s);
  out.push(min);
  return out;
}
// 70% 아래 FLOOR 까지(최후 수단)
function sizesBelow(base: number): number[] {
  const out: number[] = [];
  for (let s = Math.ceil(base * MIN_RATIO * 2) / 2 - 0.5; s >= FLOOR; s -= 0.5) out.push(s);
  return out;
}

// 한 줄 칸(행사명·이름·제목 등): ① 한 줄에 들어가는 가장 큰 크기(원래의 70%까지)
//   ② 70%로도 넘으면 70% 크기로 어절 단위(안 되면 글자 단위) 줄바꿈 — maxLines 까지
//   ③ 그래도 넘치면 maxLines 안에 들 때까지 더 줄임.
export function fitText(text: string, font: PDFFont, base: number, maxW: number, maxLines = 2): Fitted {
  const paras = text.split(/\r?\n/);
  if (paras.length <= maxLines)
    for (const s of sizesDown(base, base >= 24 ? 1 : 0.5))
      if (paras.every((p) => font.widthOfTextAtSize(p, s) <= maxW)) return { size: s, lines: paras };
  for (const s of [base * MIN_RATIO, ...sizesBelow(base)]) {
    const lines = wrap(text, font, s, maxW);
    if (lines.length <= maxLines) return { size: s, lines };
  }
  return { size: FLOOR, lines: wrap(text, font, FLOOR, maxW) };
}

// 여러 줄 칸(본문): 줄바꿈한 덩어리가 칸 높이(maxH) 안에 들 때까지 원래의 70%까지 줄임 → 그래도 넘치면 더 줄임.
export function fitBox(text: string, font: PDFFont, base: number, maxW: number, maxH: number, lhRatio: number): Fitted {
  for (const s of [...sizesDown(base, 0.5), ...sizesBelow(base)]) {
    const lines = wrap(text, font, s, maxW);
    if (lines.length * s * lhRatio <= maxH) return { size: s, lines };
  }
  return { size: FLOOR, lines: wrap(text, font, FLOOR, maxW) };
}

// 맞춘 글 덩어리의 높이(줄 간격 = 크기 × lh)
const blockH = (f: Fitted, lh = 1.25) => (f.lines.length - 1) * f.size * lh + f.size;
const blockW = (f: Fitted, font: PDFFont) => Math.max(0, ...f.lines.map((ln) => font.widthOfTextAtSize(ln, f.size)));

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
    // 맞춘 글 덩어리를 칸의 세로 가운데(centerY)에 — 줄이 늘어도 가운데 유지
    const drawFit = (fz: Fitted, x: number, centerY: number, f: PDFFont, align: "left" | "center" = "left", lh = 1.25) => {
      const top = centerY - blockH(fz, lh) / 2;
      fz.lines.forEach((ln, j) => draw(ln, x, top + j * fz.size * lh, fz.size, f, align));
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
    drawFit(fitText(fitB(`발급번호 : ${p.issueLabel}`), bold, 12, W - 2 * (M - 14), 1), M - 14, 66 + 6, bold);

    // 제목(가운데, 크게, 글자 사이 띄움) — 자동 맞춤(36pt → 25pt, 그래도 길면 2줄)
    drawFit(fitText(fitB(spacedTitle(p.title)), bold, 36, W - 2 * M), W / 2, 140 + 18, bold, "center");

    // ○ 항목(왼쪽 정렬, 콜론 줄 맞춤) + 본문(가운데, 큰 글씨)
    //   항목 이름·값(행사명·대상자 이름 등)은 칸마다 자동 맞춤, 본문은 날짜 위(BODY_LIMIT)까지의 칸에 자동 맞춤.
    //   본문이 70%로도 칸에 안 들면 항목 크기·간격을 함께 줄여 본문 칸을 넓힙니다(항목 14pt → 최소 10pt).
    const labels = p.items.map((it) => fitR(`○ ${it.label}`));
    const values = p.items.map((it) => fitR(it.value || "-"));
    const body = fitR(p.body);
    const BODY_LIMIT = 600;
    const layout = (itemSize: number, spacing: number) => {
      const labelFits = labels.map((l) => fitText(l, font, itemSize, (W - 2 * M) * 0.4));
      const labelW = Math.max(0, ...labelFits.map((f) => blockW(f, font)));
      const colonX = M + labelW + 8;
      const valueX = colonX + font.widthOfTextAtSize(": ", itemSize);
      const valueFits = values.map((v) => fitText(v, font, itemSize, W - M - valueX));
      const itemGap = itemSize * 2.15 * spacing;
      let y = 240;
      const itemCenters = p.items.map((_, i) => {
        const center = y + itemSize / 2;
        y += Math.max(itemGap, Math.max(blockH(labelFits[i]), blockH(valueFits[i])) + 8);
        return center;
      });
      const bodyTop = y + 40 * spacing;
      const bodyLhRatio = spacing < 1 ? 1.5 : 1.9;
      const bodyFit = fitBox(body, font, 18, W - 2 * M - 10, BODY_LIMIT - bodyTop, bodyLhRatio);
      const bodyLh = bodyFit.size * bodyLhRatio;
      return { itemSize, colonX, valueX, labelFits, valueFits, itemCenters, bodyTop, bodyFit, bodyLh, end: bodyTop + bodyFit.lines.length * bodyLh };
    };
    let L = layout(14, 1);
    for (let k = 1; L.bodyFit.size < 18 * MIN_RATIO - 1e-6 && k <= 8; k++) L = layout(14 - k * 0.5, k >= 4 ? 0.8 : 1);

    p.items.forEach((_, i) => {
      drawFit(L.labelFits[i], M, L.itemCenters[i], font);
      draw(":", L.colonX, L.itemCenters[i] - L.itemSize / 2, L.itemSize, font);
      drawFit(L.valueFits[i], L.valueX, L.itemCenters[i], font);
    });
    L.bodyFit.lines.forEach((ln, j) => draw(ln, W / 2, L.bodyTop + j * L.bodyLh, L.bodyFit.size, font, "center"));
    const y = L.end;

    // 날짜(가운데, 굵게) — 보통은 590 자리, 본문이 길면 본문 바로 아래
    const dateY = Math.max(y + 34, 590);
    drawFit(fitText(fitB(p.certDateText), bold, 17, W - 2 * M, 1), W / 2, dateY + 17 / 2, bold, "center");

    // 동래구청소년센터장(크게, 굵게) + 오른쪽 끝 직인 살짝 겹침
    //   폭은 양쪽에 직인 자리(74pt)를 빼고 잽니다 — 가운데 정렬이라 직인이 틀 밖으로 나가지 않게.
    const certY = Math.min(Math.max(dateY + 92, 700), Math.max(735, dateY + 52));
    const certSize = 26;
    const certFit = fitText(fitB(p.certifier), bold, certSize, W - 2 * M - 2 * 74, 1);
    drawFit(certFit, W / 2, certY + certSize / 2, bold, "center");
    if (seal) {
      const certW = blockW(certFit, bold);
      const s = 74;
      const sx = W / 2 + certW / 2 - s * 0.16; // 마지막 글자에 살짝만 걸치게
      const syTop = certY + certSize / 2 - s / 2;
      page.drawImage(seal, { x: sx, y: H - syTop - s, width: s, height: s, opacity: 0.95 });
    }
  }

  return pdf.save();
}
