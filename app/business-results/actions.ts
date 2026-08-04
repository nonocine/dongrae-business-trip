"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type BusinessResult = {
  id: string;
  report_year: number;
  report_month: number;
  category: string;
  program_name: string;
  sessions: number;
  participants: number;
  attendance: number;
  youth_uses: number;
  other_uses: number;
  summary: string;
  evaluation: string;
  status: "draft" | "submitted";
  author_name: string;
  updated_at: string;
};

export type PromotionResult = {
  id: string;
  report_year: number;
  report_month: number;
  activity_date: string;
  category: string;
  title: string;
  count: number;
  url: string;
  description: string;
  author_name: string;
};

export type BusinessResultsData = {
  configured: boolean;
  results: BusinessResult[];
  promotions: PromotionResult[];
};

function asInt(value: FormDataEntryValue | null, min = 0) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : min;
}

function tableMissing(error: { code?: string; message?: string } | null) {
  return error?.code === "42P01" || error?.message?.includes("schema cache");
}

async function requireUser() {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  return {
    name: session.kind === "employee" ? session.name : "관리자",
    isAdmin: session.kind === "admin",
  };
}

export async function getBusinessResultsData(
  year: number,
  startMonth: number,
  endMonth = startMonth,
): Promise<BusinessResultsData> {
  const session = await getSession();
  if (!session) return { configured: false, results: [], promotions: [] };

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

  if (tableMissing(resultQuery.error) || tableMissing(promotionQuery.error)) {
    return { configured: false, results: [], promotions: [] };
  }
  if (resultQuery.error) throw new Error(resultQuery.error.message);
  if (promotionQuery.error) throw new Error(promotionQuery.error.message);

  return {
    configured: true,
    results: (resultQuery.data ?? []) as BusinessResult[],
    promotions: (promotionQuery.data ?? []) as PromotionResult[],
  };
}

export async function saveBusinessResult(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "").trim();
  const payload = {
    report_year: asInt(formData.get("year"), 2020),
    report_month: Math.min(12, asInt(formData.get("month"), 1)),
    category: String(formData.get("category") ?? "기타").trim() || "기타",
    program_name: String(formData.get("program_name") ?? "").trim(),
    sessions: asInt(formData.get("sessions")),
    participants: asInt(formData.get("participants")),
    attendance: asInt(formData.get("attendance")),
    youth_uses: asInt(formData.get("youth_uses")),
    other_uses: asInt(formData.get("other_uses")),
    summary: String(formData.get("summary") ?? "").trim(),
    evaluation: String(formData.get("evaluation") ?? "").trim(),
    status: formData.get("submit") === "true" ? "submitted" : "draft",
    author_name: user.name,
    updated_by: user.name,
  };
  if (!payload.program_name) throw new Error("사업명을 입력해주세요.");

  let query = id
    ? supabaseAdmin.from("business_results").update(payload).eq("id", id)
    : supabaseAdmin.from("business_results").insert(payload);
  if (id && !user.isAdmin) query = query.eq("author_name", user.name);
  const { error } = await query;
  if (error) throw new Error(error.message);
  revalidatePath("/business-results");
  return { ok: true };
}

export async function savePromotion(formData: FormData) {
  const user = await requireUser();
  const payload = {
    report_year: asInt(formData.get("year"), 2020),
    report_month: Math.min(12, asInt(formData.get("month"), 1)),
    activity_date: String(formData.get("activity_date") ?? ""),
    category: String(formData.get("category") ?? "기타").trim() || "기타",
    title: String(formData.get("title") ?? "").trim(),
    count: asInt(formData.get("count"), 1),
    url: String(formData.get("url") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    author_name: user.name,
  };
  if (!payload.activity_date || !payload.title) {
    throw new Error("날짜와 제목을 입력해주세요.");
  }
  const { error } = await supabaseAdmin
    .from("business_promotions")
    .insert(payload);
  if (error) throw new Error(error.message);
  revalidatePath("/business-results");
  return { ok: true };
}
