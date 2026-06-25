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
  PageBreak,
  ImageRun,
  convertMillimetersToTwip,
} from "docx";
import { detectImageType } from "./applicantDocxBuilder";
import {
  type ReportData,
  type ReviewerScore,
  SCREENING_MAX,
  INTERVIEW_MAX,
  TOTAL_MAX,
  SCREENING_GROUPS,
  INTERVIEW_ITEMS,
  STATUS_LABEL,
  fmtScore,
  avgScreeningGroup,
  screeningResultLabel,
} from "./recruitmentScore";
import {
  titlePara,
  docNumberPara,
  para,
  headCell,
  dataCell,
  maskName,
  kstDateLabel,
  DOC_FONT,
  NAVY,
  GRAY,
  CELL_BORDERS,
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
// [1-B] 심사위원별 면접 세부평가 점수표 xlsx.
//   * 위원별로 q1~q4 항목 점수 + 합계를 묶어 보여줍니다(열 = 위원, 하위열 = 항목).
//   * 항목 정의·배점은 INTERVIEW_ITEMS(lib) 단일 기준. 위원 수만큼 열 동적 생성.
//   * 미채점 위원은 빈칸, 불참은 "불참". 마지막에 면접 평균(총점 평균) 열.
// =====================================================================
export async function buildInterviewDetailWorkbook(
  data: ReportData
): Promise<ArrayBuffer> {
  const { posting, applicants, interviewReviewers } = data;

  const wb = new ExcelJS.Workbook();
  wb.creator = "동래구청소년센터 채용시스템";
  const ws = wb.addWorksheet("면접 세부평가", {
    views: [{ state: "frozen", xSplit: 3, ySplit: 4 }],
  });

  const items = INTERVIEW_ITEMS;
  const perReviewer = items.length + 1; // q1..qN + 합계
  const fixed = 3; // 순위·이름·접수번호
  const totalCols = fixed + interviewReviewers.length * perReviewer + 1; // +면접평균
  const lastCol = totalCols;

  // 1행: 제목 / 2행: 부제(배점 안내) — 전체 폭 병합.
  const titleRow = ws.addRow([`${posting.title} — 심사위원별 면접 세부평가 점수표`]);
  titleRow.font = { bold: true, size: 14 };
  ws.mergeCells(1, 1, 1, totalCols);
  const scaleText = items.map((it) => `${it.shortTitle} ${it.max}`).join(" · ");
  const subRow = ws.addRow([
    `채용분야: ${posting.field || "-"}    면접위원 ${interviewReviewers.length}명    대상 ${applicants.length}명    (배점: ${scaleText} = ${INTERVIEW_MAX}점)`,
  ]);
  subRow.font = { size: 10, color: { argb: "FF666666" } };
  ws.mergeCells(2, 1, 2, totalCols);

  // 3행(그룹): 순위·이름·접수번호 + 위원명(항목 묶음 위) + 면접평균.
  // 4행(항목): 위원별 q1~qN 축약 라벨 + 합계.
  const group: (string | number)[] = new Array(totalCols).fill("");
  const subHead: (string | number)[] = new Array(totalCols).fill("");
  group[0] = "순위";
  group[1] = "이름";
  group[2] = "접수번호";
  interviewReviewers.forEach((nm, ri) => {
    const start = fixed + ri * perReviewer; // 0-based 배열 인덱스
    group[start] = nm;
    items.forEach((it, k) => {
      subHead[start + k] = `${it.shortTitle}(${it.max})`;
    });
    subHead[start + items.length] = "합계";
  });
  group[lastCol - 1] = "면접 평균";

  const groupRow = ws.addRow(group); // row 3
  const subHeadRow = ws.addRow(subHead); // row 4

  // 헤더 병합 — 고정열·면접평균은 3~4행 세로 병합, 위원명은 항목 묶음 가로 병합.
  ws.mergeCells(3, 1, 4, 1);
  ws.mergeCells(3, 2, 4, 2);
  ws.mergeCells(3, 3, 4, 3);
  interviewReviewers.forEach((_nm, ri) => {
    const start = fixed + ri * perReviewer + 1; // 1-based 열
    ws.mergeCells(3, start, 3, start + items.length); // 위원명 가로 병합(항목+합계)
  });
  ws.mergeCells(3, lastCol, 4, lastCol);

  for (const row of [groupRow, subHeadRow]) {
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1F3A5F" },
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = { bottom: { style: "thin", color: { argb: "FFBBBBBB" } } };
    });
  }

  // 본문 — applicants 는 이미 총점 내림차순(rank 부여됨).
  for (const a of applicants) {
    const cells: (string | number)[] = new Array(totalCols).fill("");
    cells[0] = a.rank;
    cells[1] = a.name;
    cells[2] = a.applicant_number;
    interviewReviewers.forEach((nm, ri) => {
      const start = fixed + ri * perReviewer; // 0-based
      const s = a.interviewByReviewer.get(nm);
      if (!s) return; // 미채점 → 빈칸
      if (s.is_absent) {
        cells[start + items.length] = "불참";
        return;
      }
      items.forEach((it, k) => {
        const v = s.scores[it.key];
        cells[start + k] = typeof v === "number" && Number.isFinite(v) ? v : "";
      });
      cells[start + items.length] = scoreCell(s.total);
    });
    cells[lastCol - 1] = scoreCell(a.interviewAvg);
    const row = ws.addRow(cells);
    row.alignment = { vertical: "middle" };
    row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    // 위원별 합계·면접평균 강조.
    interviewReviewers.forEach((_nm, ri) => {
      const sumCol = fixed + ri * perReviewer + items.length + 1; // 1-based 합계열
      row.getCell(sumCol).font = { bold: true };
    });
    row.getCell(lastCol).font = { bold: true };
  }

  // 열 너비 + 숫자열 가운데 정렬.
  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 11;
  ws.getColumn(3).width = 14;
  for (let c = fixed + 1; c <= totalCols; c++) {
    ws.getColumn(c).width = 9;
    ws.getColumn(c).alignment = { horizontal: "center", vertical: "middle" };
  }

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

