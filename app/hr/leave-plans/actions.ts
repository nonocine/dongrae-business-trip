"use server";

// =====================================================================
// 연차 사용촉진(미사용 연차 사용계획서) — 담당자 액션. LP-1 발부 / LP-3 현황·출력
//   * 접근: M0(관장·부장) 또는 accounting(회계) 직무 — 급여 게이트를 그대로
//     재사용한다(새 직무 만들지 않음). 모든 액션이 진입 시 재검증.
//   * leave_plan_requests 는 RLS on·정책 0 → service_role 경유. 이 게이트가
//     유일한 방어선이다.
//   * 슬랙 DM 은 부가기능 — 실패해도 발부·독촉 자체는 진행한다.
// =====================================================================

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSalaryAccess } from "@/lib/salaryAccess";
import { sendSlackDM, siteBaseUrl, slackLink } from "@/lib/slack";
import { kstTodayYmd } from "@/lib/trainings";
import {
  normalizeLeavePlan,
  roundHalf,
  sumLeavePlan,
  formatDays,
  isYmd,
  type LeavePlanEntry,
} from "@/lib/leavePlan";

const REQ = "leave_plan_requests";
const DRV = "drivers";
const PROF = "employee_profiles";

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length ? s : null;
}

// 직원이 계획서를 작성하는 화면(마이페이지 연차 탭).
function planPageUrl(): string {
  const base = siteBaseUrl();
  return base ? `${base}/profile/hr#leave-plan` : "/profile/hr#leave-plan";
}

// =====================================================================
// 재직자 명단(+이메일·부서) — 발부 대상 후보.
//   부서는 증명서 모듈과 같은 규칙: 최신 발령의 부서, 없으면 직급으로 폴백.
// =====================================================================
export type LeavePlanEmployee = {
  driver_id: string;
  name: string;
  email: string | null;
  department: string | null;
};

function pickDepartment(appointments: unknown): string | null {
  if (!Array.isArray(appointments) || appointments.length === 0) return null;
  const sorted = [...appointments].sort((a, b) =>
    String((a as { effective_date?: string }).effective_date ?? "").localeCompare(
      String((b as { effective_date?: string }).effective_date ?? "")
    )
  );
  const last = sorted[sorted.length - 1] as { department?: string };
  return last?.department?.trim() || null;
}

