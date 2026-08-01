// =====================================================================
// 미사용 연차유급휴가 사용계획서 PDF — LP-5 / LP-6
//   * 증명서(certificatePdf) 파이프라인 재사용: pdf-lib + fontkit +
//     나눔고딕 통임베드(subset:false — Vercel 글리프 누락 대응).
//   * 원본 법정 서식(lib/leavePlanExport 의 xlsx 와 같은 레이아웃)을 재현한다:
//       [붙임서식 1] / 제목 / 관련법 / 성명·부서 / 미사용일수·잔여기간 /
//       계획 2단 × 8행 / 합계 / 사용촉진 확인 문구 / 년 월 일 /
//       제출자 + (서명 또는 인) / 동래구청소년센터장귀중
//   * 제출자의 도장 이미지(employee_profiles.stamp_path)가 있으면 서명란에
//     합성한다. 없으면 자리를 비워 손도장을 받을 수 있게 둔다.
//   * LP-6 합본: 표지 1장 + 직원당 1페이지.
// =====================================================================

import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "fs";
import path from "path";
import {
  formatDays,
  formatPeriod,
  sumLeavePlan,
  LEAVE_PLAN_MAX_ROWS,
  type LeavePlanEntry,
} from "./leavePlan";

// --- 폰트 로딩(캐시) — certificatePdf 와 같은 방식. ---
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
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.1, 0.1, 0.1);
const LABEL_BG = rgb(0.91, 0.91, 0.91);

const W = 595.28; // A4
const H = 841.89;

// --- 서명란 배치(LP-7) ------------------------------------------------
//   원본 서식 A26 "      제출자 :        …        (서명  또는  인)" 의 표시폭을
//   재서 얻은 비례. 내용 폭(CW)에 곱해 쓴다.
//     · "제출자" 시작        = 8.0%
//     · "(서명 또는 인)" 시작 = 67.0%
//   괄호 문구를 우측 여백까지 밀면 이름과의 간격이 원본보다 벌어진다.
const SIGN_LABEL_RATIO = 0.08;
const SIGN_PAREN_RATIO = 0.67;
// 도장 크기·불투명도 — 증명서 관인과 같은 톤. 글자가 아래로 비친다.
const STAMP_SIZE = 52;
const STAMP_OPACITY = 0.92;

// 자간 넓힌 제목.
function spaced(s: string): string {
  return s.split("").join(" ");
}

export type LeavePlanPdfData = {
  name: string;
  department: string | null;
  year: number;
  unused_days: number;
  period_start: string | null;
  period_end: string | null;
  plan: LeavePlanEntry[];
  total_days: number | null;
  submitted_at: string | null;
};

export type LeavePlanPdfItem = LeavePlanPdfData & {
  /** 제출자 도장 이미지(png/jpg). 없으면 서명란을 비운다. */
  stampBytes?: Uint8Array | null;
};

// 제출 시각(UTC ISO) → KST 날짜. ISO 앞 10자를 그대로 쓰면 오전 제출이 하루
// 밀리므로 lib/datetime 과 같은 방식(UTC+9)으로 변환한다.
function kstYmd(iso: string | null): { y: number; m: number; d: number } | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const k = new Date(t.getTime() + 9 * 60 * 60 * 1000);
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate() };
}

