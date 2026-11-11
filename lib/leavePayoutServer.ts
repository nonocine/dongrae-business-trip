import "server-only";

// =====================================================================
// 연차수당 산정 — 서버 전용(leave_payout_runs / leave_payout_lines, RLS on·정책 0 → service_role).
//   * 접근: 관장(M0)·hr 직무·erp_finance 직무. 확정·무효는 관장(M0)만. 이 게이트가 유일한 방어선입니다.
//   * 줄 만들기(planPayoutLines)는 읽기만 합니다 — DB 쓰기는 createPayoutRun 에서만.
//     a) first_year_monthly : 그 해 입사자(join_date 가 그 해)의 ERP 연차 잔여(=첫해 월차 12/31 리셋분)
//     b) annual_unpromoted  : 회계연도 연차 잔여가 있는데 그 해 track=annual 1·2차가 모두 완료 근거
//                             (서명 수령본 또는 ERP 문서)를 갖추지 못한 직원
//     c) annual_promoted    : 1·2차 모두 완료 — 줄은 만들되 excluded, 사유 "사용촉진 완료(제61조)"
//     ERP 잔여가 없으면 unused_source='manual'(0일로 만들고 담당자가 입력).
//   * 통상임금: 그 해 연봉계약서 중 '체결 완료'(lib/contractCore isFinalized — 직원·센터장 서명 + PDF)의
//     가장 최근 것, 12월이 든 구간. 금액은 '구간 합계'라 ÷ 개월 수로 월액(lib/leavePayout).
//   * employee_id = employee_profiles.id(연차 사용촉진 표와 같은 기준), created_by/confirmed_by = drivers.id.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { currentAssignment } from "@/lib/appointments";
import { isFinalized, toStatus } from "@/lib/contractCore";
import { listRolesForDriver } from "@/lib/employeeRolesServer";
import { erpLastSyncedAt, leaveBalancesOf, loadDutiesOverlapping, resolveErpViewer, type ErpViewer } from "@/lib/erp/view";
import { kstTodayYmd, kstYmdOf } from "@/lib/erp/duty";
import { isFirstYear, noticeCompleted } from "@/lib/leavePromotion";
import { isPayoutStaffVisible } from "@/lib/leaveSettings";
import {
  PROMOTED_EXCLUDE_REASON,
  calcPayout,
  monthlyItemsFromContract,
  normalizeWageBasis,
  roundHalfDay,
  type ContractSegmentLike,
  type PayoutCategory,
  type WageBasis,
  type WageItemValue,
} from "@/lib/leavePayout";

export const RUNS = "leave_payout_runs";
export const LINES = "leave_payout_lines";

// --- 접근 -----------------------------------------------------------------
export type PayoutAccess = ErpViewer & { canConfirm: boolean };
export async function resolvePayoutAccess(): Promise<PayoutAccess | null> {
  const v = await resolveErpViewer();
  if (!v) return null;
  const roles = v.driverId ? await listRolesForDriver(v.driverId) : [];
  if (!v.isM0 && !roles.includes("hr") && !roles.includes("erp_finance")) return null;
  return { ...v, canConfirm: v.isM0 };
}
export async function requirePayoutAccess(): Promise<PayoutAccess> {
  const a = await resolvePayoutAccess();
  if (!a) throw new Error("연차수당 산정 권한이 없습니다. (관장·부장·인사·ERP 재무 담당)");
  return a;
}

// --- 줄 계획(읽기만) -----------------------------------------------------------
export type CalcSnapshot = {
  basis_date: string; // 산정 기준일(만든 날)
  erp_synced_at: string | null;
  erp_remaining: number | null;
  planned_days: number; // 12/31 까지 결재 진행 중 연가(예정 사용) — 자동 차감하지 않음
  planned_deducted: boolean;
  contract: { id: string; contract_date: string | null; segment: string | null } | null;
  items: WageItemValue[];
  included: string[];
  monthly: number | null;
  hourly: number | null;
  daily: number | null;
  days: number;
  amount: number;
  formula: string | null;
  errors: string[];
  join_date: string | null;
};

