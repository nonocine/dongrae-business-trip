import { requireFacilityAccess } from "@/lib/facilityAccess";
import { getCheck } from "@/app/hr/facility/safetyActions";
import { buildSafetyCheckPdf, safetyPdfFilename } from "@/lib/safetyCheckPdf";

// pdf-lib 은 Node 런타임 필요. 라우트는 layout 가드 밖 → 자체 재검증.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFacilityAccess();
  } catch {
    return new Response("시설관리 권한이 없습니다.", { status: 403 });
  }

  const { id } = await params;
  const detail = await getCheck(id);
  if (!detail) {
    return new Response("점검표를 찾을 수 없습니다.", { status: 404 });
  }

  const pdf = await buildSafetyCheckPdf(detail.check, detail.items);
  const filename = safetyPdfFilename(detail.check);
  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        filename
      )}`,
      "Cache-Control": "no-store",
    },
  });
}
