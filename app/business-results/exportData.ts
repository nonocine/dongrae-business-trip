import { getSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { BusinessReportInput } from "@/lib/businessResultsExport";

export async function loadBusinessReportForExport(
  year: number,
  startMonth: number,
  endMonth = startMonth,
  periodLabel?: string,
): Promise<BusinessReportInput> {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  const [resultQuery, promotionQuery] = await Promise.all([
    supabaseAdmin
      .from("business_results")
      .select(
        "category,program_name,sessions,participants,attendance,youth_uses,other_uses,summary,evaluation,status,author_name",
      )
      .eq("report_year", year)
      .gte("report_month", startMonth)
      .lte("report_month", endMonth)
      .order("category")
      .order("program_name"),
    supabaseAdmin
      .from("business_promotions")
      .select("activity_date,category,title,count,url,description,author_name")
      .eq("report_year", year)
      .gte("report_month", startMonth)
      .lte("report_month", endMonth)
      .order("activity_date"),
  ]);
  if (resultQuery.error) throw new Error(resultQuery.error.message);
  if (promotionQuery.error) throw new Error(promotionQuery.error.message);
  const results = Object.values(
    ((resultQuery.data ?? []) as BusinessReportInput["results"]).reduce<
      Record<string, BusinessReportInput["results"][number]>
    >((acc, row) => {
      const key = `${row.category}\u0000${row.program_name}`;
      const current = acc[key];
      if (!current) acc[key] = { ...row };
      else {
        current.sessions += row.sessions;
        current.participants += row.participants;
        current.attendance += row.attendance;
        current.youth_uses += row.youth_uses;
        current.other_uses += row.other_uses;
        if (row.status === "draft") current.status = "draft";
      }
      return acc;
    }, {}),
  );
  return {
    year,
    month: endMonth,
    startMonth,
    endMonth,
    periodLabel,
    orgName: "동래구청소년센터",
    results,
    promotions: (promotionQuery.data ??
      []) as BusinessReportInput["promotions"],
  };
}
