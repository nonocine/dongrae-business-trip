import { getSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { BusinessReportInput } from "@/lib/businessResultsExport";

export async function loadBusinessReportForExport(year: number, month: number): Promise<BusinessReportInput> {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  const [resultQuery, promotionQuery] = await Promise.all([
    supabaseAdmin.from("business_results").select("category,program_name,sessions,participants,attendance,youth_uses,other_uses,summary,evaluation,status,author_name").eq("report_year", year).eq("report_month", month).order("category").order("program_name"),
    supabaseAdmin.from("business_promotions").select("activity_date,category,title,count,url,description,author_name").eq("report_year", year).eq("report_month", month).order("activity_date"),
  ]);
  if (resultQuery.error) throw new Error(resultQuery.error.message);
  if (promotionQuery.error) throw new Error(promotionQuery.error.message);
  return { year, month, orgName: "동래구청소년센터", results: (resultQuery.data ?? []) as BusinessReportInput["results"], promotions: (promotionQuery.data ?? []) as BusinessReportInput["promotions"] };
}
