"use server";

// =====================================================================
// 연차수당 산정 — 액션. 접근: 관장(M0)·hr·erp_finance(lib/leavePayoutServer). 확정·무효는 관장만.
//   * 확정(confirmed)된 산정표는 고칠 수 없습니다. 무효(void) 뒤 다시 만들 수 있습니다.
//   * 줄 금액은 calc_snapshot 의 항목 월액으로 다시 계산합니다(계약서를 다시 읽지 않음 — 박제).
// =====================================================================

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  LINES,
  RUNS,
  planPayoutLines,
  requirePayoutAccess,
  snapshotCalc,
  type CalcSnapshot,
} from "@/lib/leavePayoutServer";
import { normalizeWageBasis, roundHalfDay, type WageBasis } from "@/lib/leavePayout";

type Fail = { ok: false; message: string };
const fail = (e: unknown, fb: string): Fail => ({ ok: false, message: e instanceof Error ? e.message : fb });
const PATH = "/hr/leave-payout";

async function loadRunStatus(runId: string): Promise<{ status: string; wage_basis: unknown; year: number } | null> {
  const { data } = await supabaseAdmin.from(RUNS).select("status, wage_basis, year").eq("id", runId).maybeSingle();
  return (data as { status: string; wage_basis: unknown; year: number } | null) ?? null;
}

