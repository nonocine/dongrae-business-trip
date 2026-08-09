"use server";

import { revalidatePath } from "next/cache";
import { getSession, isManagerAdmin } from "@/app/actions";
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

// 보고용 실(26개) — 비품관리 facility_locations 와는 별개의 마스터입니다.
export type ReportRoom = {
  id: string;
  floor: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

export type ResultRoomUsage = {
  result_id: string;
  room_id: string;
  youth_count: number;
  other_count: number;
};

// 사업별 세부입력 — 일자형(date) / 회차형(session).
export type ResultDetail = {
  id: string;
  result_id: string;
  entry_type: "date" | "session";
  entry_date: string | null;
  session_no: number | null;
  session_days: number | null;
  content: string;
  participants_youth: number;
  participants_other: number;
  room_youth: number;
  room_other: number;
  sort_order: number;
};

// 동전PAY — 건별이 아닌 월 합계 1행(월 × 구분 × 사용처).
export type CoinPayResult = {
  id: string;
  report_year: number;
  report_month: number;
  entry_type: "적립" | "차감";
  place: string;
  headcount: number;
  amount: number;
  note: string;
  author_name: string;
};

// 종사자 교육 — 의무교육 반입(mandatory) + 외부 연수·기타(manual).
export type StaffTrainingResult = {
  id: string;
  report_year: number;
  report_month: number;
  training_date: string;
  staff_name: string;
  training_name: string;
  location: string;
  organizer: string;
  hours: string;
  source: "mandatory" | "manual";
  author_name: string;
};

export type BusinessResultsData = {
  configured: boolean;
  isAdmin: boolean;
  results: BusinessResult[];
  promotions: PromotionResult[];
  registry: ProgramRegistry;
  roomsConfigured: boolean;
  rooms: ReportRoom[];
  roomUsage: ResultRoomUsage[];
  detailsConfigured: boolean;
  details: ResultDetail[];
  coinPayConfigured: boolean;
  coinPay: CoinPayResult[];
  coinPayCumulative: number; // 센터 전체 누적(조회 기간과 무관)
  staffTrainingConfigured: boolean;
  staffTrainings: StaffTrainingResult[];
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
  // SEC-3b: 관리자 판정은 구글 관장·master 기준(공유비번 세션 제거).
  return {
    name: session.name,
    isAdmin: await isManagerAdmin(),
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

// 보고용 실 목록 — 미적용(42P01)이면 빈 목록으로 폴백(입력 섹션 숨김).
async function loadRooms(): Promise<{
  configured: boolean;
  rooms: ReportRoom[];
}> {
  const { data, error } = await supabaseAdmin
    .from("report_rooms")
    .select("id,floor,name,sort_order,is_active")
    .order("sort_order");
  if (tableMissing(error)) return { configured: false, rooms: [] };
  if (error) throw new Error(error.message);
  return { configured: true, rooms: (data ?? []) as ReportRoom[] };
}

// 조회 기간 결과행들의 실별 인원 — 결과 id 목록으로 in 쿼리 1회.
async function loadRoomUsage(resultIds: string[]): Promise<ResultRoomUsage[]> {
  if (resultIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("business_result_rooms")
    .select("result_id,room_id,youth_count,other_count")
    .in("result_id", resultIds);
  if (tableMissing(error)) return [];
  if (error) throw new Error(error.message);
  return (data ?? []) as ResultRoomUsage[];
}

async function loadDetails(resultIds: string[]): Promise<{
  configured: boolean;
  details: ResultDetail[];
}> {
  if (resultIds.length === 0) return { configured: true, details: [] };
  const { data, error } = await supabaseAdmin
    .from("business_result_details")
    .select("*")
    .in("result_id", resultIds)
    .order("sort_order");
  if (tableMissing(error)) return { configured: false, details: [] };
  if (error) throw new Error(error.message);
  return { configured: true, details: (data ?? []) as ResultDetail[] };
}

// 동전PAY — 기간 행 + "최종 금액(센터 전체 누적)".
//   누적은 조회 기간과 무관하게 테이블 전체에서 적립 − 차감 으로 산출합니다.
async function loadCoinPay(
  year: number,
  startMonth: number,
  endMonth: number,
): Promise<{
  configured: boolean;
  rows: CoinPayResult[];
  cumulative: number;
}> {
  const [periodQuery, allQuery] = await Promise.all([
    supabaseAdmin
      .from("coin_pay_results")
      .select("*")
      .eq("report_year", year)
      .gte("report_month", startMonth)
      .lte("report_month", endMonth)
      .order("report_month")
      .order("entry_type")
      .order("place"),
    supabaseAdmin.from("coin_pay_results").select("entry_type,amount"),
  ]);
  if (tableMissing(periodQuery.error) || tableMissing(allQuery.error))
    return { configured: false, rows: [], cumulative: 0 };
  if (periodQuery.error) throw new Error(periodQuery.error.message);
  if (allQuery.error) throw new Error(allQuery.error.message);
  const cumulative = (
    (allQuery.data ?? []) as { entry_type: string; amount: number }[]
  ).reduce(
    (sum, r) => sum + (r.entry_type === "차감" ? -1 : 1) * Number(r.amount ?? 0),
    0,
  );
  return {
    configured: true,
    rows: (periodQuery.data ?? []) as CoinPayResult[],
    cumulative,
  };
}

async function loadStaffTrainings(
  year: number,
  startMonth: number,
  endMonth: number,
): Promise<{ configured: boolean; rows: StaffTrainingResult[] }> {
  const { data, error } = await supabaseAdmin
    .from("staff_training_results")
    .select("*")
    .eq("report_year", year)
    .gte("report_month", startMonth)
    .lte("report_month", endMonth)
    .order("training_date");
  if (tableMissing(error)) return { configured: false, rows: [] };
  if (error) throw new Error(error.message);
  return { configured: true, rows: (data ?? []) as StaffTrainingResult[] };
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
      roomsConfigured: false,
      rooms: [],
      roomUsage: [],
      detailsConfigured: false,
      details: [],
      coinPayConfigured: false,
      coinPay: [],
      coinPayCumulative: 0,
      staffTrainingConfigured: false,
      staffTrainings: [],
    };
  const isAdmin = await isManagerAdmin();

  const [resultQuery, promotionQuery, registry, roomMaster, coinPay, staff] =
    await Promise.all([
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
      loadRooms(),
      loadCoinPay(year, startMonth, endMonth),
      loadStaffTrainings(year, startMonth, endMonth),
    ]);

  if (tableMissing(resultQuery.error) || tableMissing(promotionQuery.error)) {
    return {
      configured: false,
      isAdmin,
      results: [],
      promotions: [],
      registry,
      roomsConfigured: roomMaster.configured,
      rooms: roomMaster.rooms,
      roomUsage: [],
      detailsConfigured: false,
      details: [],
      coinPayConfigured: coinPay.configured,
      coinPay: coinPay.rows,
      coinPayCumulative: coinPay.cumulative,
      staffTrainingConfigured: staff.configured,
      staffTrainings: staff.rows,
    };
  }
  if (resultQuery.error) throw new Error(resultQuery.error.message);
  if (promotionQuery.error) throw new Error(promotionQuery.error.message);

  const results = ((resultQuery.data ?? []) as Record<string, unknown>[]).map(
    toResult,
  );
  const resultIds = results.map((r) => r.id);
  const [roomUsage, detailData] = await Promise.all([
    loadRoomUsage(resultIds),
    loadDetails(resultIds),
  ]);

  return {
    configured: true,
    isAdmin,
    results,
    promotions: (promotionQuery.data ?? []) as PromotionResult[],
    registry,
    roomsConfigured: roomMaster.configured,
    rooms: roomMaster.rooms,
    roomUsage,
    detailsConfigured: detailData.configured,
    details: detailData.details,
    coinPayConfigured: coinPay.configured,
    coinPay: coinPay.rows,
    coinPayCumulative: coinPay.cumulative,
    staffTrainingConfigured: staff.configured,
    staffTrainings: staff.rows,
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

  // 실별 사용인원 — 폼의 room_{roomId}_youth / _other 를 수집합니다.
  //   섹션이 노출된 경우(= report_rooms 적용)에만 필드가 오고, 이때 실인원은
  //   실별 합계에서 파생합니다. 미적용이면 기존 직접 입력값을 그대로 씁니다.
  const roomCounts = new Map<string, { youth: number; other: number }>();
  for (const [key, value] of formData.entries()) {
    const match = /^room_(.+)_(youth|other)$/.exec(key);
    if (!match) continue;
    const [, roomId, kind] = match;
    const entry = roomCounts.get(roomId) ?? { youth: 0, other: 0 };
    const n = Math.max(0, Number.parseInt(String(value ?? "0"), 10) || 0);
    if (kind === "youth") entry.youth = n;
    else entry.other = n;
    roomCounts.set(roomId, entry);
  }
  const roomsSubmitted = roomCounts.size > 0;
  const roomTotals = [...roomCounts.values()].reduce(
    (a, r) => ({ youth: a.youth + r.youth, other: a.other + r.other }),
    { youth: 0, other: 0 },
  );

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
    youth_uses: roomsSubmitted
      ? roomTotals.youth
      : asInt(formData.get("youth_uses")),
    other_uses: roomsSubmitted
      ? roomTotals.other
      : asInt(formData.get("other_uses")),
    summary: String(formData.get("summary") ?? "").trim(),
    evaluation: String(formData.get("evaluation") ?? "").trim(),
    status: formData.get("submit") === "true" ? "submitted" : "draft",
    author_name: user.name,
    updated_by: user.name,
  };

  // upsert 후 자식 테이블(실별 인원)을 교체하는 2단계 저장. 실패 시 그대로 throw.
  let resultId = id;
  if (id) {
    let query = supabaseAdmin
      .from("business_results")
      .update(payload)
      .eq("id", id);
    if (!user.isAdmin) query = query.eq("author_name", user.name);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("본인이 작성한 실적만 수정할 수 있습니다.");
  } else {
    const { data, error } = await supabaseAdmin
      .from("business_results")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    resultId = String((data as { id: string }).id);
  }

  if (roomsSubmitted && resultId) {
    await replaceResultRooms(resultId, roomCounts);
  }
  revalidatePath("/business-results");
  return { ok: true };
}

// 실별 인원 delete-then-insert 교체. 0/0 인 실은 행을 만들지 않습니다.
async function replaceResultRooms(
  resultId: string,
  roomCounts: Map<string, { youth: number; other: number }>,
) {
  const del = await supabaseAdmin
    .from("business_result_rooms")
    .delete()
    .eq("result_id", resultId);
  if (del.error) {
    if (tableMissing(del.error)) return; // 테이블 미적용 — 실별 저장은 건너뜁니다.
    throw new Error(del.error.message);
  }
  const rows = [...roomCounts.entries()]
    .filter(([, v]) => v.youth > 0 || v.other > 0)
    .map(([roomId, v]) => ({
      result_id: resultId,
      room_id: roomId,
      youth_count: v.youth,
      other_count: v.other,
    }));
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin
    .from("business_result_rooms")
    .insert(rows);
  if (error) throw new Error(error.message);
}

// =====================================================================
// 작업 5. 사업별 세부입력 — delete-then-insert 교체(실별 인원과 동일 패턴).
//   권한 규칙은 saveBusinessResult 와 동일: 비관리자는 본인 작성 행만.
// =====================================================================
export type ResultDetailInput = {
  entry_type: "date" | "session";
  entry_date: string | null;
  session_no: number | null;
  session_days: number | null;
  content: string;
  participants_youth: number;
  participants_other: number;
  room_youth: number;
  room_other: number;
};

export async function saveResultDetails(
  resultId: string,
  rows: ResultDetailInput[],
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!resultId) return { ok: false, message: "대상 실적이 없습니다." };

    const { data: owner, error: ownerError } = await supabaseAdmin
      .from("business_results")
      .select("author_name")
      .eq("id", resultId)
      .maybeSingle();
    if (ownerError) throw new Error(ownerError.message);
    if (!owner) return { ok: false, message: "실적을 찾을 수 없습니다." };
    if (
      !user.isAdmin &&
      String((owner as { author_name: string }).author_name) !== user.name
    )
      return { ok: false, message: "본인이 작성한 실적만 수정할 수 있습니다." };

    const del = await supabaseAdmin
      .from("business_result_details")
      .delete()
      .eq("result_id", resultId);
    if (del.error) {
      if (tableMissing(del.error))
        return { ok: false, message: "세부입력 테이블이 아직 적용되지 않았습니다." };
      throw new Error(del.error.message);
    }

    const payload = rows.map((r, index) => ({
      result_id: resultId,
      entry_type: r.entry_type === "session" ? "session" : "date",
      entry_date: r.entry_type === "date" ? r.entry_date || null : null,
      session_no: r.entry_type === "session" ? r.session_no : null,
      session_days: r.entry_type === "session" ? r.session_days : null,
      content: r.content.trim(),
      participants_youth: Math.max(0, r.participants_youth),
      participants_other: Math.max(0, r.participants_other),
      room_youth: Math.max(0, r.room_youth),
      room_other: Math.max(0, r.room_other),
      sort_order: index + 1,
    }));
    if (payload.length > 0) {
      const { error } = await supabaseAdmin
        .from("business_result_details")
        .insert(payload);
      if (error) throw new Error(error.message);
    }
    revalidatePath("/business-results");
    return { ok: true };
  } catch (e) {
    return actionError(e, "세부 실적을 저장하지 못했습니다.");
  }
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
// 작업 6. 동전PAY — 월 합계 행 저장/삭제.
// =====================================================================
export async function saveCoinPay(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "").trim();
  const entryType = String(formData.get("entry_type") ?? "적립").trim();
  const payload = {
    report_year: asInt(formData.get("year"), 2020),
    report_month: Math.min(12, asInt(formData.get("month"), 1)),
    entry_type: entryType === "차감" ? "차감" : "적립",
    place: String(formData.get("place") ?? "").trim(),
    headcount: asInt(formData.get("headcount")),
    amount: asInt(formData.get("amount")),
    note: String(formData.get("note") ?? "").trim(),
    author_name: user.name,
    updated_at: new Date().toISOString(),
  };
  if (!payload.place) throw new Error("사용처를 입력해주세요.");

  let query = id
    ? supabaseAdmin.from("coin_pay_results").update(payload).eq("id", id)
    : supabaseAdmin.from("coin_pay_results").insert(payload);
  if (id && !user.isAdmin) query = query.eq("author_name", user.name);
  const { error } = await query;
  if (error) throw new Error(error.message);
  revalidatePath("/business-results");
  return { ok: true };
}

export async function deleteCoinPay(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    let query = supabaseAdmin.from("coin_pay_results").delete().eq("id", id);
    if (!user.isAdmin) query = query.eq("author_name", user.name);
    const { error } = await query;
    if (error) throw new Error(error.message);
    revalidatePath("/business-results");
    return { ok: true };
  } catch (e) {
    return actionError(e, "동전PAY 기록을 삭제하지 못했습니다.");
  }
}

