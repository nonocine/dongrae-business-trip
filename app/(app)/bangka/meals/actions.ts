"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireBangkaAccess } from "@/lib/bangkaAccess";
import {
  BK_MAX_BYTES,
  bkFileKind,
  fmtBytes,
  isYm,
  parseMealPaste,
  shiftYm,
  type BkMealLine,
  type BkMealRow,
} from "@/lib/bangkaContent";
import { bucket, finalizeImage, newObjectName, signedUrls, signUpload } from "@/lib/bangkaMedia";

// =====================================================================
// 급식(bk_meals — 하루 1행, 반 공통) 서버 액션 — /bangka/meals
//   * menu_text 는 줄바꿈 구분. 사진은 하루 1장(bangka-media/meals/{date}/, 긴 변 1600px).
//   * 일괄 입력은 메뉴만 바꾸고 이미 올린 사진은 그대로 둡니다.
// =====================================================================

const MEALS = "bk_meals";
const BASE = "/bangka/meals";
const YMD = /^\d{4}-\d{2}-\d{2}$/;

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const fail = (e: unknown, fb: string) => ({ ok: false as const, message: e instanceof Error ? e.message : fb });

export async function listMeals(ym: string): Promise<BkMealRow[]> {
  await requireBangkaAccess();
  if (!isYm(ym)) return [];
  const { data, error } = await supabaseAdmin
    .from(MEALS)
    .select("meal_date, menu_text, allergy_note, photo_path")
    .gte("meal_date", `${ym}-01`)
    .lt("meal_date", `${shiftYm(ym, 1)}-01`)
    .order("meal_date");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { meal_date: string; menu_text: string; allergy_note: string | null; photo_path: string | null }[];
  const urls = await signedUrls(rows.map((r) => r.photo_path).filter((p): p is string => !!p));
  return rows.map(({ photo_path, ...r }) => ({ ...r, photo_url: photo_path ? urls.get(photo_path) ?? null : null }));
}

