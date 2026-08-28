import { getClubReportData } from "@/app/hr/clubs/actions";
import { buildClubReportPdf, clubReportFilename } from "@/lib/clubReportPdf";
import { resolveClubAccess } from "@/lib/clubAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await resolveClubAccess())) {
    return new Response("동아리관리 권한이 없습니다.", { status: 403 });
  }
  const url = new URL(request.url);
  const now = new Date();
  const year = Math.min(2100, Math.max(2020, Number(url.searchParams.get("year")) || now.getFullYear()));
  const month = Math.min(12, Math.max(1, Number(url.searchParams.get("month")) || now.getMonth() + 1));
  const clubs = await getClubReportData(year, month);
  if (!clubs.length) return new Response("출력할 동아리 자료가 없습니다.", { status: 404 });
  const bytes = await buildClubReportPdf(year, month, clubs);
  const filename = clubReportFilename(year, month);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
