// =====================================================================
// 급여명세서 PDF 생성 (급여 3차 PART 2) — 실제 명세서 양식 재현.
//   * 제목 "{YYYY}년 {M}월 급여명세서" / 소속·이름 / (단위: 원) /
//     2단 표: 급여내역 | 공제내역 (payroll_records 항목만, 0원 미표시) /
//     지급총액 · 공제금액 / 차인지급액 / 하단 "동래구청소년센터".
//   * pdf-lib + fontkit + 나눔고딕(OFL) 임베드(subset) — 서버(Node)에서 생성.
//   * 계산 이원화 없음: 이미 확정된 payroll_records 값을 그대로 렌더링합니다.
// =====================================================================

import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "fs";
import path from "path";
import { formatKRW, type PayItem } from "./salary";

// --- 폰트 로딩(캐시). lib/fonts 의 나눔고딕 TTF 를 번들에 포함(next.config). ---
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

// --- 순수 모델(테스트 대상) — payroll_records 값 그대로 ------------------
export type PayslipMeta = {
  name: string;
  teamLabel: string; // 소속(센터/방과후아카데미)
  year: number;
  month: number;
};

export type PayslipModel = {
  title: string;
  org: string;
  name: string;
  payItems: PayItem[];
  deductItems: PayItem[];
  totalPay: number;
  totalDeduct: number;
  netPay: number;
  filename: string;
};

type PayslipRecordLike = {
  pay_items: PayItem[];
  deduct_items: PayItem[];
  total_pay: number;
  total_deduct: number;
  net_pay: number;
};

// 0원·빈 항목은 제외(명세서엔 실제 지급/공제된 항목만).
function visible(items: PayItem[]): PayItem[] {
  return items.filter((i) => i && i.label && Number(i.amount) > 0);
}

export function buildPayslipModel(
  record: PayslipRecordLike,
  meta: PayslipMeta
): PayslipModel {
  return {
    title: `${meta.year}년 ${meta.month}월 급여명세서`,
    org: meta.teamLabel,
    name: meta.name,
    payItems: visible(record.pay_items),
    deductItems: visible(record.deduct_items),
    totalPay: record.total_pay,
    totalDeduct: record.total_deduct,
    netPay: record.net_pay,
    filename: `${meta.year}년${meta.month}월_급여명세서_${meta.name}.pdf`,
  };
}

// --- 색상 ---
const NAVY = rgb(0.122, 0.227, 0.373); // #1F3A5F
const INK = rgb(0.13, 0.15, 0.18);
const LINE = rgb(0.8, 0.83, 0.87);
const SUBTOTAL_BG = rgb(0.918, 0.937, 0.961); // #EAEFF5
const WHITE = rgb(1, 1, 1);