// =====================================================================
// 작업 7. 종사자 교육 — 수동 행 저장/삭제 + 의무교육 반입.
// =====================================================================
export async function saveStaffTraining(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "").trim();
  const payload = {
    report_year: asInt(formData.get("year"), 2020),
    report_month: Math.min(12, asInt(formData.get("month"), 1)),
    training_date: String(formData.get("training_date") ?? "").trim(),
    staff_name: String(formData.get("staff_name") ?? "").trim(),
    training_name: String(formData.get("training_name") ?? "").trim(),
    location: String(formData.get("location") ?? "").trim(),
    organizer: String(formData.get("organizer") ?? "").trim(),
    hours: String(formData.get("hours") ?? "").trim(),
    author_name: user.name,
    updated_at: new Date().toISOString(),
  };
  if (!payload.training_date || !payload.staff_name || !payload.training_name) {
    throw new Error("일자·성명·교육명을 입력해주세요.");
  }
  const { error } = id
    ? // 반입 행(source='mandatory')도 장소·주최·수료시간을 고쳐 쓸 수 있게 둡니다.
      await supabaseAdmin
        .from("staff_training_results")
        .update(payload)
        .eq("id", id)
    : await supabaseAdmin
        .from("staff_training_results")
        .insert({ ...payload, source: "manual" });
  if (error) throw new Error(error.message);
  revalidatePath("/business-results");
  return { ok: true };
}

