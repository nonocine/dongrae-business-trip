import ExcelJS from "exceljs";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

// 사업별 세부표(일자형/회차형) 한 행 — 구청 서식의 사업별 세부표에 대응합니다.
export type BusinessDetailExportRow = {
  entry_type: "date" | "session";
  entry_date: string | null;
  session_no: number | null;
  session_days: number | null;
  content: string;
  participants_youth: number;
  participants_other: number;
  room_youth: number;
  room_other: number;
};

// 청/기 세부·담당자·운영일수·세부표는 신규 컬럼이라 선택 필드로 둡니다.
//   값이 없는 과거 데이터도 계 컬럼만으로 그대로 출력됩니다.
export type BusinessResultExportRow = {
  category: string;
  program_name: string;
  manager_name?: string;
  sessions: number;
  operating_days?: number;
  participants: number;
  participants_youth?: number;
  participants_other?: number;
  attendance: number;
  attendance_youth?: number;
  attendance_other?: number;
  youth_uses: number;
  other_uses: number;
  summary: string;
  status: "draft" | "submitted";
  author_name: string;
  details?: BusinessDetailExportRow[];
};

export type CoinPayExportRow = {
  entry_type: string;
  place: string;
  headcount: number;
  amount: number;
  note: string;
};

export type StaffTrainingExportRow = {
  training_date: string;
  staff_name: string;
  training_name: string;
  location: string;
  organizer: string;
  hours: string;
};

export type PromotionExportRow = {
  activity_date: string;
  category: string;
  title: string;
  count: number;
  url: string;
  description: string;
  author_name: string;
};

export type BusinessReportInput = {
  year: number;
  month: number;
  startMonth?: number;
  endMonth?: number;
  periodLabel?: string;
  orgName: string;
  results: BusinessResultExportRow[];
  promotions: PromotionExportRow[];
  coinPay?: CoinPayExportRow[];
  coinPayCumulative?: number;
  staffTrainings?: StaffTrainingExportRow[];
};

function reportPeriod(input: BusinessReportInput) {
  return {
    startMonth: input.startMonth ?? input.month,
    endMonth: input.endMonth ?? input.month,
    label: input.periodLabel ?? `${input.month}월`,
  };
}

export function calculateBusinessReportTotals(input: BusinessReportInput) {
  const result = input.results.reduce(
    (a, r) => ({
      sessions: a.sessions + r.sessions,
      operatingDays: a.operatingDays + (r.operating_days ?? 0),
      participants: a.participants + r.participants,
      participantsYouth: a.participantsYouth + (r.participants_youth ?? 0),
      participantsOther: a.participantsOther + (r.participants_other ?? 0),
      attendance: a.attendance + r.attendance,
      attendanceYouth: a.attendanceYouth + (r.attendance_youth ?? 0),
      attendanceOther: a.attendanceOther + (r.attendance_other ?? 0),
      youthUses: a.youthUses + r.youth_uses,
      otherUses: a.otherUses + r.other_uses,
    }),
    {
      sessions: 0,
      operatingDays: 0,
      participants: 0,
      participantsYouth: 0,
      participantsOther: 0,
      attendance: 0,
      attendanceYouth: 0,
      attendanceOther: 0,
      youthUses: 0,
      otherUses: 0,
    },
  );
  const totalUses = result.youthUses + result.otherUses;
  const coinPay = (input.coinPay ?? []).reduce(
    (a, r) => ({
      earn: a.earn + (r.entry_type === "차감" ? 0 : r.amount),
      spend: a.spend + (r.entry_type === "차감" ? r.amount : 0),
      headcount: a.headcount + r.headcount,
    }),
    { earn: 0, spend: 0, headcount: 0 },
  );
  return {
    ...result,
    totalUses,
    youthRate: totalUses ? result.youthUses / totalUses : 0,
    promotionCount: input.promotions.reduce((sum, row) => sum + row.count, 0),
    coinPayEarn: coinPay.earn,
    coinPaySpend: coinPay.spend,
    coinPayHeadcount: coinPay.headcount,
    coinPayCumulative: input.coinPayCumulative ?? 0,
    staffTrainingCount: (input.staffTrainings ?? []).length,
  };
}

