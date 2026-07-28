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
  CERT_EXT,
  CERT_MAX_BYTES,
  cellKey,
  type MandatoryTraining,
} from "@/lib/trainings";
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
  due_date: string | null;
  site_url: string | null;
  note: string | null;
  display_order: number | null;
  is_active: boolean;
};

function cleanStr(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

export async function saveTraining(
  input: TrainingInput
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    await requireTrainingAccess();

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

    const row = {
      year,
      name,
      due_date: cleanStr(input.due_date),
      site_url: cleanStr(input.site_url),
      note: cleanStr(input.note),
      display_order: order,
      is_active: input.is_active !== false,
    };

    if (input.id) {
      const { error } = await supabaseAdmin
        .from("mandatory_trainings")
        .update(row)
        .eq("id", input.id);
      if (error) throw new Error(error.message);
      revalidatePath("/hr/trainings");
      return { ok: true, id: input.id };
    }

    const { data, error } = await supabaseAdmin
      .from("mandatory_trainings")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/hr/trainings");
    return { ok: true, id: String((data as { id: unknown }).id) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.",
    };
  }
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
    await requireTrainingAccess();
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
        due_date: t.due_date,
        site_url: t.site_url,
        note: t.note,
        display_order: t.display_order,
        is_active: t.is_active,
      }));
    if (rows.length === 0) {
      return { ok: false, message: "복사할 새 교육이 없습니다(이미 모두 존재)." };
    }
    const { error } = await supabaseAdmin
      .from("mandatory_trainings")
      .insert(rows);
    if (error) throw new Error(error.message);
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
export type RosterEmployee = {
  driver_id: string;
  name: string;
  rank: string | null;
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
};

// 재직자 명단 — drivers.is_active 이면서 employee_profiles.employment_status
//   가 'resigned' 아닌 직원. 입사(created_at) 순.
async function listActiveRoster(): Promise<RosterEmployee[]> {
  const [{ data: drivers, error: dErr }, { data: profiles }] =
    await Promise.all([
      supabaseAdmin
        .from("drivers")
        .select("id, name, rank, is_active, created_at"),
      supabaseAdmin
        .from("employee_profiles")
        .select("driver_id, employment_status"),
    ]);
  if (dErr) throw new Error(dErr.message);
  const resigned = new Set<string>();
  for (const p of profiles ?? []) {
    const r = p as Record<string, unknown>;
    if (r.employment_status === "resigned")
      resigned.add(String(r.driver_id ?? ""));
  }
  const list = (drivers ?? [])
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        driver_id: String(r.id ?? ""),
        name: String(r.name ?? ""),
        rank: (r.rank as string | null) ?? null,
        is_active: r.is_active !== false,
        created: String(r.created_at ?? ""),
      };
    })
    .filter((e) => e.is_active && !resigned.has(e.driver_id));
  list.sort((a, b) => a.created.localeCompare(b.created));
  return list.map((e) => ({
    driver_id: e.driver_id,
    name: e.name,
    rank: e.rank,
  }));
}

export async function getTrainingMatrix(year: number): Promise<TrainingMatrix> {
  await requireTrainingAccess();
  const today = kstTodayYmd();

  const [trainingsRaw, employees] = await Promise.all([
    supabaseAdmin
      .from("mandatory_trainings")
      .select("*")
      .eq("year", year)
      .eq("is_active", true),
    listActiveRoster(),
  ]);
  if (trainingsRaw.error) throw new Error(trainingsRaw.error.message);

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

  return { today, trainings, employees, completions };
}

// 대시보드 관리 카드용 요약 — 올해 활성 교육 × 재직자 기준 미이수 총건.
//   접근 없으면 null(카드 미노출).
export async function getTrainingsAdminSummary(): Promise<
  { year: number; totalNotMet: number } | null
> {
  const ctx = await resolveTrainingAccess();
  if (!ctx) return null;
  const year = Number(kstTodayYmd().slice(0, 4));

  const [{ data: trs }, employees] = await Promise.all([
    supabaseAdmin
      .from("mandatory_trainings")
      .select("id")
      .eq("year", year)
      .eq("is_active", true),
    listActiveRoster(),
  ]);
  const trainingIds = (trs ?? []).map((r) => String((r as { id: unknown }).id));
  if (trainingIds.length === 0 || employees.length === 0) {
    return { year, totalNotMet: 0 };
  }

  const { data: comps } = await supabaseAdmin
    .from("training_completions")
    .select("training_id, driver_id")
    .in("training_id", trainingIds);
  const roster = new Set(employees.map((e) => e.driver_id));
  const done = new Set<string>();
  for (const c of comps ?? []) {
    const r = c as Record<string, unknown>;
    const did = String(r.driver_id ?? "");
    if (roster.has(did)) done.add(cellKey(String(r.training_id ?? ""), did));
  }
  const totalNotMet = trainingIds.length * employees.length - done.size;
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

    // 존재 검증 — 임의 id 주입 차단.
    const [{ data: tr }, { data: drv }] = await Promise.all([
      supabaseAdmin
        .from("mandatory_trainings")
        .select("id")
        .eq("id", trainingId)
        .maybeSingle(),
      supabaseAdmin
        .from("drivers")
        .select("id")
        .eq("id", driverId)
        .maybeSingle(),
    ]);
    if (!tr) return { ok: false, message: "존재하지 않는 교육입니다." };
    if (!drv) return { ok: false, message: "존재하지 않는 직원입니다." };

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

    // 기존 파일 경로 확인(확장자 바뀌면 옛 파일 삭제).
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
