// =====================================================================
// 증명서(재직·경력) PDF 생성 — 명세서(salaryPayslip) 패턴 재사용.
//   * pdf-lib + fontkit + 나눔고딕 통임베드(subset:false — Vercel 글리프 누락 대응).
//   * 실물 양식 재현: 발급번호 / 큰 제목(자간 넓게) / 인적사항·재직기관 표 /
//     재직사항 표(1행 + "- 이 하 여 백 -") / 용도 / 증명문구 / 발급일 /
//     "동래구청소년센터장" + 관인(글자 끝에 겹치게).
//   * 관인은 storage 에서 service_role 로 읽어 전달(sealBytes). 없으면 자리 비우고 발급.
//   * 계산 이원화 없음: snapshot 값을 그대로 렌더.
// =====================================================================

import { PDFDocument, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "fs";
import path from "path";
import {
  formatIssuedDate,
  periodToLabel,
  type CertSnapshot,
} from "./certificates";

// --- 폰트 로딩(캐시) — lib/fonts 나눔고딕 TTF. ---
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
// 실물 양식 톤 — 검정 테두리 + 연회색(#E8E8E8) 라벨 음영.
const LINE = rgb(0.1, 0.1, 0.1);
const LABEL_BG = rgb(0.91, 0.91, 0.91);

// 자간 넓힌 제목(예: "재 직 증 명 서").
function spaced(s: string): string {
  return s.split("").join("  ");
}

export async function buildCertificatePdf(
  snap: CertSnapshot,
  // 관인 바이트(actions 에서 storage 로드하여 전달). 없으면 관인 없이 발급.
  sealBytes?: Uint8Array | null
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regularFont(), { subset: false });
  const bold = await pdf.embedFont(boldFont(), { subset: false });

  const W = 595.28;
  const Hpt = 841.89;
  const page = pdf.addPage([W, Hpt]);
  const M = 56;
  const contentW = W - 2 * M;

  // top-origin 헬퍼.
  const text = (
    x: number,
    yTop: number,
    s: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      align?: "left" | "right" | "center";
    } = {}
  ) => {
    const size = opts.size ?? 10;
    const f: PDFFont = opts.bold ? bold : font;
    const tw = f.widthOfTextAtSize(s, size);
    let dx = x;
    if (opts.align === "right") dx = x - tw;
    else if (opts.align === "center") dx = x - tw / 2;
    page.drawText(s, { x: dx, y: Hpt - yTop - size, size, font: f, color: opts.color ?? INK });
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
      y: Hpt - yTop - h,
      width: w,
      height: h,
      color: opts.fill,
      borderColor: opts.border ? LINE : undefined,
      borderWidth: opts.border ? 0.9 : 0,
    });
  };
  // 셀 안 좌측·세로중앙 텍스트.
  const cellText = (
    x: number,
    yTop: number,
    h: number,
    s: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      padX?: number;
    } = {}
  ) => {
    const size = opts.size ?? 10;
    const padX = opts.padX ?? 8;
    text(x + padX, yTop + (h - size) / 2, s, {
      size,
      bold: opts.bold,
      color: opts.color,
    });
  };

  // 셀 중앙정렬 텍스트(셀 폭 명시).
  const cellCenter = (
    x: number,
    yTop: number,
    w: number,
    h: number,
    s: string,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}
  ) => {
    const size = opts.size ?? 10;
    text(x + w / 2, yTop + (h - size) / 2, s, {
      size,
      bold: opts.bold,
      color: opts.color,
      align: "center",
    });
  };

  const sectionBar = (yTop: number, h: number, title: string) => {
    rect(M, yTop, contentW, h, { fill: LABEL_BG, border: true });
    cellText(M, yTop, h, title, { size: 10.5, bold: true, color: INK });
  };

  // 좌측 세로 병합 섹션명 + (필드라벨|값) 행들. 실물 양식 구조.
  const sectionW = 66;
  const fieldW = 78;
  const valueX = M + sectionW + fieldW;
  const valueW = contentW - sectionW - fieldW;
  const mergedBlock = (
    yTop: number,
    h: number,
    titleLines: string[],
    fields: { label: string; value: string }[]
  ) => {
    const blockH = h * fields.length;
    // 좌측 병합 셀(세로 중앙, 여러 줄 지원).
    rect(M, yTop, sectionW, blockH, { fill: LABEL_BG, border: true });
    const lineGap = 13;
    const startY = yTop + (blockH - (titleLines.length - 1) * lineGap) / 2 - 5;
    titleLines.forEach((ln, i) => {
      text(M + sectionW / 2, startY + i * lineGap, ln, {
        size: 9.5,
        bold: true,
        color: INK,
        align: "center",
      });
    });
    // 필드 라벨 + 값 행.
    fields.forEach((f, i) => {
      const ry = yTop + i * h;
      rect(M + sectionW, ry, fieldW, h, { fill: LABEL_BG, border: true });
      rect(valueX, ry, valueW, h, { border: true });
      cellText(M + sectionW, ry, h, f.label, { size: 9.5, bold: true, color: INK });
      cellText(valueX, ry, h, f.value, { size: 9.5 });
    });
  };

  // ---- 발급번호(좌상단) ----
  text(M, 48, snap.issueLabel, { size: 10 });

  // ---- 제목 ----
  const titleLabel = snap.certType === "employment" ? "재직증명서" : "경력증명서";
  text(W / 2, 84, spaced(titleLabel), { size: 26, bold: true, align: "center", color: NAVY });

  // ---- 표1: 신청인 인적사항 + 재직기관 (좌측 세로 병합 라벨) ----
  let y = 150;
  const rowH = 27;

  mergedBlock(y, rowH, ["신청인", "인적사항"], [
    { label: "성명", value: snap.name },
    { label: "생년월일", value: snap.birthDate ?? "-" },
    { label: "주소", value: snap.address ?? "-" },
  ]);
  y += rowH * 3;

  y += 10;
  mergedBlock(y, rowH, ["재직", "기관"], [
    { label: "기관명", value: `${snap.org.name} (${snap.org.phone})` },
    { label: "주소", value: snap.org.address },
    { label: "대표자", value: snap.org.representative },
  ]);
  y += rowH * 3;

  // ---- 표2: 재직사항 ----
  y += 16;
  sectionBar(y, rowH, "재직사항");
  y += rowH;

  const cols = [
    { key: "dept", label: "근무부서", w: 92 },
    { key: "name", label: "이름", w: 58 },
    { key: "period", label: "근무기간", w: 138 },
    { key: "span", label: "기간", w: 66 },
    { key: "duty", label: "직위 및 담당업무", w: contentW - 92 - 58 - 138 - 66 },
  ];
  // 헤더행.
  let cx = M;
  for (const c of cols) {
    rect(cx, y, c.w, rowH, { fill: LABEL_BG, border: true });
    cellCenter(cx, y, c.w, rowH, c.label, { size: 9.5, bold: true, color: INK });
    cx += c.w;
  }
  y += rowH;
  // 데이터행(1행).
  const periodStr = `${snap.periodFrom ?? "-"} ~ ${periodToLabel(snap.periodTo)}`;
  const dataRowH = 34;
  const values = [
    snap.department ?? "-",
    snap.name,
    periodStr,
    snap.periodText || "-",
    snap.duty ?? "-",
  ];
  cx = M;
  cols.forEach((c, i) => {
    rect(cx, y, c.w, dataRowH, { border: true });
    cellCenter(cx, y, c.w, dataRowH, values[i], { size: 9 });
    cx += c.w;
  });
  y += dataRowH;
  // 이하 여백행.
  rect(M, y, contentW, rowH, { border: true });
  cellCenter(M, y, contentW, rowH, "- 이 하 여 백 -", { size: 9.5, color: INK });
  y += rowH;

  // ---- 용도 ----
  y += 18;
  text(M, y, `용도 : ${snap.purpose}`, { size: 11, bold: true, color: INK });
  y += 34;

  // ---- 증명문구(종류별 정확) ----
  text(W / 2, y, snap.statement, { size: 13.5, bold: true, align: "center", color: INK });
  y += 42;

  // ---- 발급일 ----
  text(W / 2, y, formatIssuedDate(snap.issuedOn), { size: 12, align: "center", color: INK });
  y += 50;

  // ---- 기관장 + 관인 ----
  const certifier = snap.org.certifierTitle;
  const certSize = 20;
  text(W / 2, y, certifier, { size: certSize, bold: true, align: "center", color: NAVY });

  if (sealBytes && sealBytes.length > 0) {
    const img = await embedSeal(pdf, sealBytes);
    if (img) {
      const certW = bold.widthOfTextAtSize(certifier, certSize);
      const sealSize = 74;
      // 기관장 글자 끝(우측)에 겹치게.
      const sealX = W / 2 + certW / 2 - sealSize * 0.4;
      const sealYTop = y + certSize / 2 - sealSize / 2;
      page.drawImage(img, {
        x: sealX,
        y: Hpt - sealYTop - sealSize,
        width: sealSize,
        height: sealSize,
        opacity: 0.92,
      });
    }
  } else {
    // 관인 미등록 — 발급은 계속(자리만 비움). 서버 로그로 경고.
    console.warn(
      `[certificatePdf] 관인 이미지가 없어 관인 없이 발급합니다. (${snap.issueLabel})`
    );
  }

  return pdf.save();
}

// png/jpg 모두 시도(형식 자동 판별).
async function embedSeal(
  pdf: PDFDocument,
  bytes: Uint8Array
): Promise<PDFImage | null> {
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