// 하루 저장. 메뉴를 비우면: 사진이 없으면 그날 행을 지우고, 있으면 메뉴만 비웁니다.
export async function saveMeal(input: { date: string; menu: string; allergy: string }): Promise<Result> {
  try {
    await requireBangkaAccess();
    if (!YMD.test(input.date)) return { ok: false, message: "날짜가 올바르지 않습니다." };
    const menu = (input.menu ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
    const allergy = (input.allergy ?? "").trim() || null;
    const { data: cur } = await supabaseAdmin.from(MEALS).select("photo_path").eq("meal_date", input.date).maybeSingle();
    const hasPhoto = !!(cur as { photo_path?: string | null } | null)?.photo_path;
    if (!menu && !hasPhoto) {
      if (cur) {
        const { error } = await supabaseAdmin.from(MEALS).delete().eq("meal_date", input.date);
        if (error) throw new Error(error.message);
      }
    } else {
      const { error } = await supabaseAdmin
        .from(MEALS)
        .upsert(
          { meal_date: input.date, menu_text: menu, allergy_note: allergy, updated_at: new Date().toISOString() },
          { onConflict: "meal_date" }
        );
      if (error) throw new Error(error.message);
    }
    revalidatePath(BASE);
    return { ok: true };
  } catch (e) {
    return fail(e, "급식을 저장하지 못했습니다.");
  }
}

export async function previewMealPaste(text: string, ym: string): Promise<Result<{ lines: BkMealLine[]; existing: string[] }>> {
  try {
    await requireBangkaAccess();
    if (!isYm(ym)) return { ok: false, message: "달을 고르세요." };
    const lines = parseMealPaste(text, ym);
    const dates = lines.map((l) => l.date).filter((d): d is string => !!d);
    let existing: string[] = [];
    if (dates.length) {
      const { data, error } = await supabaseAdmin.from(MEALS).select("meal_date").in("meal_date", dates);
      if (error) throw new Error(error.message);
      existing = ((data ?? []) as { meal_date: string }[]).map((r) => r.meal_date);
    }
    return { ok: true, lines, existing };
  } catch (e) {
    return fail(e, "미리보기를 만들지 못했습니다.");
  }
}

// 저장은 원문을 서버가 다시 해석합니다. 오류 줄이 있으면 아무것도 저장하지 않습니다.
export async function saveMealPaste(text: string, ym: string): Promise<Result<{ saved: number }>> {
  try {
    await requireBangkaAccess();
    if (!isYm(ym)) return { ok: false, message: "달을 고르세요." };
    const lines = parseMealPaste(text, ym);
    const bad = lines.filter((l) => l.errors.length);
    if (bad.length) return { ok: false, message: `오류 ${bad.length}줄을 먼저 고쳐 주세요.` };
    if (!lines.length) return { ok: false, message: "저장할 줄이 없습니다." };
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from(MEALS)
      .upsert(
        lines.map((l) => ({ meal_date: l.date!, menu_text: l.menu, updated_at: now })),
        { onConflict: "meal_date" }
      );
    if (error) throw new Error(error.message);
    revalidatePath(BASE);
    return { ok: true, saved: lines.length };
  } catch (e) {
    return fail(e, "일괄 입력을 저장하지 못했습니다.");
  }
}

export async function createMealPhotoUpload(input: {
  date: string;
  name: string;
  mime: string;
  size: number;
}): Promise<Result<{ path: string; token: string }>> {
  try {
    await requireBangkaAccess();
    if (!YMD.test(input.date)) return { ok: false, message: "날짜가 올바르지 않습니다." };
    if (bkFileKind(input.name, input.mime) !== "image") return { ok: false, message: "사진만 올릴 수 있습니다." };
    if (input.size > BK_MAX_BYTES.image)
      return { ok: false, message: `${fmtBytes(BK_MAX_BYTES.image)} 이하 사진만 올릴 수 있습니다.` };
    return { ok: true, ...(await signUpload(`tmp/${newObjectName(input.name, "jpg")}`)) };
  } catch (e) {
    return fail(e, "업로드를 준비하지 못했습니다.");
  }
}

// 사진 마무리 — 줄여서 meals/{date}/ 에 저장하고, 그날 예전 사진은 지웁니다.
export async function finalizeMealPhoto(input: { date: string; path: string; mime: string }): Promise<Result> {
  try {
    const me = await requireBangkaAccess();
    if (!YMD.test(input.date)) return { ok: false, message: "날짜가 올바르지 않습니다." };
    const img = await finalizeImage(input.path, `meals/${input.date}`, input.mime);
    const { data: cur } = await supabaseAdmin.from(MEALS).select("photo_path").eq("meal_date", input.date).maybeSingle();
    const old = (cur as { photo_path?: string | null } | null)?.photo_path ?? null;
    const photo = { photo_path: img.path, photo_by: me.name, photo_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { error } = cur
      ? await supabaseAdmin.from(MEALS).update(photo).eq("meal_date", input.date)
      : await supabaseAdmin.from(MEALS).insert({ meal_date: input.date, menu_text: "", ...photo });
    if (error) {
      await bucket().remove([img.path]);
      throw new Error(error.message);
    }
    if (old && old !== img.path) await bucket().remove([old]);
    revalidatePath(BASE);
    return { ok: true };
  } catch (e) {
    return fail(e, "사진을 저장하지 못했습니다.");
  }
}

export async function deleteMealPhoto(date: string): Promise<Result> {
  try {
    await requireBangkaAccess();
    if (!YMD.test(date)) return { ok: false, message: "날짜가 올바르지 않습니다." };
    const { data: cur } = await supabaseAdmin.from(MEALS).select("photo_path, menu_text").eq("meal_date", date).maybeSingle();
    const c = cur as { photo_path: string | null; menu_text: string } | null;
    if (!c?.photo_path) return { ok: true };
    const { error: rmErr } = await bucket().remove([c.photo_path]);
    if (rmErr) return { ok: false, message: `사진 삭제 실패: ${rmErr.message}` };
    const { error } = c.menu_text
      ? await supabaseAdmin
          .from(MEALS)
          .update({ photo_path: null, photo_by: null, photo_at: null, updated_at: new Date().toISOString() })
          .eq("meal_date", date)
      : await supabaseAdmin.from(MEALS).delete().eq("meal_date", date);
    if (error) throw new Error(error.message);
    revalidatePath(BASE);
    return { ok: true };
  } catch (e) {
    return fail(e, "사진을 삭제하지 못했습니다.");
  }
}
