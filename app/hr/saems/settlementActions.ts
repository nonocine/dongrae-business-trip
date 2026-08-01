"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSaemAccess } from "@/lib/saemAccess";
import {
  calcInstructorSettlement,
  detailMethod,
  type SettlementSessionInput,
  type SettlementRevenueInput,
  type SettlementProgramDetail,
} from "@/lib/settlement";
import { normalizePayType } from "@/lib/saem";

const PROJ = "saem_projects";
const TERM = "saem_terms";
const PROG = "saem_programs";
const SESS = "saem_sessions";
const SETT = "saem_settlements";
const ITEM = "saem_settlement_items";
const INSTR = "saem_instructors";
const ENROLL = "saem_enrollments";

export type SettlementStatus = "draft" | "confirmed";

// 담당자 조정값 — (강사, 프로그램) 단위. 둘 다 null 이면 조정 해제.
export type SettlementAdjustment = {
  instructor_id: string;
  program_id: string;
  enrolled: number | null;
  amount: number | null;
};

type AdjustmentMap = Map<string, { enrolled: number | null; amount: number | null }>;
const adjKey = (instructorId: string, programId: string) =>
  `${instructorId}|${programId}`;

function toAdjustmentMap(list: SettlementAdjustment[] | undefined): AdjustmentMap {
  const map: AdjustmentMap = new Map();
  for (const a of list ?? []) {
    if (!a?.instructor_id || !a?.program_id) continue;
    const enrolled =
      a.enrolled == null || !Number.isFinite(Number(a.enrolled))
        ? null
        : Math.max(0, Math.round(Number(a.enrolled)));
    const amount =
      a.amount == null || !Number.isFinite(Number(a.amount))
        ? null
        : Math.max(0, Math.round(Number(a.amount)));
    if (enrolled == null && amount == null) continue; // 조정 해제
    map.set(adjKey(a.instructor_id, a.program_id), { enrolled, amount });
  }
  return map;
}

// 저장된 항목의 detail 에서 조정값을 되살린다(재계산 시 "유지" 선택용).
function adjustmentsFromItems(
  items: { instructor_id: string; detail: SettlementProgramDetail[] }[]
): AdjustmentMap {
  const map: AdjustmentMap = new Map();
  for (const it of items) {
    for (const d of it.detail) {
      if (d.adjusted !== true || !d.program_id) continue;
      // 저장된 amount 가 조정 결과. 인원도 함께 보존한다.
      map.set(adjKey(it.instructor_id, d.program_id), {
        enrolled: d.enrolled ?? null,
        amount: d.amount ?? null,
      });
    }
  }
  return map;
}

// =====================================================================
// 공용 로더 — 프로젝트+기간의 정산 대상을 강사별로 모은다.
//   * 시급제(hourly): 기간 내 session_date, staff_confirmed_at not null,
//     settlement_id is null(재계산 시 includeSettlementId 로 자기 정산분 포함).
//   * 분배제(revenue_share, ST-5): 일지 확정과 무관. 기간에 그 프로그램 세션이
//     1개 이상 있으면 대상. 금액 기준은 등록 인원(status='active')이다.
//     세션에 settlement_id 를 찍지 않으므로(미확정 일지를 잠그면 강사가 못 쓴다)
//     기간이 겹치는 다른 정산에 이미 들어간 프로그램은 제외해 중복 지급을 막는다.
//   * 두 경우 모두 강사가 배정된 프로그램만.
// =====================================================================
type ProgRow = {
  id: string;
  name: string;
  instructor_id: string;
  hourly_rate: number;
  deduction_rate: number;
  pay_type: string;
  share_rate: number;
  tuition: number;
};

// 기간이 겹치는 다른 정산이 이미 분배제로 정산한 program_id 집합.
async function revenueProgramsSettledElsewhere(
  projectId: string,
  periodStart: string,
  periodEnd: string,
  excludeSettlementId?: string
): Promise<Set<string>> {
  const taken = new Set<string>();
  // 겹침 조건: other.start <= end AND other.end >= start.
  const { data: setts } = await supabaseAdmin
    .from(SETT)
    .select("id")
    .eq("project_id", projectId)
    .lte("period_start", periodEnd)
    .gte("period_end", periodStart);
  const ids = (setts ?? [])
    .map((s) => String((s as { id: string }).id))
    .filter((id) => id !== excludeSettlementId);
  if (!ids.length) return taken;

  const { data: items } = await supabaseAdmin
    .from(ITEM)
    .select("detail")
    .in("settlement_id", ids);
  for (const it of items ?? []) {
    for (const d of parseDetail((it as { detail: unknown }).detail)) {
      if (detailMethod(d) === "revenue_share" && d.program_id)
        taken.add(d.program_id);
    }
  }
  return taken;
}

