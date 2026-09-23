"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireFacilityAccess } from "@/lib/facilityAccess";
import {
  toSafetyItem,
  toSafetyCheck,
  toSafetyResultRow,
  sortSafetyItems,
  type SafetyCheck,
  type SafetyItemWithResult,
  type SafetyResult,
} from "@/lib/safetyCheck";

// =====================================================================
// 안전점검 서버 액션 — 전부 service_role. 진입 시 facilityAccess 재검증.
//   safety_checks(unique check_year+check_month) / safety_check_results / _items.
// =====================================================================

const CHECKS = "safety_checks";
const RESULTS = "safety_check_results";
const ITEMS = "safety_check_items";

function cleanStr(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

// 활성 항목 전체.
async function loadActiveItems() {
  const { data, error } = await supabaseAdmin
    .from(ITEMS)
    .select("*")
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return sortSafetyItems((data ?? []).map((r) => toSafetyItem(r as Record<string, unknown>)));
}

// --- 목록 ------------------------------------------------------------
export async function listChecks(): Promise<SafetyCheck[]> {
  await requireFacilityAccess();
  const { data, error } = await supabaseAdmin
    .from(CHECKS)
    .select("*")
    .order("check_year", { ascending: false })
    .order("check_month", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toSafetyCheck(r as Record<string, unknown>));
}

// --- 상세(항목+결과 조인) --------------------------------------------
export type CheckDetail = {
  check: SafetyCheck;
  items: SafetyItemWithResult[];
  failCount: number;
};

export async function getCheck(id: string): Promise<CheckDetail | null> {
  await requireFacilityAccess();
  if (!id) return null;
  const { data: checkRaw, error: cErr } = await supabaseAdmin
    .from(CHECKS)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!checkRaw) return null;
  const check = toSafetyCheck(checkRaw as Record<string, unknown>);

  const [items, { data: resRaw, error: rErr }] = await Promise.all([
    loadActiveItems(),
    supabaseAdmin.from(RESULTS).select("*").eq("check_id", id),
  ]);
  if (rErr) throw new Error(rErr.message);
  const resByItem = new Map(
    (resRaw ?? [])
      .map((r) => toSafetyResultRow(r as Record<string, unknown>))
      .map((r) => [r.item_id, r])
  );

  const merged: SafetyItemWithResult[] = items.map((it) => {
    const res = resByItem.get(it.id);
    return {
      ...it,
      result: res?.result ?? (it.default_na ? "na" : "pass"),
      note: res?.note ?? null,
    };
  });
  const failCount = merged.filter((m) => m.result === "fail").length;
  return { check, items: merged, failCount };
}

// --- 결과 seed(신규/복사 공용) ---------------------------------------
// prevResults: item_id → {result, note} (복사용). 없으면 default(default_na→na, 그 외 pass).
async function seedResults(
  checkId: string,
  prev?: Map<string, { result: SafetyResult; note: string | null }>
) {
  const items = await loadActiveItems();
  const rows = items.map((it) => {
    const p = prev?.get(it.id);
    return {
      check_id: checkId,
      item_id: it.id,
      result: p?.result ?? (it.default_na ? "na" : "pass"),
      note: p?.note ?? null,
    };
  });
  const { error } = await supabaseAdmin.from(RESULTS).insert(rows);
  if (error) throw new Error(error.message);
}

async function existingCheck(
  year: number,
  month: number
): Promise<SafetyCheck | null> {
  const { data } = await supabaseAdmin
    .from(CHECKS)
    .select("*")
    .eq("check_year", year)
    .eq("check_month", month)
    .maybeSingle();
  return data ? toSafetyCheck(data as Record<string, unknown>) : null;
}

// --- 신규 점검(빈 표 — 기본값) ---------------------------------------
export async function createCheck(
  year: number,
  month: number
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const ctx = await requireFacilityAccess();
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || y < 2000 || y > 2100)
      return { ok: false, message: "연도가 올바르지 않습니다." };
    if (!Number.isInteger(m) || m < 1 || m > 12)
      return { ok: false, message: "월이 올바르지 않습니다." };
    if (await existingCheck(y, m))
      return {
        ok: false,
        message: `${y}년 ${m}월 점검표가 이미 있습니다. 목록에서 여세요.`,
      };

    const { data, error } = await supabaseAdmin
      .from(CHECKS)
      .insert({
        check_year: y,
        check_month: m,
        status: "draft",
        created_by: ctx.name,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const id = String((data as { id: string }).id);
    await seedResults(id);
    revalidatePath("/hr/facility/safety");
    return { ok: true, id };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "점검 생성 중 오류가 발생했습니다.",
    };
  }
}

