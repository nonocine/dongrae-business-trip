import { requireSaemAccess } from "@/lib/saemAccess";
import { getSettlement } from "@/app/hr/saems/settlementActions";
import { buildSettlementWorkbook } from "@/lib/settlementExport";

// exceljs 는 Node 런타임. 라우트는 layout 가드 밖 → 자체 재검증.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSaemAccess();
  } catch {
    return new Response("권한이 없습니다.", { status: 403 });
  }
  const { id } = await params;
  const detail = await getSettlement(id);
  if (!detail) return new Response("정산을 찾을 수 없습니다.", { status: 404 });

  const buffer = await buildSettlementWorkbook(detail);
  const safeTitle = detail.title.replace(/[\\/:*?"<>|]/g, "_");
  const filename = `지급조서_${safeTitle}.xlsx`;
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
