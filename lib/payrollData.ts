import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PayItem, PayrollRecord } from "@/lib/salary";

// =====================================================================
// 월별 급여 레코드 조회 — 화면(monthlyActions.listMonthlyPayroll)과 MCP 가
//   같은 쿼리를 씁니다. 권한 확인은 호출부 책임입니다.
//   ⚠️ 레코드는 직원별 금액입니다. MCP 는 월 합계만 내고 개인별 금액은
//     내지 않습니다(lib/mcpTools).
// =====================================================================

function toPayItems(v: unknown): PayItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return {
        key: String(o.key ?? ""),
        label: String(o.label ?? ""),
        amount: Number(o.amount ?? 0),
      };
    })
    .filter((i) => i.key && Number.isFinite(i.amount));
}

export function toPayrollRecord(raw: Record<string, unknown>): PayrollRecord {
  return {
    id: String(raw.id ?? ""),
    driver_id: String(raw.driver_id ?? ""),
    year: Number(raw.year ?? 0),
    month: Number(raw.month ?? 0),
    pay_items: toPayItems(raw.pay_items),
    deduct_items: toPayItems(raw.deduct_items),
    total_pay: Number(raw.total_pay ?? 0),
    total_deduct: Number(raw.total_deduct ?? 0),
    net_pay: Number(raw.net_pay ?? 0),
    confirmed_at: (raw.confirmed_at as string | null) ?? null,
    confirmed_by: (raw.confirmed_by as string | null) ?? null,
    emailed_at: (raw.emailed_at as string | null) ?? null,
  };
}

// 한 달의 급여 레코드 전부. 조회 실패는 삼키지 않고 올립니다.
export async function loadPayrollRecords(
  year: number,
  month: number
): Promise<PayrollRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("payroll_records")
    .select("*")
    .eq("year", year)
    .eq("month", month);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toPayrollRecord(r as Record<string, unknown>));
}
