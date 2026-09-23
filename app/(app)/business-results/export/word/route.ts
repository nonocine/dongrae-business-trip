import { buildBusinessReportDocx } from "@/lib/businessResultsExport";
import { loadBusinessReportForExport } from "../../exportData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year"));
  const startMonth = Number(
    url.searchParams.get("startMonth") ?? url.searchParams.get("month"),
  );
  const endMonth = Number(
    url.searchParams.get("endMonth") ?? url.searchParams.get("month"),
  );
  const periodLabel = url.searchParams.get("label") ?? `${startMonth}월`;
  if (
    !Number.isInteger(year) ||
    year < 2020 ||
    year > 2100 ||
    !Number.isInteger(startMonth) ||
    !Number.isInteger(endMonth) ||
    startMonth < 1 ||
    endMonth > 12 ||
    startMonth > endMonth
  )
    return new Response("출력 기간이 올바르지 않습니다.", { status: 400 });
  try {
    const input = await loadBusinessReportForExport(
      year,
      startMonth,
      endMonth,
      periodLabel,
    );
    if (
      !input.results.length &&
      !input.promotions.length &&
      !input.coinPay?.length &&
      !input.staffTrainings?.length
    )
      return new Response("출력할 사업실적이 없습니다.", { status: 404 });
    const buffer = await buildBusinessReportDocx(input);
    const filename = `사업운영결과보고_${year}년_${periodLabel}.docx`;
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "보고서를 생성하지 못했습니다.";
    return new Response(message, {
      status: message.includes("로그인") ? 401 : 500,
    });
  }
}
