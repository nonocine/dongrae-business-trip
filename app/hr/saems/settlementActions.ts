"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSaemAccess } from "@/lib/saemAccess";
import {
  calcInstructorSettlement,
  type SettlementSessionInput,
  type SettlementProgramDetail,
} from "@/lib/settlement";

const PROJ = "saem_projects";
const TERM = "saem_terms";
const PROG = "saem_programs";
const SESS = "saem_sessions";
const SETT = "saem_settlements";
const ITEM = "saem_settlement_items";
const INSTR = "saem_instructors";

export type SettlementStatus = "draft" | "confirmed";

// =====================================================================
// 공용 로더 — 프로젝트+기간의 정산 대상 세션을 강사별로 모은다.
//   대상: 기간 내 session_date, staff_confirmed_at not null, settlement_id is null
//         (재계산 시 includeSettlementId 로 자기 정산에 묶인 세션도 포함), 강사 배정된 프로그램.
// =====================================================================
async function gatherEligible(
  projectId: string,
  periodStart: string,
  periodEnd: string,
  includeSettlementId?: string
): Promise<{
  byInstructor: Map<string, SettlementSessionInput[]>;
  sessionIds: string[];
}> {
  const byInstructor = new Map<string, SettlementSessionInput[]>();
  const sessionIds: string[] = [];

  const { data: terms } = await supabaseAdmin
    .from(TERM)
    .select("id")
    .eq("project_id", projectId);
  const termIds = (terms ?? []).map((t) => String((t as { id: string }).id));
  if (!termIds.length) return { byInstructor, sessionIds };

  const { data: progs } = await supabaseAdmin
    .from(PROG)
    .select("id, name, instructor_id, hourly_rate, deduction_rate")
    .in("term_id", termIds)
    .not("instructor_id", "is", null);
  const progRows = (progs ?? []) as Record<string, unknown>[];
  if (!progRows.length) return { byInstructor, sessionIds };
  const progMap = new Map(progRows.map((p) => [String(p.id), p]));
  const progIds = progRows.map((p) => String(p.id));

  const { data: sess } = await supabaseAdmin
    .from(SESS)
    .select("id, program_id, session_date, work_hours, settlement_id")
    .in("program_id", progIds)
    .gte("session_date", periodStart)
    .lte("session_date", periodEnd)
    .not("staff_confirmed_at", "is", null);

  for (const row of (sess ?? []) as Record<string, unknown>[]) {
    const settId = (row.settlement_id as string | null) ?? null;
    const eligible =
      settId == null ||
      (includeSettlementId != null && settId === includeSettlementId);
    if (!eligible) continue;
    const prog = progMap.get(String(row.program_id));
    if (!prog) continue;
    const instructorId = String(prog.instructor_id);
    const input: SettlementSessionInput = {
      program_id: String(prog.id),
      program_name: String(prog.name ?? ""),
      hourly_rate: Number(prog.hourly_rate ?? 0),
      deduction_rate: Number(prog.deduction_rate ?? 0),
      work_hours: Number(row.work_hours ?? 0),
    };
    const list = byInstructor.get(instructorId) ?? [];
    list.push(input);
    byInstructor.set(instructorId, list);
    sessionIds.push(String(row.id));
  }
  return { byInstructor, sessionIds };
}

async function instructorNameMap(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await supabaseAdmin
    .from(INSTR)
    .select("id, name")
    .in("id", ids);
  return new Map(
    (data ?? []).map((r) => [
      String((r as { id: string }).id),
      String((r as { name: string }).name ?? ""),
    ])
  );
}

// =====================================================================
// 목록 / 옵션
// =====================================================================
export type SettlementProjectOption = { id: string; name: string };
export async function listSettlementProjects(): Promise<
  SettlementProjectOption[]
> {
  await requireSaemAccess();
  const { data } = await supabaseAdmin
    .from(PROJ)
    .select("id, name")
    .order("sort_order", { ascending: true });
  return (data ?? []).map((r) => ({
    id: String((r as { id: string }).id),
    name: String((r as { name: string }).name ?? ""),
  }));
}

export type SettlementListRow = {
  id: string;
  projectName: string;
  title: string;
  period_start: string | null;
  period_end: string | null;
  status: SettlementStatus;
  instructorCount: number;
  totalNet: number;
};

