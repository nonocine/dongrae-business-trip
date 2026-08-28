import {
  AlignmentType,
  BorderStyle,
  Document,
  PageBreak,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  VerticalMergeType,
  WidthType,
} from "docx";
import type { ClubReportRow } from "@/app/hr/clubs/actions";

const TABLE_W = 10120;
// 라벨 열 폭 — 활동표 첫 열(구분)과 같아야 세로선이 맞는다.
const LABEL_W = 1780;
const FONT = "맑은 고딕";
const GRAY = "F0F0F0";
const BRAND = ["E84538", "416CB3", "3FAE5E", "F3C83E"];
const borders = {
  top: { style: BorderStyle.SINGLE, size: 6, color: "111111" },
  bottom: { style: BorderStyle.SINGLE, size: 6, color: "111111" },
  left: { style: BorderStyle.SINGLE, size: 6, color: "111111" },
  right: { style: BorderStyle.SINGLE, size: 6, color: "111111" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 6, color: "111111" },
  insideVertical: { style: BorderStyle.SINGLE, size: 6, color: "111111" },
};

function textParagraph(
  text: string,
  options: {
    bold?: boolean;
    size?: number;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    before?: number;
    after?: number;
  } = {}
) {
  return new Paragraph({
    alignment: options.align ?? AlignmentType.LEFT,
    spacing: { before: options.before ?? 0, after: options.after ?? 0, line: 270 },
    children: [
      new TextRun({
        text,
        bold: options.bold,
        size: options.size ?? 20,
        font: FONT,
      }),
    ],
  });
}

function cell(
  text: string,
  width: number,
  options: {
    bold?: boolean;
    fill?: string;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    size?: number;
    columnSpan?: number;
    verticalMerge?: (typeof VerticalMergeType)[keyof typeof VerticalMergeType];
  } = {}
) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: options.columnSpan,
    verticalMerge: options.verticalMerge,
    verticalAlign: VerticalAlign.CENTER,
    borders,
    margins: { top: 110, bottom: 110, left: 100, right: 100 },
    shading: options.fill
      ? { type: ShadingType.CLEAR, color: "auto", fill: options.fill }
      : undefined,
    children: [
      textParagraph(text, {
        bold: options.bold,
        size: options.size ?? 20,
        align: options.align ?? AlignmentType.LEFT,
      }),
    ],
  });
}

function table(rows: TableRow[], widths: number[]) {
  return new Table({
    rows,
    width: { size: TABLE_W, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders,
    margins: { top: 90, bottom: 90, left: 100, right: 100 },
  });
}

function brandRule() {
  return new Table({
    rows: [
      new TableRow({
        cantSplit: true,
        children: BRAND.map(
          (fill) =>
            new TableCell({
              width: { size: TABLE_W / 4, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, color: "auto", fill },
              borders: {
                top: { style: BorderStyle.NONE, size: 0, color: fill },
                bottom: { style: BorderStyle.NONE, size: 0, color: fill },
                left: { style: BorderStyle.NONE, size: 0, color: fill },
                right: { style: BorderStyle.NONE, size: 0, color: fill },
              },
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: " ", size: 3 })] })],
            })
        ),
      }),
    ],
    width: { size: TABLE_W, type: WidthType.DXA },
    columnWidths: BRAND.map(() => TABLE_W / 4),
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
  });
}

function formatDate(value: string) {
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
  return lines.length
    ? lines.map((line, index) => `${index === 0 ? "○" : "-"} ${line}`).join("\n")
    : "-";
}

function fundingLabel(value: string) {
  return !value || value === "동아리지원사업비"
    ? "(관) 사업비\n(항) 공모사업비\n(목) 동래구동아리지원사업비"
    : value;
}

