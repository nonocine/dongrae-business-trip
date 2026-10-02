"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  supabase,
  signHrDocument,
  removeHrDocuments,
  HR_DOCUMENTS_BUCKET,
} from "@/lib/supabase";
import {
  resolveTrainingAccess,
  requireTrainingAccess,
} from "@/lib/trainingAccess";
import {
  toTraining,
  sortTrainings,
  daysUntil,
  kstTodayYmd,
  isTrainingTarget,
  trainingTargetState,
  normalizeTargetScope,
  CERT_EXT,
  CERT_MAX_BYTES,
  cellKey,
  type MandatoryTraining,
  type TargetScope,
} from "@/lib/trainings";
import {
  loadTrainingRoster,
  loadTrainingTargets,
} from "@/lib/trainingRoster";
import {
  runTrainingReminder,
  type TrainingReminderSummary,
} from "@/lib/trainingReminder";

// =====================================================================
// 법정의무교육 담당자 액션 — /hr/trainings
//   * 접근: M0(관장·부장·master) 또는 hr(인사) 직무. lib/trainingAccess 게이트.
//   * mandatory_trainings / training_completions 는 RLS 0개 → service_role 경유.
//   * 원칙: 담당자는 "교육 목록"만 최초 등록·관리. 이수/수료증 제출은 직원 각자
//     마이페이지에서(app/profile/hr/trainingActions). 담당자는 대신 업로드도 가능.
// =====================================================================

// 페이지용 — 접근 가능 여부만.
export async function canAccessTrainings(): Promise<boolean> {
  return (await resolveTrainingAccess()) !== null;
}

// =====================================================================
// 연도 목록 / 교육 목록
// =====================================================================
export async function listTrainingYears(): Promise<number[]> {
  await requireTrainingAccess();
  const { data } = await supabaseAdmin
    .from("mandatory_trainings")
    .select("year");
  const years = new Set<number>();
  for (const r of data ?? []) years.add(Number((r as { year: unknown }).year));
  return Array.from(years)
    .filter((y) => Number.isFinite(y) && y > 0)
    .sort((a, b) => b - a);
}

// 특정 연도 교육 전체(활성+비활성) — 관리 목록용. 표시순서→이름 정렬.
export async function listTrainings(
  year: number
): Promise<MandatoryTraining[]> {
  await requireTrainingAccess();
  const { data, error } = await supabaseAdmin
    .from("mandatory_trainings")
    .select("*")
    .eq("year", year);
  if (error) throw new Error(error.message);
  return sortTrainings(
    (data ?? []).map((r) => toTraining(r as Record<string, unknown>))
  );
}

// =====================================================================
// 교육 등록 / 수정 / 삭제
// =====================================================================
export type TrainingInput = {
  id?: string | null;
  year: number;
  name: string;
  // 실시일 — 대상자 자동 판정 기준일. 비우면 due_date 로 폴백합니다.
  held_on?: string | null;
  due_date: string | null;
  site_url: string | null;
  note: string | null;
  display_order: number | null;
  is_active: boolean;
  // 종사자 교육 실적(사업실적 모듈) 반입에 쓰이는 교육 단위 속성 — 선택 입력.
  location?: string | null;
  organizer?: string | null;
  hours?: string | null;
  // 교육 대상 — all(재직자 전원, 기본) / selected(target_ids 만).
  //   생략하면 all 로 저장합니다(기존 호출부 호환).
  target_scope?: TargetScope;
  target_ids?: string[] | null;
  // 이수 기록이 있는 사람이 대상에서 빠지는 것을 담당자가 확인했는지.
  //   false 면 서버가 저장하지 않고 excluded 명단을 돌려줍니다(화면에서 확인 후 재전송).
  confirm_exclusion?: boolean;
};

export type SaveTrainingResult =
  | { ok: true; id: string }
  | { ok: false; message: string; excluded?: string[] };

