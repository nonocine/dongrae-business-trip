"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { currentAssignment } from "@/lib/appointments";
import { collectMaterials, resolveEvaluationAdmin } from "@/lib/hrEvaluationServer";
import {
  isPeriodHalf,
  totalScore,
  type EvaluationMaterials,
  type EvaluationScores,
  type EvaluationSnapshot,
  type PeriodHalf,
  type Revision,
} from "@/lib/hrEvaluation";

// =====================================================================
// 인사평가(근무성적평정) 액션 — 관장·부장(M0)만. 본인·인사 담당 불가.
//   * 모든 액션 첫 줄이 게이트(requireAdmin). hr_evaluations RLS 정책 0 이라 방어선.
//   * 작성 중(draft)에는 재료를 매번 새로 모아 보여 주고, 확정(confirmed)할 때 그 시점
//     재료를 snapshot 에 얼려 둡니다 — 이후 교육·포상이 추가돼도 과거 평정 근거는 그대로.
//   * 확정 후 점수를 고치면 snapshot.revisions 에 누가·언제·무엇을 바꿨는지 쌓습니다.
//   * 점수는 사람이 넣고, 총점만 서버가 합산합니다(화면이 보낸 총점은 쓰지 않음).
// =====================================================================

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const fail = (e: unknown): { ok: false; message: string } => ({
  ok: false,
  message: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다.",
});

async function requireAdmin() {
  const me = await resolveEvaluationAdmin();
  if (!me) throw new Error("인사평가는 관장·부장만 볼 수 있습니다.");
  return me;
}

function checkPeriod(year: number, half: string): PeriodHalf {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error("평정 연도를 확인해주세요.");
  if (!isPeriodHalf(half)) throw new Error("평정 기간(상반기·하반기·연간)을 확인해주세요.");
  return half;
}

export type EvaluationRow = EvaluationScores & {
  id: string;
  driver_id: string;
  period_year: number;
  period_half: PeriodHalf;
  total_score: number | null;
  status: "draft" | "confirmed";
  evaluated_by: string | null;
  evaluated_at: string | null;
  updated_at: string | null;
  snapshot: EvaluationSnapshot;
};

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
function toRow(r: Record<string, unknown>): EvaluationRow {
  return {
    id: String(r.id),
    driver_id: String(r.driver_id),
    period_year: Number(r.period_year),
    period_half: (isPeriodHalf(r.period_half) ? r.period_half : "YEAR") as PeriodHalf,
    score_duty: num(r.score_duty),
    score_training: num(r.score_training),
    score_career: num(r.score_career),
    bonus_award: num(r.bonus_award),
    penalty_discipline: num(r.penalty_discipline),
    total_score: num(r.total_score),
    grade: (r.grade as string | null) ?? null,
    evaluator_note: (r.evaluator_note as string | null) ?? null,
    status: r.status === "confirmed" ? "confirmed" : "draft",
    evaluated_by: (r.evaluated_by as string | null) ?? null,
    evaluated_at: (r.evaluated_at as string | null) ?? null,
    updated_at: (r.updated_at as string | null) ?? null,
    snapshot: (r.snapshot && typeof r.snapshot === "object" ? r.snapshot : {}) as EvaluationSnapshot,
  };
}

// --- 명단 -----------------------------------------------------------------------
export type RosterRow = {
  driverId: string;
  name: string;
  where: string;
  status: "none" | "draft" | "confirmed";
  total: number | null;
  grade: string | null;
};

