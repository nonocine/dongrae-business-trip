import { requireSaemAccess } from "@/lib/saemAccess";
import {
  getPayrollLedgerData,
  getSettlement,
} from "@/app/hr/saems/settlementActions";
import { buildPayrollLedgerWorkbook } from "@/lib/payrollLedgerExport";

// 강사비 지급대장(회계 제출용) — 주민번호가 들어가는 출력물.
//   * exceljs 는 Node 런타임. 라우트는 layout 가드 밖 → 자체 재검증.
//   * 확정본만 — 작성중 정산은 금액이 바뀔 수 있어 회계로 내보내지 않습니다.
//   * ⚠️ 응답 본문(엑셀)에만 주민번호 평문이 존재합니다. 로그를 남기지 않습니다.
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

  // 상태 확인이 먼저 — 확정본이 아니면 주민번호를 복호화하지도 않습니다.
  const settlement = await getSettlement(id);
  if (!settlement)
    return new Response("정산을 찾을 수 없습니다.", { status: 404 });
  if (settlement.status !== "confirmed")
    return new Response("확정된 정산만 지급대장을 출력할 수 있습니다.", {
      status: 400,
    });

  const data = await getPayrollLedgerData(id);
  if (!data) return new Response("정산을 찾을 수 없습니다.", { status: 404 });

  const buffer = await buildPayrollLedgerWorkbook(data);
  const safeTitle = data.title.replace(/[\\/:*?"<>|]/g, "_");
  const filename = `강사비지급대장_${safeTitle}.xlsx`;
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