function cleanStr(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

export async function saveTraining(
  input: TrainingInput
): Promise<SaveTrainingResult> {
  try {
    const ctx = await requireTrainingAccess();

    const year = Number(input.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return { ok: false, message: "올바른 연도를 입력해주세요." };
    }
    const name = cleanStr(input.name);
    if (!name) return { ok: false, message: "교육명을 입력해주세요." };

    // 같은 연도 내 동일 교육명 중복 방지(UNIQUE(year,name) 사전 확인).
    const { data: dup } = await supabaseAdmin
      .from("mandatory_trainings")
      .select("id")
      .eq("year", year)
      .eq("name", name)
      .maybeSingle();
    if (dup && String((dup as { id: unknown }).id) !== (input.id ?? "")) {
      return { ok: false, message: `이미 등록된 교육명입니다: ${name}` };
    }

    // 표시순서 미지정 시 해당 연도 최대값 + 1.
    let order = input.display_order;
    if (order == null || !Number.isFinite(order)) {
      const { data: rows } = await supabaseAdmin
        .from("mandatory_trainings")
        .select("display_order")
        .eq("year", year);
      const max = (rows ?? []).reduce(
        (m, r) => Math.max(m, Number((r as { display_order: unknown }).display_order ?? 0)),
        0
      );
      order = max + 1;
    }

    // 교육 대상 — 개별 지정이면 명단 검증(1명 이상, 실존 직원만).
    const targetScope = normalizeTargetScope(input.target_scope);
    const targetIds = [
      ...new Set((input.target_ids ?? []).map((v) => String(v).trim()).filter(Boolean)),
    ];
    if (targetScope === "selected") {
      if (targetIds.length === 0) {
        return { ok: false, message: "교육 대상 직원을 1명 이상 선택해주세요." };
      }
      const { data: drv, error: dErr } = await supabaseAdmin
        .from("drivers")
        .select("id")
        .in("id", targetIds);
      if (dErr) throw new Error(dErr.message);
      if ((drv ?? []).length !== targetIds.length) {
        return { ok: false, message: "존재하지 않는 직원이 대상에 포함되어 있습니다." };
      }
    }

    // 이수 기록이 있는 사람이 대상에서 빠지면 확인을 받습니다(막지는 않음).
    //   기록 자체는 지우지 않습니다 — 현황판에 ✓(대상 아님·기록 보존)로 남습니다.
    if (input.id && targetScope === "selected" && !input.confirm_exclusion) {
      const excluded = await completedButExcluded(input.id, new Set(targetIds));
      if (excluded.length > 0) {
        return {
          ok: false,
          message: `이수 기록이 있는 ${excluded.length}명이 대상에서 제외됩니다.`,
          excluded,
        };
      }
    }

    const row = {
      year,
      name,
      held_on: cleanStr(input.held_on),
      due_date: cleanStr(input.due_date),
      site_url: cleanStr(input.site_url),
      note: cleanStr(input.note),
      display_order: order,
      is_active: input.is_active !== false,
      location: cleanStr(input.location),
      organizer: cleanStr(input.organizer),
      hours: cleanStr(input.hours),
      target_scope: targetScope,
    };

    if (input.id) {
      const { error } = await supabaseAdmin
        .from("mandatory_trainings")
        .update(row)
        .eq("id", input.id);
      if (error) throw new Error(error.message);
      await syncTrainingTargets(input.id, targetScope, targetIds, ctx.name);
      revalidatePath("/hr/trainings");
      return { ok: true, id: input.id };
    }

    const { data, error } = await supabaseAdmin
      .from("mandatory_trainings")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const newId = String((data as { id: unknown }).id);
    await syncTrainingTargets(newId, targetScope, targetIds, ctx.name);
    revalidatePath("/hr/trainings");
    return { ok: true, id: newId };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.",
    };
  }
}

// 지정 대상자 명단을 저장값과 맞춥니다.
//   * all      → 지정 행을 모두 지웁니다(전원 자동 판정이라 명단이 무의미).
//   * selected → 빠진 사람만 지우고 새로 든 사람만 넣습니다. 그대로 남는
//     사람의 assigned_at·assigned_by 는 보존됩니다.
async function syncTrainingTargets(
  trainingId: string,
  scope: TargetScope,
  ids: string[],
  by: string,
): Promise<void> {
  if (scope === "all") {
    const { error } = await supabaseAdmin
      .from("mandatory_training_targets")
      .delete()
      .eq("training_id", trainingId);
    if (error) throw new Error(`대상자 정리 실패: ${error.message}`);
    return;
  }
  const existing =
    (await loadTrainingTargets([trainingId])).get(trainingId) ?? new Set();
  const next = new Set(ids);
  const toDel = [...existing].filter((d) => !next.has(d));
  const toAdd = ids.filter((d) => !existing.has(d));
  if (toDel.length > 0) {
    const { error } = await supabaseAdmin
      .from("mandatory_training_targets")
      .delete()
      .eq("training_id", trainingId)
      .in("driver_id", toDel);
    if (error) throw new Error(`대상자 저장 실패: ${error.message}`);
  }
  if (toAdd.length > 0) {
    const { error } = await supabaseAdmin
      .from("mandatory_training_targets")
      .upsert(
        toAdd.map((driver_id) => ({
          training_id: trainingId,
          driver_id,
          assigned_by: by,
        })),
        { onConflict: "training_id,driver_id", ignoreDuplicates: true },
      );
    if (error) throw new Error(`대상자 저장 실패: ${error.message}`);
  }
}

