import { getSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type {
  BusinessDetailExportRow,
  BusinessReportInput,
  BusinessResultExportRow,
  CoinPayExportRow,
  RoomUsageExportRow,
  StaffTrainingExportRow,
} from "@/lib/businessResultsExport";

// 신규 테이블이 아직 적용되지 않은 환경에서도 내보내기가 죽지 않게 합니다.
function tableMissing(error: { code?: string; message?: string } | null) {
  return error?.code === "42P01" || error?.message?.includes("schema cache");
}

// 기간 내 실별 사용인원을 실 단위로 합산 — report_rooms.sort_order 순.
async function loadRoomUsage(
  resultIds: string[],
): Promise<RoomUsageExportRow[]> {
  if (resultIds.length === 0) return [];
  const [usageQuery, roomQuery] = await Promise.all([
    supabaseAdmin
      .from("business_result_rooms")
      .select("room_id,youth_count,other_count")
      .in("result_id", resultIds),
    supabaseAdmin.from("report_rooms").select("id,floor,name,sort_order"),
  ]);
  if (tableMissing(usageQuery.error) || tableMissing(roomQuery.error)) return [];
  if (usageQuery.error) throw new Error(usageQuery.error.message);
  if (roomQuery.error) throw new Error(roomQuery.error.message);

  const rooms = new Map(
    ((roomQuery.data ?? []) as Record<string, unknown>[]).map((r) => [
      String(r.id),
      {
        floor: String(r.floor ?? ""),
        name: String(r.name ?? ""),
        sort_order: Number(r.sort_order ?? 0),
      },
    ]),
  );
  const totals = new Map<string, { youth: number; other: number }>();
  for (const raw of (usageQuery.data ?? []) as Record<string, unknown>[]) {
    const id = String(raw.room_id);
    const entry = totals.get(id) ?? { youth: 0, other: 0 };
    entry.youth += Number(raw.youth_count ?? 0);
    entry.other += Number(raw.other_count ?? 0);
    totals.set(id, entry);
  }
  return [...totals.entries()]
    .map(([id, v]) => ({
      floor: rooms.get(id)?.floor ?? "",
      name: rooms.get(id)?.name ?? "(삭제된 실)",
      sortOrder: rooms.get(id)?.sort_order ?? 999,
      youth: v.youth,
      other: v.other,
    }))
    .filter((r) => r.youth > 0 || r.other > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ floor, name, youth, other }) => ({ floor, name, youth, other }));
}

async function loadDetails(
  resultIds: string[],
): Promise<Map<string, BusinessDetailExportRow[]>> {
  const out = new Map<string, BusinessDetailExportRow[]>();
  if (resultIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from("business_result_details")
    .select("*")
    .in("result_id", resultIds)
    .order("sort_order");
  if (tableMissing(error)) return out;
  if (error) throw new Error(error.message);
  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    const key = String(raw.result_id);
    const list = out.get(key) ?? [];
    list.push({
      entry_type: raw.entry_type === "session" ? "session" : "date",
      entry_date: (raw.entry_date as string | null) ?? null,
      session_no: raw.session_no == null ? null : Number(raw.session_no),
      session_days: raw.session_days == null ? null : Number(raw.session_days),
      content: String(raw.content ?? ""),
      participants_youth: Number(raw.participants_youth ?? 0),
      participants_other: Number(raw.participants_other ?? 0),
      room_youth: Number(raw.room_youth ?? 0),
      room_other: Number(raw.room_other ?? 0),
    });
    out.set(key, list);
  }
  return out;
}

async function loadCoinPay(
  year: number,
  startMonth: number,
  endMonth: number,
): Promise<{ rows: CoinPayExportRow[]; cumulative: number }> {
  const [periodQuery, allQuery] = await Promise.all([
    supabaseAdmin
      .from("coin_pay_results")
      .select("entry_type,place,headcount,amount,note")
      .eq("report_year", year)
      .gte("report_month", startMonth)
      .lte("report_month", endMonth)
      .order("entry_type")
      .order("place"),
    supabaseAdmin.from("coin_pay_results").select("entry_type,amount"),
  ]);
  if (tableMissing(periodQuery.error) || tableMissing(allQuery.error))
    return { rows: [], cumulative: 0 };
  if (periodQuery.error) throw new Error(periodQuery.error.message);
  if (allQuery.error) throw new Error(allQuery.error.message);
  const cumulative = (
    (allQuery.data ?? []) as { entry_type: string; amount: number }[]
  ).reduce(
    (sum, r) => sum + (r.entry_type === "차감" ? -1 : 1) * Number(r.amount ?? 0),
    0,
  );
  return {
    rows: ((periodQuery.data ?? []) as Record<string, unknown>[]).map((r) => ({
      entry_type: String(r.entry_type ?? "적립"),
      place: String(r.place ?? ""),
      headcount: Number(r.headcount ?? 0),
      amount: Number(r.amount ?? 0),
      note: String(r.note ?? ""),
    })),
    cumulative,
  };
}