// =====================================================================
// [1-C] 면접전형 심사 결과 docx — 총괄표 + 개인별 심사표(견본 양식 동일).
//   * 한 파일: (1) 2차 전형 심사 총괄표  →  PageBreak  →  (2) 지원자×위원 1장씩.
//   * 점수의 진실은 recruitment_scores(stage='interview').scores jsonb(q1~q4),
//     배점·항목 라벨은 INTERVIEW_ITEMS(lib) 단일 기준. 읽기 전용.
//   * 양식: 제목 + 점수 구간표(보기별 칸 분리) + 위원별 확인란.
//     확인란 (인) 자리에는 위원 도장(opts.stamps)이 있으면 ImageRun 으로 삽입.
// =====================================================================

// 총괄표 항목 헤더 — 견본 문구(업무능력·직업관·성실성·적극성)를 q1~q4 순서로.
//   (개인별 심사표는 INTERVIEW_ITEMS 라벨·세부 불릿을 그대로 사용)
const INTERVIEW_SUMMARY_HEADERS = ["업무능력", "직업관", "성실성", "적극성"];

// 숫자 → 표시 문자열(없으면 빈칸).
function numText(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

// DXA 폭 + columnSpan 지원 셀(헤더). half-point = pt*2.
function irHeadCell(text: string, dxa: number, columnSpan?: number): TableCell {
  return new TableCell({
    width: { size: dxa, type: WidthType.DXA },
    columnSpan,
    shading: { type: ShadingType.CLEAR, color: "auto", fill: NAVY },
    verticalAlign: VerticalAlign.CENTER,
    borders: CELL_BORDERS,
    margins: { top: 40, bottom: 40, left: 50, right: 50 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text,
            bold: true,
            size: 18,
            color: "FFFFFF",
            font: DOC_FONT,
          }),
        ],
      }),
    ],
  });
}