export type PlannedLine = {
  employee_id: string; // employee_profiles.id
  driver_id: string;
  name: string;
  department: string | null;
  category: PayoutCategory;
  unused_days: number;
  unused_source: "erp" | "manual";
  excluded: boolean;
  exclude_reason: string | null;
  monthly_ordinary_wage: number | null;
  hourly_ordinary_wage: number | null;
  daily_ordinary_wage: number | null;
  amount: number;
  calc_snapshot: CalcSnapshot;
};

type ContractRow = Record<string, unknown>;

function pickContract(rows: ContractRow[]): ContractRow | null {
  const fin = rows.filter((c) =>
    isFinalized({ status: toStatus(c.status), employer_signed_at: (c.employer_signed_at as string | null) ?? null, has_pdf: !!c.contract_pdf_url })
  );
  fin.sort((a, b) =>
    String(b.contract_date ?? b.created_at ?? "").localeCompare(String(a.contract_date ?? a.created_at ?? ""))
  );
  return fin[0] ?? null;
}

export function snapshotCalc(snap: CalcSnapshot, basis: WageBasis, days: number): CalcSnapshot {
  if (!snap.items.length) return { ...snap, days: roundHalfDay(days), amount: 0, included: [] };
  const c = calcPayout(snap.items, basis, days);
  return {
    ...snap,
    included: snap.items.filter((i) => basis[i.key]).map((i) => i.key),
    monthly: c.monthly,
    hourly: c.hourly,
    daily: c.daily,
    days: roundHalfDay(days),
    amount: c.amount,
    formula: c.formula,
  };
}

