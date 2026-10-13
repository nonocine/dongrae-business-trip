import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { businessTableMissing } from "@/lib/businessResultsData";

// =====================================================================
// 사업실적 쓰기 코어 — 화면 저장(business-results/actions)과 홈페이지 대관
//   자동 반입(lib/businessRentalSync)이 같은 함수로 씁니다.
//   * 저장 방식이 두 갈래가 되지 않도록, business_results 본 행과
//     business_result_details 세부 행을 쓰는 쿼리는 여기에만 둡니다.
//   * 권한 확인은 호출부 책임입니다("use server" 아님 — Cron 도 호출).
// =====================================================================

export type ResultDetailInput = {
  entry_type: "date" | "session";
  entry_date: string | null;
  session_no: number | null;
  session_days: number | null;
  content: string;
  participants_youth: number;
  participants_other: number;
  room_youth: number;
  room_other: number;
};

// 자동 반입 행이 "사람이 숫자를 고쳤는지" 판정할 때 보는 본 행 숫자 칸.
export const RESULT_NUMBER_FIELDS = [
  "sessions",
  "operating_days",
  "participants",
  "participants_youth",
  "participants_other",
  "attendance",
  "attendance_youth",
  "attendance_other",
  "youth_uses",
  "other_uses",
] as const;

// 본 행 저장 — id 가 있으면 그 행을 갱신, 없으면 새로 만듭니다.
//   갱신 대상이 없으면 null(호출부가 "찾을 수 없음" 안내).
export async function writeBusinessResultRow(
  id: string | null,
  row: Record<string, unknown>,
): Promise<string | null> {
  if (id) {
    const { data, error } = await supabaseAdmin
      .from("business_results")
      .update(row)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? String((data as { id: string }).id) : null;
  }
  const { data, error } = await supabaseAdmin
    .from("business_results")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
}

// 본 행 삭제 — 세부 행은 FK on delete cascade 로 함께 지워집니다.
//   authorName 을 주면 그 작성자의 행만 지웁니다(화면의 본인 삭제 규칙).
//   지운 행이 없으면 false.
export async function deleteBusinessResultRow(
  id: string,
  authorName?: string,
): Promise<boolean> {
  let query = supabaseAdmin.from("business_results").delete().eq("id", id);
  if (authorName !== undefined) query = query.eq("author_name", authorName);
  const { data, error } = await query.select("id").maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// 입력 → 저장할 세부 행(정규화). 비교(수기 수정 판정)에도 같은 모양을 씁니다.
export function normalizeDetailRows(rows: ResultDetailInput[]) {
  return rows.map((r, index) => ({
    entry_type: r.entry_type === "session" ? "session" : "date",
    entry_date: r.entry_type === "date" ? r.entry_date || null : null,
    session_no: r.entry_type === "session" ? r.session_no : null,
    session_days: r.entry_type === "session" ? r.session_days : null,
    content: r.content.trim(),
    participants_youth: Math.max(0, r.participants_youth),
    participants_other: Math.max(0, r.participants_other),
    room_youth: Math.max(0, r.room_youth),
    room_other: Math.max(0, r.room_other),
    sort_order: index + 1,
  }));
}

// 세부 행 전체 교체(delete-then-insert).
//   테이블 미적용이면 false, 그 밖의 오류는 throw.
export async function replaceResultDetailRows(
  resultId: string,
  rows: ResultDetailInput[],
): Promise<boolean> {
  const del = await supabaseAdmin
    .from("business_result_details")
    .delete()
    .eq("result_id", resultId);
  if (del.error) {
    if (businessTableMissing(del.error)) return false;
    throw new Error(del.error.message);
  }
  const payload = normalizeDetailRows(rows).map((r) => ({
    result_id: resultId,
    ...r,
  }));
  if (payload.length > 0) {
    const { error } = await supabaseAdmin
      .from("business_result_details")
      .insert(payload);
    if (error) throw new Error(error.message);
  }
  return true;
}
