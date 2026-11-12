import { requireSaemAccess } from "@/lib/saemAccess";
import { getSettlement } from "@/app/(app)/hr/saems/settlementActions";
import { buildSettlementWorkbook } from "@/lib/settlementExport";
import { bankAccountsForExport } from "@/lib/sensitiveServer";

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

  // 계좌 전체 — 권한(M0·hr·saem·accounting) 확인 + 열람 기록 1건(export:settlement).
  //   권한이 없으면 화면과 같은 가림값("****1234") 그대로 나갑니다.
  const full = await bankAccountsForExport(
    detail.items.map((it) => it.instructor_id),
    "settlement"
  );
  if (full) {
    for (const it of detail.items) {
      const v = full.get(it.instructor_id);
      if (v) it.bank_account = v;
    }
  }

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