// png/jpg 자동 판별(증명서와 동일).
async function embedImage(
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

// top-origin 그리기 헬퍼 묶음.
function painter(page: PDFPage, font: PDFFont, bold: PDFFont) {
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
    const f = opts.bold ? bold : font;
    const tw = f.widthOfTextAtSize(s, size);
    let dx = x;
    if (opts.align === "right") dx = x - tw;
    else if (opts.align === "center") dx = x - tw / 2;
    page.drawText(s, {
      x: dx,
      y: H - yTop - size,
      size,
      font: f,
      color: opts.color ?? INK,
    });
  };
  const box = (
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
      borderColor: opts.border === false ? undefined : LINE,
      borderWidth: opts.border === false ? 0 : 0.7,
    });
  };
  // 라벨 칸(회색 배경 + 가운데 굵게).
  const label = (x: number, yTop: number, w: number, h: number, s: string) => {
    box(x, yTop, w, h, { fill: LABEL_BG });
    text(x + w / 2, yTop + (h - 9) / 2, s, {
      size: 9,
      bold: true,
      align: "center",
      color: NAVY,
    });
  };
  // 값 칸(테두리 + 정렬).
  const value = (
    x: number,
    yTop: number,
    w: number,
    h: number,
    s: string,
    align: "left" | "center" | "right" = "center",
    size = 10
  ) => {
    box(x, yTop, w, h);
    const pad = 5;
    const tx =
      align === "left" ? x + pad : align === "right" ? x + w - pad : x + w / 2;
    text(tx, yTop + (h - size) / 2, s, { size, align });
  };
  return { text, box, label, value };
}

