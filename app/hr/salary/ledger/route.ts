import { requireSalaryAccess } from "@/lib/salaryAccess";
import { listMonthlyPayroll } from "@/app/hr/salary/monthlyActions";
import {
  buildPayrollLedgerWorkbook,
  ledgerColsFromRecord,
  type LedgerRowInput,
} from "@/lib/salaryLedger";

// exceljs 는 Node 런타임 필요. 대장은 매 요청 최신값으로.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // 권한 — 미통과면 403. (급여대장은 개인정보 → 반드시 게이트)
  try {
    await requireSalaryAccess();
  } catch {
    return new Response("급여 관리 권한이 없습니다.", { status: 403 });
  }

  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return new Response("연·월이 올바르지 않습니다.", { status: 400 });
  }

  const list = await listMonthlyPayroll({ year, month });
  if (list.rows.length === 0) {
    return new Response(
      `${year}년 ${month}월 급여 레코드가 없습니다. 먼저 급여를 생성하세요.`,
      { status: 404 }
    );
  }

  const rows: LedgerRowInput[] = list.rows.map((r) => {
    const { cols, note } = ledgerColsFromRecord(r);
    return { team: r.team, name: r.name, rank: r.rank, cols, note };
  });

  // 확정본은 표기 없음, 하나라도 미확정이면 (초안).
  const draft = !list.allConfirmed;
  const buffer = await buildPayrollLedgerWorkbook({ year, month, draft, rows });

  const filename = `${year}년_${month}월_급여대장${draft ? "(초안)" : ""}.xlsx`;
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
