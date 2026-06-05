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
  INTERVIEW_MAX,
  TOTAL_MAX,
  fmtScore,
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

  const passed = applicants.filter((a) => a.status === "final_passed").length;
  const topScore = applicants.length > 0 ? applicants[0].total : null;

  // 표: 번호 · 이름 · 1차 서류 · 2차 면접 · 합계 · 순위
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

  const buffer = await Packer.toBuffer(doc);
  return docxResponse(buffer, `최종심사총괄표_${posting.slug}.docx`);
}
