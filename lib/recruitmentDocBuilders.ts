// =====================================================================
// 채용 문서 빌더 — ReportData → xlsx/docx Buffer (순수 함수, DB·인증 의존 없음)
//   * Route Handler 는 loadReportData 로 데이터를 받아 이 빌더에 넘기기만 합니다.
//   * @/ 별칭·서버 전용 모듈을 import 하지 않으므로 단독 테스트가 가능합니다.
// =====================================================================

import ExcelJS from "exceljs";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  TableLayoutType,
  VerticalAlign,
  BorderStyle,
  ShadingType,
  HeightRule,
  Header,
  convertMillimetersToTwip,
} from "docx";
import {
  type ReportData,
  SCREENING_MAX,
  INTERVIEW_MAX,
  TOTAL_MAX,
  STATUS_LABEL,
  fmtScore,
  avgScoreKey,
  screeningResultLabel,
} from "./recruitmentScore";
import {
  titlePara,
  para,
  headCell,
  dataCell,
  maskName,
  kstDateLabel,
  DOC_FONT,
  GRAY,
} from "./recruitmentDocx";
import { fmtKstDate, fmtKstDateTime } from "./datetime";

// 휴대전화 11자리면 010-1234-5678 형태로. 그 외는 원문.
function fmtPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (/^01\d{9}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return raw;
}

// 점수 셀(xlsx) — 숫자면 소수1자리 number, 없으면 빈 칸.
function scoreCell(n: number | null): number | string {
  if (n == null) return "";
  return Math.round(n * 10) / 10;
}

// =====================================================================
// [1] ERP용 집계 xlsx — 면접 위원 수에 따라 위원별 열 동적 생성.
// =====================================================================
export async function buildErpWorkbook(data: ReportData): Promise<ArrayBuffer> {
  const { posting, applicants, interviewReviewers } = data;

  const wb = new ExcelJS.Workbook();
  wb.creator = "동래구청소년센터 채용시스템";
  const ws = wb.addWorksheet("채용 집계", {
    views: [{ state: "frozen", ySplit: 3 }],
  });

  const headers = [
    "순위",
    "접수번호",
    "이름",
    "연락처",
    "지원분야",
    `서류 (/${SCREENING_MAX})`,
    ...interviewReviewers.map((r) => `면접·${r} (/${INTERVIEW_MAX})`),
    `면접 평균 (/${INTERVIEW_MAX})`,
    `합계 (/${TOTAL_MAX})`,
    "상태",
  ];

  const titleRow = ws.addRow([`${posting.title} — 채용 심사 집계표`]);
  titleRow.font = { bold: true, size: 14 };
  ws.mergeCells(1, 1, 1, headers.length);

  const subRow = ws.addRow([
    `채용분야: ${posting.field || "-"}    모집 ${posting.recruit_count}명    접수 ${applicants.length}명`,
  ]);
  subRow.font = { size: 10, color: { argb: "FF666666" } };
  ws.mergeCells(2, 1, 2, headers.length);

  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F3A5F" },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFBBBBBB" } } };
  });

  for (const a of applicants) {
    const row = ws.addRow([
      a.rank,
      a.applicant_number,
      a.name,
      fmtPhone(a.phone),
      posting.field,
      scoreCell(a.screeningAvg),
      ...interviewReviewers.map((r) => {
        const s = a.interviewByReviewer.get(r);
        if (!s) return "";
        if (s.is_absent) return "불참";
        return scoreCell(s.total);
      }),
      scoreCell(a.interviewAvg),
      scoreCell(a.total),
      STATUS_LABEL[a.status],
    ]);
    const totalCol = headers.length - 1;
    row.getCell(totalCol).font = { bold: true };
    row.alignment = { vertical: "middle" };
  }

  const widths = [
    6,
    14,
    10,
    16,
    16,
    10,
    ...interviewReviewers.map(() => 14),
    12,
    12,
    10,
  ];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const numericCols = [
    1,
    6,
    ...interviewReviewers.map((_, i) => 7 + i),
    7 + interviewReviewers.length,
    8 + interviewReviewers.length,
  ];
  for (const c of numericCols) {
    ws.getColumn(c).alignment = { horizontal: "center", vertical: "middle" };
  }

  ws.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: headers.length },
  };

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

