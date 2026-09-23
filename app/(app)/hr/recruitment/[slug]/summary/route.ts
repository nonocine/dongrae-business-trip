import { loadReportData } from "@/lib/recruitmentReport";
import { buildFinalSummaryDoc } from "@/lib/recruitmentDocBuilders";
import { docxResponse } from "@/lib/recruitmentDocx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const data = await loadReportData(slug); // 미인증 시 '/' redirect
  if (!data) return new Response("공고를 찾을 수 없습니다.", { status: 404 });

  const buffer = await buildFinalSummaryDoc(data);
  return docxResponse(buffer, `최종심사총괄표_${data.posting.slug}.docx`);
}
