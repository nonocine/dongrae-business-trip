// =====================================================================
// 증명서(재직·경력) PDF 생성 — 명세서(salaryPayslip) 패턴 재사용.
//   * pdf-lib + fontkit + 나눔고딕 통임베드(subset:false — Vercel 글리프 누락 대응).
//   * C-1: 기본 레이아웃(증명문구·기간 정확). C-2에서 실물 표 양식 + 관인으로 고도화.
//   * 계산 이원화 없음: snapshot 값을 그대로 렌더.
// =====================================================================

import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
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

// 자간 넓힌 제목(예: "재 직 증 명 서").
function spaced(s: string): string {
  return s.split("").join(" ");
}

export async function buildCertificatePdf(
  snap: CertSnapshot,
  // 관인 바이트(C-2에서 storage 로드하여 전달). 없으면 관인 없이 발급.
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
    const size = opts.size ?? 11;
    const f: PDFFont = opts.bold ? bold : font;
    const tw = f.widthOfTextAtSize(s, size);
    let dx = x;
    if (opts.align === "right") dx = x - tw;
    else if (opts.align === "center") dx = x - tw / 2;
    page.drawText(s, { x: dx, y: Hpt - yTop - size, size, font: f, color: opts.color ?? INK });
  };

  // 발급번호(좌상단).
  text(M, M, snap.issueLabel, { size: 10, color: INK });

  // 제목(중앙, 자간 넓게).
  const titleLabel = snap.certType === "employment" ? "재직증명서" : "경력증명서";
  text(W / 2, M + 40, spaced(titleLabel), {
    size: 24,
    bold: true,
    align: "center",
    color: NAVY,
  });

  // 본문 필드.
  let y = M + 110;
  const line = (label: string, value: string) => {
    text(M, y, label, { size: 11, bold: true, color: NAVY });
    text(M + 110, y, value, { size: 11 });
    y += 26;
  };

  line("성명", snap.name);
  line("생년월일", snap.birthDate ?? "-");
  line("주소", snap.address ?? "-");
  y += 6;
  line("재직기관", `${snap.org.name} (${snap.org.phone})`);
  line("기관주소", snap.org.address);
  line("대표자", snap.org.representative);
  y += 6;
  line("근무부서", snap.department ?? "-");
  line(
    "근무기간",
    `${snap.periodFrom ?? "-"} ~ ${periodToLabel(snap.periodTo)} (${snap.periodText})`
  );
  line("직위 및 담당업무", snap.duty ?? "-");
  y += 4;
  text(W / 2, y, "- 이 하 여 백 -", { size: 10, align: "center", color: INK });
  y += 30;
  line("용도", snap.purpose);

  // 증명문구(종류별 정확).
  y += 20;
  text(W / 2, y, snap.statement, { size: 13, bold: true, align: "center", color: INK });

  // 발급일.
  y += 40;
  text(W / 2, y, formatIssuedDate(snap.issuedOn), { size: 12, align: "center", color: INK });

  // 발급 기관장 + 관인.
  y += 44;
  const certifier = snap.org.certifierTitle;
  text(W / 2, y, certifier, { size: 18, bold: true, align: "center", color: NAVY });

  // 관인(있으면 기관장 글자 끝에 겹치게). C-1은 바이트 미전달이라 보통 생략.
  if (sealBytes && sealBytes.length > 0) {
    try {
      const png = await pdf.embedPng(sealBytes);
      const certW = bold.widthOfTextAtSize(certifier, 18);
      const sealSize = 68;
      const sealX = W / 2 + certW / 2 - sealSize * 0.35;
      const sealY = Hpt - y - 18 - sealSize * 0.55;
      page.drawImage(png, { x: sealX, y: sealY, width: sealSize, height: sealSize });
    } catch {
      // 관인 삽입 실패해도 발급은 계속.
    }
  }

  return pdf.save();
}
