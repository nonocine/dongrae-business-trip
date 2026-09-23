"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  requireFacilityAccess,
} from "@/lib/facilityAccess";
import {
  toFacilityAsset,
  toFacilityLocation,
  type FacilityAsset,
  type FacilityLocation,
  type AssetInput,
  type AssetFilters,
} from "@/lib/facility";

// =====================================================================
// 시설관리(비품관리) 서버 액션 — /hr/facility
//   * 전부 service_role(supabaseAdmin). RLS 0개 테이블이므로 진입 시 권한 재검증.
//   * 공유 인스턴스 주의: facility_assets / facility_locations 만 건드립니다.
//   * amount·disposal_scheduled_on 은 DB GENERATED → INSERT/UPDATE 에 넣지 않음.
// =====================================================================

const ASSETS = "facility_assets";
const LOCATIONS = "facility_locations";

function cleanStr(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

// --- 비품 조회 --------------------------------------------------------
// 전체(또는 필터). 정렬 기본 acquired_on desc. 68행 규모라 필터는 메모리에서 적용.
export async function listAssets(
  filters?: AssetFilters
): Promise<FacilityAsset[]> {
  await requireFacilityAccess();
  const { data, error } = await supabaseAdmin
    .from(ASSETS)
    .select("*")
    .order("acquired_on", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  let rows = (data ?? []).map((r) => toFacilityAsset(r as Record<string, unknown>));

  if (filters) {
    const f = filters;
    if (f.year && f.year !== "all") {
      const y = String(f.year);
      rows = rows.filter((r) => (r.acquired_on ?? "").slice(0, 4) === y);
    }
    if (f.location && f.location !== "all") {
      rows = rows.filter((r) => r.location === f.location);
    }
    if (f.budget_source && f.budget_source !== "all") {
      rows = rows.filter((r) => r.budget_source === f.budget_source);
    }
    if (f.acquisition_type && f.acquisition_type !== "all") {
      rows = rows.filter((r) => r.acquisition_type === f.acquisition_type);
    }
    if (f.status && f.status !== "all") {
      rows =
        f.status === "disposed"
          ? rows.filter((r) => !!r.disposed_on)
          : rows.filter((r) => !r.disposed_on);
    }
    if (f.q && f.q.trim()) {
      const q = f.q.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.item_name.toLowerCase().includes(q) ||
          (r.spec ?? "").toLowerCase().includes(q)
      );
    }
  }
  return rows;
}

// --- 장소 조회 --------------------------------------------------------
export async function getLocations(
  activeOnly?: boolean
): Promise<FacilityLocation[]> {
  await requireFacilityAccess();
  let query = supabaseAdmin.from(LOCATIONS).select("*");
  if (activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toFacilityLocation(r as Record<string, unknown>));
}

// 장소별 사용중 비품 수 — 장소관리 페이지에서 사용.
export async function getLocationAssetCounts(): Promise<Record<string, number>> {
  await requireFacilityAccess();
  const { data, error } = await supabaseAdmin
    .from(ASSETS)
    .select("location, disposed_on");
  if (error) throw new Error(error.message);
  const counts: Record<string, number> = {};
  for (const r of data ?? []) {
    const rr = r as { location?: unknown; disposed_on?: unknown };
    if (rr.disposed_on) continue; // 사용중만 집계
    const name = cleanStr(rr.location as string | null);
    if (!name) continue;
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

// --- 비품 등록/수정 ---------------------------------------------------
// amount·disposal_scheduled_on 은 넣지 않음(DB 자동계산).
function assetPayload(input: AssetInput) {
  const quantity = Math.max(1, Math.round(Number(input.quantity) || 0));
  const unitPrice = Math.max(0, Math.round(Number(input.unit_price) || 0));
  const life =
    input.useful_life_years == null || String(input.useful_life_years) === ""
      ? null
      : Math.max(0, Math.round(Number(input.useful_life_years)));
  return {
    acquired_on: cleanStr(input.acquired_on),
    item_name: (input.item_name ?? "").trim(),
    spec: cleanStr(input.spec),
    location: cleanStr(input.location),
    unit: cleanStr(input.unit),
    quantity,
    unit_price: unitPrice,
    useful_life_years: life,
    budget_source: cleanStr(input.budget_source),
    acquisition_type: input.acquisition_type === "관리전환" ? "관리전환" : "구매",
    note: cleanStr(input.note),
  };
}

export async function createAsset(
  input: AssetInput
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const ctx = await requireFacilityAccess();
    const payload = assetPayload(input);
    if (!payload.item_name) return { ok: false, message: "품목을 입력하세요." };
    const { data, error } = await supabaseAdmin
      .from(ASSETS)
      .insert({ ...payload, created_by: ctx.name })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/hr/facility/assets");
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "비품 등록 중 오류가 발생했습니다.",
    };
  }
}

export async function updateAsset(
  id: string,
  input: AssetInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireFacilityAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const payload = assetPayload(input);
    if (!payload.item_name) return { ok: false, message: "품목을 입력하세요." };
    const { error } = await supabaseAdmin
      .from(ASSETS)
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/facility/assets");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "비품 수정 중 오류가 발생했습니다.",
    };
  }
}

// --- 불용 처리 / 되돌리기 ---------------------------------------------
export async function disposeAsset(
  id: string,
  disposed_on: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireFacilityAccess();
    const day = cleanStr(disposed_on);
    if (!id || !day) return { ok: false, message: "불용일자를 입력하세요." };
    const { error } = await supabaseAdmin
      .from(ASSETS)
      .update({ disposed_on: day, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/facility/assets");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "불용 처리 중 오류가 발생했습니다.",
    };
  }
}

