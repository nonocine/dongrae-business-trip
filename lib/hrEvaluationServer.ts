// =====================================================================
// 인사평가 재료 자동 집계 — 서버 전용("use server" 아님)
//   출처(실제 테이블 확인 후 연결, 2026-10):
//     근무   employee_profiles(join_date·appointments) + lib/appointments.currentAssignment
//     교육   mandatory_trainings + training_completions(의무교육, 대상 판정은
//            lib/trainings.trainingTargetState) + staff_training_results(종사자교육)
//            ⚠️ staff_training_results 중 source='mandatory' 행은 의무교육 이수를 복사한
//              것이라(2026-10 기준 186건 중 182건) 종사자교육에서 뺍니다 — 넣으면 의무교육이
//              두 번 세어집니다. 연결은 driver_id 가 없어 staff_name = drivers.name.
//     경력   employee_profiles.career
//     포상   hr_awards(award_source 로 센터 포상/외부 수상 구분 — 점수는 매기지 않음)
//     징계   hr_disciplines(승진제한은 lib/hrDiscipline.activePromotionBlock)
//   권한 게이트는 상벌과 같은 M0 전용(resolveDisciplineAdmin) — hr 직무 불가.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { currentAssignment } from "@/lib/appointments";
import { trainingTargetState } from "@/lib/trainings";
import { loadTrainingTargets } from "@/lib/trainingRoster";
import { activePromotionBlock, DISCIPLINE_LABEL, isDisciplineKind } from "@/lib/hrDiscipline";
import {
  parseHours,
  periodRange,
  type EvaluationMaterials,
  type PeriodHalf,
} from "@/lib/hrEvaluation";

export { resolveDisciplineAdmin as resolveEvaluationAdmin } from "@/lib/hrDisciplineServer";

const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const inRange = (d: string | null | undefined, from: string, to: string) => !!d && d >= from && d <= to;

// 근속(년, 소수 1자리) — 입사일 ~ 기준일.
function serviceYears(join: string | null, asOf: string): number | null {
  if (!join || !/^\d{4}-\d{2}-\d{2}$/.test(join) || join > asOf) return null;
  const ms = Date.parse(asOf) - Date.parse(join);
  return Math.round((ms / (365.2425 * 86400000)) * 10) / 10;
}