export async function planPayoutLines(year: number, basisIn?: unknown): Promise<PlannedLine[]> {
  const basis = normalizeWageBasis(basisIn);
  const today = kstTodayYmd();
  const [{ data: drivers }, { data: profs }, { data: notices }, { data: contracts }, synced] = await Promise.all([
    supabaseAdmin.from("drivers").select("id, name, is_active"),
    supabaseAdmin.from("employee_profiles").select("id, driver_id, employment_status, join_date, appointments, erp_employee_id"),
    supabaseAdmin
      .from("leave_promotion_notices")
      .select("employee_id, stage, delivery_method, signed_receipt_path, erp_document_id")
      .eq("year", year)
      .eq("track", "annual"),
    supabaseAdmin
      .from("salary_contracts")
      .select("id, driver_id, status, employer_signed_at, contract_pdf_url, contract_date, created_at, segments")
      .eq("year", year),
    erpLastSyncedAt("leaveBalances"),
  ]);
  const drv = new Map(((drivers ?? []) as { id: string; name: string; is_active: boolean | null }[]).map((d) => [d.id, d]));
  const people = ((profs ?? []) as Record<string, unknown>[]).filter((p) => {
    const d = drv.get(String(p.driver_id));
    return d && d.is_active !== false && p.employment_status !== "resigned";
  });
  const erpIds = people.map((p) => p.erp_employee_id).filter((v): v is string => typeof v === "string" && !!v);
  const bal = await leaveBalancesOf(erpIds);

  // 12/31 까지 결재 진행 중인 연가(예정 사용) — 오늘~연말, 진행(1)만.
  const planned = new Map<string, number>();
  if (today <= `${year}-12-31`) {
    const duties = await loadDutiesOverlapping(today > `${year}-01-01` ? today : `${year}-01-01`, `${year}-12-31`);
    for (const d of duties) {
      if ((d.type_name ?? "").trim() !== "연가" || d.process_code !== 1 || !d.start_at) continue;
      const s = kstYmdOf(d.start_at);
      if (s < today || s > `${year}-12-31`) continue;
      const amt = d.declared_amount == null ? 1 : Number(d.declared_amount);
      for (const id of d.employee_ids) planned.set(id, (planned.get(id) ?? 0) + amt);
    }
  }

  // 사용촉진 완료 — track=annual 1·2차 모두 완료 근거.
  const done = new Map<string, Set<number>>();
  for (const n of (notices ?? []) as Record<string, unknown>[]) {
    if (!noticeCompleted(n as never)) continue;
    const s = done.get(String(n.employee_id)) ?? new Set<number>();
    s.add(Number(n.stage));
    done.set(String(n.employee_id), s);
  }
  const contractsBy = new Map<string, ContractRow[]>();
  for (const c of (contracts ?? []) as ContractRow[]) {
    const k = String(c.driver_id);
    contractsBy.set(k, [...(contractsBy.get(k) ?? []), c]);
  }

  const out: PlannedLine[] = [];
  for (const p of people) {
    const profileId = String(p.id);
    const driverId = String(p.driver_id);
    const joinDate = typeof p.join_date === "string" && p.join_date ? p.join_date.slice(0, 10) : null;
    const erpId = typeof p.erp_employee_id === "string" ? p.erp_employee_id : null;
    const remaining = erpId ? bal.get(erpId)?.annual ?? null : null;
    const firstYear = isFirstYear(joinDate, year);
    const promoted = (done.get(profileId)?.has(1) && done.get(profileId)?.has(2)) ?? false;
    if (remaining != null && remaining <= 0) continue; // 남은 연차 없음
    const category: PayoutCategory = firstYear ? "first_year_monthly" : promoted ? "annual_promoted" : "annual_unpromoted";
    const source: "erp" | "manual" = remaining == null ? "manual" : "erp";
    const days = roundHalfDay(remaining ?? 0);

    const errors: string[] = [];
    if (source === "manual") errors.push(erpId ? "ERP 연차 잔여 없음 — 직접 입력" : "ERP 계정 미연결 — 직접 입력");
    const contract = pickContract(contractsBy.get(driverId) ?? []);
    let items: WageItemValue[] = [];
    let segment: string | null = null;
    if (!contract) errors.push(`${year}년 체결 완료된 연봉계약서 없음 — 통상임금 계산 불가`);
    else {
      const segs = Array.isArray(contract.segments) ? (contract.segments as ContractSegmentLike[]) : [];
      const r = monthlyItemsFromContract(segs);
      items = r.items;
      segment = r.segment ? `${r.segment.start_month}~${r.segment.end_month}월` : null;
      if (!items.length) errors.push("연봉계약서에 급여 구간이 없음");
    }
    const base: CalcSnapshot = {
      basis_date: today,
      erp_synced_at: synced,
      erp_remaining: remaining,
      planned_days: erpId ? planned.get(erpId) ?? 0 : 0,
      planned_deducted: false,
      contract: contract ? { id: String(contract.id), contract_date: (contract.contract_date as string | null) ?? null, segment } : null,
      items,
      included: [],
      monthly: null,
      hourly: null,
      daily: null,
      days,
      amount: 0,
      formula: null,
      errors,
      join_date: joinDate,
    };
    const snap = snapshotCalc(base, basis, days);
    out.push({
      employee_id: profileId,
      driver_id: driverId,
      name: drv.get(driverId)?.name ?? "(이름 없음)",
      department: currentAssignment(p.appointments, today).current?.department ?? null,
      category,
      unused_days: days,
      unused_source: source,
      excluded: category === "annual_promoted",
      exclude_reason: category === "annual_promoted" ? PROMOTED_EXCLUDE_REASON : null,
      monthly_ordinary_wage: snap.monthly,
      hourly_ordinary_wage: snap.hourly,
      daily_ordinary_wage: snap.daily,
      amount: snap.amount,
      calc_snapshot: snap,
    });
  }
  return out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, "ko"));
}

// --- 산정표 읽기 ---------------------------------------------------------------
export type PayoutRun = {
  id: string;
  year: number;
  title: string;
  status: "draft" | "confirmed" | "void";
  wage_basis: WageBasis;
  note: string | null;
  created_at: string;
  confirmed_at: string | null;
};
export type PayoutLineRow = Omit<PlannedLine, "driver_id" | "name" | "department"> & {
  id: string;
  name: string;
  department: string | null;
};

