import { loadReportData } from "@/lib/recruitmentReport";
import { buildInterviewNoticeDoc } from "@/lib/recruitmentDocBuilders";
import { docxResponse } from "@/lib/recruitmentDocx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const data = await loadReportData(slug); // 미인증 시 '/' redirect
  if (!data) return new Response("공고를 찾을 수 없습니다.", { status: 404 });

  // 선택적 쿼리(?date=, ?time=, ?place=) — 없으면 빈칸으로 둬서 직접 기입.
  const url = new URL(request.url);
  const buffer = await buildInterviewNoticeDoc(data, {
    date: url.searchParams.get("date") ?? "",
    time: url.searchParams.get("time") ?? "",
    place: url.searchParams.get("place") ?? "",
  });
  return docxResponse(buffer, `면접심사대상자공고_${data.posting.slug}.docx`);
}
