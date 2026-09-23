import { resolveSalaryAccess } from "@/lib/salaryAccess";
import { getPayoutRowsFor } from "@/app/(app)/hr/payouts/actions";
import {
  buildPayoutWorkbook,
  type PayoutExportMode,
} from "@/lib/instructorPayoutExport";

// 강사비 지출표 엑셀 — 화면에서 보고 있는 표를 그대로 내려받습니다.
//   * exceljs 는 Node 런타임. 라우트는 레이아웃 가드 밖이라 자체 재검증합니다.
//   * 필터는 쿼리로 받습니다 — 화면이 링크(<a href>)로 열어야 팝업 차단에
//     걸리지 않습니다(메일 첨부 다운로드에서 배운 것과 같은 이유).
//   * 주민번호는 들어가지 않습니다(이 화면은 복호화하지 않습니다).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await resolveSalaryAccess())) {
    return new Response("권한이 없습니다. (관장·부장 또는 회계 담당자)", {
      status: 403,
    });
  }

  const q = new URL(req.url).searchParams;
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? "";
  const projectId = q.get("project") ?? "";
  const settlementId = q.get("settlement") ?? "";
  const mode: PayoutExportMode = q.get("mode") === "person" ? "person" : "source";

  const rows = await getPayoutRowsFor({ from, to, projectId, settlementId });

  // 조건 문구는 화면과 같은 이름으로 — 품의에 첨부했을 때 무엇을 뽑은
  //   문서인지 파일만 보고 알 수 있어야 합니다.
  const projectName = projectId
    ? rows[0]?.projectName || "선택 사업"
    : "전체";
  const settlementName = settlementId
    ? rows[0]?.settlementTitle || "선택 재원"
    : "전체";
  const filterLabel = `사업: ${projectName} · 재원: ${settlementName}`;

  const buffer = await buildPayoutWorkbook({ rows, mode, from, to, filterLabel });

  const stamp = (from || to || "전체기간").replace(/-/g, "");
  const modeLabel = mode === "person" ? "사람별" : "재원별";
  const filename = `강사비지출표_${modeLabel}_${stamp}.xlsx`;
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