// --- 직전월 복사 -----------------------------------------------------
export async function copyFromPrevious(
  year: number,
  month: number
): Promise<{ ok: true; id: string; copied: boolean } | { ok: false; message: string }> {
  try {
    const ctx = await requireFacilityAccess();
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12)
      return { ok: false, message: "연·월이 올바르지 않습니다." };
    if (await existingCheck(y, m))
      return {
        ok: false,
        message: `${y}년 ${m}월 점검표가 이미 있습니다. 목록에서 여세요.`,
      };

    // 직전월.
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    const prevCheck = await existingCheck(py, pm);
    let prevMap:
      | Map<string, { result: SafetyResult; note: string | null }>
      | undefined;
    if (prevCheck) {
      const { data: prevRes } = await supabaseAdmin
        .from(RESULTS)
        .select("*")
        .eq("check_id", prevCheck.id);
      prevMap = new Map(
        (prevRes ?? [])
          .map((r) => toSafetyResultRow(r as Record<string, unknown>))
          .map((r) => [r.item_id, { result: r.result, note: r.note }])
      );
    }

    const { data, error } = await supabaseAdmin
      .from(CHECKS)
      .insert({
        check_year: y,
        check_month: m,
        status: "draft",
        created_by: ctx.name,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const id = String((data as { id: string }).id);
    await seedResults(id, prevMap);
    revalidatePath("/hr/facility/safety");
    return { ok: true, id, copied: !!prevCheck };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "복사 생성 중 오류가 발생했습니다.",
    };
  }
}

// --- 점검 상태 가드 --------------------------------------------------
async function assertDraft(checkId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from(CHECKS)
    .select("status")
    .eq("id", checkId)
    .maybeSingle();
  if (!data) throw new Error("점검표를 찾을 수 없습니다.");
  if ((data as { status: string }).status === "completed")
    throw new Error("완료된 점검표는 수정할 수 없습니다.");
}

// --- 결과 수정(적합/부적합/해당없음 + 지적사항) ----------------------
export async function updateResult(
  checkId: string,
  itemId: string,
  result: SafetyResult,
  note: string | null
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireFacilityAccess();
    if (!checkId || !itemId) return { ok: false, message: "대상이 없습니다." };
    if (!["pass", "fail", "na"].includes(result))
      return { ok: false, message: "결과 값이 올바르지 않습니다." };
    await assertDraft(checkId);

    const cleanNote = cleanStr(note);
    // update → 없으면 insert.
    const { data: upd, error: upErr } = await supabaseAdmin
      .from(RESULTS)
      .update({ result, note: cleanNote })
      .eq("check_id", checkId)
      .eq("item_id", itemId)
      .select("id");
    if (upErr) throw new Error(upErr.message);
    if (!upd || upd.length === 0) {
      const { error: insErr } = await supabaseAdmin
        .from(RESULTS)
        .insert({ check_id: checkId, item_id: itemId, result, note: cleanNote });
      if (insErr) throw new Error(insErr.message);
    }
    revalidatePath(`/hr/facility/safety/${checkId}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "결과 저장 중 오류가 발생했습니다.",
    };
  }
}

// --- 점검일시 / 점검자 -----------------------------------------------
export async function setInspector(
  checkId: string,
  inspector: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  return updateCheckHeader(checkId, { inspector: cleanStr(inspector) });
}
export async function setCheckedOn(
  checkId: string,
  checkedOn: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  return updateCheckHeader(checkId, { checked_on: cleanStr(checkedOn) });
}

async function updateCheckHeader(
  checkId: string,
  patch: { inspector?: string | null; checked_on?: string | null }
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireFacilityAccess();
    if (!checkId) return { ok: false, message: "대상이 없습니다." };
    await assertDraft(checkId);
    const { error } = await supabaseAdmin
      .from(CHECKS)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", checkId);
    if (error) throw new Error(error.message);
    revalidatePath(`/hr/facility/safety/${checkId}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.",
    };
  }
}

// --- 완료 처리 -------------------------------------------------------
export async function completeCheck(
  checkId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireFacilityAccess();
    if (!checkId) return { ok: false, message: "대상이 없습니다." };
    const { data, error: cErr } = await supabaseAdmin
      .from(CHECKS)
      .select("inspector, checked_on, status")
      .eq("id", checkId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!data) return { ok: false, message: "점검표를 찾을 수 없습니다." };
    const row = data as {
      inspector: string | null;
      checked_on: string | null;
      status: string;
    };
    if (row.status === "completed") return { ok: true };
    if (!cleanStr(row.inspector) || !cleanStr(row.checked_on))
      return {
        ok: false,
        message: "점검일시와 점검자를 먼저 입력한 뒤 완료해 주세요.",
      };
    const { error } = await supabaseAdmin
      .from(CHECKS)
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", checkId);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/facility/safety");
    revalidatePath(`/hr/facility/safety/${checkId}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "완료 처리 중 오류가 발생했습니다.",
    };
  }
}

// 완료 취소(작성중으로) — 수정 재개용.
export async function reopenCheck(
  checkId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireFacilityAccess();
    if (!checkId) return { ok: false, message: "대상이 없습니다." };
    const { error } = await supabaseAdmin
      .from(CHECKS)
      .update({ status: "draft", updated_at: new Date().toISOString() })
      .eq("id", checkId);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/facility/safety");
    revalidatePath(`/hr/facility/safety/${checkId}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "취소 중 오류가 발생했습니다.",
    };
  }
}

// --- 삭제 — M0 전용 --------------------------------------------------
export async function deleteCheck(
  checkId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireFacilityAccess({ onlyM0: true });
    if (!checkId) return { ok: false, message: "대상이 없습니다." };
    // 결과 먼저 삭제(FK CASCADE 없을 수 있으므로 방어적).
    await supabaseAdmin.from(RESULTS).delete().eq("check_id", checkId);
    const { error } = await supabaseAdmin.from(CHECKS).delete().eq("id", checkId);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/facility/safety");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.",
    };
  }
}