export async function listEvaluationRoster(year: number, half: string): Promise<RosterRow[]> {
  await requireAdmin();
  const h = checkPeriod(year, half);
  const [{ data: drivers }, { data: profs }, { data: evals }] = await Promise.all([
    supabaseAdmin.from("drivers").select("id, name").order("name"),
    supabaseAdmin.from("employee_profiles").select("driver_id, employment_status, appointments"),
    supabaseAdmin.from("hr_evaluations").select("driver_id, status, total_score, grade").eq("period_year", year).eq("period_half", h),
  ]);
  const prof = new Map((profs ?? []).map((p) => [String((p as { driver_id: string }).driver_id), p as Record<string, unknown>]));
  const ev = new Map((evals ?? []).map((e) => [String((e as { driver_id: string }).driver_id), e as Record<string, unknown>]));
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  return (drivers ?? [])
    .map((d) => {
      const id = String((d as { id: string }).id);
      const p = prof.get(id);
      const e = ev.get(id);
      return { id, name: String((d as { name: string }).name), p, e };
    })
    // 재직자 + (퇴사했어도) 이 기간 평정이 있는 사람.
    .filter(({ p, e }) => (p && p.employment_status !== "resigned") || !!e)
    .map(({ id, name, p, e }) => {
      const { current } = currentAssignment(p?.appointments, today);
      return {
        driverId: id,
        name,
        where: [current?.department, current?.title].filter(Boolean).join(" ") || "-",
        status: (e ? (e.status === "confirmed" ? "confirmed" : "draft") : "none") as RosterRow["status"],
        total: e ? num(e.total_score) : null,
        grade: e ? ((e.grade as string | null) ?? null) : null,
      };
    });
}

// --- 평정표 ---------------------------------------------------------------------
export type EvaluationSheet = {
  name: string;
  evaluation: EvaluationRow | null;
  materials: EvaluationMaterials; // 확정이면 snapshot, 아니면 지금 새로 모은 것
  frozen: boolean;
  previous: { year: number; half: PeriodHalf; total: number | null; grade: string | null; status: string; scores: Partial<EvaluationScores> }[];
};

export async function getEvaluationSheet(driverId: string, year: number, half: string): Promise<Result<{ sheet: EvaluationSheet }>> {
  try {
    await requireAdmin();
    const h = checkPeriod(year, half);
    const [{ data: drv }, { data: row }, { data: prev }] = await Promise.all([
      supabaseAdmin.from("drivers").select("name").eq("id", driverId).maybeSingle(),
      supabaseAdmin.from("hr_evaluations").select("*").eq("driver_id", driverId).eq("period_year", year).eq("period_half", h).maybeSingle(),
      // 전년도 같은 기간 + 전년도 다른 기간(비교용)
      supabaseAdmin.from("hr_evaluations").select("*").eq("driver_id", driverId).eq("period_year", year - 1),
    ]);
    if (!drv) return { ok: false, message: "직원을 찾을 수 없습니다." };
    const evaluation = row ? toRow(row as Record<string, unknown>) : null;
    const frozen = evaluation?.status === "confirmed" && !!evaluation.snapshot.period;
    const materials = frozen ? (evaluation!.snapshot as EvaluationMaterials) : await collectMaterials(driverId, year, h);
    const previous = ((prev ?? []) as Record<string, unknown>[]).map((r) => {
      const e = toRow(r);
      return {
        year: e.period_year,
        half: e.period_half,
        total: e.total_score,
        grade: e.grade,
        status: e.status,
        scores: {
          score_duty: e.score_duty,
          score_training: e.score_training,
          score_career: e.score_career,
          bonus_award: e.bonus_award,
          penalty_discipline: e.penalty_discipline,
        },
      };
    });
    return { ok: true, sheet: { name: String((drv as { name: string }).name), evaluation, materials, frozen, previous } };
  } catch (e) {
    return fail(e);
  }
}

// --- 저장·확정 -------------------------------------------------------------------
export type SaveEvaluationInput = EvaluationScores & {
  driverId: string;
  year: number;
  half: string;
  confirm: boolean; // true 면 확정(재료 스냅샷 저장)
};

const SCORE_KEYS = ["score_duty", "score_training", "score_career", "bonus_award", "penalty_discipline", "grade", "evaluator_note"] as const;

