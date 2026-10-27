"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireBangkaAccess } from "@/lib/bangkaAccess";
import { bucket } from "@/lib/bangkaMedia";
import { readXlsxGrid } from "@/lib/bangkaMenuXlsx";
import { allergyNoteOf, menuItemsOf, mondayOfYmd, parseVendorWeek } from "@/lib/bangkaMenuParse";

// =====================================================================
// 업체 주간 식단표(xlsx) 올리기 — /bangka/meals/upload
//   1) 미리보기: 파일 → 칸 격자를 돌려줌(해석은 브라우저가 같은 함수로 — 칸을 고치면 바로 다시 해석)
//   2) 저장: 파일을 다시 받아 서버가 격자를 읽고, 직원이 고친 칸(edits)을 덮어쓴 뒤 다시 해석.
//      bk_meal_weeks 1줄(week_start 기준 덮어쓰기) + bk_meals 날짜별(사진은 그대로) + 원본 보관.
//   이미 메뉴가 있는 날짜는 overwrite 확인이 있어야만 덮어씁니다.
// =====================================================================

const MAX_BYTES = 5 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const fail = (e: unknown, fb: string) => ({ ok: false as const, message: e instanceof Error ? e.message : fb });

export type CellEdit = { r: number; c: number; value: string };

async function fileFrom(fd: FormData): Promise<{ file: File; bytes: Uint8Array }> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("엑셀 파일을 고르세요.");
  if (!/\.xlsx$/i.test(file.name)) throw new Error("xlsx 파일만 올릴 수 있습니다(xls·pdf 는 안 됩니다).");
  if (file.size > MAX_BYTES) throw new Error("5MB 이하 파일만 올릴 수 있습니다.");
  return { file, bytes: new Uint8Array(await file.arrayBuffer()) };
}

async function existingMenuDates(dates: string[]): Promise<string[]> {
  if (!dates.length) return [];
  const { data, error } = await supabaseAdmin.from("bk_meals").select("meal_date, menu_text").in("meal_date", dates);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { meal_date: string; menu_text: string | null }[])
    .filter((r) => (r.menu_text ?? "").trim())
    .map((r) => r.meal_date)
    .sort();
}

export async function previewMenuXlsx(fd: FormData): Promise<Result<{ grid: string[][]; sheetName: string; existing: string[] }>> {
  try {
    await requireBangkaAccess();
    const { bytes } = await fileFrom(fd);
    const g = await readXlsxGrid(bytes);
    const week = parseVendorWeek(g.rows);
    const existing = await existingMenuDates(week.days.filter((d) => d.hasMeal).map((d) => d.date!));
    return { ok: true, grid: g.rows, sheetName: g.sheetName, existing };
  } catch (e) {
    return fail(e, "식단표를 읽지 못했습니다.");
  }
}

export async function saveMenuXlsx(fd: FormData): Promise<Result<{ saved: string[] }>> {
  try {
    const me = await requireBangkaAccess();
    const { file, bytes } = await fileFrom(fd);
    const edits = JSON.parse(String(fd.get("edits") ?? "[]")) as CellEdit[];
    const overwrite = fd.get("overwrite") === "1";

    const g = await readXlsxGrid(bytes);
    const grid = g.rows.map((r) => [...r]);
    for (const e of Array.isArray(edits) ? edits : []) {
      if (!Number.isInteger(e?.r) || !Number.isInteger(e?.c) || e.r < 0 || e.c < 0 || e.r > 500 || e.c > 100) continue;
      while (grid.length <= e.r) grid.push([]);
      while (grid[e.r].length <= e.c) grid[e.r].push("");
      grid[e.r][e.c] = String(e.value ?? "").slice(0, 200);
    }
    const week = parseVendorWeek(grid);
    if (week.errors.length) return { ok: false, message: week.errors.join(" ") };
    const days = week.days.filter((d) => d.hasMeal);
    const dates = days.map((d) => d.date!);
    const existing = await existingMenuDates(dates);
    if (existing.length && !overwrite) {
      return { ok: false, message: `이미 식단이 있는 날짜(${existing.join(", ")})가 있습니다. 덮어쓰기를 확인해 주세요.` };
    }

    const weekStart = mondayOfYmd(dates[0]);
    const now = new Date().toISOString();
    const srcPath = `meal-sources/${weekStart}/${crypto.randomUUID()}.xlsx`;
    const { error: upErr } = await bucket().upload(srcPath, bytes, { contentType: XLSX_MIME, upsert: false });
    if (upErr) throw new Error(`원본 보관 실패: ${upErr.message}`);

    const { data: prev } = await supabaseAdmin.from("bk_meal_weeks").select("source_file_path").eq("week_start", weekStart).maybeSingle();
    const { data: wk, error: wkErr } = await supabaseAdmin
      .from("bk_meal_weeks")
      .upsert(
        {
          week_start: weekStart,
          title: week.title || file.name,
          dietitian: week.dietitian,
          vendor: week.vendor,
          nutrition_basis: week.nutritionBasis,
          allergen_legend: week.allergenLegend,
          origin_text: week.originText,
          source_file_path: srcPath,
          uploaded_by: me.name,
          updated_at: now,
        },
        { onConflict: "week_start" },
      )
      .select("id")
      .single();
    if (wkErr || !wk) {
      await bucket().remove([srcPath]);
      throw new Error(wkErr?.message ?? "주간 식단을 저장하지 못했습니다.");
    }

    // 메뉴 칸만 갱신 — photo_* 는 보내지 않으므로 그날 올린 사진은 그대로 남습니다.
    const rows = days.map((d) => {
      const items = menuItemsOf(d);
      return {
        meal_date: d.date!,
        menu_text: items.map((i) => i.name).join("\n"),
        allergy_note: allergyNoteOf(items),
        week_id: (wk as { id: string }).id,
        menu_items: items,
        kcal: d.nutrition.kcal,
        protein_pct: d.nutrition.protein_pct,
        calcium_mg: d.nutrition.calcium_mg,
        iron_mg: d.nutrition.iron_mg,
        updated_at: now,
      };
    });
    const { error } = await supabaseAdmin.from("bk_meals").upsert(rows, { onConflict: "meal_date" });
    if (error) throw new Error(error.message);

    const old = (prev as { source_file_path?: string | null } | null)?.source_file_path;
    if (old && old !== srcPath) await bucket().remove([old]);
    revalidatePath("/bangka/meals");
    return { ok: true, saved: dates };
  } catch (e) {
    return fail(e, "식단표를 저장하지 못했습니다.");
  }
}
