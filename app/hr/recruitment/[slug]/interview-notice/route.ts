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
  screeningResultLabel,
} from "@/lib/recruitmentReport";
import {
  titlePara,
  para,
  headCell,
  dataCell,
  maskName,
  kstDateLabel,
  docxResponse,
  GRAY,
} from "@/lib/recruitmentDocx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const data = await loadReportData(slug); // 미인증 시 '/' redirect
  if (!data) return new Response("공고를 찾을 수 없습니다.", { status: 404 });
  const { posting, applicants } = data;

  // 선택적 쿼리(?date=, ?time=, ?place=) — 없으면 빈칸으로 둬서 직접 기입.
  const url = new URL(request.url);
  const interviewDate = (url.searchParams.get("date") ?? "").trim();
  const interviewTime = (url.searchParams.get("time") ?? "").trim();
  const interviewPlace = (url.searchParams.get("place") ?? "").trim();
  const blank = "                              "; // 기입용 빈칸

  // 면접 대상 = 서류전형 합격자. 접수번호 오름차순(접수순).
  const targets = applicants
    .filter((a) => screeningResultLabel(a.status) === "합격")
    .sort((a, b) => a.applicant_number.localeCompare(b.applicant_number));

  // 표: 번호 · 성명(마스킹) · 접수번호(뒷4자리) · 비고
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

  const buffer = await Packer.toBuffer(doc);
  return docxResponse(buffer, `면접심사대상자공고_${posting.slug}.docx`);
}
