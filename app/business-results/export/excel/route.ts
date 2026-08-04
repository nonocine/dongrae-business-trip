import { buildBusinessReportWorkbook } from "@/lib/businessResultsExport";
import { loadBusinessReportForExport } from "../../exportData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) return new Response("출력 월이 올바르지 않습니다.", { status: 400 });
  try {
    const input = await loadBusinessReportForExport(year, month);
    if (!input.results.length && !input.promotions.length) return new Response("출력할 사업실적이 없습니다.", { status: 404 });
    const buffer = await buildBusinessReportWorkbook(input);
    const filename = `사업운영결과보고_${year}년_${month}월.xlsx`;
    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "보고서를 생성하지 못했습니다.";
    return new Response(message, { status: message.includes("로그인") ? 401 : 500 });
  }
}