// =====================================================================
// [2] 최종 심사 총괄표 docx.
// =====================================================================
export async function buildFinalSummaryDoc(data: ReportData): Promise<Buffer> {
  const { posting, applicants } = data;
  const passed = applicants.filter((a) => a.status === "final_passed").length;
  const topScore = applicants.length > 0 ? applicants[0].total : null;

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headCell("번호", 8),
      headCell("이름", 22),
      headCell(`1차 서류 (/${SCREENING_MAX})`, 18),
      headCell(`2차 면접 (/${INTERVIEW_MAX})`, 18),
      headCell(`합계 (/${TOTAL_MAX})`, 18),
      headCell("순위", 16),
    ],
  });

  const bodyRows = applicants.map((a, i) =>
    new TableRow({
      children: [
        dataCell(String(i + 1)),
        dataCell(a.name, { align: AlignmentType.LEFT }),
        dataCell(fmtScore(a.screeningAvg)),
        dataCell(fmtScore(a.interviewAvg)),
        dataCell(fmtScore(a.total), { bold: true }),
        dataCell(`${a.rank}위`),
      ],
    })
  );

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [headerRow, ...bodyRows],
  });

  const doc = new Document({
    sections: [
      {
        children: [
          titlePara("최종 심사 총괄표"),
          para(`채용분야 : ${posting.field || "-"}`, {
            bold: true,
            size: 12,
            spacing: { after: 60 },
          }),
          para(`공고명 : ${posting.title}`, {
            size: 11,
            color: GRAY,
            spacing: { after: 200 },
          }),
          para("■ 최종 점수 결과 요약", {
            bold: true,
            size: 12,
            spacing: { after: 80 },
          }),
          para(
            `· 모집인원 ${posting.recruit_count}명 · 응시 ${applicants.length}명 · 최종합격 ${passed}명`,
            { size: 11, spacing: { after: 40 } }
          ),
          para(
            `· 최고 득점 ${fmtScore(topScore)}점 / ${TOTAL_MAX}점 (서류 ${SCREENING_MAX} + 면접 ${INTERVIEW_MAX})`,
            { size: 11, spacing: { after: 240 } }
          ),
          table,
          para("", { spacing: { after: 200 } }),
          para(`작성일 : ${kstDateLabel(new Date())}`, {
            size: 11,
            align: AlignmentType.RIGHT,
          }),
          para("동래구청소년센터", {
            bold: true,
            size: 13,
            align: AlignmentType.RIGHT,
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// =====================================================================
// [3] 1차 서류전형 심사 총괄표 docx.
// =====================================================================
export async function buildScreeningSummaryDoc(
  data: ReportData
): Promise<Buffer> {
  const { posting, applicants } = data;
  const ranked = [...applicants].sort(
    (a, b) => (b.screeningAvg ?? -1) - (a.screeningAvg ?? -1)
  );

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headCell("번호", 8),
      headCell("이름", 16),
      headCell("전문성(학위) (15점)", 18),
      headCell("자격증 (5점)", 12),
      headCell("자기소개서 (15점)", 18),
      headCell(`득점 (${SCREENING_MAX}점)`, 16),
      headCell("결과", 12),
    ],
  });

  const bodyRows = ranked.map((a, i) => {
    const q1 = avgScoreKey(a.screeningByReviewer, "q1_expertise");
    const q2 = avgScoreKey(a.screeningByReviewer, "q2_license");
    const q3 = avgScoreKey(a.screeningByReviewer, "q3_statement");
    return new TableRow({
      children: [
        dataCell(String(i + 1)),
        dataCell(a.name, { align: AlignmentType.LEFT }),
        dataCell(fmtScore(q1)),
        dataCell(fmtScore(q2)),
        dataCell(fmtScore(q3)),
        dataCell(fmtScore(a.screeningAvg), { bold: true }),
        dataCell(screeningResultLabel(a.status)),
      ],
    });
  });

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [headerRow, ...bodyRows],
  });

  const reviewerNames = data.screeningReviewers.join(", ") || "-";
  const passedCount = ranked.filter(
    (a) => screeningResultLabel(a.status) === "합격"
  ).length;

  const doc = new Document({
    sections: [
      {
        children: [
          titlePara("1차 서류전형 심사 총괄표"),
          para(`채용분야 : ${posting.field || "-"}`, {
            bold: true,
            size: 12,
            spacing: { after: 60 },
          }),
          para(`공고명 : ${posting.title}`, {
            size: 11,
            color: GRAY,
            spacing: { after: 60 },
          }),
          para(
            `응시 ${ranked.length}명 · 서류합격 ${passedCount}명 · 심사위원 ${reviewerNames}`,
            { size: 11, color: GRAY, spacing: { after: 200 } }
          ),
          table,
          para("", { spacing: { after: 80 } }),
          para(
            `※ 항목 점수는 심사위원 ${data.screeningReviewers.length || 0}인의 평균값입니다. (전문성 0~15 · 자격증 0~5 · 자기소개서 0~15)`,
            { size: 9, color: GRAY, spacing: { after: 200 } }
          ),
          para(`작성일 : ${kstDateLabel(new Date())}`, {
            size: 11,
            align: AlignmentType.RIGHT,
          }),
          para("동래구청소년센터", {
            bold: true,
            size: 13,
            align: AlignmentType.RIGHT,
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// =====================================================================
// [4] 면접심사 대상자 공고 docx — 성명 마스킹 + 접수번호 뒷4자리.
// =====================================================================
export async function buildInterviewNoticeDoc(
  data: ReportData,
  opts: { date?: string; time?: string; place?: string } = {}
): Promise<Buffer> {
  const { posting, applicants } = data;
  const interviewDate = (opts.date ?? "").trim();
  const interviewTime = (opts.time ?? "").trim();
  const interviewPlace = (opts.place ?? "").trim();
  const blank = "                              ";

  const targets = applicants
    .filter((a) => screeningResultLabel(a.status) === "합격")
    .sort((a, b) => a.applicant_number.localeCompare(b.applicant_number));

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headCell("번호", 12),
      headCell("성명", 30),
      headCell("접수번호", 30),
      headCell("비고", 28),
    ],
  });

  const bodyRows = targets.map((a, i) => {
    const last4 = a.applicant_number.slice(-4);
    return new TableRow({
      children: [
        dataCell(String(i + 1)),
        dataCell(maskName(a.name)),
        dataCell(`****-${last4}`),
        dataCell(""),
      ],
    });
  });

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [headerRow, ...bodyRows],
  });

  const doc = new Document({
    sections: [
      {
        children: [
          titlePara("면접심사 대상자 공고"),
          para(`1. 채용분야 : ${posting.field || "-"}`, {
            size: 11.5,
            spacing: { after: 80 },
          }),
          para(`2. 공고명 : ${posting.title}`, {
            size: 11.5,
            spacing: { after: 160 },
          }),
          para(
            "위 채용의 1차 서류전형 합격자를 대상으로 아래와 같이 면접심사를 실시하오니, 해당 응시자께서는 시간에 맞추어 참석하여 주시기 바랍니다.",
            { size: 11.5, spacing: { after: 200 } }
          ),
          para(`■ 면접 일시 : ${interviewDate || blank}  ${interviewTime}`, {
            bold: true,
            size: 11.5,
            spacing: { after: 80 },
          }),
          para(`■ 면접 장소 : ${interviewPlace || blank}`, {
            bold: true,
            size: 11.5,
            spacing: { after: 200 },
          }),
          para(`■ 면접 대상자 (총 ${targets.length}명)`, {
            bold: true,
            size: 11.5,
            spacing: { after: 80 },
          }),
          table,
          para(
            "※ 응시자 보호를 위해 성명 일부와 접수번호를 비공개 처리하였습니다. 본인 여부는 접수번호 뒷 4자리로 확인하시기 바랍니다.",
            { size: 9, color: GRAY, spacing: { before: 120, after: 240 } }
          ),
          para(`작성일 : ${kstDateLabel(new Date())}`, {
            size: 11,
            align: AlignmentType.RIGHT,
          }),
          para("동래구청소년센터", {
            bold: true,
            size: 14,
            align: AlignmentType.RIGHT,
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// =====================================================================
// 채용 공고문(announcement) docx — 실제 공문 양식.
//   * A4 세로, 맑은 고딕 기본 11pt, 초록 헤더(#4CAF50)·연초록 셀(#E8F5E9).
//   * 입력은 recruitment_postings 실제 컬럼 기준(라우트에서 매핑해 전달).
// =====================================================================

export type AnnouncementPosting = {
  slug: string;
  title: string;
  field: string; // 지원분야
  recruit_count: number;
  qualifications: string | null; // 필수
  preferred: string | null; // 우대
  salary_grade: string | null; // 기준급수(없으면 빈칸)
  work_contract_period: string | null;
  work_location: string | null;
  work_hours: string | null;
  work_duties: string | null;
  salary_info: string | null; // 임금
  application_start: string;
  application_end: string;
  screening_criteria: string | null;
  interview_criteria: string | null;
  // 합격자 발표 일정 (자유 텍스트, 비어있을 수 있음)
  interview_candidate_announce_date: string | null;
  interview_datetime: string | null;
  interview_location: string | null;
  final_result_announce_date: string | null;
  appointment_date: string | null;
  notice: string | null;
  origin: string; // 온라인 지원 URL 구성용(요청 origin)
};

const G_HEADER = "4CAF50"; // 초록 헤더
const G_LIGHT = "E8F5E9"; // 연초록 셀
const STRIP_COLORS = ["E84040", "2563EB", "4CAF50", "F0C030"]; // 빨강·파랑·초록·노랑

const A_THIN = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" } as const;
const A_TABLE_BORDERS = {
  top: A_THIN,
  bottom: A_THIN,
  left: A_THIN,
  right: A_THIN,
  insideHorizontal: A_THIN,
  insideVertical: A_THIN,
};
const A_NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const A_NO_BORDERS = {
  top: A_NONE,
  bottom: A_NONE,
  left: A_NONE,
  right: A_NONE,
  insideHorizontal: A_NONE,
  insideVertical: A_NONE,
};

type Align = (typeof AlignmentType)[keyof typeof AlignmentType];

// 셀 본문 문단(10pt).
function aCellPara(
  text: string,
  opts: { bold?: boolean; align?: Align; color?: string } = {}
): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    spacing: { before: 20, after: 20 },
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        size: 20,
        color: opts.color,
        font: DOC_FONT,
      }),
    ],
  });
}

// 여러 줄 텍스트 → 문단 배열(빈 입력이면 대체 문구).
function aMultiline(
  text: string | null | undefined,
  fallback: string
): Paragraph[] {
  const lines = (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [aCellPara(fallback)];
  return lines.map((l) => aCellPara(l));
}

// 초록 헤더 셀.
function aHeadCell(text: string, widthPct?: number): TableCell {
  return new TableCell({
    width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
    shading: { type: ShadingType.CLEAR, color: "auto", fill: G_HEADER },
    verticalAlign: VerticalAlign.CENTER,
    borders: A_TABLE_BORDERS,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text, bold: true, size: 20, color: "FFFFFF", font: DOC_FONT }),
        ],
      }),
    ],
  });
}

// 본문 셀(string 또는 Paragraph[] 허용).
function aBodyCell(
  content: string | Paragraph[],
  opts: {
    fill?: string;
    align?: Align;
    bold?: boolean;
    widthPct?: number;
    columnSpan?: number;
  } = {}
): TableCell {
  const paras = Array.isArray(content)
    ? content
    : [aCellPara(content || "-", { align: opts.align, bold: opts.bold })];
  return new TableCell({
    width: opts.widthPct
      ? { size: opts.widthPct, type: WidthType.PERCENTAGE }
      : undefined,
    columnSpan: opts.columnSpan,
    shading: opts.fill
      ? { type: ShadingType.CLEAR, color: "auto", fill: opts.fill }
      : undefined,
    verticalAlign: VerticalAlign.CENTER,
    borders: A_TABLE_BORDERS,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    children: paras,
  });
}

function aTable(rows: TableRow[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows,
  });
}

// 4색 선(빨강·파랑·초록·노랑).
function aColorStrip(): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: A_NO_BORDERS,
    rows: [
      new TableRow({
        height: { value: 90, rule: HeightRule.ATLEAST },
        children: STRIP_COLORS.map(
          (c) =>
            new TableCell({
              width: { size: 25, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, color: "auto", fill: c },
              borders: A_NO_BORDERS,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: [
                new Paragraph({ children: [new TextRun({ text: "", size: 2 })] }),
              ],
            })
        ),
      }),
    ],
  });
}