export async function listSettlements(): Promise<SettlementListRow[]> {
  await requireSaemAccess();
  const { data: setts } = await supabaseAdmin
    .from(SETT)
    .select("*")
    .order("created_at", { ascending: false });
  const rows = (setts ?? []) as Record<string, unknown>[];
  if (!rows.length) return [];

  const projIds = [...new Set(rows.map((r) => String(r.project_id)))];
  const { data: projs } = await supabaseAdmin
    .from(PROJ)
    .select("id, name")
    .in("id", projIds);
  const projName = new Map(
    (projs ?? []).map((p) => [
      String((p as { id: string }).id),
      String((p as { name: string }).name ?? ""),
    ])
  );

  const settIds = rows.map((r) => String(r.id));
  const { data: items } = await supabaseAdmin
    .from(ITEM)
    .select("settlement_id, net_amount")
    .in("settlement_id", settIds);
  const agg = new Map<string, { count: number; net: number }>();
  for (const it of items ?? []) {
    const sid = String((it as { settlement_id: string }).settlement_id);
    const a = agg.get(sid) ?? { count: 0, net: 0 };
    a.count += 1;
    a.net += Number((it as { net_amount: number }).net_amount ?? 0);
    agg.set(sid, a);
  }

  return rows.map((r) => {
    const id = String(r.id);
    const a = agg.get(id) ?? { count: 0, net: 0 };
    return {
      id,
      projectName: projName.get(String(r.project_id)) ?? "",
      title: String(r.title ?? ""),
      period_start: (r.period_start as string | null) ?? null,
      period_end: (r.period_end as string | null) ?? null,
      status: r.status === "confirmed" ? "confirmed" : "draft",
      instructorCount: a.count,
      totalNet: a.net,
    };
  });
}

// =====================================================================
// 미리보기(계산만, 저장 없음)
// =====================================================================
export type SettlementPreviewRow = {
  instructor_id: string;
  instructorName: string;
  detail: SettlementProgramDetail[];
  gross_amount: number;
  deduction_rate: number;
  deduction_amount: number;
  net_amount: number;
};
export type SettlementPreview = {
  rows: SettlementPreviewRow[];
  sessionCount: number;
  totalGross: number;
  totalDeduction: number;
  totalNet: number;
};

async function buildRows(
  byInstructor: Map<string, SettlementSessionInput[]>
): Promise<SettlementPreviewRow[]> {
  const names = await instructorNameMap([...byInstructor.keys()]);
  const rows: SettlementPreviewRow[] = [];
  for (const [instructorId, sessions] of byInstructor) {
    const c = calcInstructorSettlement(sessions);
    rows.push({
      instructor_id: instructorId,
      instructorName: names.get(instructorId) ?? "(이름 없음)",
      detail: c.detail,
      gross_amount: c.gross_amount,
      deduction_rate: c.deduction_rate,
      deduction_amount: c.deduction_amount,
      net_amount: c.net_amount,
    });
  }
  rows.sort((a, b) => a.instructorName.localeCompare(b.instructorName, "ko"));
  return rows;
}

function totalsOf(rows: SettlementPreviewRow[]) {
  return rows.reduce(
    (acc, r) => ({
      totalGross: acc.totalGross + r.gross_amount,
      totalDeduction: acc.totalDeduction + r.deduction_amount,
      totalNet: acc.totalNet + r.net_amount,
    }),
    { totalGross: 0, totalDeduction: 0, totalNet: 0 }
  );
}