// =====================================================================
// 계획서 1페이지 — 원본 서식 레이아웃.
// =====================================================================
async function drawPlanPage(
  pdf: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  d: LeavePlanPdfItem
): Promise<void> {
  const page = pdf.addPage([W, H]);
  const p = painter(page, font, bold);
  const M = 56;
  const CW = W - 2 * M; // 내용 폭

  let y = 42;

  // ---- [붙임서식 1] ----
  p.text(M, y, "[붙임서식 1]", { size: 8.5, color: MUTED });
  y += 26;

  // ---- 제목 ----
  p.text(W / 2, y, spaced("미사용 연차유급휴가 사용계획서"), {
    size: 17,
    bold: true,
    align: "center",
    color: NAVY,
  });
  y += 30;
  p.text(W / 2, y, "[ 관련 : 근로기준법 제61조의 2항 ]", {
    size: 9.5,
    align: "center",
    color: MUTED,
  });
  y += 30;

  // ---- 성명 · 부서 ----
  const rowH = 26;
  const labW = 78;
  const halfW = CW / 2;
  p.label(M, y, labW, rowH, "성  명");
  p.value(M + labW, y, halfW - labW, rowH, d.name, "center", 11);
  p.label(M + halfW, y, labW, rowH, "부  서");
  p.value(M + halfW + labW, y, halfW - labW, rowH, d.department ?? "", "center", 11);
  y += rowH + 14;

  // ---- 미사용 일수 · 잔여기간 ----
  p.label(M, y, halfW, rowH, "미사용 연차유급휴가일");
  p.label(M + halfW, y, halfW, rowH, "미사용 연차유급휴가 잔여기간");
  y += rowH;
  p.value(M, y, halfW, rowH, `${formatDays(d.unused_days)} 일`, "center", 11);
  p.value(
    M + halfW,
    y,
    halfW,
    rowH,
    formatPeriod(d.period_start, d.period_end),
    "center",
    10
  );
  y += rowH + 16;

  // ---- 계획 표 2단 × 8행 ----
  const PLAN_ROWS = LEAVE_PLAN_MAX_ROWS / 2; // 8
  const dateW = halfW * 0.62;
  const daysW = halfW - dateW;
  p.label(M, y, dateW, rowH, "날 짜");
  p.label(M + dateW, y, daysW, rowH, "기간(일)");
  p.label(M + halfW, y, dateW, rowH, "날 짜");
  p.label(M + halfW + dateW, y, daysW, rowH, "기간(일)");
  y += rowH;

  const cellH = 24;
  for (let i = 0; i < PLAN_ROWS; i++) {
    const left = d.plan[i];
    const right = d.plan[i + PLAN_ROWS];
    const ry = y + i * cellH;
    p.value(M, ry, dateW, cellH, left?.date ?? "", "center", 10);
    p.value(
      M + dateW,
      ry,
      daysW,
      cellH,
      left ? `${formatDays(left.days)} 일` : "일",
      "center",
      10
    );
    p.value(M + halfW, ry, dateW, cellH, right?.date ?? "", "center", 10);
    p.value(
      M + halfW + dateW,
      ry,
      daysW,
      cellH,
      right ? `${formatDays(right.days)} 일` : "일",
      "center",
      10
    );
  }
  y += PLAN_ROWS * cellH + 10;

  // ---- 합계 (원본처럼 우측) ----
  const total = d.total_days ?? sumLeavePlan(d.plan);
  p.label(M + halfW, y, dateW, rowH, "합  계");
  p.value(M + halfW + dateW, y, daysW, rowH, `${formatDays(total)} 일`, "center", 11);
  y += rowH + 22;

  // ---- 사용촉진 확인 문구(원본 2줄) ----
  p.text(
    M,
    y,
    "** 회사의 연차휴가 사용촉진을 통보 받았으며 연차휴가를 사용하지 않을 경우,",
    { size: 10 }
  );
  y += 15;
  p.text(M, y, " 잔여 연차휴가는 자동소멸됨을 인지하였습니다.", { size: 10 });
  y += 34;

  // ---- 제출일 (제출 전이면 빈 서식) ----
  const k = kstYmd(d.submitted_at);
  p.text(
    W / 2,
    y,
    k
      ? `${k.y} 년      ${k.m} 월      ${k.d} 일`
      : "년           월           일",
    { size: 11.5, align: "center" }
  );
  y += 34;

  // ---- 제출자 + (서명 또는 인) + 도장 ----
  //   위치는 원본 서식(A26 병합셀 "      제출자 :        …        (서명  또는  인)")의
  //   표시폭 비례를 그대로 따른다 — "제출자" 시작 8.0%, "(서명" 시작 67.0%.
  //   괄호 문구를 우측 여백까지 밀면 이름과의 간격이 원본보다 넓어진다(LP-7 교정).
  const signSize = 11.5;
  const signLabel = `제출자 :  ${d.name}`;
  const signX = M + CW * SIGN_LABEL_RATIO;
  const paren = "(서명  또는  인)";
  const parenX = M + CW * SIGN_PAREN_RATIO;
  p.text(signX, y, signLabel, { size: signSize });
  p.text(parenX, y, paren, { size: signSize });

  // 도장은 "(서명 또는 인)" 문구 위에, 문구 중앙에 중심을 맞춰 찍는다.
  //   실제 결재 관행과 같은 자리다. 문구를 먼저 그리고 도장을 반투명으로 얹어
  //   글자가 도장 아래로 비친다(불투명도는 증명서 관인과 동일하게 유지).
  if (d.stampBytes && d.stampBytes.length > 0) {
    const img = await embedImage(pdf, d.stampBytes);
    if (img) {
      const parenW = font.widthOfTextAtSize(paren, signSize);
      const centerX = parenX + parenW / 2;
      const sx = centerX - STAMP_SIZE / 2;
      // 문구가 차지하는 줄의 세로 중앙에 도장 중심을 맞춘다.
      const syTop = y + signSize / 2 - STAMP_SIZE / 2;
      page.drawImage(img, {
        x: sx,
        y: H - syTop - STAMP_SIZE,
        width: STAMP_SIZE,
        height: STAMP_SIZE,
        opacity: STAMP_OPACITY,
      });
    }
  }
  y += 42;

  // ---- 수신 ----
  p.text(W / 2, y, spaced("동래구청소년센터장 귀중"), {
    size: 13.5,
    bold: true,
    align: "center",
    color: NAVY,
  });

  // 계획이 서식 칸수를 넘으면 잘린 사실을 남긴다(정책상 막았지만 방어).
  if (d.plan.length > LEAVE_PLAN_MAX_ROWS) {
    p.text(
      M,
      H - 46,
      `※ 계획 ${d.plan.length}건 중 서식 칸수(${LEAVE_PLAN_MAX_ROWS})를 초과한 ${
        d.plan.length - LEAVE_PLAN_MAX_ROWS
      }건은 표에 표시되지 않았습니다.`,
      { size: 8.5, color: rgb(0.72, 0.11, 0.11) }
    );
  }
}

