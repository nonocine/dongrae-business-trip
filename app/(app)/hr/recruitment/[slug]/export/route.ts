import { loadReportData } from "@/lib/recruitmentReport";
import { buildErpWorkbook } from "@/lib/recruitmentDocBuilders";

// exceljs 는 Node 런타임 필요. 채점 데이터는 매 요청 최신값으로.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const data = await loadReportData(slug); // 미인증 시 내부에서 '/' redirect
  if (!data) {
    return new Response("공고를 찾을 수 없습니다.", { status: 404 });
  }

  const buffer = await buildErpWorkbook(data);
  const filename = `ERP_채용집계_${data.posting.slug}.xlsx`;

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        filename
      )}`,
      "Cache-Control": "no-store",
    },
  });
}