// 초록 섹션 헤더(전체폭 초록 바).
function aSectionHeader(text: string): Paragraph {
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, color: "auto", fill: G_HEADER },
    spacing: { before: 260, after: 120 },
    children: [
      new TextRun({ text, bold: true, size: 24, color: "FFFFFF", font: DOC_FONT }),
    ],
  });
}

function aSubHeading(text: string): Paragraph {
  return para(text, { bold: true, size: 11, spacing: { before: 140, after: 60 } });
}

// 심사항목 파싱 — 실제 입력 형식:
//   "1. 사업에 대한 이해"   → 새 심사항목(왼쪽 열). "숫자." 접두 그대로 유지.
//   "· 센터 사업에 대한 이해" → 직전 심사항목의 세부항목(오른쪽 열).
//   같은 항목의 세부 줄이 여러 개면 줄바꿈으로 묶어 한 셀에.
//   첫 줄이 "·" 등으로 시작해 앞 항목이 없으면 심사항목 빈칸 + 세부만.
//   빈 줄은 무시. (면접처럼 "숫자." 없이 "·"만 있는 경우 → item 빈 행들)
export function parseCriteria(
  text: string | null | undefined
): { item: string; details: string[] }[] {
  if (!text) return [];
  const numbered = /^\s*\d+\.\s*/;
  const rows: { item: string; details: string[] }[] = [];
  let current: { item: string; details: string[] } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (numbered.test(line)) {
      current = { item: line, details: [] };
      rows.push(current);
    } else {
      // "·" 줄이거나 그 외 줄 → 직전 항목의 세부로. 없으면 빈 항목 생성.
      if (!current) {
        current = { item: "", details: [] };
        rows.push(current);
      }
      current.details.push(line);
    }
  }
  return rows;
}