// 직원 1명 계획서 PDF.
export async function buildLeavePlanPdf(
  d: LeavePlanPdfItem
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regularFont(), { subset: false });
  const bold = await pdf.embedFont(boldFont(), { subset: false });
  await drawPlanPage(pdf, font, bold, d);
  return pdf.save();
}

// =====================================================================
// LP-6. 합본 — 표지 1장 + 직원당 1페이지.
// =====================================================================
export type LeavePlanBundle = {
  year: number;
  orgName: string;
  issuedCount: number; // 발부
  submittedCount: number; // 제출
  pendingNames: string[]; // 미제출 명단
  generatedAt: string; // ISO — 표지 출력일
  items: LeavePlanPdfItem[]; // 제출 완료자
};

function drawCover(
  pdf: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  b: LeavePlanBundle
): void {
  const page = pdf.addPage([W, H]);
  const p = painter(page, font, bold);
  const M = 56;
  const CW = W - 2 * M;

  let y = 150;
  p.text(W / 2, y, `${b.year}년`, {
    size: 22,
    bold: true,
    align: "center",
    color: MUTED,
  });
  y += 40;
  p.text(W / 2, y, spaced("미사용 연차유급휴가 사용계획서"), {
    size: 20,
    bold: true,
    align: "center",
    color: NAVY,
  });
  y += 34;
  p.text(W / 2, y, spaced("일괄 날인본"), {
    size: 15,
    bold: true,
    align: "center",
    color: NAVY,
  });
  y += 26;
  p.text(W / 2, y, b.orgName, { size: 12, align: "center", color: INK });
  y += 60;

  // 요약 표.
  const rowH = 30;
  const labW = 150;
  const rows: [string, string][] = [
    ["대상 연도", `${b.year}년`],
    ["발부", `${b.issuedCount}명`],
    ["제출", `${b.submittedCount}명`],
    ["미제출", `${b.pendingNames.length}명`],
    ["수록 계획서", `${b.items.length}건 (제출 완료자, 1인 1면)`],
  ];
  for (const [k, v] of rows) {
    p.label(M, y, labW, rowH, k);
    p.value(M + labW, y, CW - labW, rowH, v, "left", 11);
    y += rowH;
  }
  y += 18;

  if (b.pendingNames.length > 0) {
    p.text(M, y, "미제출자", { size: 10, bold: true, color: NAVY });
    y += 16;
    // 이름이 많으면 줄바꿈.
    const maxW = CW;
    let line = "";
    for (const name of b.pendingNames) {
      const next = line ? `${line}, ${name}` : name;
      if (font.widthOfTextAtSize(next, 10) > maxW) {
        p.text(M, y, line, { size: 10, color: rgb(0.72, 0.11, 0.11) });
        y += 14;
        line = name;
      } else {
        line = next;
      }
    }
    if (line) {
      p.text(M, y, line, { size: 10, color: rgb(0.72, 0.11, 0.11) });
      y += 14;
    }
    y += 10;
  }

  const g = kstYmd(b.generatedAt);
  p.text(
    W / 2,
    H - 120,
    g ? `출력일 ${g.y}. ${g.m}. ${g.d}.` : "",
    { size: 10, align: "center", color: MUTED }
  );
  p.text(
    W / 2,
    H - 100,
    "근로기준법 제61조의2에 따른 연차 사용촉진 서식 — 보관용",
    { size: 9, align: "center", color: MUTED }
  );
}

export async function buildLeavePlanBundlePdf(
  b: LeavePlanBundle
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regularFont(), { subset: false });
  const bold = await pdf.embedFont(boldFont(), { subset: false });

  drawCover(pdf, font, bold, b);
  // 이름 가나다순 — 표지 요약과 순서를 맞춘다.
  const items = [...b.items].sort((x, z) => x.name.localeCompare(z.name, "ko"));
  for (const item of items) await drawPlanPage(pdf, font, bold, item);
  return pdf.save();
}