const navy = "17365D";
const sectionBlue = "9CC2E5";
const paleBlue = "D9E2F3";
const paleGray = "F2F2F2";
const documentFont = "NanumGothic";
const documentFontAttributes = {
  ascii: documentFont,
  hAnsi: documentFont,
  eastAsia: documentFont,
  cs: documentFont,
};
const border = { style: BorderStyle.SINGLE, size: 6, color: "595959" };

function docCell(
  text: string,
  options?: {
    header?: boolean;
    width?: number;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    small?: boolean;
  },
) {
  return new TableCell({
    width: options?.width
      ? { size: options.width, type: WidthType.DXA }
      : undefined,
    shading: options?.header
      ? { fill: paleBlue, type: ShadingType.CLEAR }
      : undefined,
    margins: { top: 70, bottom: 70, left: 70, right: 70 },
    borders: { top: border, bottom: border, left: border, right: border },
    children: [
      new Paragraph({
        alignment: options?.align ?? AlignmentType.CENTER,
        spacing: { before: 0, after: 0, line: 230 },
        children: [
          new TextRun({
            text: text || "-",
            bold: options?.header,
            size: options?.small ? 14 : 18,
            font: documentFontAttributes,
          }),
        ],
      }),
    ],
  });
}

function colorRule() {
  const colors = ["EA4335", "3B6EAA", "42B86B", "F6D04D"];
  return new Table({
    width: { size: 9500, type: WidthType.DXA },
    layout: "fixed",
    columnWidths: [2375, 2375, 2375, 2375],
    rows: [
      new TableRow({
        cantSplit: true,
        children: colors.map(
          (fill) =>
            new TableCell({
              width: { size: 2375, type: WidthType.DXA },
              shading: { fill, type: ShadingType.CLEAR },
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              borders: {
                top: { style: BorderStyle.NONE },
                bottom: { style: BorderStyle.NONE },
                left: { style: BorderStyle.NONE },
                right: { style: BorderStyle.NONE },
              },
              children: [
                new Paragraph({
                  spacing: { before: 0, after: 0, line: 60 },
                  children: [new TextRun({ text: " ", size: 2 })],
                }),
              ],
            }),
        ),
      }),
    ],
  });
}

function sectionTitle(roman: string, title: string) {
  return new Table({
    width: { size: 9500, type: WidthType.DXA },
    layout: "fixed",
    columnWidths: [950, 8550],
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 950, type: WidthType.DXA },
            shading: { fill: "3B6EAA", type: ShadingType.CLEAR },
            margins: { top: 90, bottom: 90, left: 140, right: 80 },
            borders: {
              top: { style: BorderStyle.NONE },
              bottom: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
            },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: roman,
                    bold: true,
                    color: "FFFFFF",
                    size: 24,
                    font: documentFontAttributes,
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 8550, type: WidthType.DXA },
            shading: { fill: sectionBlue, type: ShadingType.CLEAR },
            margins: { top: 90, bottom: 90, left: 260, right: 100 },
            borders: {
              top: { style: BorderStyle.NONE },
              bottom: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
            },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: title,
                    bold: true,
                    color: "FFFFFF",
                    size: 25,
                    font: documentFontAttributes,
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function docTable(
  headers: string[],
  widths: number[],
  rows: string[][],
  small = false,
) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    layout: "fixed",
    columnWidths: widths,
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: headers.map((h, i) =>
          docCell(h, { header: true, width: widths[i], small }),
        ),
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            cantSplit: true,
            children: row.map((v, i) =>
              docCell(v, {
                width: widths[i],
                small,
                align: i < 3 ? AlignmentType.LEFT : AlignmentType.CENTER,
              }),
            ),
          }),
      ),
    ],
  });
}