async function loadStaffTrainings(
  year: number,
  startMonth: number,
  endMonth: number,
): Promise<StaffTrainingExportRow[]> {
  const { data, error } = await supabaseAdmin
    .from("staff_training_results")
    .select("training_date,staff_name,training_name,location,organizer,hours")
    .eq("report_year", year)
    .gte("report_month", startMonth)
    .lte("report_month", endMonth)
    .order("training_date");
  if (tableMissing(error)) return [];
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    training_date: String(r.training_date ?? ""),
    staff_name: String(r.staff_name ?? ""),
    training_name: String(r.training_name ?? ""),
    location: String(r.location ?? ""),
    organizer: String(r.organizer ?? ""),
    hours: String(r.hours ?? ""),
  }));
}

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
        "id,category,program_name,manager_name,sessions,operating_days,participants,participants_youth,participants_other,attendance,attendance_youth,attendance_other,youth_uses,other_uses,summary,evaluation,status,author_name",
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

  const rawResults = ((resultQuery.data ?? []) as Record<string, unknown>[]).map(
    (r) => ({
      id: String(r.id ?? ""),
      category: String(r.category ?? "기타"),
      program_name: String(r.program_name ?? ""),
      manager_name: String(r.manager_name ?? ""),
      sessions: Number(r.sessions ?? 0),
      operating_days: Number(r.operating_days ?? 0),
      participants: Number(r.participants ?? 0),
      participants_youth: Number(r.participants_youth ?? 0),
      participants_other: Number(r.participants_other ?? 0),
      attendance: Number(r.attendance ?? 0),
      attendance_youth: Number(r.attendance_youth ?? 0),
      attendance_other: Number(r.attendance_other ?? 0),
      youth_uses: Number(r.youth_uses ?? 0),
      other_uses: Number(r.other_uses ?? 0),
      summary: String(r.summary ?? ""),
      evaluation: String(r.evaluation ?? ""),
      status: (r.status === "submitted" ? "submitted" : "draft") as
        | "submitted"
        | "draft",
      author_name: String(r.author_name ?? ""),
    }),
  );
  const resultIds = rawResults.map((r) => r.id);
  const [rooms, detailsByResult, coinPay, staffTrainings] = await Promise.all([
    loadRoomUsage(resultIds),
    loadDetails(resultIds),
    loadCoinPay(year, startMonth, endMonth),
    loadStaffTrainings(year, startMonth, endMonth),
  ]);

  // 같은 분야·사업명은 기간 내 수치를 합산하고 세부 행은 이어 붙입니다.
  const merged = new Map<string, BusinessResultExportRow>();
  for (const row of rawResults) {
    const key = `${row.category} ${row.program_name}`;
    const details = detailsByResult.get(row.id) ?? [];
    const current = merged.get(key);
    if (!current) {
      const { id: _id, ...rest } = row;
      void _id;
      merged.set(key, { ...rest, details: [...details] });
      continue;
    }
    current.sessions += row.sessions;
    current.operating_days = (current.operating_days ?? 0) + row.operating_days;
    current.participants += row.participants;
    current.participants_youth =
      (current.participants_youth ?? 0) + row.participants_youth;
    current.participants_other =
      (current.participants_other ?? 0) + row.participants_other;
    current.attendance += row.attendance;
    current.attendance_youth =
      (current.attendance_youth ?? 0) + row.attendance_youth;
    current.attendance_other =
      (current.attendance_other ?? 0) + row.attendance_other;
    current.youth_uses += row.youth_uses;
    current.other_uses += row.other_uses;
    if (!current.manager_name && row.manager_name)
      current.manager_name = row.manager_name;
    if (row.status === "draft") current.status = "draft";
    current.details = [...(current.details ?? []), ...details];
  }

  return {
    year,
    month: endMonth,
    startMonth,
    endMonth,
    periodLabel,
    orgName: "동래구청소년센터",
    results: [...merged.values()],
    promotions: (promotionQuery.data ??
      []) as BusinessReportInput["promotions"],
    rooms,
    coinPay: coinPay.rows,
    coinPayCumulative: coinPay.cumulative,
    staffTrainings,
  };
}
