// =====================================================================
// 급여 기준값(salary_config) 읽기 — 서버 전용("use server" 아님). salary_config 를
//   읽는 곳은 모두 여기를 거칩니다(월별 급여·연봉계약서·기준값 화면).
//   * 월별 값 고르는 규칙은 lib/salary 의 salaryConfigForMonth 한 곳:
//     m월 값 = effective_month ≤ m 인 행 중 가장 큰 것, 직급별 교통보조비가 그 달에
//     없으면 그 달의 일괄 transport_allowance.
//   * 한 해 여러 달을 계산하는 곳은 loadSalaryConfigRows 로 한 번 읽고
//     salaryConfigForMonth(rows, month) 로 달마다 고릅니다(달마다 DB 를 읽지 않게).
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { salaryConfigForMonth, type ConfigValueRow } from "@/lib/salary";

export async function loadSalaryConfigRows(year: number): Promise<ConfigValueRow[]> {
  const { data, error } = await supabaseAdmin
    .from("salary_config")
    .select("config_key, config_value, effective_month")
    .eq("year", year);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const o = r as Record<string, unknown>;
    return {
      config_key: String(o.config_key ?? ""),
      config_value: Number(o.config_value ?? 0),
      effective_month: Number(o.effective_month ?? 1) || 1,
    };
  });
}

// year 년 month 월의 key 값(없으면 null).
export async function getSalaryConfig(
  year: number,
  key: string,
  month: number
): Promise<number | null> {
  const map = salaryConfigForMonth(await loadSalaryConfigRows(year), month);
  return map[key] ?? null;
}