export async function loadPayoutRun(year: number): Promise<{ run: PayoutRun | null; lines: PayoutLineRow[]; history: PayoutRun[] }> {
  const { data: runs } = await supabaseAdmin.from(RUNS).select("*").eq("year", year).order("created_at", { ascending: false });
  const all = ((runs ?? []) as Record<string, unknown>[]).map(
    (r): PayoutRun => ({
      id: String(r.id),
      year: Number(r.year),
      title: String(r.title ?? ""),
      status: r.status === "confirmed" ? "confirmed" : r.status === "void" ? "void" : "draft",
      wage_basis: normalizeWageBasis(r.wage_basis),
      note: (r.note as string | null) ?? null,
      created_at: String(r.created_at ?? ""),
      confirmed_at: (r.confirmed_at as string | null) ?? null,
    })
  );
  const run = all.find((r) => r.status !== "void") ?? null;
  if (!run) return { run: null, lines: [], history: all };
  const { data: lines } = await supabaseAdmin.from(LINES).select("*").eq("run_id", run.id);
  const profIds = [...new Set(((lines ?? []) as { employee_id: string }[]).map((l) => l.employee_id))];
  const { data: profs } = profIds.length
    ? await supabaseAdmin.from("employee_profiles").select("id, driver_id, appointments").in("id", profIds)
    : { data: [] };
  const profMap = new Map(((profs ?? []) as { id: string; driver_id: string; appointments: unknown }[]).map((p) => [p.id, p]));
  const dIds = [...new Set([...profMap.values()].map((p) => p.driver_id))];
  const { data: drv } = dIds.length ? await supabaseAdmin.from("drivers").select("id, name").in("id", dIds) : { data: [] };
  const nameOf = new Map(((drv ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name]));
  const today = kstTodayYmd();
  return {
    run,
    history: all,
    lines: ((lines ?? []) as Record<string, unknown>[])
      .map((l): PayoutLineRow => {
        const pr = profMap.get(String(l.employee_id));
        return {
          id: String(l.id),
          employee_id: String(l.employee_id),
          name: pr ? nameOf.get(pr.driver_id) ?? "(이름 없음)" : "(이름 없음)",
          department: pr ? currentAssignment(pr.appointments, today).current?.department ?? null : null,
          category: (String(l.category) as PayoutCategory) || "annual_unpromoted",
          unused_days: Number(l.unused_days ?? 0),
          unused_source: l.unused_source === "manual" ? "manual" : "erp",
          excluded: l.excluded === true,
          exclude_reason: (l.exclude_reason as string | null) ?? null,
          monthly_ordinary_wage: l.monthly_ordinary_wage == null ? null : Number(l.monthly_ordinary_wage),
          hourly_ordinary_wage: l.hourly_ordinary_wage == null ? null : Number(l.hourly_ordinary_wage),
          daily_ordinary_wage: l.daily_ordinary_wage == null ? null : Number(l.daily_ordinary_wage),
          amount: Number(l.amount ?? 0),
          calc_snapshot: (l.calc_snapshot ?? {}) as CalcSnapshot,
        };
      })
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, "ko")),
  };
}

// --- 직원 노출(지금은 꺼짐) -------------------------------------------------------
//   leave_payout_staff_visible='true' 일 때만, 확정(confirmed)된 산정표의 본인 줄(제외 아님)만.
export async function myLeavePayout(driverId: string | null, year: number): Promise<{ days: number; amount: number } | null> {
  if (!driverId) return null;
  if (!(await isPayoutStaffVisible())) return null;
  const { data: prof } = await supabaseAdmin.from("employee_profiles").select("id").eq("driver_id", driverId).maybeSingle();
  const profileId = (prof as { id?: string } | null)?.id;
  if (!profileId) return null;
  const { data: run } = await supabaseAdmin
    .from(RUNS)
    .select("id")
    .eq("year", year)
    .eq("status", "confirmed")
    .order("confirmed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const runId = (run as { id?: string } | null)?.id;
  if (!runId) return null;
  const { data: lines } = await supabaseAdmin
    .from(LINES)
    .select("unused_days, amount, excluded")
    .eq("run_id", runId)
    .eq("employee_id", profileId)
    .eq("excluded", false);
  const ls = (lines ?? []) as { unused_days: number; amount: number }[];
  if (!ls.length) return null;
  return {
    days: ls.reduce((a, l) => a + Number(l.unused_days ?? 0), 0),
    amount: ls.reduce((a, l) => a + Number(l.amount ?? 0), 0),
  };
}