export async function deleteStaffTraining(id: string): Promise<ActionResult> {
  try {
    await requireUser();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const { error } = await supabaseAdmin
      .from("staff_training_results")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/business-results");
    return { ok: true };
  } catch (e) {
    return actionError(e, "교육 기록을 삭제하지 못했습니다.");
  }
}

// KST(UTC+9) 기준 해당 연·월의 [시작, 끝) 을 UTC ISO 로 계산합니다.
function kstMonthRangeUtc(year: number, month: number) {
  const offset = 9 * 60 * 60 * 1000;
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - offset).toISOString(),
    end: new Date(Date.UTC(year, month, 1) - offset).toISOString(),
  };
}

// completed_at(timestamptz) → KST 기준 "YYYY-MM-DD".
function kstDateOf(iso: string): string {
  const kst = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}-${p2(kst.getUTCMonth() + 1)}-${p2(kst.getUTCDate())}`;
}

// 의무교육 수료기록을 종사자 교육 실적으로 반입합니다.
//   source_completion_id unique + ignoreDuplicates 로 재클릭 시 중복이 생기지 않습니다.
export async function importMandatoryTrainings(
  year: number,
  month: number,
): Promise<
  { ok: true; inserted: number; skipped: number } | { ok: false; message: string }
> {
  try {
    const user = await requireUser();
    const range = kstMonthRangeUtc(year, month);
    const { data: comps, error: compError } = await supabaseAdmin
      .from("training_completions")
      .select("id, training_id, driver_id, completed_at")
      .gte("completed_at", range.start)
      .lt("completed_at", range.end);
    if (compError) {
      if (tableMissing(compError))
        return { ok: false, message: "의무교육 테이블을 찾을 수 없습니다." };
      throw new Error(compError.message);
    }
    const rows = (comps ?? []) as {
      id: string;
      training_id: string;
      driver_id: string;
      completed_at: string | null;
    }[];
    const usable = rows.filter((r) => r.completed_at);
    if (usable.length === 0) return { ok: true, inserted: 0, skipped: 0 };

    const [{ data: trainings }, { data: drivers }] = await Promise.all([
      supabaseAdmin
        .from("mandatory_trainings")
        .select("id, name, location, organizer, hours")
        .in("id", [...new Set(usable.map((r) => r.training_id))]),
      supabaseAdmin
        .from("drivers")
        .select("id, name")
        .in("id", [...new Set(usable.map((r) => r.driver_id))]),
    ]);
    const trainingById = new Map(
      (trainings ?? []).map((t) => {
        const r = t as Record<string, unknown>;
        return [
          String(r.id),
          {
            name: String(r.name ?? ""),
            location: String(r.location ?? ""),
            organizer: String(r.organizer ?? ""),
            hours: String(r.hours ?? ""),
          },
        ];
      }),
    );
    const nameById = new Map(
      (drivers ?? []).map((d) => {
        const r = d as Record<string, unknown>;
        return [String(r.id), String(r.name ?? "")];
      }),
    );

    const payload = usable.map((r) => {
      const t = trainingById.get(r.training_id);
      return {
        report_year: year,
        report_month: month,
        training_date: kstDateOf(r.completed_at as string),
        staff_name: nameById.get(r.driver_id) ?? "(이름 없음)",
        training_name: t?.name ?? "(교육명 없음)",
        location: t?.location ?? "",
        organizer: t?.organizer ?? "",
        hours: t?.hours ?? "",
        source: "mandatory",
        source_completion_id: r.id,
        author_name: user.name,
      };
    });

    const { data: inserted, error } = await supabaseAdmin
      .from("staff_training_results")
      .upsert(payload, {
        onConflict: "source_completion_id",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) {
      if (tableMissing(error))
        return { ok: false, message: "종사자 교육 테이블이 아직 적용되지 않았습니다." };
      throw new Error(error.message);
    }
    const count = (inserted ?? []).length;
    revalidatePath("/business-results");
    return { ok: true, inserted: count, skipped: payload.length - count };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "반입하지 못했습니다.",
    };
  }
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
