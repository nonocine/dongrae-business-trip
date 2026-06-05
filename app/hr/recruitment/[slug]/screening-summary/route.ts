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
  loadReportData,
  SCREENING_MAX,
  fmtScore,
  avgScoreKey,
  screeningResultLabel,
  joinMemos,
} from "@/lib/recruitmentReport";
import {
  titlePara,
  para,
  headCell,
  dataCell,
  kstDateLabel,
  docxResponse,
  GRAY,
} from "@/lib/recruitmentDocx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const data = await loadReportData(slug); // 미인증 시 '/' redirect
  if (!data) return new Response("공고를 찾을 수 없습니다.", { status: 404 });
  const { posting, applicants } = data;

  // 서류 점수(평균) 내림차순으로 재정렬 — 서류전형 총괄표 관점.
  const ranked = [...applicants].sort(
    (a, b) => (b.screeningAvg ?? -1) - (a.screeningAvg ?? -1)
  );

  // 표: 번호 · 이름 · 전문성(/15) · 자격증(/5) · 자기소개서(/15) · 득점(/35) · 결과 · 사유
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

  const buffer = await Packer.toBuffer(doc);
  return docxResponse(buffer, `1차서류전형총괄표_${posting.slug}.docx`);
}