type IrCellOpts = {
  dxa: number;
  rowSpan?: number;
  columnSpan?: number;
  bold?: boolean;
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  size?: number; // pt
  fill?: string;
  color?: string;
};

// 본문 셀(여러 문단 허용) — 표는 columnWidths + 셀 width(DXA) 둘 다 지정.
function irCellBox(children: Paragraph[], opts: IrCellOpts): TableCell {
  return new TableCell({
    width: { size: opts.dxa, type: WidthType.DXA },
    rowSpan: opts.rowSpan,
    columnSpan: opts.columnSpan,
    shading: opts.fill
      ? { type: ShadingType.CLEAR, color: "auto", fill: opts.fill }
      : undefined,
    verticalAlign: VerticalAlign.CENTER,
    borders: CELL_BORDERS,
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    children,
  });
}

// 본문 셀(단일 텍스트).
function irCell(text: string, opts: IrCellOpts): TableCell {
  return irCellBox(
    [
      new Paragraph({
        alignment: opts.align ?? AlignmentType.CENTER,
        children: [
          new TextRun({
            text: text || "",
            bold: opts.bold,
            size: (opts.size ?? 10) * 2,
            color: opts.color,
            font: DOC_FONT,
          }),
        ],
      }),
    ],
    opts
  );
}

// 한 지원자의 면접 위원별 채점(가나다순 위원만, 채점 있는 것만).
function interviewEntriesOf(
  a: ReportData["applicants"][number],
  interviewReviewers: string[]
): { name: string; entry: ReviewerScore }[] {
  const out: { name: string; entry: ReviewerScore }[] = [];
  for (const nm of interviewReviewers) {
    const e = a.interviewByReviewer.get(nm);
    if (e) out.push({ name: nm, entry: e });
  }
  return out;
}

// 면접 평균 내림차순(동점 가나다순) — 면접 채점이 1건이라도 있는 지원자만.
function rankByInterview(
  applicants: ReportData["applicants"]
): ReportData["applicants"] {
  return [...applicants]
    .filter((a) => a.interviewByReviewer.size > 0)
    .sort((a, b) => {
      const av = a.interviewAvg ?? -1;
      const bv = b.interviewAvg ?? -1;
      if (bv !== av) return bv - av;
      return a.name.localeCompare(b.name, "ko");
    });
}