// 본문 문단 한 줄 — 기존 인라인 Paragraph 와 같은 서식.
function docParagraph(
  text: string,
  options?: { bold?: boolean; size?: number; before?: number; after?: number },
) {
  return new Paragraph({
    spacing: { before: options?.before ?? 0, after: options?.after ?? 90 },
    children: [
      new TextRun({
        text,
        bold: options?.bold,
        size: options?.size,
        font: documentFontAttributes,
      }),
    ],
  });
}

// 데이터가 없는 신규 섹션 — 빈 표는 docx 에서 깨질 수 있어 문단으로 대체합니다.
function noDataParagraph() {
  return new Paragraph({
    spacing: { before: 40, after: 120 },
    children: [
      new TextRun({
        text: "해당 없음",
        size: 18,
        color: "666666",
        font: documentFontAttributes,
      }),
    ],
  });
}

// 청/기 구분이 없는 과거 행(청·기 0 인데 계 > 0)은 청·기 를 "-" 로 표기합니다.
function trioCells(
  youth: number | undefined,
  other: number | undefined,
  total: number,
): string[] {
  const y = youth ?? 0;
  const o = other ?? 0;
  if (y + o === 0 && total > 0) return ["-", "-", String(total)];
  return [String(y), String(o), String(y + o)];
}

// 사업별 세부표 — 첫 열이 일자형은 일자, 회차형은 운영일수(김혜지 확정 6개 항목).
function detailTables(results: BusinessResultExportRow[]) {
  const out: (Paragraph | Table)[] = [];
  for (const row of results) {
    const details = row.details ?? [];
    if (details.length === 0) continue;
    const isSession = details[0].entry_type === "session";
    out.push(
      docParagraph(`▸ ${row.program_name} 세부 실적`, {
        bold: true,
        size: 19,
        before: 140,
        after: 60,
      }),
    );
    out.push(
      docTable(
        [
          isSession ? "운영일수" : "일자",
          "운영내용",
          "참가 청",
          "참가 기",
          "참가 계",
          "실별 청",
          "실별 기",
          "실별 계",
        ],
        [1300, 3600, 760, 760, 760, 760, 760, 800],
        details.map((d) => [
          isSession
            ? `${d.session_days ?? "-"}일`
            : (d.entry_date ?? "-"),
          d.content,
          String(d.participants_youth),
          String(d.participants_other),
          String(d.participants_youth + d.participants_other),
          String(d.room_youth),
          String(d.room_other),
          String(d.room_youth + d.room_other),
        ]),
        true,
      ),
    );
  }
  return out;
}