async function gatherEligible(
  projectId: string,
  periodStart: string,
  periodEnd: string,
  options?: { includeSettlementId?: string; adjustments?: AdjustmentMap }
): Promise<{
  byInstructor: Map<string, SettlementSessionInput[]>;
  revenueByInstructor: Map<string, SettlementRevenueInput[]>;
  sessionIds: string[];
  instructorIds: string[];
}> {
  const includeSettlementId = options?.includeSettlementId;
  const adjustments = options?.adjustments ?? new Map();
  const byInstructor = new Map<string, SettlementSessionInput[]>();
  const revenueByInstructor = new Map<string, SettlementRevenueInput[]>();
  const sessionIds: string[] = [];
  const empty = {
    byInstructor,
    revenueByInstructor,
    sessionIds,
    instructorIds: [] as string[],
  };

  const { data: terms } = await supabaseAdmin
    .from(TERM)
    .select("id")
    .eq("project_id", projectId);
  const termIds = (terms ?? []).map((t) => String((t as { id: string }).id));
  if (!termIds.length) return empty;

  const { data: progs } = await supabaseAdmin
    .from(PROG)
    .select(
      "id, name, instructor_id, hourly_rate, deduction_rate, pay_type, share_rate, tuition"
    )
    .in("term_id", termIds)
    .not("instructor_id", "is", null);
  const progRows = ((progs ?? []) as Record<string, unknown>[]).map(
    (p): ProgRow => ({
      id: String(p.id),
      name: String(p.name ?? ""),
      instructor_id: String(p.instructor_id),
      hourly_rate: Number(p.hourly_rate ?? 0),
      deduction_rate: Number(p.deduction_rate ?? 0),
      pay_type: normalizePayType(p.pay_type),
      share_rate: Number(p.share_rate ?? 0),
      tuition: Number(p.tuition ?? 0),
    })
  );
  if (!progRows.length) return empty;
  const progMap = new Map(progRows.map((p) => [p.id, p]));

  // 기간 내 세션 — 시급제 집계와 분배제 대상 판정에 함께 쓴다.
  const { data: sess } = await supabaseAdmin
    .from(SESS)
    .select(
      "id, program_id, session_date, work_hours, settlement_id, staff_confirmed_at"
    )
    .in(
      "program_id",
      progRows.map((p) => p.id)
    )
    .gte("session_date", periodStart)
    .lte("session_date", periodEnd);

  const revenueHasSession = new Set<string>();
  for (const row of (sess ?? []) as Record<string, unknown>[]) {
    const prog = progMap.get(String(row.program_id));
    if (!prog) continue;

    if (prog.pay_type === "revenue_share") {
      // 확정 여부와 무관하게 "기간에 세션이 있다"만 본다.
      revenueHasSession.add(prog.id);
      continue;
    }

    if (row.staff_confirmed_at == null) continue;
    const settId = (row.settlement_id as string | null) ?? null;
    const eligible =
      settId == null ||
      (includeSettlementId != null && settId === includeSettlementId);
    if (!eligible) continue;

    const list = byInstructor.get(prog.instructor_id) ?? [];
    list.push({
      program_id: prog.id,
      program_name: prog.name,
      hourly_rate: prog.hourly_rate,
      deduction_rate: prog.deduction_rate,
      work_hours: Number(row.work_hours ?? 0),
    });
    byInstructor.set(prog.instructor_id, list);
    sessionIds.push(String(row.id));
  }

  // --- 분배제 대상 프로그램 ---
  if (revenueHasSession.size) {
    const taken = await revenueProgramsSettledElsewhere(
      projectId,
      periodStart,
      periodEnd,
      includeSettlementId
    );
    const targets = [...revenueHasSession].filter((id) => !taken.has(id));
    if (targets.length) {
      // 등록 인원(active) 집계.
      const enrolled = new Map<string, number>();
      const { data: rows } = await supabaseAdmin
        .from(ENROLL)
        .select("program_id")
        .in("program_id", targets)
        .eq("status", "active");
      for (const r of rows ?? []) {
        const pid = String((r as { program_id: string }).program_id);
        enrolled.set(pid, (enrolled.get(pid) ?? 0) + 1);
      }

      for (const programId of targets) {
        const prog = progMap.get(programId);
        if (!prog) continue;
        const adj = adjustments.get(adjKey(prog.instructor_id, programId));
        const list = revenueByInstructor.get(prog.instructor_id) ?? [];
        list.push({
          program_id: programId,
          program_name: prog.name,
          deduction_rate: prog.deduction_rate,
          enrolled: enrolled.get(programId) ?? 0,
          tuition: prog.tuition,
          share_rate: prog.share_rate,
          adjusted_enrolled: adj?.enrolled ?? null,
          adjusted_amount: adj?.amount ?? null,
        });
        revenueByInstructor.set(prog.instructor_id, list);
      }
    }
  }

  const instructorIds = [
    ...new Set([...byInstructor.keys(), ...revenueByInstructor.keys()]),
  ];
  return { byInstructor, revenueByInstructor, sessionIds, instructorIds };
}

