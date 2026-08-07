"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type BusinessResult = {
  id: string;
  report_year: number;
  report_month: number;
  category: string;
  program_id: string | null;
  program_name: string;
  manager_name: string;
  sessions: number;
  operating_days: number;
  participants: number;
  participants_youth: number;
  participants_other: number;
  attendance: number;
  attendance_youth: number;
  attendance_other: number;
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

// 사업명·세부사업명 레지스트리(등록제) — 자유 입력 표기 불일치 방지.
export type BusinessCategory = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

export type BusinessProgram = {
  id: string;
  category_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

export type ProgramRegistry = {
  configured: boolean; // 레지스트리 테이블 적용 여부
  categories: BusinessCategory[];
  programs: BusinessProgram[];
};

export type BusinessResultsData = {
  configured: boolean;
  isAdmin: boolean;
  results: BusinessResult[];
  promotions: PromotionResult[];
  registry: ProgramRegistry;
};

const EMPTY_REGISTRY: ProgramRegistry = {
  configured: false,
  categories: [],
  programs: [],
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

// 레지스트리 관리(분야·사업 등록/수정)는 관리자 세션 전용.
async function requireAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) throw new Error("관리자만 사용할 수 있습니다.");
  return user;
}

// 신규 컬럼이 아직 적용되지 않은 DB 에서도 화면이 죽지 않도록 행을 정규화합니다.
function toResult(raw: Record<string, unknown>): BusinessResult {
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

// 레지스트리 조회 — 미적용(42P01)이면 configured=false 로 우아하게 폴백합니다.
async function loadRegistry(): Promise<ProgramRegistry> {
  const [categoryQuery, programQuery] = await Promise.all([
    supabaseAdmin
      .from("business_categories")
      .select("id,name,sort_order,is_active")
      .order("sort_order")
      .order("name"),
    supabaseAdmin
      .from("business_programs")
      .select("id,category_id,name,sort_order,is_active")
      .order("sort_order")
      .order("name"),
  ]);
  if (tableMissing(categoryQuery.error) || tableMissing(programQuery.error)) {
    return EMPTY_REGISTRY;
  }
  if (categoryQuery.error) throw new Error(categoryQuery.error.message);
  if (programQuery.error) throw new Error(programQuery.error.message);
  return {
    configured: true,
    categories: (categoryQuery.data ?? []) as BusinessCategory[],
    programs: (programQuery.data ?? []) as BusinessProgram[],
  };
}

export async function getBusinessResultsData(
  year: number,
  startMonth: number,
  endMonth = startMonth,
): Promise<BusinessResultsData> {
  const session = await getSession();
  if (!session)
    return {
      configured: false,
      isAdmin: false,
      results: [],
      promotions: [],
      registry: EMPTY_REGISTRY,
    };
  const isAdmin = session.kind === "admin";

  const [resultQuery, promotionQuery, registry] = await Promise.all([
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
    loadRegistry(),
  ]);

  if (tableMissing(resultQuery.error) || tableMissing(promotionQuery.error)) {
    return {
      configured: false,
      isAdmin,
      results: [],
      promotions: [],
      registry,
    };
  }
  if (resultQuery.error) throw new Error(resultQuery.error.message);
  if (promotionQuery.error) throw new Error(promotionQuery.error.message);

  return {
    configured: true,
    isAdmin,
    results: ((resultQuery.data ?? []) as Record<string, unknown>[]).map(
      toResult,
    ),
    promotions: (promotionQuery.data ?? []) as PromotionResult[],
    registry,
  };
}

export async function saveBusinessResult(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "").trim();

  // 드롭다운 선택이면 등록된 이름을 정본으로 사용하고, 직접 입력이면 program_id = null.
  const programId = String(formData.get("program_id") ?? "").trim();
  let programName = String(formData.get("program_name") ?? "").trim();
  if (programId) {
    const { data, error } = await supabaseAdmin
      .from("business_programs")
      .select("name")
      .eq("id", programId)
      .maybeSingle();
    if (!error && data) programName = String((data as { name: string }).name);
  }
  if (!programName) throw new Error("사업명을 입력해주세요.");

  const participantsYouth = asInt(formData.get("participants_youth"));
  const participantsOther = asInt(formData.get("participants_other"));
  const attendanceYouth = asInt(formData.get("attendance_youth"));
  const attendanceOther = asInt(formData.get("attendance_other"));

  const payload = {
    report_year: asInt(formData.get("year"), 2020),
    report_month: Math.min(12, asInt(formData.get("month"), 1)),
    category: String(formData.get("category") ?? "기타").trim() || "기타",
    program_id: programId || null,
    program_name: programName,
    manager_name: String(formData.get("manager_name") ?? "").trim(),
    sessions: asInt(formData.get("sessions")),
    operating_days: asInt(formData.get("operating_days")),
    participants_youth: participantsYouth,
    participants_other: participantsOther,
    // 합계 컬럼은 유지하고 항상 청+기 로 동기화 — 기존 집계·내보내기 코드 호환.
    participants: participantsYouth + participantsOther,
    attendance_youth: attendanceYouth,
    attendance_other: attendanceOther,
    attendance: attendanceYouth + attendanceOther,
    youth_uses: asInt(formData.get("youth_uses")),
    other_uses: asInt(formData.get("other_uses")),
    summary: String(formData.get("summary") ?? "").trim(),
    evaluation: String(formData.get("evaluation") ?? "").trim(),
    status: formData.get("submit") === "true" ? "submitted" : "draft",
    author_name: user.name,
    updated_by: user.name,
  };

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

// =====================================================================
// 레지스트리 관리 (admin 전용) — /hr/facility 의 장소 마스터 관리와 같은 패턴.
//   삭제 대신 is_active 토글로 숨깁니다(과거 실적 표기 보존).
// =====================================================================
type ActionResult = { ok: true } | { ok: false; message: string };

function actionError(e: unknown, fallback: string): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : fallback };
}

