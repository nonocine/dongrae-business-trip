import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  toTraining,
  sortTrainings,
  daysUntil,
  kstTodayYmd,
  type MandatoryTraining,
} from "@/lib/trainings";
import { loadTrainingRoster, loadTrainingTargets } from "@/lib/trainingRoster";

// =====================================================================
// 법정의무교육 현황판 조회 — 화면(hr/trainings/actions)과 MCP 가 같은 쿼리를
//   씁니다. 권한 확인은 호출부 책임입니다. 집계 규칙은 lib/trainings
//   (trainingStatsByTraining / trainingStatsByEmployee).
// =====================================================================

// 현황판 행 — 대상 판정을 클라이언트에서도 같은 규칙(lib/trainings.trainingTargetState)으로
//   할 수 있게 입사일·퇴사일을 함께 내려보냅니다(HR 전용 화면).
export type RosterEmployee = {
  driver_id: string;
  name: string;
  rank: string | null;
  joinDate: string | null;
  resignationDate: string | null;
};
export type MatrixCompletion = {
  training_id: string;
  driver_id: string;
  completed_at: string | null;
  has_cert: boolean;
};
export type TrainingColumn = MandatoryTraining & { dday: number | null };
export type TrainingMatrix = {
  today: string;
  trainings: TrainingColumn[];
  employees: RosterEmployee[];
  completions: MatrixCompletion[];
  // 개별 지정 교육(target_scope=selected)의 지정 대상자 — training_id → driver_id[].
  //   활성·비활성 모두 실어 보냅니다(수정 폼이 비활성 교육의 명단도 채워야 함).
  targets: Record<string, string[]>;
};

// 교육이 등록된 연도(최신순).
export async function loadTrainingYears(): Promise<number[]> {
  const { data } = await supabaseAdmin
    .from("mandatory_trainings")
    .select("year");
  const years = new Set<number>();
  for (const r of data ?? []) years.add(Number((r as { year: unknown }).year));
  return Array.from(years)
    .filter((y) => Number.isFinite(y) && y > 0)
    .sort((a, b) => b - a);
}

// 재직자 명단 — 규칙은 lib/trainingRoster 단일 출처(D-7 독촉과 공유).
export async function listActiveRoster(): Promise<RosterEmployee[]> {
  const roster = await loadTrainingRoster();
  return roster.map((e) => ({
    driver_id: e.driver_id,
    name: e.name,
    rank: e.rank,
    joinDate: e.joinDate,
    resignationDate: e.resignationDate,
  }));
}

// 현황판 매트릭스 — 행=재직 직원, 열=활성 교육.
export async function loadTrainingMatrix(year: number): Promise<TrainingMatrix> {
  const today = kstTodayYmd();

  const [trainingsRaw, employees, selectedRaw] = await Promise.all([
    supabaseAdmin
      .from("mandatory_trainings")
      .select("*")
      .eq("year", year)
      .eq("is_active", true),
    listActiveRoster(),
    supabaseAdmin
      .from("mandatory_trainings")
      .select("id")
      .eq("year", year)
      .eq("target_scope", "selected"),
  ]);
  if (trainingsRaw.error) throw new Error(trainingsRaw.error.message);
  if (selectedRaw.error) throw new Error(selectedRaw.error.message);
  const targetSets = await loadTrainingTargets(
    (selectedRaw.data ?? []).map((r) => String((r as { id: unknown }).id)),
  );
  const targets: Record<string, string[]> = {};
  for (const [tid, set] of targetSets) targets[tid] = [...set];

  const trainings = sortTrainings(
    (trainingsRaw.data ?? []).map((r) => toTraining(r as Record<string, unknown>))
  ).map((t) => ({ ...t, dday: daysUntil(t.due_date, today) }));

  const trainingIds = trainings.map((t) => t.id);
  let completions: MatrixCompletion[] = [];
  if (trainingIds.length > 0) {
    const { data: comps } = await supabaseAdmin
      .from("training_completions")
      .select("training_id, driver_id, completed_at, certificate_path")
      .in("training_id", trainingIds);
    completions = (comps ?? []).map((c) => {
      const r = c as Record<string, unknown>;
      return {
        training_id: String(r.training_id ?? ""),
        driver_id: String(r.driver_id ?? ""),
        completed_at: (r.completed_at as string | null) ?? null,
        has_cert:
          typeof r.certificate_path === "string" &&
          (r.certificate_path as string).length > 0,
      };
    });
  }

  return { today, trainings, employees, completions, targets };
}