// 파싱된 심사항목 1건 → 표 행. 심사항목이 있으면 2열, 없으면 두 열 병합.
function criteriaRow(c: { item: string; details: string[] }): TableRow {
  const detailParas =
    c.details.length > 0 ? c.details.map((d) => aCellPara(d)) : [aCellPara("-")];
  if (c.item) {
    return new TableRow({
      children: [
        aBodyCell([aCellPara(c.item, { bold: true })], { widthPct: 30 }),
        aBodyCell(detailParas, { widthPct: 70 }),
      ],
    });
  }
  return new TableRow({
    children: [aBodyCell(detailParas, { columnSpan: 2 })],
  });
}

// 공통 지원자격 — 항상 고정 텍스트.
const COMMON_QUALIFICATIONS = [
  "· 지방공무원법 결격사유에 해당하지 아니한 자",
  "· 해외여행에 결격사유가 없는 자",
  "· 아동·청소년의 성보호에 관한 법률에 해당하지 아니한 자",
  "· 동료 및 청소년과 의사소통과 네트워킹이 원활한 자",
  "· 남자의 경우 병역의무를 이행하였거나 면제된 자",
  "· 아동·청소년대상 성범죄 경력이 없는 자",
  "※ 결격사유 해당 시 합격 및 채용 취소",
];