// 새 지정 명단(nextIds)으로 바꾸면 "지금 대상이면서 이수 기록이 있는데 빠지는"
//   직원 이름 목록. 지금 대상 = 저장된 대상 범위 그대로의 판정(공용 함수).
async function completedButExcluded(
  trainingId: string,
  nextIds: ReadonlySet<string>,
): Promise<string[]> {
  const [{ data: tr }, { data: comps, error: cErr }] = await Promise.all([
    supabaseAdmin
      .from("mandatory_trainings")
      .select("held_on, due_date, target_scope")
      .eq("id", trainingId)
      .maybeSingle(),
    supabaseAdmin
      .from("training_completions")
      .select("driver_id")
      .eq("training_id", trainingId),
  ]);
  if (cErr) throw new Error(cErr.message);
  if (!tr) return [];
  const doneIds = [
    ...new Set(
      (comps ?? []).map((c) => String((c as { driver_id: unknown }).driver_id ?? "")),
    ),
  ].filter((d) => d && !nextIds.has(d));
  if (doneIds.length === 0) return [];

  const rule = tr as Record<string, string | null>;
  const [roster, targets] = await Promise.all([
    loadTrainingRoster(),
    normalizeTargetScope(rule.target_scope) === "selected"
      ? loadTrainingTargets([trainingId]).then((m) => m.get(trainingId))
      : Promise.resolve(undefined),
  ]);
  const byId = new Map(roster.map((e) => [e.driver_id, e]));
  const excluded = doneIds.filter((d) => {
    // 지정 명단에 있었던 사람은 재직 명단과 무관하게 "지금 대상"입니다.
    if (targets?.has(d)) return true;
    const emp = byId.get(d);
    return !!emp && isTrainingTarget(rule, emp, targets);
  });
  if (excluded.length === 0) return [];
  const { data: drv } = await supabaseAdmin
    .from("drivers")
    .select("id, name")
    .in("id", excluded);
  const nameById = new Map(
    (drv ?? []).map((d) => [
      String((d as { id: unknown }).id),
      String((d as { name: unknown }).name ?? ""),
    ]),
  );
  return excluded.map((d) => nameById.get(d) || "(이름 없음)");
}

// 교육 삭제 — 이수기록(training_completions)은 FK CASCADE 로 함께 삭제됩니다.
//   수료증 파일(Storage)은 CASCADE 대상이 아니라 먼저 회수합니다.
export async function deleteTraining(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireTrainingAccess();
    if (!id) return { ok: false, message: "교육 정보가 없습니다." };

    const { data: comps } = await supabaseAdmin
      .from("training_completions")
      .select("certificate_path")
      .eq("training_id", id);
    const paths = (comps ?? [])
      .map((c) => (c as { certificate_path?: unknown }).certificate_path)
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    if (paths.length > 0) await removeHrDocuments(paths);

    const { error } = await supabaseAdmin
      .from("mandatory_trainings")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/trainings");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.",
    };
  }
}

