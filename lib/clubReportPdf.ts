import { PDFDocument, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { boldFont, fitToFont, fkFont, regularFont } from "@/lib/pdfFont";
import type { ClubReportRow } from "@/app/hr/clubs/actions";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 43;
// 라벨 열 폭 — 활동표 첫 열(구분)과 같아야 세로선이 맞는다.
const LABEL_W = 88;
const INK = rgb(0.03, 0.03, 0.03);
const LINE = rgb(0.08, 0.08, 0.08);
const HEAD = rgb(0.94, 0.94, 0.94);
const BRAND = [
  rgb(0.91, 0.27, 0.22),
  rgb(0.25, 0.42, 0.7),
  rgb(0.25, 0.68, 0.38),
  rgb(0.96, 0.78, 0.24),
];

function safe(text: string, bold = false) {
  return fitToFont(text, fkFont(bold));
}

function wrapParagraph(text: string, font: PDFFont, size: number, width: number) {
  const source = safe(text).replace(/\s+/g, " ").trim();
  if (!source) return [""];
  const lines: string[] = [];
  let line = "";
  for (const char of source) {
    const next = line + char;
    if (font.widthOfTextAtSize(next, size) <= width || !line) {
      line = next;
    } else {
      lines.push(line.trimEnd());
      line = char.trimStart();
    }
  }
  if (line) lines.push(line.trimEnd());
  return lines;
}

function wrap(text: string, font: PDFFont, size: number, width: number, maxLines = 2) {
  const lines = text
    .split(/\r?\n/)
    .flatMap((paragraph) => wrapParagraph(paragraph, font, size, width));
  if (lines.length <= maxLines) return lines;
  const result = lines.slice(0, maxLines);
  let last = result[maxLines - 1];
  while (last && font.widthOfTextAtSize(`${last}…`, size) > width) last = last.slice(0, -1);
  result[maxLines - 1] = `${last}…`;
  return result;
}

function drawText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  top: number,
  size = 9,
  width?: number,
  align: "left" | "center" | "right" = "left"
) {
  const value = safe(text, font.name.includes("Bold"));
  const tw = font.widthOfTextAtSize(value, size);
  let dx = x;
  if (width != null && align === "center") dx = x + (width - tw) / 2;
  if (width != null && align === "right") dx = x + width - tw;
  page.drawText(value, { x: dx, y: PAGE_H - top - size, size, font, color: INK });
}

function cell(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  top: number,
  width: number,
  height: number,
  options: {
    fill?: boolean;
    align?: "left" | "center" | "right";
    maxLines?: number;
    size?: number;
    padding?: number;
  } = {}
) {
  page.drawRectangle({
    x,
    y: PAGE_H - top - height,
    width,
    height,
    color: options.fill ? HEAD : undefined,
    borderColor: LINE,
    borderWidth: 0.55,
  });
  const size = options.size ?? 9.1;
  const padding = options.padding ?? 5;
  const lines = wrap(text, font, size, width - padding * 2, options.maxLines ?? 3);
  const lineHeight = size + 2.5;
  let y = top + (height - lines.length * lineHeight) / 2 + 1.4;
  for (const line of lines) {
    drawText(page, font, line, x + padding, y, size, width - padding * 2, options.align ?? "left");
    y += lineHeight;
  }
}

function drawBrandRule(page: PDFPage, top: number, width: number) {
  const segment = width / BRAND.length;
  for (const [index, color] of BRAND.entries()) {
    page.drawRectangle({
      x: MARGIN + segment * index,
      y: PAGE_H - top - 2.4,
      width: segment + 0.2,
      height: 2.4,
      color,
    });
  }
}

function fittingSize(text: string, font: PDFFont, maxWidth: number, start = 29, min = 20) {
  for (let size = start; size >= min; size -= 0.5) {
    if (font.widthOfTextAtSize(safe(text, true), size) <= maxWidth) return size;
  }
  return min;
}

function formatActivityDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][
    new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()
  ];
  return `${month}.${day}.(${weekday})`;
}

function activityContent(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return "-";
  return lines.map((line, index) => `${index === 0 ? "○" : "-"} ${line}`).join("\n");
}

function fundingLabel(value: string) {
  if (!value || value === "동아리지원사업비") {
    return "(관) 사업비\n(항) 공모사업비\n(목) 동래구동아리지원사업비";
  }
  return value;
}

export function clubReportFilename(year: number, month: number) {
  return `${year}년_${String(month).padStart(2, "0")}월_청소년동아리_결과보고.pdf`;
}

