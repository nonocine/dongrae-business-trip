// 출처 ④ 직원 — 재직 중 직원(drivers.is_active 이면서 employment_status ≠ resigned).
//   번호: employee_profiles.phone. 사용: 문자 발송 권한이 있는 직원 누구나.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidSmsPhone, normalizeSmsPhone } from "@/lib/sms/text";
import { idsOf, str, type SmsSource } from "./types";

type Employee = { id: string; name: string; rank: string | null; phone: string | null };

async function loadEmployees(): Promise<Employee[]> {
  const { data: drivers, error } = await supabaseAdmin
    .from("drivers")
    .select("id, name, rank, is_active")
    .order("name");
  if (error) throw new Error(`직원 조회 실패: ${error.message}`);
  const { data: profiles, error: pe } = await supabaseAdmin
    .from("employee_profiles")
    .select("driver_id, phone, employment_status");
  if (pe) throw new Error(`인사기록 조회 실패: ${pe.message}`);
  const prof = new Map(
    ((profiles ?? []) as { driver_id: string; phone: string | null; employment_status: string | null }[]).map(
      (p) => [p.driver_id, p],
    ),
  );
  return ((drivers ?? []) as { id: string; name: string; rank: string | null; is_active: boolean | null }[])
    .filter((d) => d.is_active !== false && prof.get(d.id)?.employment_status !== "resigned")
    .map((d) => ({ id: d.id, name: d.name, rank: d.rank, phone: prof.get(d.id)?.phone ?? null }));
}

export const employeesSource: SmsSource = {
  key: "employees",
  label: "직원",
  icon: "👥",
  description: "재직 중 직원 전체·개별",
  pickerType: "list",
  color: "violet",
  canUse: () => true,

  async loadOptions() {
    const list = await loadEmployees();
    return {
      filters: [],
      bulkLabel: "재직 중 직원 전체 담기",
      items: list.map((e) => ({
        id: e.id,
        name: e.name,
        sub: e.rank ?? undefined,
        hasPhone: isValidSmsPhone(normalizeSmsPhone(e.phone ?? "")),
      })),
    };
  },

  async resolvePhones(_u, sel) {
    const all = await loadEmployees();
    const wanted = new Set(idsOf(sel));
    const list = all.filter((e) => wanted.has(e.id));
    return {
      label: list.length === all.length ? `직원 전체 ${list.length}명` : `직원 ${list.length}명`,
      short: "직원",
      people: list.map((e) => ({
        key: `employees:${e.id}`,
        name: e.name,
        phone: e.phone,
        ref: { source: "employees", ref_id: e.id, phone: null },
      })),
    };
  },

  async resolveRefs(ids) {
    const wanted = new Set(ids);
    const list = (await loadEmployees()).filter((e) => wanted.has(e.id));
    return new Map(list.map((e) => [e.id, { name: str(e.name), phone: e.phone }]));
  },
};
