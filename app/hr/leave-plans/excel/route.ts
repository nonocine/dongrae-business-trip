import { requireSalaryAccess } from "@/lib/salaryAccess";
import { loadLeavePlansForExport } from "@/app/hr/leave-plans/actions";
import { buildLeavePlanWorkbook } from "@/lib/leavePlanExport";

// exceljs 는 Node 런타임. 라우트는 페이지 가드 밖 → 자체 재검증.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /hr/leave-plans/excel?year=2026[&employeeId=uuid]
//   employeeId 없으면 그 연도 발부 전체(직원당 1시트).
export async function GET(req: Request) {
  try {
    await requireSalaryAccess();
  } catch {
    return new Response("권한이 없습니다.", { status: 403 });
  }

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year"));
  if (!Number.isFinite(year) || year <= 0)
    return new Response("연도가 올바르지 않습니다.", { status: 400 });
  const employeeId = url.searchParams.get("employeeId") || undefined;

  const rows = await loadLeavePlansForExport({ year, employeeId });
  if (rows.length === 0)
    return new Response("출력할 계획서가 없습니다.", { status: 404 });

  const buffer = await buildLeavePlanWorkbook(
    rows.map((r) => ({
      name: r.name,
      department: r.department,
      year: r.year,
      unused_days: r.unused_days,
      period_start: r.period_start,
      period_end: r.period_end,
      plan: r.plan,
      total_days: r.total_days,
      submitted_at: r.submitted_at,
    }))
  );

  const who =
    employeeId && rows.length === 1
      ? `_${rows[0].name.replace(/[\\/:*?"<>|]/g, "_")}`
      : "_전체";
  const filename = `연차사용계획서_${year}${who}.xlsx`;
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