// 강사별 계산 결과 → items 행. 생성·재계산이 공용으로 쓴다.
function buildItemRows(
  settlementId: string,
  instructorIds: string[],
  byInstructor: Map<string, SettlementSessionInput[]>,
  revenueByInstructor: Map<string, SettlementRevenueInput[]>
) {
  return instructorIds.map((instructorId) => {
    const c = calcInstructorSettlement(
      byInstructor.get(instructorId) ?? [],
      revenueByInstructor.get(instructorId) ?? []
    );
    return {
      settlement_id: settlementId,
      instructor_id: instructorId,
      detail: c.detail,
      gross_amount: c.gross_amount,
      deduction_rate: c.deduction_rate,
      deduction_amount: c.deduction_amount,
      net_amount: c.net_amount,
      adjusted: c.adjusted,
    };
  });
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
  adjusted: boolean;
};
export type SettlementPreview = {
  rows: SettlementPreviewRow[];
  sessionCount: number;
  revenueProgramCount: number; // 분배제 대상 프로그램 수
  totalGross: number;
  totalDeduction: number;
  totalNet: number;
};

async function buildRows(
  instructorIds: string[],
  byInstructor: Map<string, SettlementSessionInput[]>,
  revenueByInstructor: Map<string, SettlementRevenueInput[]>
): Promise<SettlementPreviewRow[]> {
  const names = await instructorNameMap(instructorIds);
  const rows: SettlementPreviewRow[] = [];
  for (const instructorId of instructorIds) {
    const c = calcInstructorSettlement(
      byInstructor.get(instructorId) ?? [],
      revenueByInstructor.get(instructorId) ?? []
    );
    rows.push({
      instructor_id: instructorId,
      instructorName: names.get(instructorId) ?? "(이름 없음)",
      detail: c.detail,
      gross_amount: c.gross_amount,
      deduction_rate: c.deduction_rate,
      deduction_amount: c.deduction_amount,
      net_amount: c.net_amount,
      adjusted: c.adjusted,
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
  // 화면에서 조정한 값(저장 전). 넘기면 그 값으로 계산해 보여 준다.
  adjustments?: SettlementAdjustment[];
}): Promise<SettlementPreview> {
  await requireSaemAccess();
  const g = await gatherEligible(
    input.projectId,
    input.periodStart,
    input.periodEnd,
    { adjustments: toAdjustmentMap(input.adjustments) }
  );
  const rows = await buildRows(
    g.instructorIds,
    g.byInstructor,
    g.revenueByInstructor
  );
  const revenueProgramCount = [...g.revenueByInstructor.values()].reduce(
    (s, l) => s + l.length,
    0
  );
  return {
    rows,
    sessionCount: g.sessionIds.length,
    revenueProgramCount,
    ...totalsOf(rows),
  };
}

// =====================================================================
// 생성(draft) — items 생성 + 세션 settlement_id 기록
// =====================================================================
export async function createSettlement(input: {
  projectId: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  // 미리보기에서 조정한 분배제 항목(있으면 그대로 저장).
  adjustments?: SettlementAdjustment[];
}): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    const title = (input.title ?? "").trim();
    if (!input.projectId || !input.periodStart || !input.periodEnd)
      return { ok: false, message: "프로젝트·기간을 선택하세요." };
    if (!title) return { ok: false, message: "제목을 입력하세요." };
    if (input.periodStart > input.periodEnd)
      return { ok: false, message: "기간이 올바르지 않습니다." };

    const g = await gatherEligible(
      input.projectId,
      input.periodStart,
      input.periodEnd,
      { adjustments: toAdjustmentMap(input.adjustments) }
    );
    const { byInstructor, revenueByInstructor, sessionIds, instructorIds } = g;
    if (instructorIds.length === 0)
      return {
        ok: false,
        message:
          "대상이 없습니다. (확정된 미정산 근무일지도, 기간 내 분배제 프로그램도 없습니다)",
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

    const itemRows = buildItemRows(
      settId,
      instructorIds,
      byInstructor,
      revenueByInstructor
    );
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
  adjusted: boolean;
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
  adjustedCount: number; // 조정된 프로그램 항목 수(재계산 안내용)
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
    const detail = parseDetail(it.detail);
    return {
      instructor_id: String(it.instructor_id),
      instructorName: info?.name ?? "(이름 없음)",
      phone: info?.phone ?? null,
      bank_name: info?.bank_name ?? null,
      bank_account: info?.bank_account ?? null,
      account_holder: info?.account_holder ?? null,
      detail,
      gross_amount: Number(it.gross_amount ?? 0),
      deduction_rate: Number(it.deduction_rate ?? 0),
      deduction_amount: Number(it.deduction_amount ?? 0),
      net_amount: Number(it.net_amount ?? 0),
      // adjusted 컬럼이 없던 시기 대비 — detail 로도 판정한다.
      adjusted: it.adjusted === true || detail.some((d) => d.adjusted === true),
    };
  });
  items.sort((a, b) => a.instructorName.localeCompare(b.instructorName, "ko"));
  const adjustedCount = items.reduce(
    (n, it) => n + it.detail.filter((d) => d.adjusted === true).length,
    0
  );

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
    adjustedCount,
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
//   ST-5. keepAdjusted=true 면 기존 조정값(adjusted=true 항목)을 되살려 다시 적용한다.
//         false 면 전부 자동 계산으로 되돌린다. 화면이 "유지/초기화"를 물어 전달.
export async function recalcSettlement(
  id: string,
  options?: { keepAdjusted?: boolean }
): Promise<
  { ok: true; kept: number; adjustedLost: number } | { ok: false; message: string }
> {
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

    // 삭제 전에 기존 조정값을 확보한다(유지 선택 시 되살릴 근거).
    const { data: prevItems } = await supabaseAdmin
      .from(ITEM)
      .select("instructor_id, detail")
      .eq("settlement_id", id);
    const prevAdjustments = adjustmentsFromItems(
      ((prevItems ?? []) as Record<string, unknown>[]).map((it) => ({
        instructor_id: String(it.instructor_id),
        detail: parseDetail(it.detail),
      }))
    );
    const keep = options?.keepAdjusted === true;

    // 기존 귀속 해제 + 항목 삭제 후 재수집(해제된 세션이 다시 대상에 포함됨).
    await supabaseAdmin.from(SESS).update({ settlement_id: null }).eq("settlement_id", id);
    await supabaseAdmin.from(ITEM).delete().eq("settlement_id", id);

    const g = await gatherEligible(
      String(r.project_id),
      String(r.period_start),
      String(r.period_end),
      {
        // 위에서 귀속을 이미 해제했으므로 includeSettlementId 는 필요 없지만,
        // 분배제 중복 제외 판정에서 "자기 자신"을 빼야 하므로 넘긴다.
        includeSettlementId: id,
        adjustments: keep ? prevAdjustments : new Map(),
      }
    );
    const itemRows = buildItemRows(
      id,
      g.instructorIds,
      g.byInstructor,
      g.revenueByInstructor
    );
    if (itemRows.length) {
      const { error } = await supabaseAdmin.from(ITEM).insert(itemRows);
      if (error) throw new Error(error.message);
    }
    if (g.sessionIds.length)
      await supabaseAdmin
        .from(SESS)
        .update({ settlement_id: id })
        .in("id", g.sessionIds);

    // 실제로 되살아난 조정 수 / 대상이 사라져 유실된 조정 수.
    const kept = keep
      ? itemRows.reduce(
          (n, row) => n + row.detail.filter((d) => d.adjusted === true).length,
          0
        )
      : 0;
    const adjustedLost = keep ? Math.max(0, prevAdjustments.size - kept) : 0;

    revalidatePath(`/hr/saems/settlements/${id}`);
    revalidatePath("/hr/saems/settlements");
    return { ok: true, kept, adjustedLost };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "재계산 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// ST-5. 담당자 조정 — 분배제 항목의 인원 또는 금액을 직접 지정/해제.
//   draft 만 가능. 조정 후 항목 전체를 다시 계산해 공제·차인지급을 맞춘다.
//   시급제 항목은 조정하지 않는다(근무일지를 고쳐 재계산 — 단일 진실 원칙).
// =====================================================================
export async function adjustSettlementItem(input: {
  settlementId: string;
  instructorId: string;
  programId: string;
  enrolled: number | null;
  amount: number | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    const { settlementId, instructorId, programId } = input;
    if (!settlementId || !instructorId || !programId)
      return { ok: false, message: "대상이 없습니다." };

    const { data: sett } = await supabaseAdmin
      .from(SETT)
      .select("status")
      .eq("id", settlementId)
      .maybeSingle();
    if (!sett) return { ok: false, message: "정산을 찾을 수 없습니다." };
    if ((sett as { status: string }).status !== "draft")
      return { ok: false, message: "확정된 정산은 조정할 수 없습니다." };

    const { data: itemRow } = await supabaseAdmin
      .from(ITEM)
      .select("id, detail, instructor_id")
      .eq("settlement_id", settlementId)
      .eq("instructor_id", instructorId)
      .maybeSingle();
    if (!itemRow) return { ok: false, message: "정산 항목을 찾을 수 없습니다." };
    const detail = parseDetail((itemRow as { detail: unknown }).detail);
    const target = detail.find((d) => d.program_id === programId);
    if (!target)
      return { ok: false, message: "조정할 프로그램 내역을 찾을 수 없습니다." };
    if (detailMethod(target) !== "revenue_share")
      return {
        ok: false,
        message:
          "시급제 항목은 조정할 수 없습니다. 근무일지를 고친 뒤 재계산하세요.",
      };
    if (target.tuition == null || target.share_rate == null)
      return { ok: false, message: "분배 기준(수강료·비율)이 없어 조정할 수 없습니다." };

    // 이 항목의 모든 분배제 내역을 계산 입력으로 되돌린 뒤, 대상만 조정값을 바꾼다.
    //   (시급제 내역은 저장된 금액을 그대로 유지해야 하므로 세션을 다시 읽지 않고
    //    저장된 detail 값을 그대로 쓰는 합성 입력을 만든다.)
    const revenue: SettlementRevenueInput[] = [];
    const hourly: SettlementSessionInput[] = [];
    for (const d of detail) {
      if (detailMethod(d) === "revenue_share") {
        const isTarget = d.program_id === programId;
        const autoEnrolled = d.auto_enrolled ?? d.enrolled ?? 0;
        const adj = isTarget
          ? { enrolled: input.enrolled, amount: input.amount }
          : {
              enrolled: d.adjusted === true ? d.enrolled ?? null : null,
              amount: d.adjusted === true ? d.amount ?? null : null,
            };
        revenue.push({
          program_id: d.program_id ?? "",
          program_name: d.program_name,
          deduction_rate: d.deduction_rate ?? 0,
          enrolled: autoEnrolled,
          tuition: d.tuition ?? 0,
          share_rate: d.share_rate ?? 0,
          adjusted_enrolled: adj.enrolled,
          adjusted_amount: adj.amount,
        });
      } else {
        // 시급제 — 저장된 금액을 재현하는 1건 입력(hours×rate = amount).
        hourly.push({
          program_id: d.program_id ?? d.program_name,
          program_name: d.program_name,
          hourly_rate: d.rate ?? 0,
          deduction_rate: d.deduction_rate ?? 0,
          work_hours: d.hours ?? 0,
        });
      }
    }
    const c = calcInstructorSettlement(hourly, revenue);
    // 시급제 회차 수(sessions)는 세션에서만 알 수 있으므로 저장된 값을 되살린다.
    const prevSessions = new Map(
      detail
        .filter((d) => detailMethod(d) === "hourly")
        .map((d) => [d.program_id ?? d.program_name, d.sessions])
    );
    for (const d of c.detail) {
      if (detailMethod(d) !== "hourly") continue;
      const s = prevSessions.get(d.program_id ?? d.program_name);
      if (s != null) d.sessions = s;
    }

    const { error } = await supabaseAdmin
      .from(ITEM)
      .update({
        detail: c.detail,
        gross_amount: c.gross_amount,
        deduction_rate: c.deduction_rate,
        deduction_amount: c.deduction_amount,
        net_amount: c.net_amount,
        adjusted: c.adjusted,
      })
      .eq("id", String((itemRow as { id: string }).id));
    if (error) throw new Error(error.message);

    revalidatePath(`/hr/saems/settlements/${settlementId}`);
    revalidatePath("/hr/saems/settlements");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "조정 중 오류가 발생했습니다.",
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