export async function createBusinessCategory(
  name: string,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const nm = name.trim();
    if (!nm) return { ok: false, message: "분야명을 입력하세요." };
    const { data: rows } = await supabaseAdmin
      .from("business_categories")
      .select("sort_order");
    const max = (rows ?? []).reduce(
      (m, r) => Math.max(m, Number((r as { sort_order: unknown }).sort_order)),
      0,
    );
    const { error } = await supabaseAdmin
      .from("business_categories")
      .insert({ name: nm, sort_order: max + 1 });
    if (error) throw new Error(error.message);
    revalidatePath("/business-results");
    return { ok: true };
  } catch (e) {
    return actionError(e, "분야를 추가하지 못했습니다.");
  }
}

export async function updateBusinessCategory(
  id: string,
  patch: { name?: string; sort_order?: number; is_active?: boolean },
): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const nm = patch.name.trim();
      if (!nm) return { ok: false, message: "분야명을 입력하세요." };
      row.name = nm;
    }
    if (patch.sort_order !== undefined) row.sort_order = patch.sort_order;
    if (patch.is_active !== undefined) row.is_active = patch.is_active;
    const { error } = await supabaseAdmin
      .from("business_categories")
      .update(row)
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/business-results");
    return { ok: true };
  } catch (e) {
    return actionError(e, "분야를 수정하지 못했습니다.");
  }
}

export async function createBusinessProgram(
  categoryId: string,
  name: string,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const nm = name.trim();
    if (!categoryId) return { ok: false, message: "분야를 선택하세요." };
    if (!nm) return { ok: false, message: "사업명을 입력하세요." };
    const { data: rows } = await supabaseAdmin
      .from("business_programs")
      .select("sort_order")
      .eq("category_id", categoryId);
    const max = (rows ?? []).reduce(
      (m, r) => Math.max(m, Number((r as { sort_order: unknown }).sort_order)),
      0,
    );
    const { error } = await supabaseAdmin
      .from("business_programs")
      .insert({ category_id: categoryId, name: nm, sort_order: max + 1 });
    if (error) throw new Error(error.message);
    revalidatePath("/business-results");
    return { ok: true };
  } catch (e) {
    return actionError(e, "사업을 추가하지 못했습니다.");
  }
}

export async function updateBusinessProgram(
  id: string,
  patch: { name?: string; sort_order?: number; is_active?: boolean },
): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const nm = patch.name.trim();
      if (!nm) return { ok: false, message: "사업명을 입력하세요." };
      row.name = nm;
    }
    if (patch.sort_order !== undefined) row.sort_order = patch.sort_order;
    if (patch.is_active !== undefined) row.is_active = patch.is_active;
    const { error } = await supabaseAdmin
      .from("business_programs")
      .update(row)
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/business-results");
    return { ok: true };
  } catch (e) {
    return actionError(e, "사업을 수정하지 못했습니다.");
  }
}
