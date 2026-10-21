"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireBangkaAccess } from "@/lib/bangkaAccess";
import { isBkScope, type BkEventRow, type BkScope } from "@/lib/bangkaContent";

// =====================================================================
// 연간일정(bk_events) 서버 액션 — /bangka/events
//   목록은 연도별(그 해에 걸친 일정). 추가·수정·삭제.
// =====================================================================

const EVENTS = "bk_events";
const BASE = "/bangka/events";
const YMD = /^\d{4}-\d{2}-\d{2}$/;

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const fail = (e: unknown, fb: string) => ({ ok: false as const, message: e instanceof Error ? e.message : fb });

export async function listEvents(year: number): Promise<BkEventRow[]> {
  await requireBangkaAccess();
  // 그 해에 시작했거나, 전해에 시작해 그 해까지 이어지는 일정.
  const { data, error } = await supabaseAdmin
    .from(EVENTS)
    .select("id, title, start_date, end_date, scope, memo")
    .lte("start_date", `${year}-12-31`)
    .or(`start_date.gte.${year}-01-01,end_date.gte.${year}-01-01`)
    .order("start_date")
    .order("title");
  if (error) throw new Error(error.message);
  return (data ?? []) as BkEventRow[];
}

export type BkEventInput = {
  id?: string;
  title: string;
  start_date: string;
  end_date: string;
  scope: BkScope;
  memo: string;
};

export async function saveEvent(input: BkEventInput): Promise<Result<{ id: string }>> {
  try {
    const me = await requireBangkaAccess();
    const title = (input.title ?? "").trim();
    if (!title) return { ok: false, message: "제목을 입력하세요." };
    if (!YMD.test(input.start_date ?? "")) return { ok: false, message: "시작일을 입력하세요." };
    const end = (input.end_date ?? "").trim() || null;
    if (end && !YMD.test(end)) return { ok: false, message: "종료일 형식이 올바르지 않습니다." };
    if (end && end < input.start_date) return { ok: false, message: "종료일이 시작일보다 빠릅니다." };
    if (!isBkScope(input.scope)) return { ok: false, message: "대상을 고르세요." };
    const row = {
      title,
      start_date: input.start_date,
      end_date: end && end !== input.start_date ? end : null,
      scope: input.scope,
      memo: (input.memo ?? "").trim() || null,
    };
    if (input.id) {
      const { error } = await supabaseAdmin.from(EVENTS).update(row).eq("id", input.id);
      if (error) throw new Error(error.message);
      revalidatePath(BASE);
      return { ok: true, id: input.id };
    }
    const { data, error } = await supabaseAdmin
      .from(EVENTS)
      .insert({ ...row, created_by: me.name })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath(BASE);
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (e) {
    return fail(e, "일정을 저장하지 못했습니다.");
  }
}

export async function deleteEvent(id: string): Promise<Result> {
  try {
    await requireBangkaAccess();
    const { error } = await supabaseAdmin.from(EVENTS).delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath(BASE);
    return { ok: true };
  } catch (e) {
    return fail(e, "일정을 지우지 못했습니다.");
  }
}
