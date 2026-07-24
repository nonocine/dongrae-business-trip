"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/app/actions";
import {
  supabase,
  signHrDocument,
  removeHrDocuments,
  HR_DOCUMENTS_BUCKET,
} from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  toTraining,
  sortTrainings,
  daysUntil,
  kstTodayYmd,
  CERT_EXT,
  CERT_MAX_BYTES,
} from "@/lib/trainings";

// =====================================================================
// 직원 본인(self) 의무교육 액션 — /profile/hr "내 의무교육" + 대시보드 카드.
//   * driver_id 는 항상 세션에서만 도출(폼 값 신뢰 안 함) → 타인 기록 접근 차단.
//   * 업로드 = 즉시 이수(training_completions upsert). 본인 것만 열람/재업로드/삭제.
//   * 수료증 교차 열람 차단: getMyCertificateUrl 은 본인 driver_id 행만 서명.
// =====================================================================

// 세션 직원 → drivers row(id,name). 아니면 null.
async function getMyDriver(): Promise<{ id: string; name: string } | null> {
  const session = await getSession();
  if (!session || session.kind !== "employee") return null;
  const { data } = await supabaseAdmin
    .from("drivers")
    .select("id, name")
    .eq("name", session.name)
    .maybeSingle();
  if (!data) return null;
  const id = String((data as { id?: unknown }).id ?? "");
  if (!id) return null;
  return { id, name: String((data as { name?: unknown }).name ?? "") };
}

// KST 기준 올해.
function currentYear(): number {
  return Number(kstTodayYmd().slice(0, 4));
}

export type MyTrainingItem = {
  training_id: string;
  name: string;
  due_date: string | null;
  site_url: string | null;
  note: string | null;
  dday: number | null;
  completed: boolean;
  completed_at: string | null;
  has_cert: boolean;
};

export type MyTrainings = {
  year: number;
  today: string;
  items: MyTrainingItem[];
};

// 올해 활성 교육 목록 + 본인 이수 상태. 직원 세션 아니면 null.
export async function getMyTrainings(): Promise<MyTrainings | null> {
  const driver = await getMyDriver();
  if (!driver) return null;
  const year = currentYear();
  const today = kstTodayYmd();

  const { data: trs } = await supabaseAdmin
    .from("mandatory_trainings")
    .select("*")
    .eq("year", year)
    .eq("is_active", true);
  const trainings = sortTrainings(
    (trs ?? []).map((r) => toTraining(r as Record<string, unknown>))
  );
  if (trainings.length === 0) return { year, today, items: [] };

  const { data: comps } = await supabaseAdmin
    .from("training_completions")
    .select("training_id, completed_at, certificate_path")
    .eq("driver_id", driver.id)
    .in(
      "training_id",
      trainings.map((t) => t.id)
    );
  const doneMap = new Map<
    string,
    { completed_at: string | null; has_cert: boolean }
  >();
  for (const c of comps ?? []) {
    const r = c as Record<string, unknown>;
    doneMap.set(String(r.training_id ?? ""), {
      completed_at: (r.completed_at as string | null) ?? null,
      has_cert:
        typeof r.certificate_path === "string" &&
        (r.certificate_path as string).length > 0,
    });
  }

  const items: MyTrainingItem[] = trainings.map((t) => {
    const done = doneMap.get(t.id);
    return {
      training_id: t.id,
      name: t.name,
      due_date: t.due_date,
      site_url: t.site_url,
      note: t.note,
      dday: daysUntil(t.due_date, today),
      completed: !!done,
      completed_at: done?.completed_at ?? null,
      has_cert: done?.has_cert ?? false,
    };
  });

  return { year, today, items };
}

