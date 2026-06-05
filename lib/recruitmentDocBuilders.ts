// =====================================================================
// 채용 문서 빌더 — ReportData → xlsx/docx Buffer (순수 함수, DB·인증 의존 없음)
//   * Route Handler 는 loadReportData 로 데이터를 받아 이 빌더에 넘기기만 합니다.
//   * @/ 별칭·서버 전용 모듈을 import 하지 않으므로 단독 테스트가 가능합니다.
// =====================================================================

import ExcelJS from "exceljs";
import {
  Document,
  Packer,
  Table,
  TableRow,
  WidthType,
  AlignmentType,
  TableLayoutType,
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
  joinMemos,
} from "./recruitmentScore";
import {
  titlePara,
  para,
  headCell,
  dataCell,
  maskName,
  kstDateLabel,
  GRAY,
} from "./recruitmentDocx";

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
      headCell("번호", 6),
      headCell("이름", 12),
      headCell("전문성(학위) /15", 10),
      headCell("자격증 /5", 8),
      headCell("자기소개서 /15", 10),
      headCell(`득점 /${SCREENING_MAX}`, 10),
      headCell("결과", 9),
      headCell("정성평가 · 사유", 35),
    ],
  });

  const bodyRows = ranked.map((a, i) => {
    const q1 = avgScoreKey(a.screeningByReviewer, "q1_expertise");
    const q2 = avgScoreKey(a.screeningByReviewer, "q2_license");
    const q3 = avgScoreKey(a.screeningByReviewer, "q3_statement");
    const memo = joinMemos(a.screeningByReviewer);
    return new TableRow({
      children: [
        dataCell(String(i + 1)),
        dataCell(a.name, { align: AlignmentType.LEFT }),
        dataCell(fmtScore(q1)),
        dataCell(fmtScore(q2)),
        dataCell(fmtScore(q3)),
        dataCell(fmtScore(a.screeningAvg), { bold: true }),
        dataCell(screeningResultLabel(a.status)),
        dataCell(memo || "—", { align: AlignmentType.LEFT }),
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