export async function restoreAsset(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireFacilityAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const { error } = await supabaseAdmin
      .from(ASSETS)
      .update({ disposed_on: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/facility/assets");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "되돌리기 중 오류가 발생했습니다.",
    };
  }
}

// --- 삭제 — M0 전용(서버 재검증) --------------------------------------
export async function deleteAsset(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireFacilityAccess({ onlyM0: true });
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const { error } = await supabaseAdmin.from(ASSETS).delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/facility/assets");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.",
    };
  }
}

// --- 장소 관리 --------------------------------------------------------
export async function createLocation(
  name: string
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    await requireFacilityAccess();
    const nm = cleanStr(name);
    if (!nm) return { ok: false, message: "장소명을 입력하세요." };

    // 이미 있으면(활성/비활성 무관) 재사용 — unique 제약 충돌 방지.
    const { data: existing } = await supabaseAdmin
      .from(LOCATIONS)
      .select("id, is_active")
      .eq("name", nm)
      .maybeSingle();
    if (existing) {
      const ex = existing as { id: string; is_active: boolean };
      if (!ex.is_active) {
        await supabaseAdmin
          .from(LOCATIONS)
          .update({ is_active: true })
          .eq("id", ex.id);
      }
      revalidatePath("/hr/facility/locations");
      revalidatePath("/hr/facility/assets");
      return { ok: true, id: ex.id };
    }

    // sort_order = 현재 최대 + 1.
    const { data: maxRow } = await supabaseAdmin
      .from(LOCATIONS)
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder =
      Number((maxRow as { sort_order?: number } | null)?.sort_order ?? 0) + 1;

    const { data, error } = await supabaseAdmin
      .from(LOCATIONS)
      .insert({ name: nm, sort_order: nextOrder, is_active: true })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/hr/facility/locations");
    revalidatePath("/hr/facility/assets");
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "장소 추가 중 오류가 발생했습니다.",
    };
  }
}

export async function toggleLocation(
  id: string,
  is_active: boolean
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireFacilityAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const { error } = await supabaseAdmin
      .from(LOCATIONS)
      .update({ is_active: !!is_active })
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/facility/locations");
    revalidatePath("/hr/facility/assets");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "장소 상태 변경 중 오류가 발생했습니다.",
    };
  }
}

// 장소 이름 변경 — 병합 로직 포함.
//   * 대상 이름이 이미 다른 활성 장소로 존재 → 병합: 해당 이름 비품 일괄 이동 후
//     원래 장소 row 삭제.
//   * 없으면 → 단순 이름 변경 + 그 이름 쓰던 비품 일괄 UPDATE.
//   * 부분 반영 방지를 위해 비품 이동을 먼저 끝낸 뒤 장소 row 를 정리합니다.
export async function renameLocation(
  id: string,
  newName: string
): Promise<
  | { ok: true; merged: boolean; moved: number; newName: string }
  | { ok: false; message: string }
> {
  try {
    await requireFacilityAccess();
    const nm = cleanStr(newName);
    if (!id || !nm) return { ok: false, message: "새 장소명을 입력하세요." };

    // 대상 장소(원본) 조회.
    const { data: cur, error: curErr } = await supabaseAdmin
      .from(LOCATIONS)
      .select("id, name")
      .eq("id", id)
      .maybeSingle();
    if (curErr) throw new Error(curErr.message);
    if (!cur) return { ok: false, message: "장소를 찾을 수 없습니다." };
    const oldName = String((cur as { name: string }).name);
    if (oldName === nm) return { ok: true, merged: false, moved: 0, newName: nm };

    // 같은 이름의 다른 장소가 있는지(병합 여부 판정).
    const { data: dupe } = await supabaseAdmin
      .from(LOCATIONS)
      .select("id")
      .eq("name", nm)
      .neq("id", id)
      .maybeSingle();

    // 이 장소명을 쓰는 비품 수(피드백용) — 이동 대상.
    const { data: affected } = await supabaseAdmin
      .from(ASSETS)
      .select("id")
      .eq("location", oldName);
    const moved = (affected ?? []).length;

    // 1) 비품 location 일괄 이동(먼저 — 부분 반영 방지).
    if (moved > 0) {
      const { error: upAssetsErr } = await supabaseAdmin
        .from(ASSETS)
        .update({ location: nm, updated_at: new Date().toISOString() })
        .eq("location", oldName);
      if (upAssetsErr) throw new Error(upAssetsErr.message);
    }

    if (dupe) {
      // 병합 — 원래 장소 row 삭제(대상 이름 장소는 그대로 유지).
      const { error: delErr } = await supabaseAdmin
        .from(LOCATIONS)
        .delete()
        .eq("id", id);
      if (delErr) throw new Error(delErr.message);
      revalidatePath("/hr/facility/locations");
      revalidatePath("/hr/facility/assets");
      return { ok: true, merged: true, moved, newName: nm };
    }

    // 단순 이름 변경.
    const { error: upLocErr } = await supabaseAdmin
      .from(LOCATIONS)
      .update({ name: nm })
      .eq("id", id);
    if (upLocErr) throw new Error(upLocErr.message);
    revalidatePath("/hr/facility/locations");
    revalidatePath("/hr/facility/assets");
    return { ok: true, merged: false, moved, newName: nm };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "장소 이름 변경 중 오류가 발생했습니다.",
    };
  }
}