// [올해 산정표 만들기] — draft 1건 + 재직자별 줄.
export async function createPayoutRun(year: number, basisIn?: WageBasis): Promise<{ ok: true; id: string } | Fail> {
  try {
    const access = await requirePayoutAccess();
    const y = Math.round(year);
    const { data: live } = await supabaseAdmin.from(RUNS).select("id, status").eq("year", y).neq("status", "void");
    if ((live ?? []).length) return { ok: false, message: "이미 이 연도 산정표가 있습니다. 무효 처리 뒤 다시 만들 수 있습니다." };
    const basis = normalizeWageBasis(basisIn);
    const lines = await planPayoutLines(y, basis);
    const { data: run, error } = await supabaseAdmin
      .from(RUNS)
      .insert({ year: y, title: `${y}년 연차수당 산정`, status: "draft", wage_basis: basis, created_by: access.driverId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const runId = String((run as { id: string }).id);
    const rows = lines.map((l) => ({
      run_id: runId,
      employee_id: l.employee_id,
      category: l.category,
      unused_days: l.unused_days,
      unused_source: l.unused_source,
      monthly_ordinary_wage: l.monthly_ordinary_wage,
      hourly_ordinary_wage: l.hourly_ordinary_wage,
      daily_ordinary_wage: l.daily_ordinary_wage,
      amount: l.amount,
      calc_snapshot: l.calc_snapshot,
      excluded: l.excluded,
      exclude_reason: l.exclude_reason,
    }));
    if (rows.length) {
      let { error: lErr } = await supabaseAdmin.from(LINES).insert(rows);
      // 구분 값 제약(check)에 'annual_promoted' 가 없으면 회계연도 줄로 넣고 제외 사유로 구분합니다.
      if (lErr?.code === "23514") {
        ({ error: lErr } = await supabaseAdmin
          .from(LINES)
          .insert(rows.map((r) => (r.category === "annual_promoted" ? { ...r, category: "annual_unpromoted" } : r))));
      }
      if (lErr) {
        await supabaseAdmin.from(RUNS).delete().eq("id", runId);
        throw new Error(lErr.message);
      }
    }
    revalidatePath(PATH);
    return { ok: true, id: runId };
  } catch (e) {
    return fail(e, "산정표를 만들지 못했습니다.");
  }
}

// 포함 항목(wage_basis) 변경 — 모든 줄 다시 계산(작성 중만).
export async function updateWageBasis(runId: string, basisIn: WageBasis): Promise<{ ok: true } | Fail> {
  try {
    await requirePayoutAccess();
    const run = await loadRunStatus(runId);
    if (!run) return { ok: false, message: "산정표를 찾을 수 없습니다." };
    if (run.status !== "draft") return { ok: false, message: "확정·무효된 산정표는 고칠 수 없습니다." };
    const basis = normalizeWageBasis(basisIn);
    const { error } = await supabaseAdmin.from(RUNS).update({ wage_basis: basis }).eq("id", runId).eq("status", "draft");
    if (error) throw new Error(error.message);
    const { data: lines } = await supabaseAdmin.from(LINES).select("id, unused_days, calc_snapshot").eq("run_id", runId);
    for (const l of (lines ?? []) as { id: string; unused_days: number; calc_snapshot: CalcSnapshot }[]) {
      const snap = snapshotCalc(l.calc_snapshot, basis, Number(l.unused_days));
      await supabaseAdmin
        .from(LINES)
        .update({
          calc_snapshot: snap,
          monthly_ordinary_wage: snap.monthly,
          hourly_ordinary_wage: snap.hourly,
          daily_ordinary_wage: snap.daily,
          amount: snap.amount,
        })
        .eq("id", l.id);
    }
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return fail(e, "저장하지 못했습니다.");
  }
}

// 줄 고치기 — 제외·사유, 미사용 일수(직접 입력), 예정 사용 차감/되돌리기. 작성 중만.
export async function updatePayoutLine(
  lineId: string,
  patch: { excluded?: boolean; excludeReason?: string | null; unusedDays?: number; deductPlanned?: boolean }
): Promise<{ ok: true } | Fail> {
  try {
    await requirePayoutAccess();
    const { data: line } = await supabaseAdmin.from(LINES).select("*").eq("id", lineId).maybeSingle();
    if (!line) return { ok: false, message: "줄을 찾을 수 없습니다." };
    const l = line as Record<string, unknown>;
    const run = await loadRunStatus(String(l.run_id));
    if (!run || run.status !== "draft") return { ok: false, message: "확정·무효된 산정표는 고칠 수 없습니다." };
    const basis = normalizeWageBasis(run.wage_basis);
    let snap = (l.calc_snapshot ?? {}) as CalcSnapshot;
    let days = Number(l.unused_days ?? 0);
    const upd: Record<string, unknown> = {};

    if (patch.unusedDays != null) {
      if (!Number.isFinite(Number(patch.unusedDays)) || patch.unusedDays < 0) return { ok: false, message: "미사용 일수가 올바르지 않습니다." };
      days = roundHalfDay(patch.unusedDays);
      if (l.unused_source !== "erp" || snap.erp_remaining == null) upd.unused_source = "manual";
    }
    if (patch.deductPlanned != null) {
      // 예정 사용(결재 진행 중 연가) 차감 — 담당자가 눌러야만. 되돌리면 다시 더합니다.
      const planned = Number(snap.planned_days ?? 0);
      if (patch.deductPlanned && !snap.planned_deducted && planned > 0) days = roundHalfDay(Math.max(0, days - planned));
      if (!patch.deductPlanned && snap.planned_deducted) days = roundHalfDay(days + planned);
      snap = { ...snap, planned_deducted: patch.deductPlanned && planned > 0 };
    }
    if (patch.excluded != null) {
      upd.excluded = patch.excluded;
      const reason = (patch.excludeReason ?? "").trim();
      if (patch.excluded && !reason && !l.exclude_reason) return { ok: false, message: "제외 사유를 입력하세요." };
      upd.exclude_reason = patch.excluded ? (reason || (l.exclude_reason as string)) : null;
    } else if (patch.excludeReason != null) upd.exclude_reason = patch.excludeReason.trim() || null;

    snap = snapshotCalc(snap, basis, days);
    Object.assign(upd, {
      unused_days: days,
      calc_snapshot: snap,
      monthly_ordinary_wage: snap.monthly,
      hourly_ordinary_wage: snap.hourly,
      daily_ordinary_wage: snap.daily,
      amount: snap.amount,
    });
    const { error } = await supabaseAdmin.from(LINES).update(upd).eq("id", lineId);
    if (error) throw new Error(error.message);
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return fail(e, "저장하지 못했습니다.");
  }
}

// [확정] — 관장(M0)만. 이후 수정 불가.
export async function confirmPayoutRun(runId: string): Promise<{ ok: true } | Fail> {
  try {
    const access = await requirePayoutAccess();
    if (!access.canConfirm) return { ok: false, message: "확정은 관장·부장만 할 수 있습니다." };
    const { error, count } = await supabaseAdmin
      .from(RUNS)
      .update({ status: "confirmed", confirmed_by: access.driverId, confirmed_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", runId)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    if (!count) return { ok: false, message: "작성 중인 산정표만 확정할 수 있습니다." };
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return fail(e, "확정하지 못했습니다.");
  }
}

// [무효] — 관장(M0)만. 무효 뒤 다시 만들 수 있습니다(행은 지우지 않음).
export async function voidPayoutRun(runId: string, reason: string): Promise<{ ok: true } | Fail> {
  try {
    const access = await requirePayoutAccess();
    if (!access.canConfirm) return { ok: false, message: "무효 처리는 관장·부장만 할 수 있습니다." };
    const why = (reason ?? "").trim();
    if (!why) return { ok: false, message: "무효 사유를 입력하세요." };
    const run = await loadRunStatus(runId);
    if (!run || run.status === "void") return { ok: false, message: "이미 무효이거나 없는 산정표입니다." };
    const { error } = await supabaseAdmin
      .from(RUNS)
      .update({ status: "void", note: `[무효] ${why.slice(0, 300)} — ${access.name}` })
      .eq("id", runId)
      .neq("status", "void");
    if (error) throw new Error(error.message);
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return fail(e, "무효 처리하지 못했습니다.");
  }
}
