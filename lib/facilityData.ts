import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { toFacilityAsset, type FacilityAsset } from "@/lib/facility";

// =====================================================================
// 비품 대장 조회 — 화면(hr/facility/actions.listAssets)과 MCP 가 같은 쿼리를
//   씁니다. 권한 확인은 호출부 책임입니다. 정렬 기본 acquired_on desc.
//   ※ facility_assets 에는 거래처 컬럼이 없습니다(금액·예산출처까지만).
// =====================================================================
export async function loadAllAssets(): Promise<FacilityAsset[]> {
  const { data, error } = await supabaseAdmin
    .from("facility_assets")
    .select("*")
    .order("acquired_on", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toFacilityAsset(r as Record<string, unknown>));
}