// 전년도(또는 임의 연도) 교육 "목록만" 복사 — 이수 기록은 복사하지 않습니다.
//   * 대상 연도에 이미 있는 교육명은 건너뜁니다(UNIQUE(year,name) 충돌 방지).
export async function copyTrainingsFromYear(
  fromYear: number,
  toYear: number
): Promise<{ ok: true; copied: number } | { ok: false; message: string }> {
  try {
    const ctx = await requireTrainingAccess();
    const from = Number(fromYear);
    const to = Number(toYear);
    if (!Number.isInteger(to) || to < 2000 || to > 2100) {
      return { ok: false, message: "복사 대상 연도가 올바르지 않습니다." };
    }
    if (from === to) {
      return { ok: false, message: "같은 연도로는 복사할 수 없습니다." };
    }

    const [{ data: src }, { data: existing }] = await Promise.all([
      supabaseAdmin.from("mandatory_trainings").select("*").eq("year", from),
      supabaseAdmin
        .from("mandatory_trainings")
        .select("name")
        .eq("year", to),
    ]);
    if (!src || src.length === 0) {
      return { ok: false, message: `${from}년에 복사할 교육이 없습니다.` };
    }
    const taken = new Set(
      (existing ?? []).map((r) => String((r as { name: unknown }).name ?? ""))
    );
    const rows = src
      .map((r) => toTraining(r as Record<string, unknown>))
      .filter((t) => !taken.has(t.name))
      .map((t) => ({
        year: to,
        name: t.name,
        // 실시일은 해마다 달라지므로 복사하지 않습니다(대상 판정 기준일 오염 방지).
        held_on: null,
        due_date: t.due_date,
        site_url: t.site_url,
        note: t.note,
        display_order: t.display_order,
        is_active: t.is_active,
        // 장소·주최·수료시간은 해가 바뀌어도 대개 같으므로 함께 복사합니다.
        location: t.location,
        organizer: t.organizer,
        hours: t.hours,
        // 대상 범위도 복사합니다 — 개별 지정 교육(소방안전관리자 등)은 해가
        //   바뀌어도 대개 같은 사람이 대상이라, 아래에서 지정 명단도 함께 옮깁니다.
        target_scope: t.target_scope,
      }));
    if (rows.length === 0) {
      return { ok: false, message: "복사할 새 교육이 없습니다(이미 모두 존재)." };
    }
    const { data: inserted, error } = await supabaseAdmin
      .from("mandatory_trainings")
      .insert(rows)
      .select("id, name");
    if (error) throw new Error(error.message);

    // 개별 지정 교육의 대상자 명단 복사(이름으로 원본↔사본 매칭, UNIQUE(year,name)).
    const srcByName = new Map(
      src
        .map((r) => toTraining(r as Record<string, unknown>))
        .filter((t) => t.target_scope === "selected")
        .map((t) => [t.name, t.id] as const),
    );
    if (srcByName.size > 0) {
      const srcTargets = await loadTrainingTargets([...srcByName.values()]);
      const targetRows: {
        training_id: string;
        driver_id: string;
        assigned_by: string;
      }[] = [];
      for (const r of (inserted ?? []) as { id: unknown; name: unknown }[]) {
        const srcId = srcByName.get(String(r.name ?? ""));
        const ids = srcId ? srcTargets.get(srcId) : undefined;
        for (const driver_id of ids ?? []) {
          targetRows.push({
            training_id: String(r.id),
            driver_id,
            assigned_by: ctx.name,
          });
        }
      }
      if (targetRows.length > 0) {
        const { error: tErr } = await supabaseAdmin
          .from("mandatory_training_targets")
          .insert(targetRows);
        if (tErr) throw new Error(`대상자 복사 실패: ${tErr.message}`);
      }
    }
    revalidatePath("/hr/trainings");
    return { ok: true, copied: rows.length };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "복사 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 현황판 매트릭스 — 행=재직 직원, 열=활성 교육.
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

// 재직자 명단 — 규칙은 lib/trainingRoster 단일 출처(D-7 독촉과 공유).
async function listActiveRoster(): Promise<RosterEmployee[]> {
  const roster = await loadTrainingRoster();
  return roster.map((e) => ({
    driver_id: e.driver_id,
    name: e.name,
    rank: e.rank,
    joinDate: e.joinDate,
    resignationDate: e.resignationDate,
  }));
}

export async function getTrainingMatrix(year: number): Promise<TrainingMatrix> {
  await requireTrainingAccess();
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

// 대시보드 관리 카드용 요약 — 올해 활성 교육 중 "대상"인 (교육×직원) 셀만 집계.
//   * 대상 = lib/trainings.trainingTargetState. 'all' 교육은 재직 직원 전원
//     (퇴사 후 교육만 제외), 'selected' 교육은 지정된 사람만.
//   * 접근 없으면 null(카드 미노출).
export async function getTrainingsAdminSummary(): Promise<
  { year: number; totalNotMet: number } | null
> {
  const ctx = await resolveTrainingAccess();
  if (!ctx) return null;
  const year = Number(kstTodayYmd().slice(0, 4));

  const [{ data: trs }, employees] = await Promise.all([
    supabaseAdmin
      .from("mandatory_trainings")
      .select("id, held_on, due_date, target_scope")
      .eq("year", year)
      .eq("is_active", true),
    listActiveRoster(),
  ]);
  const trainings = ((trs ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id ?? ""),
    held_on: (r.held_on as string | null) ?? null,
    due_date: (r.due_date as string | null) ?? null,
    target_scope: normalizeTargetScope(r.target_scope),
  }));
  if (trainings.length === 0 || employees.length === 0) {
    return { year, totalNotMet: 0 };
  }

  const [{ data: comps }, targetsByTraining] = await Promise.all([
    supabaseAdmin
      .from("training_completions")
      .select("training_id, driver_id")
      .in(
        "training_id",
        trainings.map((t) => t.id),
      ),
    loadTrainingTargets(
      trainings.filter((t) => t.target_scope === "selected").map((t) => t.id),
    ),
  ]);
  const roster = new Set(employees.map((e) => e.driver_id));
  const done = new Set<string>();
  for (const c of comps ?? []) {
    const r = c as Record<string, unknown>;
    const did = String(r.driver_id ?? "");
    if (roster.has(did)) done.add(cellKey(String(r.training_id ?? ""), did));
  }

  let totalNotMet = 0;
  for (const t of trainings) {
    for (const e of employees) {
      // 대상 아님 → 미이수로 세지 않음
      if (!isTrainingTarget(t, e, targetsByTraining.get(t.id))) continue;
      if (!done.has(cellKey(t.id, e.driver_id))) totalNotMet += 1;
    }
  }
  return { year, totalNotMet };
}

// =====================================================================
// 담당자가 직원 대신 수료증 업로드 / 열람 / 제거
//   * 경로: trainings/{trainingId}/{driverId}.{ext} (hr-documents Private).
//   * 업로드 = 즉시 이수 처리(training_completions upsert).
// =====================================================================
export async function adminUploadCertificate(
  formData: FormData
): Promise<{ ok: true; signedUrl: string | null } | { ok: false; message: string }> {
  try {
    const ctx = await requireTrainingAccess();

    const trainingId = String(formData.get("training_id") ?? "").trim();
    const driverId = String(formData.get("driver_id") ?? "").trim();
    if (!trainingId || !driverId) {
      return { ok: false, message: "교육/직원 정보가 누락되었습니다." };
    }

    // 존재 검증 — 임의 id 주입 차단. 기존 이수 기록(prev)도 함께 확인합니다.
    const [{ data: tr }, { data: drv }, { data: prof }, { data: prev }] =
      await Promise.all([
        supabaseAdmin
          .from("mandatory_trainings")
          .select("id, held_on, due_date, target_scope")
          .eq("id", trainingId)
          .maybeSingle(),
        supabaseAdmin
          .from("drivers")
          .select("id")
          .eq("id", driverId)
          .maybeSingle(),
        supabaseAdmin
          .from("employee_profiles")
          .select("join_date, resignation_date")
          .eq("driver_id", driverId)
          .maybeSingle(),
        supabaseAdmin
          .from("training_completions")
          .select("certificate_path")
          .eq("training_id", trainingId)
          .eq("driver_id", driverId)
          .maybeSingle(),
      ]);
    if (!tr) return { ok: false, message: "존재하지 않는 교육입니다." };
    if (!drv) return { ok: false, message: "존재하지 않는 직원입니다." };

    // 대상자 판정 — 대상 아닌 셀(퇴사 후 교육 / 개별 지정 교육의 비지정자)의
    //   "새" 이수 처리를 막습니다. 입사 전 교육은 대상입니다(before-join 제거).
    //   이미 기록이 있는 셀(과거에 올린 수료증)의 재업로드는 그대로 허용합니다.
    if (!prev) {
      const p = (prof ?? {}) as Record<string, unknown>;
      const rule = tr as Record<string, string | null>;
      const targets =
        normalizeTargetScope(rule.target_scope) === "selected"
          ? (await loadTrainingTargets([trainingId])).get(trainingId)
          : undefined;
      const state = trainingTargetState(
        rule,
        {
          driver_id: driverId,
          joinDate: (p.join_date as string | null) ?? null,
          resignationDate: (p.resignation_date as string | null) ?? null,
        },
        targets,
      );
      if (!state.isTarget) {
        return {
          ok: false,
          message:
            state.reason === "not-selected"
              ? "이 교육의 대상자로 지정되지 않은 직원입니다. 교육 수정에서 대상에 추가한 뒤 올려주세요."
              : "퇴사 후에 실시된 교육이라 이수 처리할 수 없습니다. (퇴사 후 교육)",
        };
      }
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, message: "업로드할 수료증 파일을 선택해주세요." };
    }
    if (file.size > CERT_MAX_BYTES) {
      return { ok: false, message: "파일 용량은 16MB 이하여야 합니다." };
    }
    const ext = CERT_EXT[file.type];
    if (!ext) {
      return { ok: false, message: "PDF, JPG, PNG 형식만 업로드할 수 있습니다." };
    }

    // 기존 파일 경로(확장자 바뀌면 옛 파일 삭제) — 위에서 함께 조회했습니다.
    const oldPath =
      ((prev as { certificate_path?: unknown } | null)?.certificate_path as
        | string
        | null) ?? null;

    const newPath = `trainings/${trainingId}/${driverId}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(HR_DOCUMENTS_BUCKET)
      .upload(newPath, file, { contentType: file.type, upsert: true });
    if (upErr) return { ok: false, message: `업로드 실패: ${upErr.message}` };

    const { error: dbErr } = await supabaseAdmin
      .from("training_completions")
      .upsert(
        {
          training_id: trainingId,
          driver_id: driverId,
          certificate_path: newPath,
          completed_at: new Date().toISOString(),
          uploaded_by: ctx.name,
        },
        { onConflict: "training_id,driver_id" }
      );
    if (dbErr) throw new Error(dbErr.message);

    if (oldPath && oldPath !== newPath) await removeHrDocuments([oldPath]);

    revalidatePath("/hr/trainings");
    return { ok: true, signedUrl: await signHrDocument(newPath) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "업로드 중 오류가 발생했습니다.",
    };
  }
}

// 담당자 — 임의 직원의 수료증 1시간 임시 열람 URL.
export async function adminGetCertificateUrl(
  trainingId: string,
  driverId: string
): Promise<string | null> {
  await requireTrainingAccess();
  if (!trainingId || !driverId) return null;
  const { data } = await supabaseAdmin
    .from("training_completions")
    .select("certificate_path")
    .eq("training_id", trainingId)
    .eq("driver_id", driverId)
    .maybeSingle();
  return signHrDocument(
    ((data as { certificate_path?: unknown } | null)?.certificate_path as
      | string
      | null) ?? null
  );
}

// 담당자 — 이수 취소(수료증·이수기록 제거).
export async function adminDeleteCompletion(
  trainingId: string,
  driverId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireTrainingAccess();
    if (!trainingId || !driverId) {
      return { ok: false, message: "교육/직원 정보가 누락되었습니다." };
    }
    const { data: prev } = await supabaseAdmin
      .from("training_completions")
      .select("certificate_path")
      .eq("training_id", trainingId)
      .eq("driver_id", driverId)
      .maybeSingle();
    const oldPath =
      ((prev as { certificate_path?: unknown } | null)?.certificate_path as
        | string
        | null) ?? null;

    const { error } = await supabaseAdmin
      .from("training_completions")
      .delete()
      .eq("training_id", trainingId)
      .eq("driver_id", driverId);
    if (error) throw new Error(error.message);
    if (oldPath) await removeHrDocuments([oldPath]);

    revalidatePath("/hr/trainings");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "취소 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 의무교육 D-7 독촉 — 수동 실행(M0 전용). Cron 과 동일 코어(lib/trainingReminder).
//   * Cron 하루 안 기다리고 검증용. 슬랙 실패해도 데이터 조회만 성공하면 ok.
// =====================================================================
export async function runTrainingReminderNow(): Promise<
  | { ok: true; summary: TrainingReminderSummary }
  | { ok: false; message: string }
> {
  try {
    const ctx = await requireTrainingAccess();
    if (!ctx.isM0) {
      return { ok: false, message: "독촉 발송은 관장·부장만 실행할 수 있습니다." };
    }
    const summary = await runTrainingReminder();
    return { ok: true, summary };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "독촉 실행 중 오류가 발생했습니다.",
    };
  }
}