export async function buildClubReportPdf(
  year: number,
  month: number,
  clubs: ClubReportRow[]
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(regularFont(), { subset: false });
  const bold = await pdf.embedFont(boldFont(), { subset: false });
  const tableW = PAGE_W - MARGIN * 2;

  for (const club of clubs) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);

    drawBrandRule(page, 31, tableW);
    drawText(
      page,
      bold,
      `${year}년 청소년동아리연합회 ‘Do Go Do Go 동래’`,
      MARGIN,
      43,
      12.5,
      tableW,
      "center"
    );
    drawBrandRule(page, 65, tableW);

    const title = `[${club.name}] ${month}월 결과 보고`;
    const titleSize = fittingSize(title, bold, tableW - 10);
    drawText(page, bold, title, MARGIN + 5, 78, titleSize, tableW - 10, "center");

    let top = 126;
    cell(page, bold, "목적 및 목표", MARGIN, top, LABEL_W, 43, { fill: true, align: "center", size: 10.2 });
    cell(page, regular, club.goal || "-", MARGIN + LABEL_W, top, tableW - LABEL_W, 43, { maxLines: 3, size: 9.7 });
    top += 43;
    cell(page, bold, "대상 및 인원", MARGIN, top, LABEL_W, 30, { fill: true, align: "center", size: 10.2 });
    cell(page, regular, `${club.target || "청소년"} / ${club.registeredCount}명`, MARGIN + LABEL_W, top, tableW - LABEL_W, 30, { align: "center", size: 9.7 });

    top += 30;
    const activityCols = [LABEL_W, 257, 99, tableW - LABEL_W - 257 - 99];
    let x = MARGIN;
    for (const [label, width] of [
      ["구분", activityCols[0]],
      ["활동내용", activityCols[1]],
      ["활동장소", activityCols[2]],
      ["참여인원", activityCols[3]],
    ] as Array<[string, number]>) {
      cell(page, bold, label, x, top, width, 28, { fill: true, align: "center", size: 10.2 });
      x += width;
    }
    top += 28;

    const visibleSessions = club.sessions.slice(0, 6);
    const activityRows = visibleSessions.length
      ? visibleSessions
      : [{ date: "-", content: "활동 내역 없음", location: "-", participants: 0 }];
    const activityRowHeights = [78, 62, 52, 44, 38, 34];
    const activityRowH = activityRowHeights[Math.min(activityRows.length, 6) - 1];
    for (const activity of activityRows) {
      x = MARGIN;
      const values: Array<[string, number, "left" | "center" | "right", number]> = [
        [formatActivityDate(activity.date), activityCols[0], "center", 1],
        [activityContent(activity.content), activityCols[1], "left", 4],
        [activity.location || "-", activityCols[2], "center", 2],
        [`${activity.participants}명`, activityCols[3], "center", 1],
      ];
      for (const [value, width, align, maxLines] of values) {
        cell(page, regular, value, x, top, width, activityRowH, { align, maxLines, size: 9.3 });
        x += width;
      }
      top += activityRowH;
    }
    if (club.sessions.length > visibleSessions.length) {
      cell(page, regular, `외 ${club.sessions.length - visibleSessions.length}건`, MARGIN, top, tableW, 22, { align: "center" });
      top += 22;
    }
    const attendance = club.sessions.reduce((sum, row) => sum + row.participants, 0);
    cell(page, bold, "연인원", MARGIN, top, tableW - activityCols[3], 28, { fill: true, align: "center", size: 10.2 });
    cell(page, bold, `${attendance}명`, MARGIN + tableW - activityCols[3], top, activityCols[3], 28, { align: "center", size: 10.2 });

    top += 39;
    // 집행 내역이 없고 예산계획만 있으면 계획으로 표를 채운다(실적과 섞지 않는다).
    const planMode = club.expenses.length === 0 && club.budgetPlans.length > 0;
    const budgetSource = planMode
      ? club.budgetPlans.map((plan) => ({
          fundingSource: "",
          budgetCategory: plan.category,
          description: plan.description,
          amount: plan.amount,
        }))
      : club.expenses.map((expense) => ({
          fundingSource: expense.fundingSource,
          budgetCategory: expense.budgetCategory,
          description: expense.description,
          amount: expense.amount,
        }));
    cell(page, bold, planMode ? "소요예산 (계획)" : "소요예산", MARGIN, top, tableW, 28, { fill: true, align: "center", size: 10.7 });
    top += 28;
    const sourceW = 118;
    const categoryW = 86;
    const amountW = 75;
    const detailW = tableW - sourceW - categoryW - amountW;
    cell(page, bold, "항목", MARGIN, top, sourceW, 28, { fill: true, align: "center", size: 10.2 });
    cell(page, bold, "산출내역", MARGIN + sourceW, top, tableW - sourceW, 28, { fill: true, align: "center", size: 10.2 });
    top += 28;

    const maxBudgetRows = Math.max(1, Math.min(4, Math.floor((784 - top - 28) / 31)));
    const visibleExpenses = budgetSource.slice(0, maxBudgetRows);
    const budgetRows = visibleExpenses.length
      ? visibleExpenses
      : [{ fundingSource: "", budgetCategory: "-", description: "-", amount: 0 }];
    const budgetRowH = 31;
    const source = fundingLabel(budgetRows[0].fundingSource);
    cell(page, regular, source, MARGIN, top, sourceW, budgetRows.length * budgetRowH, {
      align: "center",
      maxLines: 4,
      size: 8.5,
      padding: 4,
    });
    for (const expense of budgetRows) {
      cell(page, regular, expense.budgetCategory || "-", MARGIN + sourceW, top, categoryW, budgetRowH, { align: "center", size: 8.8 });
      cell(page, regular, expense.description || "-", MARGIN + sourceW + categoryW, top, detailW, budgetRowH, { maxLines: 2, size: 8.8 });
      cell(
        page,
        regular,
        visibleExpenses.length ? `${expense.amount.toLocaleString("ko-KR")}원` : "-",
        MARGIN + tableW - amountW,
        top,
        amountW,
        budgetRowH,
        { align: "right", size: 8.8 }
      );
      top += budgetRowH;
    }
    const total = budgetSource.reduce((sum, row) => sum + row.amount, 0);
    cell(page, bold, "총계", MARGIN, top, tableW - amountW, 28, { fill: true, align: "center", size: 10.2 });
    cell(
      page,
      bold,
      budgetSource.length ? `${total.toLocaleString("ko-KR")}원` : "-",
      MARGIN + tableW - amountW,
      top,
      amountW,
      28,
      { align: "right", size: 9.7 }
    );
  }
  return pdf.save();
}