async function loadRoster(): Promise<LeavePlanEmployee[]> {
  const [{ data: drivers, error: dErr }, { data: profs, error: pErr }] =
    await Promise.all([
      supabaseAdmin.from(DRV).select("id, name, rank, is_active"),
      supabaseAdmin
        .from(PROF)
        .select("driver_id, employment_status, email, appointments"),
    ]);
  if (dErr) throw new Error(dErr.message);
  if (pErr) throw new Error(pErr.message);

  const profByDriver = new Map<
    string,
    { status: string; email: string | null; department: string | null }
  >();
  for (const p of profs ?? []) {
    const r = p as Record<string, unknown>;
    profByDriver.set(String(r.driver_id ?? ""), {
      status: String(r.employment_status ?? "active"),
      email: (r.email as string | null) ?? null,
      department: pickDepartment(r.appointments),
    });
  }

  const out: LeavePlanEmployee[] = [];
  for (const d of drivers ?? []) {
    const r = d as Record<string, unknown>;
    const id = String(r.id ?? "");
    if (!id) continue;
    if (r.is_active === false) continue;
    const prof = profByDriver.get(id);
    if (prof?.status === "resigned") continue;
    out.push({
      driver_id: id,
      name: String(r.name ?? ""),
      email: prof?.email ?? null,
      // 발령 부서 없으면 직급 표기(증명서 모듈과 동일 폴백).
      department: prof?.department ?? clean(r.rank as string | null),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

// =====================================================================
// 조회 — 연도별 현황
// =====================================================================
export type LeavePlanRow = {
  id: string;
  year: number;
  employee_id: string;
  name: string;
  department: string | null;
  email: string | null;
  unused_days: number;
  period_start: string | null;
  period_end: string | null;
  plan: LeavePlanEntry[];
  total_days: number | null;
  submitted_at: string | null;
  issued_by: string | null;
  created_at: string | null;
};

export type LeavePlanOverview = {
  year: number;
  years: number[]; // 데이터가 있는 연도(내림차순) + 올해
  rows: LeavePlanRow[]; // 발부된 건(제출 여부 무관)
  roster: LeavePlanEmployee[]; // 재직자 전체(발부 모달용)
  issuedCount: number;
  submittedCount: number;
  pendingNames: string[]; // 미제출자
  isM0: boolean;
};

function toRow(
  r: Record<string, unknown>,
  emp: LeavePlanEmployee | undefined
): LeavePlanRow {
  return {
    id: String(r.id ?? ""),
    year: Number(r.year ?? 0),
    employee_id: String(r.employee_id ?? ""),
    name: emp?.name ?? "(퇴직·삭제된 직원)",
    department: emp?.department ?? null,
    email: emp?.email ?? null,
    unused_days: Number(r.unused_days ?? 0),
    period_start: (r.period_start as string | null) ?? null,
    period_end: (r.period_end as string | null) ?? null,
    plan: normalizeLeavePlan(r.plan),
    total_days: r.total_days == null ? null : Number(r.total_days),
    submitted_at: (r.submitted_at as string | null) ?? null,
    issued_by: (r.issued_by as string | null) ?? null,
    created_at: (r.created_at as string | null) ?? null,
  };
}

export async function getLeavePlanOverview(
  yearInput?: number
): Promise<LeavePlanOverview> {
  const ctx = await requireSalaryAccess();
  const thisYear = Number(kstTodayYmd().slice(0, 4));

  const { data: yearRows } = await supabaseAdmin.from(REQ).select("year");
  const years = [
    ...new Set([
      thisYear,
      ...((yearRows ?? []).map((r) => Number((r as { year: number }).year)) ?? []),
    ]),
  ]
    .filter((y) => Number.isFinite(y) && y > 0)
    .sort((a, b) => b - a);

  const year =
    yearInput && Number.isFinite(yearInput) && yearInput > 0
      ? Math.round(yearInput)
      : years[0] ?? thisYear;

  const [roster, { data: reqs, error }] = await Promise.all([
    loadRoster(),
    supabaseAdmin.from(REQ).select("*").eq("year", year),
  ]);
  if (error) throw new Error(error.message);

  const empById = new Map(roster.map((e) => [e.driver_id, e]));
  const rows = ((reqs ?? []) as Record<string, unknown>[])
    .map((r) => toRow(r, empById.get(String(r.employee_id ?? ""))))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const submittedCount = rows.filter((r) => r.submitted_at != null).length;
  return {
    year,
    years,
    rows,
    roster,
    issuedCount: rows.length,
    submittedCount,
    pendingNames: rows
      .filter((r) => r.submitted_at == null)
      .map((r) => r.name),
    isM0: ctx.isM0,
  };
}

// =====================================================================
// LP-1. 발부 — 선택한 직원에게 미사용 일수·잔여기간을 지정해 계획서를 낸다.
//   * 이미 발부된 직원: 미제출이면 일수·기간을 갱신(재발부), 제출된 건은 건너뛴다
//     (담당자가 먼저 제출 취소해야 한다 — 제출본을 조용히 덮지 않는다).
//   * unique(year, employee_id) 를 upsert 로 사용.
// =====================================================================
export type IssueTarget = {
  employeeId: string;
  unusedDays: number;
  periodStart: string | null;
  periodEnd: string | null;
};

export type IssueResult =
  | {
      ok: true;
      issued: number; // 신규 발부
      updated: number; // 미제출 건 갱신
      skipped: string[]; // 제출됨 → 건너뜀
      dmSent: number;
      dmFailed: string[]; // 슬랙 미연결·실패 직원명
    }
  | { ok: false; message: string };

export async function issueLeavePlans(input: {
  year: number;
  targets: IssueTarget[];
}): Promise<IssueResult> {
  try {
    const ctx = await requireSalaryAccess();
    const year = Math.round(Number(input.year));
    if (!Number.isFinite(year) || year <= 0)
      return { ok: false, message: "연도를 확인하세요." };
    const targets = (input.targets ?? []).filter((t) => t?.employeeId);
    if (!targets.length)
      return { ok: false, message: "발부할 직원을 선택하세요." };

    // 대상이 재직자인지 서버에서 재확인(화면 값만 믿지 않음).
    const roster = await loadRoster();
    const empById = new Map(roster.map((e) => [e.driver_id, e]));
    for (const t of targets) {
      if (!empById.has(t.employeeId))
        return { ok: false, message: "재직자가 아닌 대상이 포함되어 있습니다." };
      if (t.periodStart && !isYmd(t.periodStart))
        return { ok: false, message: "잔여기간 시작일 형식이 올바르지 않습니다." };
      if (t.periodEnd && !isYmd(t.periodEnd))
        return { ok: false, message: "잔여기간 종료일 형식이 올바르지 않습니다." };
      if (t.periodStart && t.periodEnd && t.periodStart > t.periodEnd)
        return { ok: false, message: "잔여기간이 올바르지 않습니다." };
      if (roundHalf(t.unusedDays) <= 0)
        return {
          ok: false,
          message: `${empById.get(t.employeeId)?.name ?? "대상"}의 미사용 일수를 0보다 크게 입력하세요.`,
        };
    }

    // 기존 발부 상태.
    const { data: existing, error: exErr } = await supabaseAdmin
      .from(REQ)
      .select("id, employee_id, submitted_at")
      .eq("year", year)
      .in(
        "employee_id",
        targets.map((t) => t.employeeId)
      );
    if (exErr) throw new Error(exErr.message);
    const prevById = new Map(
      ((existing ?? []) as Record<string, unknown>[]).map((r) => [
        String(r.employee_id),
        {
          id: String(r.id),
          submitted: r.submitted_at != null,
        },
      ])
    );

    let issued = 0;
    let updated = 0;
    const skipped: string[] = [];
    const toNotify: LeavePlanEmployee[] = [];

    for (const t of targets) {
      const emp = empById.get(t.employeeId)!;
      const prev = prevById.get(t.employeeId);
      if (prev?.submitted) {
        skipped.push(emp.name);
        continue;
      }
      const payload = {
        year,
        employee_id: t.employeeId,
        unused_days: roundHalf(t.unusedDays),
        period_start: clean(t.periodStart),
        period_end: clean(t.periodEnd),
        issued_by: ctx.name,
      };
      if (prev) {
        const { error } = await supabaseAdmin
          .from(REQ)
          .update(payload)
          .eq("id", prev.id);
        if (error) throw new Error(error.message);
        updated++;
      } else {
        const { error } = await supabaseAdmin
          .from(REQ)
          .insert({ ...payload, plan: [], total_days: null });
        if (error) throw new Error(error.message);
        issued++;
      }
      toNotify.push(emp);
    }

    // 슬랙 DM — 부가기능. 실패해도 발부는 이미 끝났다.
    let dmSent = 0;
    const dmFailed: string[] = [];
    const link = slackLink(planPageUrl(), "지금 작성하기");
    for (const emp of toNotify) {
      const text =
        `📝 ${emp.name}님, ${year}년 미사용 연차 사용계획서를 작성해주세요.\n` +
        `• 미사용 연차 ${formatDays(
          roundHalf(targets.find((t) => t.employeeId === emp.driver_id)!.unusedDays)
        )}일\n` +
        `• ${link}`;
      const ok = await sendSlackDM(emp.email, text);
      if (ok) dmSent++;
      else dmFailed.push(emp.name);
    }

    revalidatePath("/hr/leave-plans");
    revalidatePath("/profile/hr");
    revalidatePath("/");
    return { ok: true, issued, updated, skipped, dmSent, dmFailed };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "발부 중 오류가 발생했습니다.",
    };
  }
}

// 발부 취소(회수) — 아직 제출 전인 건만 지운다.
export async function revokeLeavePlan(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSalaryAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const { data, error } = await supabaseAdmin
      .from(REQ)
      .delete()
      .eq("id", id)
      .is("submitted_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if ((data ?? []).length === 0)
      return {
        ok: false,
        message: "제출된 계획서는 회수할 수 없습니다. 먼저 제출 취소하세요.",
      };
    revalidatePath("/hr/leave-plans");
    revalidatePath("/profile/hr");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "회수 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// LP-3. 제출 취소 — 직원이 다시 수정할 수 있게 submitted_at 을 비운다.
//   계획 내용(plan)은 남겨 두어 직원이 이어서 고칠 수 있게 한다.
// =====================================================================
export async function unsubmitLeavePlan(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSalaryAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const { data, error } = await supabaseAdmin
      .from(REQ)
      .update({ submitted_at: null })
      .eq("id", id)
      .not("submitted_at", "is", null)
      .select("id");
    if (error) throw new Error(error.message);
    if ((data ?? []).length === 0)
      return { ok: false, message: "제출된 계획서가 아닙니다." };
    revalidatePath("/hr/leave-plans");
    revalidatePath("/profile/hr");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "제출 취소 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// LP-3. 미제출 독촉 — 미제출자에게 슬랙 DM 일괄(의무교육 독촉 패턴).
// =====================================================================
export async function remindLeavePlans(
  year: number
): Promise<
  | { ok: true; targets: number; dmSent: number; dmFailed: string[] }
  | { ok: false; message: string }
> {
  try {
    await requireSalaryAccess();
    const y = Math.round(Number(year));
    if (!Number.isFinite(y) || y <= 0)
      return { ok: false, message: "연도를 확인하세요." };

    const [roster, { data: reqs, error }] = await Promise.all([
      loadRoster(),
      supabaseAdmin
        .from(REQ)
        .select("employee_id, unused_days, period_end, submitted_at")
        .eq("year", y)
        .is("submitted_at", null),
    ]);
    if (error) throw new Error(error.message);
    const empById = new Map(roster.map((e) => [e.driver_id, e]));

    const targets = ((reqs ?? []) as Record<string, unknown>[])
      .map((r) => ({
        emp: empById.get(String(r.employee_id ?? "")),
        unused: Number(r.unused_days ?? 0),
        periodEnd: (r.period_end as string | null) ?? null,
      }))
      .filter((t): t is { emp: LeavePlanEmployee; unused: number; periodEnd: string | null } =>
        Boolean(t.emp)
      );
    if (targets.length === 0)
      return { ok: false, message: "미제출자가 없습니다." };

    let dmSent = 0;
    const dmFailed: string[] = [];
    const link = slackLink(planPageUrl(), "지금 작성하기");
    for (const t of targets) {
      const text =
        `⏰ ${t.emp.name}님, ${y}년 미사용 연차 사용계획서가 아직 제출되지 않았습니다.\n` +
        `• 미사용 연차 ${formatDays(t.unused)}일` +
        (t.periodEnd ? ` · 잔여기간 ${t.periodEnd}까지` : "") +
        `\n• ${link}`;
      const ok = await sendSlackDM(t.emp.email, text);
      if (ok) dmSent++;
      else dmFailed.push(t.emp.name);
    }

    return { ok: true, targets: targets.length, dmSent, dmFailed };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "독촉 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 엑셀 출력용 로더 — 라우트가 자체 권한 검증 후 호출한다.
//   employeeId 를 주면 그 1명, 없으면 그 연도 발부 전체.
// =====================================================================
export async function loadLeavePlansForExport(input: {
  year: number;
  employeeId?: string;
}): Promise<LeavePlanRow[]> {
  await requireSalaryAccess();
  const year = Math.round(Number(input.year));
  if (!Number.isFinite(year) || year <= 0) return [];

  let q = supabaseAdmin.from(REQ).select("*").eq("year", year);
  if (input.employeeId) q = q.eq("employee_id", input.employeeId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const roster = await loadRoster();
  const empById = new Map(roster.map((e) => [e.driver_id, e]));
  return ((data ?? []) as Record<string, unknown>[])
    .map((r) => {
      const row = toRow(r, empById.get(String(r.employee_id ?? "")));
      // 저장된 total_days 가 비어 있으면(구버전·미제출) 계획에서 다시 센다.
      if (row.total_days == null && row.plan.length)
        row.total_days = sumLeavePlan(row.plan);
      return row;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