export async function previewSettlement(input: {
  projectId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<SettlementPreview> {
  await requireSaemAccess();
  const { byInstructor, sessionIds } = await gatherEligible(
    input.projectId,
    input.periodStart,
    input.periodEnd
  );
  const rows = await buildRows(byInstructor);
  return { rows, sessionCount: sessionIds.length, ...totalsOf(rows) };
}

// =====================================================================
// 생성(draft) — items 생성 + 세션 settlement_id 기록
// =====================================================================
export async function createSettlement(input: {
  projectId: string;
  title: string;
  periodStart: string;
  periodEnd: string;
}): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    const title = (input.title ?? "").trim();
    if (!input.projectId || !input.periodStart || !input.periodEnd)
      return { ok: false, message: "프로젝트·기간을 선택하세요." };
    if (!title) return { ok: false, message: "제목을 입력하세요." };
    if (input.periodStart > input.periodEnd)
      return { ok: false, message: "기간이 올바르지 않습니다." };

    const { byInstructor, sessionIds } = await gatherEligible(
      input.projectId,
      input.periodStart,
      input.periodEnd
    );
    if (byInstructor.size === 0)
      return {
        ok: false,
        message: "대상 세션이 없습니다. (확정된 미정산 근무일지가 없습니다)",
      };

    const { data: sett, error: sErr } = await supabaseAdmin
      .from(SETT)
      .insert({
        project_id: input.projectId,
        title,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        status: "draft",
      })
      .select("id")
      .single();
    if (sErr || !sett) throw new Error(sErr?.message ?? "정산 생성 실패");
    const settId = String((sett as { id: string }).id);

    const itemRows = [...byInstructor].map(([instructorId, sessions]) => {
      const c = calcInstructorSettlement(sessions);
      return {
        settlement_id: settId,
        instructor_id: instructorId,
        detail: c.detail,
        gross_amount: c.gross_amount,
        deduction_rate: c.deduction_rate,
        deduction_amount: c.deduction_amount,
        net_amount: c.net_amount,
      };
    });
    const { error: iErr } = await supabaseAdmin.from(ITEM).insert(itemRows);
    if (iErr) {
      await supabaseAdmin.from(SETT).delete().eq("id", settId);
      throw new Error(iErr.message);
    }
    if (sessionIds.length) {
      const { error: uErr } = await supabaseAdmin
        .from(SESS)
        .update({ settlement_id: settId })
        .in("id", sessionIds);
      if (uErr) throw new Error(uErr.message);
    }
    revalidatePath("/hr/saems/settlements");
    return { ok: true, id: settId };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "생성 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 상세
// =====================================================================
export type SettlementDetailItem = {
  instructor_id: string;
  instructorName: string;
  phone: string | null;
  bank_name: string | null;
  bank_account: string | null;
  account_holder: string | null;
  detail: SettlementProgramDetail[];
  gross_amount: number;
  deduction_rate: number;
  deduction_amount: number;
  net_amount: number;
};
export type SettlementDetail = {
  id: string;
  projectName: string;
  title: string;
  period_start: string | null;
  period_end: string | null;
  status: SettlementStatus;
  confirmed_at: string | null;
  confirmed_by: string | null;
  items: SettlementDetailItem[];
  totalGross: number;
  totalDeduction: number;
  totalNet: number;
  isM0: boolean;
};

function parseDetail(v: unknown): SettlementProgramDetail[] {
  if (Array.isArray(v)) return v as SettlementProgramDetail[];
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? (p as SettlementProgramDetail[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function getSettlement(
  id: string
): Promise<SettlementDetail | null> {
  const ctx = await requireSaemAccess();
  if (!id) return null;
  const { data: sett } = await supabaseAdmin
    .from(SETT)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!sett) return null;
  const r = sett as Record<string, unknown>;

  const { data: proj } = await supabaseAdmin
    .from(PROJ)
    .select("name")
    .eq("id", String(r.project_id))
    .maybeSingle();

  const { data: itemRows } = await supabaseAdmin
    .from(ITEM)
    .select("*")
    .eq("settlement_id", id);
  const rawItems = (itemRows ?? []) as Record<string, unknown>[];
  const insMap = await loadInstructorInfo(
    rawItems.map((it) => String(it.instructor_id))
  );

  const items: SettlementDetailItem[] = rawItems.map((it) => {
    const info = insMap.get(String(it.instructor_id));
    return {
      instructor_id: String(it.instructor_id),
      instructorName: info?.name ?? "(이름 없음)",
      phone: info?.phone ?? null,
      bank_name: info?.bank_name ?? null,
      bank_account: info?.bank_account ?? null,
      account_holder: info?.account_holder ?? null,
      detail: parseDetail(it.detail),
      gross_amount: Number(it.gross_amount ?? 0),
      deduction_rate: Number(it.deduction_rate ?? 0),
      deduction_amount: Number(it.deduction_amount ?? 0),
      net_amount: Number(it.net_amount ?? 0),
    };
  });
  items.sort((a, b) => a.instructorName.localeCompare(b.instructorName, "ko"));

  const totals = items.reduce(
    (acc, it) => ({
      totalGross: acc.totalGross + it.gross_amount,
      totalDeduction: acc.totalDeduction + it.deduction_amount,
      totalNet: acc.totalNet + it.net_amount,
    }),
    { totalGross: 0, totalDeduction: 0, totalNet: 0 }
  );

  return {
    id: String(r.id),
    projectName: (proj as { name?: string } | null)?.name ?? "",
    title: String(r.title ?? ""),
    period_start: (r.period_start as string | null) ?? null,
    period_end: (r.period_end as string | null) ?? null,
    status: r.status === "confirmed" ? "confirmed" : "draft",
    confirmed_at: (r.confirmed_at as string | null) ?? null,
    confirmed_by: (r.confirmed_by as string | null) ?? null,
    items,
    ...totals,
    isM0: ctx.isM0,
  };
}

type InstructorInfo = {
  name: string;
  phone: string | null;
  bank_name: string | null;
  bank_account: string | null;
  account_holder: string | null;
};
async function loadInstructorInfo(
  ids: string[]
): Promise<Map<string, InstructorInfo>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  const { data } = await supabaseAdmin
    .from(INSTR)
    .select("id, name, phone, bank_name, bank_account, account_holder")
    .in("id", uniq);
  return new Map(
    (data ?? []).map((r) => {
      const x = r as Record<string, unknown>;
      return [
        String(x.id),
        {
          name: String(x.name ?? ""),
          phone: (x.phone as string | null) ?? null,
          bank_name: (x.bank_name as string | null) ?? null,
          bank_account: (x.bank_account as string | null) ?? null,
          account_holder: (x.account_holder as string | null) ?? null,
        },
      ];
    })
  );
}

// =====================================================================
// draft 재계산 — 기간 내 새 확정 일지 반영(단일 진실: 근무일지 → 재계산).
// =====================================================================
export async function recalcSettlement(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    const { data: sett } = await supabaseAdmin
      .from(SETT)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!sett) return { ok: false, message: "정산을 찾을 수 없습니다." };
    const r = sett as Record<string, unknown>;
    if (r.status !== "draft")
      return { ok: false, message: "확정된 정산은 재계산할 수 없습니다." };

    // 기존 귀속 해제 + 항목 삭제 후 재수집(해제된 세션이 다시 대상에 포함됨).
    await supabaseAdmin.from(SESS).update({ settlement_id: null }).eq("settlement_id", id);
    await supabaseAdmin.from(ITEM).delete().eq("settlement_id", id);

    const { byInstructor, sessionIds } = await gatherEligible(
      String(r.project_id),
      String(r.period_start),
      String(r.period_end)
    );
    const itemRows = [...byInstructor].map(([instructorId, sessions]) => {
      const c = calcInstructorSettlement(sessions);
      return {
        settlement_id: id,
        instructor_id: instructorId,
        detail: c.detail,
        gross_amount: c.gross_amount,
        deduction_rate: c.deduction_rate,
        deduction_amount: c.deduction_amount,
        net_amount: c.net_amount,
      };
    });
    if (itemRows.length) await supabaseAdmin.from(ITEM).insert(itemRows);
    if (sessionIds.length)
      await supabaseAdmin.from(SESS).update({ settlement_id: id }).in("id", sessionIds);

    revalidatePath(`/hr/saems/settlements/${id}`);
    revalidatePath("/hr/saems/settlements");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "재계산 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 확정 / 확정취소(M0) / 삭제(draft)
// =====================================================================
export async function confirmSettlement(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const ctx = await requireSaemAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const { error } = await supabaseAdmin
      .from(SETT)
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        confirmed_by: ctx.name,
      })
      .eq("id", id)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    revalidatePath(`/hr/saems/settlements/${id}`);
    revalidatePath("/hr/saems/settlements");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "확정 중 오류가 발생했습니다.",
    };
  }
}

// 확정 취소 — M0 전용. 취소 시 세션 settlement_id 해제.
export async function unconfirmSettlement(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess({ onlyM0: true });
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const { error } = await supabaseAdmin
      .from(SETT)
      .update({ status: "draft", confirmed_at: null, confirmed_by: null })
      .eq("id", id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from(SESS).update({ settlement_id: null }).eq("settlement_id", id);
    revalidatePath(`/hr/saems/settlements/${id}`);
    revalidatePath("/hr/saems/settlements");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "확정 취소 중 오류가 발생했습니다.",
    };
  }
}

// 삭제 — draft 만. 세션 settlement_id 해제 후 items·settlement 삭제.
export async function deleteSettlement(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const { data: sett } = await supabaseAdmin
      .from(SETT)
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (!sett) return { ok: true };
    if ((sett as { status: string }).status !== "draft")
      return { ok: false, message: "확정된 정산은 삭제할 수 없습니다. (먼저 확정 취소)" };

    await supabaseAdmin.from(SESS).update({ settlement_id: null }).eq("settlement_id", id);
    await supabaseAdmin.from(ITEM).delete().eq("settlement_id", id);
    const { error } = await supabaseAdmin.from(SETT).delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/saems/settlements");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.",
    };
  }
}
