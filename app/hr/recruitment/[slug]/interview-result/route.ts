import {
  loadReportData,
  loadInterviewStamps,
} from "@/lib/recruitmentReport";
import { buildInterviewResultDocx } from "@/lib/recruitmentDocBuilders";
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

  // 위원별 도장(서명) 바이트 — 내부=프로필 도장, 외부=풀 도장 또는 채점 손서명.
  const stamps = await loadInterviewStamps(data);

  // 선택적 쿼리(?date=) — 면접일자. 없으면 빈칸으로 둬서 직접 기입.
  const url = new URL(request.url);
  const buffer = await buildInterviewResultDocx(data, {
    interviewDate: url.searchParams.get("date") ?? "",
    stamps,
  });
  return docxResponse(buffer, `면접전형_심사결과_${data.posting.slug}.docx`);
}