export async function buildInterviewResultDocx(
  data: ReportData,
  opts: { interviewDate?: string; stamps?: Map<string, Uint8Array> } = {}
): Promise<Buffer> {
  const { posting, applicants, interviewReviewers } = data;
  const interviewDate = (opts.interviewDate ?? "").trim();
  const stamps = opts.stamps ?? new Map<string, Uint8Array>();
  const ranked = rankByInterview(applicants);

  // ---- (1) 총괄표 ----------------------------------------------------
  // 열: 번호·이름·면접위원 + q1~q4(견본 헤더) + 득점 + 합계 + 평균.
  const colW = [600, 1100, 1100, 900, 900, 900, 900, 800, 900, 900];
  const headLabels = [
    "번호",
    "이름",
    "면접위원",
    ...INTERVIEW_ITEMS.map(
      (it, i) => `${INTERVIEW_SUMMARY_HEADERS[i] ?? it.shortTitle}(${it.max})`
    ),
    `득점(${INTERVIEW_MAX})`,
    "합계",
    "평균",
  ];
  const headerRow = new TableRow({
    tableHeader: true,
    children: headLabels.map((t, i) => irHeadCell(t, colW[i])),
  });

  const summaryRows: TableRow[] = [headerRow];
  const absentNames: string[] = [];
  let no = 1;
  for (const a of ranked) {
    const entries = interviewEntriesOf(a, interviewReviewers);
    const nRows = entries.length;
    // 합계 = 위원 득점 합(불참=0), 평균 = 합계 / 채점위원수(불참 포함).
    const totals = entries.map((x) =>
      x.entry.is_absent ? 0 : x.entry.total ?? 0
    );
    const sum = totals.reduce((p, c) => p + c, 0);
    const avg = nRows > 0 ? sum / nRows : null;
    // 전원 불참(no-show) 지원자 → 비고 집계.
    if (nRows > 0 && entries.every((x) => x.entry.is_absent)) {
      absentNames.push(a.name);
    }

    entries.forEach((x, ri) => {
      const cells: TableCell[] = [];
      if (ri === 0) {
        cells.push(irCell(String(no), { dxa: colW[0], rowSpan: nRows }));
        cells.push(
          irCell(a.name, { dxa: colW[1], rowSpan: nRows, bold: true })
        );
      }
      cells.push(irCell(x.name, { dxa: colW[2] }));
      INTERVIEW_ITEMS.forEach((it, i) => {
        const v = x.entry.is_absent ? "" : numText(x.entry.scores[it.key]);
        cells.push(irCell(v, { dxa: colW[3 + i] }));
      });
      cells.push(
        irCell(x.entry.is_absent ? "불참" : String(x.entry.total ?? 0), {
          dxa: colW[7],
          bold: true,
        })
      );
      if (ri === 0) {
        cells.push(
          irCell(String(sum), { dxa: colW[8], rowSpan: nRows, bold: true })
        );
        cells.push(
          irCell(fmtScore(avg), { dxa: colW[9], rowSpan: nRows, bold: true })
        );
      }
      summaryRows.push(new TableRow({ children: cells }));
    });
    no++;
  }

  const summaryTable = new Table({
    columnWidths: colW,
    layout: TableLayoutType.FIXED,
    rows: summaryRows,
  });

  // 면접전형 결과 1~3순위 문장.
  const top3 = ranked
    .slice(0, 3)
    .map((a, i) => `${i + 1}순위 ${a.name}`)
    .join(", ");
  const reviewerLine =
    interviewReviewers.length > 0 ? interviewReviewers.join(", ") : "-";

  const summaryChildren: (Paragraph | Table)[] = [
    docNumberPara(posting.slug, "면접전형 심사결과"),
    titlePara("2차 전형(면접전형) 심사 총괄표"),
    para(`○ 채용분야 : ${posting.field || "-"}`, {
      size: 11,
      spacing: { after: 40 },
    }),
    para(`○ 면접일자 : ${interviewDate || ""}`, {
      size: 11,
      spacing: { after: 40 },
    }),
    para(`○ 면접위원 : ${reviewerLine}`, {
      size: 11,
      spacing: { after: 40 },
    }),
    para(`○ 면접전형 결과 : ${top3 || "-"}`, {
      bold: true,
      size: 11,
      spacing: { after: 160 },
    }),
  ];
  if (ranked.length === 0) {
    summaryChildren.push(
      para("※ 면접 채점 내역이 없습니다.", {
        size: 10,
        color: GRAY,
        spacing: { after: 120 },
      })
    );
  } else {
    summaryChildren.push(summaryTable);
  }
  if (absentNames.length > 0) {
    summaryChildren.push(
      para(`※ ${absentNames.join(", ")} 불참`, {
        size: 10,
        color: GRAY,
        spacing: { before: 120 },
      })
    );
  }

  // ---- (2) 개인별 심사표 (지원자 × 위원) ------------------------------
  const sheetChildren: (Paragraph | Table)[] = [];
  for (const a of ranked) {
    const entries = interviewEntriesOf(a, interviewReviewers);
    for (const { name: reviewerName, entry } of entries) {
      const absent = entry.is_absent;
      const scoreLabel = absent
        ? `불참 / ${INTERVIEW_MAX}점`
        : `${entry.total ?? 0}점 / ${INTERVIEW_MAX}점`;

      // 모집분야 표기 — "{모집분야} / {직위}". 직위는 공고 salary_grade(기준급수).
      //   직위 값이 없으면 모집분야만 표기.
      const fieldText = posting.field || "-";
      const positionText = (posting.salary_grade ?? "").trim();
      const fieldWithPosition = positionText
        ? `${fieldText} / ${positionText}`
        : fieldText;

      // 1. 지원자 표.
      const infoW = [1500, 3100, 1600, 2800];
      const infoTable = new Table({
        columnWidths: infoW,
        layout: TableLayoutType.FIXED,
        rows: [
          new TableRow({
            children: [
              irCell("성명", { dxa: infoW[0], bold: true, fill: "F2F4F7" }),
              irCell(a.name, { dxa: infoW[1] }),
              irCell("면접전형 점수", {
                dxa: infoW[2],
                bold: true,
                fill: "F2F4F7",
              }),
              irCell(scoreLabel, { dxa: infoW[3], bold: true }),
            ],
          }),
          new TableRow({
            children: [
              irCell("모집분야", { dxa: infoW[0], bold: true, fill: "F2F4F7" }),
              irCell(fieldWithPosition, {
                dxa: infoW[1] + infoW[2] + infoW[3],
                columnSpan: 3,
                align: AlignmentType.LEFT,
              }),
            ],
          }),
        ],
      });

      // 2. 심사표 — 심사항목(넓게) | 배점 | 평가구간 4칸 | 점수.
      //   견본처럼 보기(매우적합/적합/양호/보통)를 각각 별도 셀로 분리.
      const SEG = 900; // 구간 4칸 동일 너비
      const critW = [3800, 700, SEG, SEG, SEG, SEG, 900]; // 합계 9000
      const segStart = 2; // 구간 칸 시작 인덱스
      const critRows: TableRow[] = [
        new TableRow({
          tableHeader: true,
          children: [
            irHeadCell("심사항목 (점수 분류를 기준으로 자유롭게 배점)", critW[0]),
            irHeadCell("배점", critW[1]),
            // 평가 구간 4칸 묶음 헤더(가로 병합).
            irHeadCell("평가 구간", critW[segStart] * 4, 4),
            irHeadCell("점수", critW[6]),
          ],
        }),
      ];
      for (const it of INTERVIEW_ITEMS) {
        const labelParas = [
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({
                text: it.title,
                bold: true,
                size: 20,
                font: DOC_FONT,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({
                text: it.sub,
                size: 17,
                color: GRAY,
                font: DOC_FONT,
              }),
            ],
          }),
        ];
        // 구간 4칸 — 각 보기 라벨(점수).
        const segCells = it.options.map((o) =>
          irCell(`${o.label}(${o.value})`, { dxa: SEG, size: 9 })
        );
        critRows.push(
          new TableRow({
            children: [
              irCellBox(labelParas, { dxa: critW[0], align: AlignmentType.LEFT }),
              irCell(`${it.max}점`, { dxa: critW[1] }),
              ...segCells,
              irCell(absent ? "불참" : numText(entry.scores[it.key]), {
                dxa: critW[6],
                bold: true,
                size: 14,
              }),
            ],
          })
        );
      }
      // 합계 행 — "합계"(심사항목+배점 병합) | 고정 총배점 "65 점"(구간 4칸 병합) | 점수.
      const sumLabelW = critW[0] + critW[1];
      const sumRangeW = critW[segStart] * 4;
      critRows.push(
        new TableRow({
          children: [
            irCell("합계", {
              dxa: sumLabelW,
              columnSpan: 2,
              bold: true,
              fill: "F2F4F7",
              align: AlignmentType.RIGHT,
            }),
            irCell(`${INTERVIEW_MAX} 점`, {
              dxa: sumRangeW,
              columnSpan: 4,
              bold: true,
              fill: "F2F4F7",
            }),
            irCell(absent ? "불참" : String(entry.total ?? 0), {
              dxa: critW[6],
              bold: true,
              size: 14,
              fill: "F2F4F7",
            }),
          ],
        })
      );
      const critTable = new Table({
        columnWidths: critW,
        layout: TableLayoutType.FIXED,
        rows: critRows,
      });

      // 심사위원 확인란 — 도장 이미지가 있으면 이름 뒤에 삽입, 없으면 이름만.
      //   ("(인)" 텍스트는 표기하지 않음. 도장 이미지 우선순위 로직은 그대로.)
      const stampBytes = stamps.get(reviewerName) ?? null;
      const stampType = detectImageType(stampBytes);
      const signRunChildren: (TextRun | ImageRun)[] = [
        new TextRun({
          text: `심사위원 성명 : ${reviewerName}`,
          size: 22,
          font: DOC_FONT,
        }),
      ];
      if (stampBytes && stampType) {
        signRunChildren.push(
          new TextRun({ text: "    ", size: 22, font: DOC_FONT }),
          new ImageRun({
            type: stampType,
            data: stampBytes,
            transformation: { width: 72, height: 72 },
          })
        );
      }
      const signPara = new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: signRunChildren,
      });

      // 페이지 분리(앞 내용과 항상 분리) + 제목 + 표 + 확인란(도장).
      sheetChildren.push(
        new Paragraph({ children: [new PageBreak()] }),
        para("2차 전형(면접전형) 심사표", {
          bold: true,
          size: 18,
          align: AlignmentType.CENTER,
          color: NAVY,
          spacing: { before: 120, after: 200 },
        }),
        para("1. 지원자", { bold: true, size: 12, spacing: { after: 80 } }),
        infoTable,
        para("2. 심사표", {
          bold: true,
          size: 12,
          spacing: { before: 200, after: 80 },
        }),
        critTable,
        para(
          "본인은 심사를 함에 있어 사실에 근거하여 객관적이고 공정하게 심사하였음을 확인합니다.",
          { size: 11, spacing: { before: 320, after: 160 } }
        ),
        para(interviewDate || "", {
          size: 11,
          align: AlignmentType.CENTER,
          spacing: { after: 120 },
        }),
        signPara
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        children: [...summaryChildren, ...sheetChildren],
      },
    ],
  });

  return Packer.toBuffer(doc);
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
          docNumberPara(posting.slug, "최종심사 총괄표"),
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
  // 지원자 순서는 이름 가나다순(한글 오름차순)으로 항상 고정 — 번호도 이 순서로 재부여.
  const ranked = [...applicants].sort((a, b) =>
    a.name.localeCompare(b.name, "ko")
  );

  // 그룹 만점(전문성 20 · 자기소개서 10 · 정성평가 5)은 기준표에서 파생.
  const gMax = (key: string) =>
    SCREENING_GROUPS.find((g) => g.key === key)?.max ?? 0;

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headCell("번호", 6),
      headCell("이름", 12),
      headCell(`전문성 (${gMax("expertise")}점)`, 13),
      headCell(`자기소개서 (${gMax("statement")}점)`, 13),
      headCell(`정성평가 (${gMax("qualitative")}점)`, 11),
      headCell(`득점 (${SCREENING_MAX}점)`, 12),
      headCell("결과", 9),
      headCell("사유", 24),
    ],
  });

  const bodyRows = ranked.map((a, i) => {
    // 신·레거시 데이터 모두 그룹 합계로 정규화해 표시(avgScreeningGroup).
    const expertise = avgScreeningGroup(a.screeningByReviewer, "expertise");
    const statement = avgScreeningGroup(a.screeningByReviewer, "statement");
    const qualitative = avgScreeningGroup(a.screeningByReviewer, "qualitative");
    const isFail = screeningResultLabel(a.status) === "불합격";
    // 사유는 불합격자만 표시(합격/미정은 빈칸). 입력값 없으면 빈칸.
    const reason = isFail ? (a.screeningRejectReason ?? "") : "";
    return new TableRow({
      children: [
        dataCell(String(i + 1)),
        dataCell(a.name, { align: AlignmentType.LEFT }),
        dataCell(fmtScore(expertise)),
        dataCell(fmtScore(statement)),
        dataCell(fmtScore(qualitative)),
        dataCell(fmtScore(a.screeningAvg), { bold: true }),
        dataCell(screeningResultLabel(a.status)),
        dataCell(reason, { align: AlignmentType.LEFT }),
      ],
    });
  });

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [headerRow, ...bodyRows],
  });

  const reviewerNames = data.screeningReviewers.join(", ") || "-";
  const totalCount = ranked.length;
  const passedCount = ranked.filter(
    (a) => screeningResultLabel(a.status) === "합격"
  ).length;
  // 증빙서류 미제출 인원(M). 정확히 0이면 괄호 자체를 생략.
  const missingDocsCount = ranked.filter((a) => a.missingRequiredDocs).length;
  const summarySentence =
    missingDocsCount > 0
      ? `본 채용 공고에 총 ${totalCount}명이 지원하였으며(증빙서류 미제출 ${missingDocsCount}명 포함), 서류심사 결과 총 ${passedCount}명이 선정되었습니다.`
      : `본 채용 공고에 총 ${totalCount}명이 지원하였으며, 서류심사 결과 총 ${passedCount}명이 선정되었습니다.`;

  const doc = new Document({
    sections: [
      {
        children: [
          docNumberPara(posting.slug, "서류전형 결과 공고"),
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
          para(summarySentence, {
            size: 11,
            spacing: { after: 60 },
          }),
          para(`심사위원 : ${reviewerNames}`, {
            size: 11,
            color: GRAY,
            spacing: { after: 200 },
          }),
          table,
          para("", { spacing: { after: 80 } }),
          para(
            `※ 항목 점수는 심사위원 ${data.screeningReviewers.length || 0}인의 평균값입니다. (전문성 ${gMax("expertise")} · 자기소개서 ${gMax("statement")} · 정성평가 ${gMax("qualitative")} = ${SCREENING_MAX}점)`,
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

  // 면접 대상자(서류 합격자) — 이름 가나다순(한글 오름차순)으로 항상 고정.
  //   접수번호·비고는 같은 객체에서 함께 나열되므로 매칭이 어긋나지 않습니다.
  const targets = applicants
    .filter((a) => screeningResultLabel(a.status) === "합격")
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  // 상단 요약 문장 — 1차 총괄표와 동일한 톤.
  //   N=전체 지원자, M=증빙서류 미제출(정확히 0이면 괄호 생략), K=서류 합격자.
  const totalCount = applicants.length;
  const passedCount = targets.length;
  const missingDocsCount = applicants.filter((a) => a.missingRequiredDocs).length;
  const summarySentence =
    missingDocsCount > 0
      ? `본 채용 공고에 총 ${totalCount}명이 지원하였으며(증빙서류 미제출 ${missingDocsCount}명 포함), 서류전형 합격자 ${passedCount}명을 다음과 같이 공고합니다.`
      : `본 채용 공고에 총 ${totalCount}명이 지원하였으며, 서류전형 합격자 ${passedCount}명을 다음과 같이 공고합니다.`;

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
          docNumberPara(posting.slug, "면접대상자 공고"),
          titlePara("면접심사 대상자 공고"),
          para(`1. 채용분야 : ${posting.field || "-"}`, {
            size: 11.5,
            spacing: { after: 80 },
          }),
          para(`2. 공고명 : ${posting.title}`, {
            size: 11.5,
            spacing: { after: 160 },
          }),
          para(summarySentence, { size: 11.5, spacing: { after: 200 } }),
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
// [5] 최종 합격자 공고 docx — 외부 공개 공고문.
//   * 최종합격(final_passed) 처리된 지원자만. 이름 가운데 마스킹 + 접수번호 뒷4자리.
//   * 이름 가나다순 정렬·번호 재부여. 임용일/출근예정일은 공고 appointment_date 활용.
//   * 2. 임용 예정자 등록 안내는 양식 기본 텍스트(추후 공고 편집으로 커스텀 확장 예정).
// =====================================================================
export async function buildFinalNoticeDoc(data: ReportData): Promise<Buffer> {
  const { posting, applicants } = data;

  // 최종합격자 — 이름 가나다순 고정, 번호는 정렬 순서대로 재부여.
  const finals = applicants
    .filter((a) => a.status === "final_passed")
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const apptLabel = posting.appointment_date
    ? fmtKstDate(posting.appointment_date)
    : "추후 개별 안내";

  // 1. 최종 합격자 명단 표 — 번호 | 채용분야 | 이름 | 임용일(출근일).
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headCell("번호", 10),
      headCell("채용분야", 28),
      headCell("이름", 30),
      headCell("임용일(출근일)", 32),
    ],
  });
  const bodyRows = finals.map((a, i) => {
    const last4 = a.applicant_number.slice(-4);
    return new TableRow({
      children: [
        dataCell(String(i + 1)),
        dataCell(posting.field || "-"),
        // 외부 공개 — 가운데 마스킹 + 접수번호 뒷4자리 병기(예: 정○준(7841)).
        dataCell(`${maskName(a.name)}(${last4})`),
        dataCell(apptLabel),
      ],
    });
  });
  const rosterTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [headerRow, ...bodyRows],
  });

  // 2. 임용 예정자 등록 안내 — 양식 기본 제출서류 목록.
  const submitDocs = [
    "① 임용신청서(센터 양식) 1부",
    "② 채용신체검사서 1부",
    "③ 기본증명서·주민등록등본 각 1부",
    "④ 최종학력 졸업(성적)증명서 1부",
    "⑤ 경력증명서(해당자에 한함)",
    "⑥ 자격증 사본(해당자에 한함)",
  ];

  const doc = new Document({
    sections: [
      {
        children: [
          docNumberPara(posting.slug, "최종합격자 공고"),
          para("동래구청소년센터 직원 채용", {
            bold: true,
            size: 13,
            align: AlignmentType.CENTER,
            spacing: { after: 40 },
          }),
          titlePara("최종 합격자 공고"),
          para(
            "동래구청소년센터 직원 채용에 따른 최종 합격자를 다음과 같이 공고합니다.",
            { size: 11.5, spacing: { after: 160 } }
          ),
          para(`작성일 : ${kstDateLabel(new Date())}`, {
            size: 11,
            align: AlignmentType.RIGHT,
          }),
          para("동래구청소년센터장", {
            bold: true,
            size: 13,
            align: AlignmentType.RIGHT,
            spacing: { after: 240 },
          }),

          para("1. 최종 합격자 명단", {
            bold: true,
            size: 12,
            spacing: { after: 80 },
          }),
          rosterTable,
          finals.length === 0
            ? para("※ 최종 합격자가 없습니다.", {
                size: 10,
                color: GRAY,
                spacing: { before: 80, after: 240 },
              })
            : para(
                "※ 응시자 보호를 위해 성명 일부를 비공개 처리하였습니다. 본인 여부는 접수번호 뒷 4자리로 확인하시기 바랍니다.",
                { size: 9, color: GRAY, spacing: { before: 120, after: 240 } }
              ),

          para("2. 임용 예정자 등록 안내", {
            bold: true,
            size: 12,
            spacing: { after: 80 },
          }),
          para("가. 제출기간 : 최종 합격자 발표일로부터 7일 이내 (공휴일 제외)", {
            size: 11,
            spacing: { after: 40 },
          }),
          para(`나. 임용예정일 : ${apptLabel}`, {
            size: 11,
            spacing: { after: 40 },
          }),
          para(`다. 출근예정일 : ${apptLabel}`, {
            size: 11,
            spacing: { after: 40 },
          }),
          para(
            "라. 제출방법 : 동래구청소년센터 방문 제출 또는 등기우편 (사전 연락 후 제출)",
            { size: 11, spacing: { after: 40 } }
          ),
          para("마. 제출서류", { size: 11, spacing: { after: 40 } }),
          ...submitDocs.map((t) =>
            para(`    ${t}`, { size: 11, spacing: { after: 20 } })
          ),
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
    docNumberPara(p.slug, "채용 공고"),
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
