import { requireFacilityAccess } from "@/lib/facilityAccess";
import { listDrivingLogs } from "@/app/(app)/hr/facility/driving/actions";
import {
  buildDrivingLedgerWorkbook,
  drivingLedgerFilename,
  getLedgerHeaderInfo,
} from "@/lib/drivingLedger";

// xlsx 는 Node 런타임 필요. 대장은 매 요청 최신값으로.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /hr/facility/driving/export?month=YYYY-MM  (month 없으면 전체 기간)
export async function GET(request: Request) {
  // 권한 — 라우트는 layout 가드를 거치지 않으므로 여기서 반드시 재검증.
  try {
    await requireFacilityAccess();
  } catch {
    return new Response("시설관리 권한이 없습니다.", { status: 403 });
  }

  const monthRaw = new URL(request.url).searchParams.get("month") ?? "";
  const month = /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : "";

  const [logs, header] = await Promise.all([
    listDrivingLogs(month),
    getLedgerHeaderInfo(),
  ]);

  const buffer = buildDrivingLedgerWorkbook({ logs, month, header });
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;

  return new Response(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        drivingLedgerFilename(month)
      )}`,
      "Cache-Control": "no-store",
    },
  });
}
