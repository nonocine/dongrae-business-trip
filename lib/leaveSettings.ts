import "server-only";

// =====================================================================
// 연차 관련 설정(settings 표 key/value) — 서버 전용.
//   * leave_first_year_policy : 'payout'(입사 첫해 월차 12/31 리셋분을 12월 연차수당으로 정산, 기본)
//                               'carryover'(입사 1주년까지 이월 + 1년 미만 사용촉진)
//     근거: 근로기준법 제60조 ⑦·취업규칙 제29조 ① — 첫해 월차는 근속 1년까지 사용 가능.
//     ERP 는 첫해 월차를 12월까지 선부여하고 1/1 에 리셋합니다(회계연도 기준, 취업규칙 제28조 ⑤).
//   * leave_payout_staff_visible : 'true' 일 때만 직원 화면(인사기록카드 복무 기록)에 본인 연차수당 표시.
//     ⚠️ 이 값을 바꾸는 화면은 만들지 않습니다(관장 확정 후 DB 로 변경).
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type FirstYearPolicy = "payout" | "carryover";
export const FIRST_YEAR_POLICY_KEY = "leave_first_year_policy";
export const PAYOUT_STAFF_VISIBLE_KEY = "leave_payout_staff_visible";
export const FIRST_YEAR_POLICY_LABEL: Record<FirstYearPolicy, string> = {
  payout: "12월 연차수당 정산(기본)",
  carryover: "입사 1주년까지 이월 + 1년 미만 사용촉진",
};

async function readSetting(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("settings").select("value").eq("key", key).maybeSingle();
  return (data as { value?: string | null } | null)?.value ?? null;
}

export async function getFirstYearPolicy(): Promise<FirstYearPolicy> {
  const v = (await readSetting(FIRST_YEAR_POLICY_KEY).catch(() => null))?.trim();
  return v === "carryover" ? "carryover" : "payout";
}

// 직원 노출 — 'true' 일 때만. 읽기 실패·값 없음은 꺼진 것으로 봅니다.
export async function isPayoutStaffVisible(): Promise<boolean> {
  const v = (await readSetting(PAYOUT_STAFF_VISIBLE_KEY).catch(() => null))?.trim().toLowerCase();
  return v === "true";
}

export async function writeFirstYearPolicy(policy: FirstYearPolicy): Promise<void> {
  const { data } = await supabaseAdmin.from("settings").select("id").eq("key", FIRST_YEAR_POLICY_KEY).maybeSingle();
  if (data) {
    const { error } = await supabaseAdmin.from("settings").update({ value: policy }).eq("key", FIRST_YEAR_POLICY_KEY);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseAdmin.from("settings").insert({ key: FIRST_YEAR_POLICY_KEY, value: policy });
    if (error) throw new Error(error.message);
  }
}