export async function buildBusinessReportDocx(
  input: BusinessReportInput,
): Promise<Uint8Array> {
  const totals = calculateBusinessReportTotals(input);
  const period = reportPeriod(input);
  const periodEnd = new Date(input.year, period.endMonth, 0).getDate();
  const coinPayRows = input.coinPay ?? [];
  const staffRows = input.staffTrainings ?? [];
  const detailRows = input.results.filter(
    (row) =>
      row.summary &&
      !/^\d+월 최종 결과보고서 \d+번 사업 실적$/.test(row.summary),
  );
  // 평가·향후 계획 열은 김혜지 요청으로 삭제 — 남은 열에 폭을 나눠 줍니다.
  const detailSection = detailRows.length
    ? [
        docTable(
          ["번호", "사업명", "담당자", "주요 운영내용"],
          [700, 2900, 1000, 8460],
          detailRows.map((r) => [
            String(input.results.indexOf(r) + 1),
            r.program_name,
            r.manager_name ?? "",
            r.summary,
          ]),
        ),
      ]
    : [
        new Paragraph({
          spacing: { before: 40, after: 120 },
          children: [
            new TextRun({
              text: "※ 프로그램 목록과 수치는 반영되었으며, 사업별 주요 운영내용은 원자료 추가 입력 후 이 위치에 자동 출력됩니다.",
              size: 18,
              color: "666666",
              font: documentFontAttributes,
            }),
          ],
        }),
      ];
  const children = [
    colorRule(),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 0 },
      children: [
        new TextRun({
          text: `${input.year}년 ${input.orgName}`,
          bold: true,
          size: 24,
          color: "000000",
          font: documentFontAttributes,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 70 },
      children: [
        new TextRun({
          text: `${period.label} 청소년 사업 운영 결과보고서`,
          bold: true,
          size: 34,
          color: "000000",
          font: documentFontAttributes,
        }),
      ],
    }),
    colorRule(),
    new Paragraph({ spacing: { before: 0, after: 100 }, children: [] }),
    sectionTitle("Ⅰ.", "사업개요"),
    new Paragraph({ spacing: { before: 50, after: 0 }, children: [] }),
    new Paragraph({
      children: [
        new TextRun({
          text: `1. 사업기간 : ${input.year}. ${String(period.startMonth).padStart(2, "0")}. 01. ~ ${input.year}. ${String(period.endMonth).padStart(2, "0")}. ${String(periodEnd).padStart(2, "0")}.`,
          font: documentFontAttributes,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `2. 총 이용인원 : ${totals.totalUses.toLocaleString("ko-KR")}명 (청소년 : ${totals.youthUses.toLocaleString("ko-KR")}명, 기타 : ${totals.otherUses.toLocaleString("ko-KR")}명)`,
          font: documentFontAttributes,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `3. 청소년 이용률 : ${(totals.youthRate * 100).toFixed(2)}%`,
          font: documentFontAttributes,
        }),
      ],
    }),
    new Paragraph({
      spacing: { before: 50, after: 60 },
      children: [
        new TextRun({
          text: "4. 사업별 종합실적",
          bold: true,
          size: 20,
          font: documentFontAttributes,
        }),
      ],
    }),
    docTable(
      [
        "번호",
        "분야",
        "사업명",
        "담당자",
        "횟수",
        "참가 청",
        "참가 기",
        "참가 계",
        "연인원 청",
        "연인원 기",
        "연인원 계",
        "실인원 청",
        "실인원 기",
        "실인원 계",
      ],
      [380, 950, 1600, 600, 450, 613, 613, 613, 613, 613, 613, 613, 613, 616],
      input.results.map((r, index) => [
        String(index + 1),
        r.category,
        r.program_name,
        r.manager_name ?? "",
        r.sessions ? String(r.sessions) : "수시",
        ...trioCells(r.participants_youth, r.participants_other, r.participants),
        ...trioCells(r.attendance_youth, r.attendance_other, r.attendance),
        String(r.youth_uses),
        String(r.other_uses),
        String(r.youth_uses + r.other_uses),
      ]),
      true,
    ),
    new Paragraph({
      pageBreakBefore: true,
      spacing: { before: 0, after: 0 },
      children: [],
    }),
    sectionTitle("Ⅱ.", "사업별 실적보고"),
    new Paragraph({ spacing: { before: 70, after: 0 }, children: [] }),
    ...detailSection,
    ...detailTables(input.results),
    new Paragraph({ spacing: { before: 150, after: 0 }, children: [] }),
    sectionTitle("Ⅲ.", "홍보·대외협력 실적"),
    new Paragraph({ spacing: { before: 70, after: 0 }, children: [] }),
    docTable(
      ["날짜", "구분", "제목", "횟수", "설명"],
      [1200, 1300, 2200, 700, 4100],
      input.promotions.map((r) => [
        r.activity_date,
        r.category,
        r.title,
        String(r.count),
        r.description,
      ]),
    ),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 100 },
      children: [
        new TextRun({
          text: `홍보·대외협력 합계 ${totals.promotionCount.toLocaleString("ko-KR")}회`,
          bold: true,
          size: 18,
          font: documentFontAttributes,
        }),
      ],
    }),
    new Paragraph({ spacing: { before: 150, after: 0 }, children: [] }),
    sectionTitle("Ⅳ.", "동전PAY 실적"),
    new Paragraph({ spacing: { before: 70, after: 0 }, children: [] }),
    ...(coinPayRows.length
      ? [
          docTable(
            ["구분", "사용처", "인원", "금액", "비고"],
            [1000, 3000, 1200, 1600, 2700],
            coinPayRows.map((r) => [
              r.entry_type,
              r.place,
              r.headcount.toLocaleString("ko-KR"),
              r.amount.toLocaleString("ko-KR"),
              r.note,
            ]),
          ),
          docParagraph(
            `기간 합계 : 적립 ${totals.coinPayEarn.toLocaleString("ko-KR")} · 차감 ${totals.coinPaySpend.toLocaleString("ko-KR")} (인원 ${totals.coinPayHeadcount.toLocaleString("ko-KR")}명)`,
            { before: 100 },
          ),
        ]
      : [noDataParagraph()]),
    docParagraph(
      `최종 금액(센터 전체 누적) : ${totals.coinPayCumulative.toLocaleString("ko-KR")}`,
      { bold: true },
    ),
    new Paragraph({ spacing: { before: 150, after: 0 }, children: [] }),
    sectionTitle("Ⅴ.", "종사자 교육"),
    new Paragraph({ spacing: { before: 70, after: 0 }, children: [] }),
    ...(staffRows.length
      ? [
          docTable(
            ["연번", "일자", "성명", "교육명", "장소", "주최", "수료시간"],
            [600, 1300, 1000, 2800, 1300, 1400, 1100],
            staffRows.map((r, index) => [
              String(index + 1),
              r.training_date,
              r.staff_name,
              r.training_name,
              r.location,
              r.organizer,
              r.hours,
            ]),
            true,
          ),
        ]
      : [noDataParagraph()]),
  ];

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: documentFontAttributes, size: 19 },
          paragraph: { spacing: { after: 90, line: 260 } },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            bold: true,
            size: 25,
            color: "000000",
            font: documentFontAttributes,
          },
          paragraph: { spacing: { before: 260, after: 100 }, keepNext: true },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            bold: true,
            size: 21,
            color: "000000",
            font: documentFontAttributes,
          },
          paragraph: { spacing: { before: 180, after: 80 }, keepNext: true },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11900, height: 16840 },
            margin: {
              top: 620,
              right: 700,
              bottom: 620,
              left: 700,
              header: 300,
              footer: 300,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `${input.orgName} | ${input.year}년 ${period.label}`,
                    size: 16,
                    color: "666666",
                    font: documentFontAttributes,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    color: "777777",
                    font: documentFontAttributes,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

function styleSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 4, showGridLines: false }];
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: {
      left: 0.3,
      right: 0.3,
      top: 0.5,
      bottom: 0.5,
      header: 0.2,
      footer: 0.2,
    },
  };
  sheet.eachRow((row) => {
    row.alignment = { vertical: "middle", wrapText: true };
  });
}