// --- PDF 렌더링 -------------------------------------------------------
export async function buildPayslipPdf(
  record: PayslipRecordLike,
  meta: PayslipMeta
): Promise<Uint8Array> {
  const model = buildPayslipModel(record, meta);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // subset 임베드는 Vercel(서버리스) 환경에서 한글 글리프가 누락돼
  // 발송 PDF가 깨져 보이는 문제가 있어, 나눔고딕을 통째로 임베드한다.
  // (파일 크기 증가는 감수 — 한글 렌더 정확성 우선.)
  const font = await pdf.embedFont(regularFont(), { subset: false });
  const bold = await pdf.embedFont(boldFont(), { subset: false });

  const W = 595.28;
  const Hpt = 841.89;
  const page = pdf.addPage([W, Hpt]);
  const M = 48;

  // top-origin 좌표 헬퍼.
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
    page.drawText(s, {
      x: dx,
      y: Hpt - yTop - size,
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
    opts: {
      fill?: ReturnType<typeof rgb>;
      border?: ReturnType<typeof rgb>;
      borderWidth?: number;
    } = {}
  ) => {
    page.drawRectangle({
      x,
      y: Hpt - yTop - h,
      width: w,
      height: h,
      color: opts.fill,
      borderColor: opts.border,
      borderWidth: opts.borderWidth ?? (opts.border ? 0.7 : 0),
    });
  };

  // 제목.
  text(W / 2, M, model.title, { size: 18, bold: true, align: "center", color: NAVY });
  text(W - M, M + 4, "(단위: 원)", { size: 8, align: "right", color: INK });

  // 소속·이름.
  const infoY = M + 34;
  text(M, infoY, `소속: ${model.org}`, { size: 10.5 });
  text(M, infoY + 16, `성명: ${model.name}`, { size: 10.5, bold: true });

  // 2단 표 — 좌우 두 단이 한 표를 이루도록 인접 배치(가운데 세로 구분선 공유).
  //   좌우 행 수가 달라도 긴 쪽 기준으로 행 높이를 맞추고, 짧은 쪽은 빈 칸(테두리 유지).
  //   소계(지급 총액|공제 총액)는 두 단 모두 같은 줄(맨 아래)에 나란히.
  const tableTop = infoY + 44;
  const contentW = W - 2 * M;
  const colW = contentW / 2;
  const leftX = M;
  const rightX = M + colW;
  const headH = 24;
  const rowH = 22;
  const amtPad = 8;
  const textDy = 6; // 셀 내 텍스트 상단 여백

  // 한 셀(라벨 좌·금액 우) 렌더 — item 없으면 빈 칸(테두리만).
  const cell = (
    x: number,
    y: number,
    item: PayItem | undefined,
    opts: {
      fill?: ReturnType<typeof rgb>;
      bold?: boolean;
      labelColor?: ReturnType<typeof rgb>;
      size?: number;
    } = {}
  ) => {
    rect(x, y, colW, rowH, { fill: opts.fill, border: LINE });
    if (!item) return;
    const size = opts.size ?? 10;
    text(x + amtPad, y + textDy, item.label, {
      size,
      bold: opts.bold,
      color: opts.labelColor,
    });
    text(x + colW - amtPad, y + textDy, formatKRW(item.amount), {
      size,
      bold: opts.bold,
      align: "right",
      color: opts.labelColor,
    });
  };

  // 헤더 행(양 단, 진한 네이비 배경 · 흰 글씨).
  const drawHeader = (x: number, title: string) => {
    rect(x, tableTop, colW, headH, { fill: NAVY });
    text(x + amtPad, tableTop + textDy, title, {
      size: 10.5,
      bold: true,
      color: WHITE,
    });
    text(x + colW - amtPad, tableTop + textDy, "금액", {
      size: 10.5,
      bold: true,
      color: WHITE,
      align: "right",
    });
  };
  drawHeader(leftX, "급여 내역");
  drawHeader(rightX, "공제 내역");

  // 항목 행 — 긴 쪽 기준으로 행 수를 맞춤.
  const bodyRows = Math.max(model.payItems.length, model.deductItems.length);
  const bodyTop = tableTop + headH;
  for (let i = 0; i < bodyRows; i++) {
    const y = bodyTop + i * rowH;
    cell(leftX, y, model.payItems[i]);
    cell(rightX, y, model.deductItems[i]);
  }

  // 소계 행 — 두 단 같은 줄(굵게 · 연회색 배경).
  const subtotalY = bodyTop + bodyRows * rowH;
  cell(
    leftX,
    subtotalY,
    { key: "_subtotal", label: "지급 총액", amount: model.totalPay },
    { fill: SUBTOTAL_BG, bold: true, labelColor: NAVY }
  );
  cell(
    rightX,
    subtotalY,
    { key: "_subtotal", label: "공제 총액", amount: model.totalDeduct },
    { fill: SUBTOTAL_BG, bold: true, labelColor: NAVY }
  );

  // 차인지급액 박스(표 전체 폭 아래).
  const netTop = subtotalY + rowH + 16;
  const netH = 30;
  rect(M, netTop, contentW, netH, { fill: NAVY });
  text(M + amtPad, netTop + 9, "차인지급액", {
    size: 12,
    bold: true,
    color: WHITE,
  });
  text(W - M - amtPad, netTop + 8, `${formatKRW(model.netPay)} 원`, {
    size: 13,
    bold: true,
    color: WHITE,
    align: "right",
  });

  // 하단 기관명.
  text(W / 2, Hpt - 70, "동래구청소년센터", {
    size: 13,
    bold: true,
    align: "center",
    color: NAVY,
  });

  return pdf.save();
}