export async function collectMaterials(driverId: string, year: number, half: PeriodHalf): Promise<EvaluationMaterials> {
  const { from, to } = periodRange(year, half);
  const today = kstToday();
  const asOf = to < today ? to : today;

  const [{ data: drv }, { data: prof }, { data: mts }, { data: aw }, { data: dis }] = await Promise.all([
    supabaseAdmin.from("drivers").select("name, rank").eq("id", driverId).maybeSingle(),
    supabaseAdmin
      .from("employee_profiles")
      .select("join_date, resignation_date, appointments, career")
      .eq("driver_id", driverId)
      .maybeSingle(),
    supabaseAdmin.from("mandatory_trainings").select("id, name, held_on, due_date, hours, target_scope, is_active").eq("year", year),
    supabaseAdmin.from("hr_awards").select("awarded_on, title, awarding_body, award_kind, award_source").eq("driver_id", driverId),
    supabaseAdmin.from("hr_disciplines").select("kind, decided_on, reason, promotion_block_until").eq("driver_id", driverId),
  ]);
  const name = String((drv as { name?: string } | null)?.name ?? "");
  const p = (prof ?? {}) as {
    join_date?: string | null;
    resignation_date?: string | null;
    appointments?: unknown;
    career?: unknown;
  };

  // --- 근무 ---
  const { current } = currentAssignment(p.appointments, asOf);
  const appts = (Array.isArray(p.appointments) ? p.appointments : []) as Record<string, unknown>[];
  const appointmentsInPeriod = appts
    .map((a) => ({
      date: String(a.effective_date ?? ""),
      text: [a.type, a.department, a.title, a.duty ? `(${a.duty})` : ""].filter((x) => x && String(x).trim()).join(" "),
    }))
    .filter((a) => inRange(a.date, from, to))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // --- 의무교육 ---
  const trainings = ((mts ?? []) as {
    id: string;
    name: string;
    held_on: string | null;
    due_date: string | null;
    hours: string | null;
    target_scope: string | null;
    is_active: boolean | null;
  }[])
    .filter((t) => t.is_active !== false)
    // 반기 평정이면 실시일(없으면 이수기한)이 그 반기에 든 교육만. 날짜가 없으면 연간에만.
    .filter((t) => half === "YEAR" || inRange(t.held_on || t.due_date, from, to));
  const selected = await loadTrainingTargets(trainings.filter((t) => t.target_scope === "selected").map((t) => t.id));
  const span = { driver_id: driverId, joinDate: p.join_date ?? null, resignationDate: p.resignation_date ?? null };
  const targets = trainings.filter((t) => trainingTargetState(t, span, selected.get(t.id)).isTarget);
  const { data: comps } = targets.length
    ? await supabaseAdmin
        .from("training_completions")
        .select("training_id, completed_at")
        .eq("driver_id", driverId)
        .in(
          "training_id",
          targets.map((t) => t.id)
        )
    : { data: [] };
  const doneAt = new Map(((comps ?? []) as { training_id: string; completed_at: string | null }[]).map((c) => [c.training_id, c.completed_at]));
  const mandatoryItems = targets
    .map((t) => ({
      name: t.name,
      base: t.held_on || t.due_date || null,
      hours: parseHours(t.hours),
      completed: doneAt.has(t.id),
      completedAt: doneAt.get(t.id) ?? null,
    }))
    .sort((a, b) => String(a.base ?? "").localeCompare(String(b.base ?? "")));

  // --- 종사자교육(직접 입력분만) ---
  const { data: staff } = name
    ? await supabaseAdmin
        .from("staff_training_results")
        .select("training_name, training_date, hours, organizer, source")
        .eq("staff_name", name)
        .or("source.is.null,source.neq.mandatory")
        .gte("training_date", from)
        .lte("training_date", to)
        .order("training_date")
    : { data: [] };
  const staffItems = ((staff ?? []) as { training_name: string; training_date: string | null; hours: string | null; organizer: string | null }[]).map(
    (s) => ({ name: s.training_name, date: s.training_date, hours: parseHours(s.hours), organizer: s.organizer })
  );

  // --- 경력 ---
  const career = ((Array.isArray(p.career) ? p.career : []) as Record<string, unknown>[])
    .map((c) => ({
      company: String(c.company ?? "").trim(),
      department: String(c.department ?? "").trim(),
      period: [String(c.start_date ?? "").trim(), c.current ? "재직" : String(c.end_date ?? "").trim()].filter(Boolean).join(" ~ "),
      duties: String(c.duties ?? "").trim(),
    }))
    .filter((c) => c.company || c.duties);

  // --- 포상 ---
  const awards = ((aw ?? []) as { awarded_on: string; title: string; awarding_body: string | null; award_kind: string | null; award_source: string }[])
    .map((a) => ({
      date: a.awarded_on,
      title: a.title,
      body: a.awarding_body,
      kind: a.award_kind,
      source: (a.award_source === "internal" ? "internal" : "external") as "internal" | "external",
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const internal = awards.filter((a) => a.source === "internal");
  const external = awards.filter((a) => a.source === "external");

  // --- 징계 ---
  const disRows = (dis ?? []) as { kind: string; decided_on: string; reason: string; promotion_block_until: string | null }[];
  const disItems = disRows
    .map((d) => ({
      date: d.decided_on,
      kind: d.kind,
      label: isDisciplineKind(d.kind) ? DISCIPLINE_LABEL[d.kind] : d.kind,
      reason: d.reason,
      blockUntil: d.promotion_block_until,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    period: { year, half, from, to },
    collectedAt: new Date().toISOString(),
    service: {
      joinDate: p.join_date ?? null,
      years: serviceYears(p.join_date ?? null, asOf),
      department: current?.department ?? null,
      title: current?.title ?? null,
      duty: current?.duty ?? null,
      rank: (drv as { rank?: string | null } | null)?.rank ?? null,
      appointmentsInPeriod,
    },
    training: {
      mandatory: {
        target: mandatoryItems.length,
        completed: mandatoryItems.filter((m) => m.completed).length,
        hours: Math.round(mandatoryItems.filter((m) => m.completed).reduce((a, m) => a + m.hours, 0) * 10) / 10,
        items: mandatoryItems,
      },
      staff: {
        count: staffItems.length,
        hours: Math.round(staffItems.reduce((a, s) => a + s.hours, 0) * 10) / 10,
        items: staffItems,
      },
    },
    career,
    awards: {
      internal,
      external,
      internalInPeriod: internal.filter((a) => inRange(a.date, from, to)).length,
      externalInPeriod: external.filter((a) => inRange(a.date, from, to)).length,
    },
    disciplines: {
      items: disItems,
      inPeriod: disItems.filter((d) => inRange(d.date, from, to)).length,
      // 승진제한은 "지금" 기준(운영규정 32조) — 기한이 지나면 사라짐.
      blockUntil: activePromotionBlock(disRows, today),
      warnings: disRows.filter((d) => d.kind === "warning").length,
    },
  };
}