function applyExcelHeader(row: ExcelJS.Row) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { name: "맑은 고딕", bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${navy}` },
    };
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFB8C4D0" } },
      bottom: { style: "thin", color: { argb: "FFB8C4D0" } },
      left: { style: "thin", color: { argb: "FFB8C4D0" } },
      right: { style: "thin", color: { argb: "FFB8C4D0" } },
    };
  });
}

export async function buildBusinessReportWorkbook(
  input: BusinessReportInput,
): Promise<Buffer> {
  const period = reportPeriod(input);
  const totals = calculateBusinessReportTotals(input);
  const wb = new ExcelJS.Workbook();
  wb.creator = input.orgName;
  wb.created = new Date(Date.UTC(input.year, input.month - 1, 1));

  const coinPayRows = input.coinPay ?? [];
  const staffRows = input.staffTrainings ?? [];

  const summary = wb.addWorksheet("종합현황");
  summary.mergeCells("A1:K1");
  summary.getCell("A1").value =
    `${input.year}년 ${period.label} 사업 운영 결과보고`;
  summary.getCell("A1").font = {
    name: "맑은 고딕",
    size: 18,
    bold: true,
    color: { argb: `FF${navy}` },
  };
  summary.getCell("A1").alignment = {
    horizontal: "center",
    vertical: "middle",
  };
  summary.getRow(1).height = 34;
  summary.mergeCells("A2:K2");
  summary.getCell("A2").value = input.orgName;
  summary.getCell("A2").alignment = { horizontal: "right" };
  summary.addRow([]);
  summary.addRow([
    "등록 사업",
    "운영 횟수",
    "참가인원",
    "연인원",
    "실인원",
    "실인원 청",
    "실인원 기",
    "청소년 이용률",
    "홍보·협력",
    "동전PAY 최종",
    "종사자 교육",
  ]);
  summary.addRow([
    input.results.length,
    totals.sessions,
    totals.participants,
    totals.attendance,
    totals.totalUses,
    totals.youthUses,
    totals.otherUses,
    totals.youthRate,
    totals.promotionCount,
    totals.coinPayCumulative,
    totals.staffTrainingCount,
  ]);
  applyExcelHeader(summary.getRow(4));
  summary.getRow(5).font = { name: "맑은 고딕", bold: true, size: 12 };
  summary.getRow(5).alignment = { horizontal: "center", vertical: "middle" };
  summary.getCell("H5").numFmt = "0.0%";
  summary.columns = [14, 14, 14, 14, 14, 13, 13, 18, 14, 16, 14].map(
    (width) => ({ width }),
  );
  styleSheet(summary);

  const results = wb.addWorksheet("사업실적");
  results.addRow([`${input.year}년 ${period.label} 사업실적`]);
  results.mergeCells("A1:Q1");
  results.getCell("A1").font = {
    name: "맑은 고딕",
    size: 17,
    bold: true,
    color: { argb: `FF${navy}` },
  };
  results.getCell("A1").alignment = { horizontal: "center" };
  results.addRow([]);
  results.addRow([]);
  results.addRow([
    "분야",
    "사업명",
    "담당자",
    "운영 횟수",
    "운영일수",
    "참가 청",
    "참가 기",
    "참가 계",
    "연인원 청",
    "연인원 기",
    "연인원 계",
    "실인원 청",
    "실인원 기",
    "실인원 계",
    "주요 내용",
    "상태",
    "작성자",
  ]);
  input.results.forEach((r) => {
    // 계 열은 기존 방식대로 수식으로 넣습니다(F+G / I+J / L+M).
    const line = results.rowCount + 1;
    results.addRow([
      r.category,
      r.program_name,
      r.manager_name ?? "",
      r.sessions,
      r.operating_days ?? 0,
      r.participants_youth ?? 0,
      r.participants_other ?? 0,
      { formula: `F${line}+G${line}` },
      r.attendance_youth ?? 0,
      r.attendance_other ?? 0,
      { formula: `I${line}+J${line}` },
      r.youth_uses,
      r.other_uses,
      { formula: `L${line}+M${line}` },
      r.summary,
      r.status === "submitted" ? "제출" : "작성 중",
      r.author_name,
    ]);
  });
  const sumTo = results.rowCount;
  const totalRow = results.addRow([
    "합계",
    "",
    "",
    ...["D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"].map((col) => ({
      formula: `SUM(${col}5:${col}${sumTo})`,
    })),
    // 주요 내용 · 상태 · 작성자 — 합계 없는 열(평가 열 삭제로 3칸).
    "",
    "",
    "",
  ]);
  applyExcelHeader(results.getRow(4));
  totalRow.font = { name: "맑은 고딕", bold: true };
  totalRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: `FF${paleGray}` },
  };
  results.columns = [
    14, 24, 10, 11, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 48, 11, 12,
  ].map((width) => ({ width }));
  results.autoFilter = `A4:Q${results.rowCount}`;
  styleSheet(results);

  const promotions = wb.addWorksheet("홍보대외협력");
  promotions.addRow([`${input.year}년 ${period.label} 홍보·대외협력`]);
  promotions.mergeCells("A1:G1");
  promotions.getCell("A1").font = {
    name: "맑은 고딕",
    size: 17,
    bold: true,
    color: { argb: `FF${navy}` },
  };
  promotions.getCell("A1").alignment = { horizontal: "center" };
  promotions.addRow([]);
  promotions.addRow([]);
  promotions.addRow(["날짜", "구분", "제목", "횟수", "URL", "설명", "작성자"]);
  input.promotions.forEach((r) =>
    promotions.addRow([
      r.activity_date,
      r.category,
      r.title,
      r.count,
      r.url,
      r.description,
      r.author_name,
    ]),
  );
  const promoTotal = promotions.addRow([
    "합계",
    "",
    "",
    { formula: `SUM(D5:D${promotions.rowCount})` },
    "",
    "",
    "",
  ]);
  applyExcelHeader(promotions.getRow(4));
  promoTotal.font = { name: "맑은 고딕", bold: true };
  promoTotal.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: `FF${paleGray}` },
  };
  promotions.columns = [14, 16, 28, 10, 34, 42, 14].map((width) => ({ width }));
  promotions.autoFilter = `A4:G${promotions.rowCount}`;
  styleSheet(promotions);

  // --- 신규 시트 2종: 동전PAY / 종사자교육 ------------------------------
  const lastCol = (n: number) => String.fromCharCode(64 + n);

  function addDataSheet(
    name: string,
    title: string,
    headers: string[],
    widths: number[],
    rows: (string | number)[][],
  ) {
    const sheet = wb.addWorksheet(name);
    sheet.addRow([title]);
    sheet.mergeCells(`A1:${lastCol(headers.length)}1`);
    sheet.getCell("A1").font = {
      name: "맑은 고딕",
      size: 17,
      bold: true,
      color: { argb: `FF${navy}` },
    };
    sheet.getCell("A1").alignment = { horizontal: "center" };
    sheet.addRow([]);
    sheet.addRow([]);
    sheet.addRow(headers);
    rows.forEach((row) => sheet.addRow(row));
    applyExcelHeader(sheet.getRow(4));
    sheet.columns = widths.map((width) => ({ width }));
    sheet.autoFilter = `A4:${lastCol(headers.length)}${sheet.rowCount}`;
    styleSheet(sheet);
    return sheet;
  }

  const coinSheet = addDataSheet(
    "동전PAY",
    `${input.year}년 ${period.label} 동전PAY 실적`,
    ["구분", "사용처", "인원", "금액", "비고"],
    [12, 30, 12, 16, 34],
    coinPayRows.map((r) => [
      r.entry_type,
      r.place,
      r.headcount,
      r.amount,
      r.note,
    ]),
  );
  if (coinPayRows.length) {
    const to = coinSheet.rowCount;
    const coinTotal = coinSheet.addRow([
      "기간 합계",
      "",
      { formula: `SUM(C5:C${to})` },
      { formula: `SUM(D5:D${to})` },
      "",
    ]);
    coinTotal.font = { name: "맑은 고딕", bold: true };
    coinTotal.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${paleGray}` },
    };
  }
  // 최종 금액은 조회 기간과 무관한 센터 전체 누적이라 합계행과 분리해 표기합니다.
  const cumulativeRow = coinSheet.addRow([
    "최종 금액(센터 전체 누적)",
    "",
    "",
    totals.coinPayCumulative,
    "",
  ]);
  cumulativeRow.font = { name: "맑은 고딕", bold: true };

  addDataSheet(
    "종사자교육",
    `${input.year}년 ${period.label} 종사자 교육`,
    ["연번", "일자", "성명", "교육명", "장소", "주최", "수료시간"],
    [8, 14, 12, 34, 16, 18, 12],
    staffRows.map((r, index) => [
      index + 1,
      r.training_date,
      r.staff_name,
      r.training_name,
      r.location,
      r.organizer,
      r.hours,
    ]),
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}