function cleanScores(i: EvaluationScores): EvaluationScores {
  const n = (v: number | null) => {
    if (v == null || (typeof v === "number" && Number.isNaN(v))) return null;
    const x = Number(v);
    if (!Number.isFinite(x) || x < -1000 || x > 1000) throw new Error("점수는 -1000 ~ 1000 사이 숫자로 넣어주세요.");
    return Math.round(x * 100) / 100;
  };
  return {
    score_duty: n(i.score_duty),
    score_training: n(i.score_training),
    score_career: n(i.score_career),
    bonus_award: n(i.bonus_award),
    // 감점은 양수로 받아 총점에서 뺍니다.
    penalty_discipline: i.penalty_discipline == null ? null : Math.abs(n(i.penalty_discipline) ?? 0),
    grade: (i.grade ?? "").trim().slice(0, 20) || null,
    evaluator_note: (i.evaluator_note ?? "").trim() || null,
  };
}

export async function saveEvaluation(input: SaveEvaluationInput): Promise<Result<{ status: "draft" | "confirmed"; total: number }>> {
  try {
    const me = await requireAdmin();
    const h = checkPeriod(Number(input.year), input.half);
    if (!input.driverId) return { ok: false, message: "평정 대상자를 고르세요." };
    const scores = cleanScores(input);
    const total = totalScore(scores);
    const now = new Date().toISOString();
    const { data: cur } = await supabaseAdmin
      .from("hr_evaluations")
      .select("*")
      .eq("driver_id", input.driverId)
      .eq("period_year", input.year)
      .eq("period_half", h)
      .maybeSingle();
    const existing = cur ? toRow(cur as Record<string, unknown>) : null;

    if (existing?.status === "confirmed") {
      // 확정 후 수정 — 재료 스냅샷은 그대로 두고, 바뀐 칸만 수정 기록으로 남깁니다.
      const before: Partial<EvaluationScores> = {};
      const after: Partial<EvaluationScores> = {};
      for (const k of SCORE_KEYS) {
        if ((existing[k] ?? null) !== (scores[k] ?? null)) {
          (before as Record<string, unknown>)[k] = existing[k];
          (after as Record<string, unknown>)[k] = scores[k];
        }
      }
      if (Object.keys(after).length === 0) return { ok: true, status: "confirmed", total };
      const rev: Revision = { at: now, by: me.name, before, after };
      const snapshot: EvaluationSnapshot = { ...existing.snapshot, revisions: [...(existing.snapshot.revisions ?? []), rev] };
      const { error } = await supabaseAdmin
        .from("hr_evaluations")
        .update({ ...scores, total_score: total, snapshot, updated_at: now })
        .eq("id", existing.id)
        .eq("status", "confirmed");
      if (error) throw new Error(error.message);
      revalidatePath("/hr/evaluations");
      return { ok: true, status: "confirmed", total };
    }

    const row: Record<string, unknown> = {
      ...scores,
      total_score: total,
      status: input.confirm ? "confirmed" : "draft",
      updated_at: now,
    };
    if (input.confirm) {
      // 확정 — 이 시점 재료를 얼립니다.
      row.snapshot = { ...(await collectMaterials(input.driverId, input.year, h)), revisions: [] } satisfies EvaluationSnapshot;
      row.evaluated_by = me.name;
      row.evaluated_at = now;
    }
    if (existing) {
      const { error } = await supabaseAdmin.from("hr_evaluations").update(row).eq("id", existing.id).eq("status", "draft");
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("hr_evaluations").insert({
        ...row,
        driver_id: input.driverId,
        period_year: input.year,
        period_half: h,
        created_by: me.name,
      });
      if (error) throw new Error(error.code === "23505" ? "이미 같은 기간 평정이 있습니다. 새로고침해주세요." : error.message);
    }
    revalidatePath("/hr/evaluations");
    return { ok: true, status: input.confirm ? "confirmed" : "draft", total };
  } catch (e) {
    return fail(e);
  }
}

// 작성 중 평정만 삭제(확정본은 기록으로 남김).
export async function deleteDraftEvaluation(driverId: string, year: number, half: string): Promise<Result> {
  try {
    await requireAdmin();
    const h = checkPeriod(year, half);
    const { error, count } = await supabaseAdmin
      .from("hr_evaluations")
      .delete({ count: "exact" })
      .eq("driver_id", driverId)
      .eq("period_year", year)
      .eq("period_half", h)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    if (!count) return { ok: false, message: "작성 중인 평정만 지울 수 있습니다." };
    revalidatePath("/hr/evaluations");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
