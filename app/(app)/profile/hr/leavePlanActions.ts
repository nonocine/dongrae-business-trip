"use server";

// =====================================================================
// 연차 사용계획서 — 직원 본인(self) 액션. LP-2
//   * employee_id 는 항상 세션에서만 도출한다(폼 값 신뢰 안 함) → 타인 계획서
//     열람·수정 차단. 저장·제출도 자기 행 조건을 update 절에 함께 걸어
//     경합 상황에서도 남의 행을 건드릴 수 없게 한다.
//   * 제출된 건은 본인이 수정할 수 없다 — 담당자가 [제출 취소]를 해줘야 한다.
//   * 계획 합계 ≠ 미사용 일수는 "경고"일 뿐 제출을 막지 않는다(지시문).
//     화면이 확인 모달로 붙잡고, 서버는 그대로 저장한다.
// =====================================================================

import { revalidatePath } from "next/cache";
import { getSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { kstTodayYmd } from "@/lib/trainings";
import {
  normalizeLeavePlan,
  sumLeavePlan,
  validateLeavePlan,
  leavePlanIssueText,
  LEAVE_PLAN_MAX_ROWS,
  type LeavePlanEntry,
} from "@/lib/leavePlan";

const REQ = "leave_plan_requests";

// 세션 직원 → drivers row. 아니면 null.
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

export type MyLeavePlan = {
  id: string;
  year: number;
  unused_days: number;
  period_start: string | null;
  period_end: string | null;
  plan: LeavePlanEntry[];
  total_days: number | null;
  submitted_at: string | null;
  maxRows: number;
};

// 내 계획서 — 발부된 것 중 가장 최근 연도 1건. 없으면 null.
export async function getMyLeavePlan(): Promise<MyLeavePlan | null> {
  const me = await getMyDriver();
  if (!me) return null;
  const { data } = await supabaseAdmin
    .from(REQ)
    .select("*")
    .eq("employee_id", me.id)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const plan = normalizeLeavePlan(r.plan);
  return {
    id: String(r.id ?? ""),
    year: Number(r.year ?? 0),
    unused_days: Number(r.unused_days ?? 0),
    period_start: (r.period_start as string | null) ?? null,
    period_end: (r.period_end as string | null) ?? null,
    plan,
    total_days: r.total_days == null ? null : Number(r.total_days),
    submitted_at: (r.submitted_at as string | null) ?? null,
    maxRows: LEAVE_PLAN_MAX_ROWS,
  };
}

// 대시보드 알림 배지용 — 발부됐지만 아직 제출하지 않은 건.
export type MyLeavePlanNotice = {
  year: number;
  unusedDays: number;
  periodEnd: string | null;
  dueSoon: boolean; // 잔여기간 종료가 30일 이내
};
export async function getMyLeavePlanNotice(): Promise<MyLeavePlanNotice | null> {
  const me = await getMyDriver();
  if (!me) return null;
  const { data } = await supabaseAdmin
    .from(REQ)
    .select("year, unused_days, period_end, submitted_at")
    .eq("employee_id", me.id)
    .is("submitted_at", null)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const periodEnd = (r.period_end as string | null) ?? null;
  let dueSoon = false;
  if (periodEnd) {
    const today = kstTodayYmd();
    const diff =
      (Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86400000;
    dueSoon = Number.isFinite(diff) && diff <= 30;
  }
  return {
    year: Number(r.year ?? 0),
    unusedDays: Number(r.unused_days ?? 0),
    periodEnd,
    dueSoon,
  };
}

// 저장(임시저장) / 제출 공용. submit=true 면 submitted_at 을 찍는다.
export async function saveMyLeavePlan(input: {
  planId: string;
  plan: LeavePlanEntry[];
  submit: boolean;
}): Promise<
  { ok: true; total: number; submitted: boolean } | { ok: false; message: string }
> {
  try {
    const me = await getMyDriver();
    if (!me) return { ok: false, message: "직원 로그인이 필요합니다." };
    if (!input.planId) return { ok: false, message: "대상이 없습니다." };

    // 내 행인지 + 제출 상태 확인.
    const { data: row } = await supabaseAdmin
      .from(REQ)
      .select("id, employee_id, period_start, period_end, submitted_at")
      .eq("id", input.planId)
      .eq("employee_id", me.id)
      .maybeSingle();
    if (!row)
      return { ok: false, message: "계획서를 찾을 수 없습니다." };
    const r = row as Record<string, unknown>;
    if (r.submitted_at != null)
      return {
        ok: false,
        message:
          "이미 제출되었습니다. 수정이 필요하면 담당자에게 제출 취소를 요청하세요.",
      };

    const plan = normalizeLeavePlan(input.plan);
    const issues = validateLeavePlan(plan, {
      start: (r.period_start as string | null) ?? null,
      end: (r.period_end as string | null) ?? null,
    });
    // 제출은 구조 검증을 통과해야 한다. 임시저장은 빈 계획도 허용.
    const blocking = input.submit
      ? issues
      : issues.filter((i) => i.kind !== "empty");
    if (blocking.length > 0)
      return { ok: false, message: leavePlanIssueText(blocking[0]) };

    const total = sumLeavePlan(plan);
    const { data: updated, error } = await supabaseAdmin
      .from(REQ)
      .update({
        plan,
        total_days: total,
        submitted_at: input.submit ? new Date().toISOString() : null,
      })
      .eq("id", input.planId)
      .eq("employee_id", me.id) // 서버 재검증 — 남의 행은 절대 안 걸린다
      .is("submitted_at", null) // 경합 방어 — 이미 제출된 건 갱신 금지
      .select("id");
    if (error) throw new Error(error.message);
    if ((updated ?? []).length === 0)
      return {
        ok: false,
        message: "저장하지 못했습니다. (제출 상태를 다시 확인하세요)",
      };

    revalidatePath("/profile/hr");
    revalidatePath("/hr/leave-plans");
    revalidatePath("/");
    return { ok: true, total, submitted: input.submit };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.",
    };
  }
}