function clubChildren(year: number, month: number, club: ClubReportRow) {
  const items: Array<Paragraph | Table> = [];
  items.push(brandRule());
  items.push(
    textParagraph(`${year}년 청소년동아리연합회 'Do Go Do Go 동래'`, {
      bold: true,
      size: 26,
      align: AlignmentType.CENTER,
      before: 80,
      after: 80,
    })
  );
  items.push(brandRule());
  items.push(
    textParagraph(`[${club.name}] ${month}월 결과 보고`, {
      bold: true,
      size: 48,
      align: AlignmentType.CENTER,
      before: 170,
      after: 210,
    })
  );

  items.push(
    table(
      [
        new TableRow({
          cantSplit: true,
          children: [
            cell("목적 및 목표", LABEL_W, { bold: true, fill: GRAY, align: AlignmentType.CENTER, size: 21 }),
            cell(club.goal || "-", TABLE_W - LABEL_W, { size: 20 }),
          ],
        }),
        new TableRow({
          cantSplit: true,
          children: [
            cell("대상 및 인원", LABEL_W, { bold: true, fill: GRAY, align: AlignmentType.CENTER, size: 21 }),
            cell(`${club.target || "청소년"} / ${club.registeredCount}명`, TABLE_W - LABEL_W, { align: AlignmentType.CENTER, size: 20 }),
          ],
        }),
      ],
      [LABEL_W, TABLE_W - LABEL_W]
    )
  );

  const activityWidths = [LABEL_W, 5040, 1960, TABLE_W - LABEL_W - 5040 - 1960];
  const activityRows = club.sessions.length
    ? club.sessions
    : [{ date: "-", content: "활동 내역 없음", location: "-", participants: 0 }];
  items.push(
    table(
      [
        new TableRow({
          cantSplit: true,
          tableHeader: true,
          children: ["구분", "활동내용", "활동장소", "참여인원"].map((label, index) =>
            cell(label, activityWidths[index], { bold: true, fill: GRAY, align: AlignmentType.CENTER, size: 21 })
          ),
        }),
        ...activityRows.map(
          (activity) =>
            new TableRow({
              cantSplit: true,
              children: [
                cell(formatDate(activity.date), activityWidths[0], { align: AlignmentType.CENTER, size: 20 }),
                cell(activityContent(activity.content), activityWidths[1], { size: 20 }),
                cell(activity.location || "-", activityWidths[2], { align: AlignmentType.CENTER, size: 20 }),
                cell(`${activity.participants}명`, activityWidths[3], { align: AlignmentType.CENTER, size: 20 }),
              ],
            })
        ),
        new TableRow({
          cantSplit: true,
          children: [
            cell("연인원", activityWidths.slice(0, 3).reduce((sum, width) => sum + width, 0), {
              bold: true,
              fill: GRAY,
              align: AlignmentType.CENTER,
              size: 21,
              columnSpan: 3,
            }),
            cell(`${club.sessions.reduce((sum, row) => sum + row.participants, 0)}명`, activityWidths[3], {
              bold: true,
              align: AlignmentType.CENTER,
              size: 21,
            }),
          ],
        }),
      ],
      activityWidths
    )
  );

  items.push(new Paragraph({ spacing: { before: 80, after: 0 }, children: [] }));
  const budgetWidths = [2400, 1740, 4480, TABLE_W - 2400 - 1740 - 4480];
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
  const budgetRows = budgetSource.length
    ? budgetSource
    : [{ fundingSource: "", budgetCategory: "-", description: "-", amount: 0 }];
  const budgetTableRows: TableRow[] = [
    new TableRow({
      cantSplit: true,
      children: [
        cell(planMode ? "소요예산 (계획)" : "소요예산", TABLE_W, { bold: true, fill: GRAY, align: AlignmentType.CENTER, size: 22, columnSpan: 4 }),
      ],
    }),
    new TableRow({
      cantSplit: true,
      tableHeader: true,
      children: [
        cell("항목", budgetWidths[0], { bold: true, fill: GRAY, align: AlignmentType.CENTER, size: 21 }),
        cell("산출내역", TABLE_W - budgetWidths[0], { bold: true, fill: GRAY, align: AlignmentType.CENTER, size: 21, columnSpan: 3 }),
      ],
    }),
  ];
  budgetRows.forEach((expense, index) => {
    budgetTableRows.push(
      new TableRow({
        cantSplit: true,
        children: [
          cell(index === 0 ? fundingLabel(expense.fundingSource) : "", budgetWidths[0], {
            align: AlignmentType.CENTER,
            size: 18,
            verticalMerge: index === 0 ? VerticalMergeType.RESTART : VerticalMergeType.CONTINUE,
          }),
          cell(expense.budgetCategory || "-", budgetWidths[1], { align: AlignmentType.CENTER, size: 19 }),
          cell(expense.description || "-", budgetWidths[2], { size: 19 }),
          cell(budgetSource.length ? `${expense.amount.toLocaleString("ko-KR")}원` : "-", budgetWidths[3], {
            align: AlignmentType.RIGHT,
            size: 19,
          }),
        ],
      })
    );
  });
  budgetTableRows.push(
    new TableRow({
      cantSplit: true,
      children: [
        cell("총계", TABLE_W - budgetWidths[3], {
          bold: true,
          fill: GRAY,
          align: AlignmentType.CENTER,
          size: 21,
          columnSpan: 3,
        }),
        cell(
          budgetSource.length
            ? `${budgetSource.reduce((sum, row) => sum + row.amount, 0).toLocaleString("ko-KR")}원`
            : "-",
          budgetWidths[3],
          { bold: true, align: AlignmentType.RIGHT, size: 20 }
        ),
      ],
    })
  );
  items.push(table(budgetTableRows, budgetWidths));
  return items;
}

export function clubReportDocxFilename(year: number, month: number) {
  return `${year}년_${String(month).padStart(2, "0")}월_청소년동아리_결과보고_편집용.docx`;
}

export async function buildClubReportDocx(year: number, month: number, clubs: ClubReportRow[]) {
  const children: Array<Paragraph | Table> = [];
  clubs.forEach((club, index) => {
    if (index > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(...clubChildren(year, month, club));
  });
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 20, color: "111111" }, paragraph: { spacing: { after: 0 } } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 620, right: 893, bottom: 620, left: 893 },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