// 본인 수료증 업로드 — 업로드 = 즉시 이수. 경로 trainings/{trainingId}/{driverId}.{ext}.
export async function uploadMyCertificate(
  formData: FormData
): Promise<{ ok: true; signedUrl: string | null } | { ok: false; message: string }> {
  try {
    const driver = await getMyDriver();
    if (!driver) return { ok: false, message: "직원 로그인이 필요합니다." };

    const trainingId = String(formData.get("training_id") ?? "").trim();
    if (!trainingId) return { ok: false, message: "교육 정보가 없습니다." };

    // 교육 존재 확인(임의 id 주입 차단).
    const { data: tr } = await supabaseAdmin
      .from("mandatory_trainings")
      .select("id")
      .eq("id", trainingId)
      .maybeSingle();
    if (!tr) return { ok: false, message: "존재하지 않는 교육입니다." };

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

    const { data: prev } = await supabaseAdmin
      .from("training_completions")
      .select("certificate_path")
      .eq("training_id", trainingId)
      .eq("driver_id", driver.id)
      .maybeSingle();
    const oldPath =
      ((prev as { certificate_path?: unknown } | null)?.certificate_path as
        | string
        | null) ?? null;

    const newPath = `trainings/${trainingId}/${driver.id}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(HR_DOCUMENTS_BUCKET)
      .upload(newPath, file, { contentType: file.type, upsert: true });
    if (upErr) return { ok: false, message: `업로드 실패: ${upErr.message}` };

    const { error: dbErr } = await supabaseAdmin
      .from("training_completions")
      .upsert(
        {
          training_id: trainingId,
          driver_id: driver.id,
          certificate_path: newPath,
          completed_at: new Date().toISOString(),
          uploaded_by: driver.name,
        },
        { onConflict: "training_id,driver_id" }
      );
    if (dbErr) throw new Error(dbErr.message);

    if (oldPath && oldPath !== newPath) await removeHrDocuments([oldPath]);

    revalidatePath("/profile/hr");
    return { ok: true, signedUrl: await signHrDocument(newPath) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "업로드 중 오류가 발생했습니다.",
    };
  }
}

// 본인 수료증 열람 URL — 본인 driver_id 행만 서명(교차 열람 차단).
export async function getMyCertificateUrl(
  trainingId: string
): Promise<string | null> {
  const driver = await getMyDriver();
  if (!driver || !trainingId) return null;
  const { data } = await supabaseAdmin
    .from("training_completions")
    .select("certificate_path")
    .eq("training_id", trainingId)
    .eq("driver_id", driver.id)
    .maybeSingle();
  return signHrDocument(
    ((data as { certificate_path?: unknown } | null)?.certificate_path as
      | string
      | null) ?? null
  );
}

// 본인 이수 취소(수료증·기록 제거).
export async function deleteMyCertificate(
  trainingId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const driver = await getMyDriver();
    if (!driver) return { ok: false, message: "직원 로그인이 필요합니다." };
    if (!trainingId) return { ok: false, message: "교육 정보가 없습니다." };

    const { data: prev } = await supabaseAdmin
      .from("training_completions")
      .select("certificate_path")
      .eq("training_id", trainingId)
      .eq("driver_id", driver.id)
      .maybeSingle();
    if (!prev) return { ok: true };
    const oldPath =
      ((prev as { certificate_path?: unknown }).certificate_path as
        | string
        | null) ?? null;

    const { error } = await supabaseAdmin
      .from("training_completions")
      .delete()
      .eq("training_id", trainingId)
      .eq("driver_id", driver.id);
    if (error) throw new Error(error.message);
    if (oldPath) await removeHrDocuments([oldPath]);

    revalidatePath("/profile/hr");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "취소 중 오류가 발생했습니다.",
    };
  }
}

// 대시보드 카드용 요약 — 올해 기준. 직원 세션 아니면 null.
export type MyTrainingSummary = {
  total: number;
  done: number;
  notMet: number;
  nearest: { name: string; dday: number | null } | null; // 미이수 중 가장 임박
};

export async function getMyTrainingSummary(): Promise<MyTrainingSummary | null> {
  const my = await getMyTrainings();
  if (!my) return null;
  const total = my.items.length;
  const done = my.items.filter((i) => i.completed).length;
  const notMet = total - done;

  // 미이수 중 기한이 가장 임박한 교육(기한 없는 것은 후순위).
  const pending = my.items.filter((i) => !i.completed);
  pending.sort((a, b) => {
    if (a.dday == null && b.dday == null) return 0;
    if (a.dday == null) return 1;
    if (b.dday == null) return -1;
    return a.dday - b.dday;
  });
  const nearest =
    pending.length > 0
      ? { name: pending[0].name, dday: pending[0].dday }
      : null;

  return { total, done, notMet, nearest };
}
