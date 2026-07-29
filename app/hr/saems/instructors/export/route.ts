import { requireSaemAccess } from "@/lib/saemAccess";
import {
  loadInstructorExportRows,
  buildInstructorsWorkbook,
} from "@/lib/saemExport";
import { kstTodayYmd } from "@/lib/trainings";

// exceljs 는 Node 런타임. 라우트는 layout 가드 밖 → 자체 재검증.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSaemAccess();
  } catch {
    return new Response("권한이 없습니다.", { status: 403 });
  }
  const rows = await loadInstructorExportRows();
  const buffer = await buildInstructorsWorkbook(rows);
  const filename = `강사명단_${kstTodayYmd()}.xlsx`;
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
