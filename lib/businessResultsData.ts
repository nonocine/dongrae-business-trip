import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type {
  BusinessResult,
  PromotionResult,
} from "@/app/(app)/business-results/actions";

// =====================================================================
// 사업실적 조회 — 화면(business-results/actions.getBusinessResultsData)과 MCP 가
//   같은 쿼리를 씁니다. 권한 확인은 호출부 책임입니다.
// =====================================================================

export function businessTableMissing(
  error: { code?: string; message?: string } | null
) {
  return error?.code === "42P01" || error?.message?.includes("schema cache");
}

// 신규 컬럼이 아직 적용되지 않은 DB 에서도 화면이 죽지 않도록 행을 정규화합니다.
export function toBusinessResult(raw: Record<string, unknown>): BusinessResult {
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    id: String(raw.id ?? ""),
    report_year: num(raw.report_year),
    report_month: num(raw.report_month),
    category: String(raw.category ?? "기타"),
    program_id: (raw.program_id as string | null) ?? null,
    program_name: String(raw.program_name ?? ""),
    manager_name: String(raw.manager_name ?? ""),
    sessions: num(raw.sessions),
    operating_days: num(raw.operating_days),
    participants: num(raw.participants),
    participants_youth: num(raw.participants_youth),
    participants_other: num(raw.participants_other),
    attendance: num(raw.attendance),
    attendance_youth: num(raw.attendance_youth),
    attendance_other: num(raw.attendance_other),
    youth_uses: num(raw.youth_uses),
    other_uses: num(raw.other_uses),
    summary: String(raw.summary ?? ""),
    evaluation: String(raw.evaluation ?? ""),
    status: raw.status === "submitted" ? "submitted" : "draft",
    author_name: String(raw.author_name ?? ""),
    updated_at: String(raw.updated_at ?? ""),
  };
}

// 한 해의 [startMonth, endMonth] 프로그램 실적·홍보 실적.
//   테이블이 아직 없으면 configured=false(빈 목록), 그 밖의 오류는 throw.
export async function loadBusinessResultRows(
  year: number,
  startMonth: number,
  endMonth: number
): Promise<{
  configured: boolean;
  results: BusinessResult[];
  promotions: PromotionResult[];
}> {
  const [resultQuery, promotionQuery] = await Promise.all([
    supabaseAdmin
      .from("business_results")
      .select("*")
      .eq("report_year", year)
      .gte("report_month", startMonth)
      .lte("report_month", endMonth)
      .order("report_month")
      .order("category")
      .order("program_name"),
    supabaseAdmin
      .from("business_promotions")
      .select("*")
      .eq("report_year", year)
      .gte("report_month", startMonth)
      .lte("report_month", endMonth)
      .order("report_month", { ascending: false })
      .order("activity_date", { ascending: false }),
  ]);
  if (
    businessTableMissing(resultQuery.error) ||
    businessTableMissing(promotionQuery.error)
  ) {
    return { configured: false, results: [], promotions: [] };
  }
  if (resultQuery.error) throw new Error(resultQuery.error.message);
  if (promotionQuery.error) throw new Error(promotionQuery.error.message);
  return {
    configured: true,
    results: ((resultQuery.data ?? []) as Record<string, unknown>[]).map(
      toBusinessResult
    ),
    promotions: (promotionQuery.data ?? []) as PromotionResult[],
  };
}