export async function buildAnnouncementDoc(
  p: AnnouncementPosting
): Promise<Buffer> {
  const field = p.field || "직원";

  // 1-가. 분야 및 계획
  const detailQualParas = [
    aCellPara("[필수]", { bold: true }),
    ...aMultiline(p.qualifications, "공고 내용을 참고하시기 바랍니다."),
    aCellPara("[우대]", { bold: true }),
    ...aMultiline(p.preferred, "해당 없음"),
  ];
  const planTable = aTable([
    new TableRow({
      tableHeader: true,
      children: [
        aHeadCell("분야", 22),
        aHeadCell("채용인원", 18),
        aHeadCell("세부 지원자격", 60),
      ],
    }),
    new TableRow({
      children: [
        aBodyCell(field, { align: AlignmentType.CENTER }),
        aBodyCell(`${p.recruit_count}명`, { align: AlignmentType.CENTER }),
        aBodyCell(detailQualParas),
      ],
    }),
    new TableRow({
      children: [
        aBodyCell("공통 지원자격", {
          fill: G_LIGHT,
          bold: true,
          align: AlignmentType.CENTER,
        }),
        aBodyCell(
          COMMON_QUALIFICATIONS.map((t) => aCellPara(t)),
          { columnSpan: 2 }
        ),
      ],
    }),
  ]);

  // 1-나. 근무조건
  const workParas = [
    aCellPara(`① 계약기간 : ${p.work_contract_period || "-"}`),
    aCellPara(`② 근무지 : ${p.work_location || "-"}`),
    aCellPara(`③ 근무시간 : ${p.work_hours || "-"}`),
    aCellPara("④ 주요업무"),
    ...aMultiline(p.work_duties, "공고 내용을 참고하시기 바랍니다."),
  ];
  const workTable = aTable([
    new TableRow({
      tableHeader: true,
      children: [
        aHeadCell("분야", 22),
        aHeadCell("기준급수", 18),
        aHeadCell("근무형태 및 근무지", 60),
      ],
    }),
    new TableRow({
      children: [
        aBodyCell(field, { align: AlignmentType.CENTER }),
        aBodyCell(p.salary_grade || "", { align: AlignmentType.CENTER }),
        aBodyCell(workParas),
      ],
    }),
  ]);

  // 2. 채용공고 및 지원방법
  const applyUrl = `${p.origin}/recruitment/${p.slug}`;
  const noticePlaces =
    "동래구청소년센터 홈페이지 / 부산광역시청소년수련시설협회 홈페이지 / 고용24 홈페이지";
  const applyTable = aTable([
    new TableRow({
      tableHeader: true,
      children: [aHeadCell("구분", 24), aHeadCell("내용", 76)],
    }),
    new TableRow({
      children: [
        aBodyCell("공고장소", { fill: G_LIGHT, bold: true, align: AlignmentType.CENTER }),
        aBodyCell(noticePlaces),
      ],
    }),
    new TableRow({
      children: [
        aBodyCell("공고일자", { fill: G_LIGHT, bold: true, align: AlignmentType.CENTER }),
        aBodyCell(fmtKstDate(p.application_start)),
      ],
    }),
    new TableRow({
      children: [
        aBodyCell("접수기간", { fill: G_LIGHT, bold: true, align: AlignmentType.CENTER }),
        aBodyCell(
          `${fmtKstDateTime(p.application_start)} ~ ${fmtKstDateTime(
            p.application_end
          )} (시간 엄수)`
        ),
      ],
    }),
    new TableRow({
      children: [
        aBodyCell("지원방법", { fill: G_LIGHT, bold: true, align: AlignmentType.CENTER }),
        aBodyCell(`온라인 지원 : ${applyUrl}`),
      ],
    }),
  ]);

  // 2-나. 합격자 발표 — 값 없으면 빈칸(에러 없이).
  const fmtDateDot = (iso: string) => {
    const d = fmtKstDate(iso);
    return d === "-" ? "" : `${d}.`; // "YYYY.MM.DD."
  };
  const scheduleRow = (label: string, value: string | null) =>
    new TableRow({
      children: [
        aBodyCell(label, {
          fill: G_LIGHT,
          bold: true,
          align: AlignmentType.CENTER,
        }),
        // 배열 형태로 넘겨 빈 값일 때 "-" 대신 빈 셀이 되도록.
        aBodyCell([aCellPara(value ?? "")]),
      ],
    });
  const scheduleTable = aTable([
    new TableRow({
      tableHeader: true,
      children: [aHeadCell("구분", 30), aHeadCell("내용", 70)],
    }),
    scheduleRow("서류 마감일", fmtDateDot(p.application_end)),
    scheduleRow("면접 대상자 발표일", p.interview_candidate_announce_date),
    scheduleRow("면접일시", p.interview_datetime),
    scheduleRow("면접 장소", p.interview_location),
    scheduleRow("최종합격자 발표일", p.final_result_announce_date),
    scheduleRow("임용일", p.appointment_date),
  ]);

  // 3-가. 단계별 절차
  const screening = parseCriteria(p.screening_criteria);
  const interview = parseCriteria(p.interview_criteria);
  const procRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [aHeadCell("심사항목", 30), aHeadCell("세부항목", 70)],
    }),
    new TableRow({
      children: [
        aBodyCell("서류전형 (1단계)", { fill: G_LIGHT, bold: true, columnSpan: 2 }),
      ],
    }),
  ];
  if (screening.length > 0) {
    for (const c of screening) {
      procRows.push(criteriaRow(c));
    }
  } else {
    procRows.push(
      new TableRow({
        children: [
          aBodyCell("서류 심사", { align: AlignmentType.CENTER }),
          aBodyCell("제출 서류를 바탕으로 자격요건·전문성·자기소개서 등을 종합 심사"),
        ],
      })
    );
  }
  procRows.push(
    new TableRow({
      children: [
        aBodyCell("면접전형 (2단계)", { fill: G_LIGHT, bold: true, columnSpan: 2 }),
      ],
    })
  );
  if (interview.length > 0) {
    for (const c of interview) {
      procRows.push(criteriaRow(c));
    }
  } else {
    procRows.push(
      new TableRow({
        children: [
          aBodyCell("면접 심사", { align: AlignmentType.CENTER }),
          aBodyCell("면접을 통해 직무 수행 능력·인성·의사소통 능력 등을 종합 평가"),
        ],
      })
    );
  }
  const procTable = aTable(procRows);

  const children: (Paragraph | Table)[] = [
    aColorStrip(),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 160 },
      children: [
        new TextRun({
          text: "동래구청소년센터 직원 채용 공고문",
          bold: true,
          size: 40,
          color: "1A1A1A",
          font: DOC_FONT,
        }),
      ],
    }),
    aColorStrip(),

    para(`동래구청소년센터에서는 ${field} 직원을 모집합니다.`, {
      size: 11,
      spacing: { before: 240, after: 200 },
    }),
    para(kstDateLabel(new Date()), { align: AlignmentType.RIGHT, size: 11 }),
    para("동래구청소년센터장", {
      align: AlignmentType.RIGHT,
      bold: true,
      size: 13,
      spacing: { after: 80 },
    }),

    aSectionHeader("1. 채용개요"),
    aSubHeading("가. 채용 공고 채용분야 및 계획"),
    planTable,
    aSubHeading("나. 근무조건"),
    workTable,
    aSubHeading("다. 임금"),
    ...aMultiline(p.salary_info, "공고 내용을 참고하시기 바랍니다."),

    aSectionHeader("2. 채용공고 및 지원방법"),
    aSubHeading("가. 공고 및 지원방법"),
    applyTable,
    aSubHeading("나. 합격자 발표"),
    scheduleTable,
    para("※ 최종합격자 발표 및 임용일은 센터 사정에 따라 변경될 수 있음", {
      size: 9,
      color: GRAY,
      spacing: { before: 80, after: 120 },
    }),

    aSectionHeader("3. 채용절차"),
    aSubHeading("가. 단계별 절차"),
    procTable,
    aSubHeading("나. 유의사항"),
    ...aMultiline(p.notice, "공고 내용을 참고하시기 바랍니다."),
  ];

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(210),
              height: convertMillimetersToTwip(297),
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: "동래구청소년센터 직원 채용 공고문",
                    size: 16,
                    color: GRAY,
                    font: DOC_FONT,
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
