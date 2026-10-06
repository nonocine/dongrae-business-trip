"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { kstTodayYmd } from "@/lib/trainings";
import { currentAssignment } from "@/lib/appointments";
import { CONTRACT_KINDS, isYmd } from "@/lib/contractCore";
import {
  CONTRACT_LIST_COLUMNS,
  parseClauses,
  toContract,
  type ContractClauses,
  type ContractType,
  type EmploymentContract,
} from "@/lib/employmentContracts";
import {
  requireContractAdmin,
  readCurrentClausesRaw,
  writeSetting,
  namesById,
  fail,
  type Result,
} from "@/lib/contractServer";

// =====================================================================
// 근로계약서 전용 관리자 액션 — 작성 폼·직원 목록·조항 문구 (M0 또는 hr 직무)
//   * 보내기·발송취소·무효·센터장 서명·PDF 는 연봉계약서와 공용인
//     ./workflowActions(→ lib/contractServer) 에 있습니다.
// =====================================================================

const TABLE = CONTRACT_KINDS.employment.table;

async function loadRow(id: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.from(TABLE).select(CONTRACT_LIST_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("계약서를 찾을 수 없습니다.");
  return data as Record<string, unknown>;
}

// 수정 폼에 채울 원본 한 건.
export async function getEmploymentContract(id: string): Promise<Result<{ contract: EmploymentContract }>> {
  try {
    await requireContractAdmin();
    const raw = await loadRow(id);
    const names = await namesById([String(raw.driver_id)]);
    return { ok: true, contract: toContract(raw, names.get(String(raw.driver_id)) ?? "") };
  } catch (e) {
    return fail(e);
  }
}


export type ContractEmployee = {
  driverId: string;
  name: string;
  joinDate: string | null;
  department: string | null;
  position: string | null;
  hasAssignment: boolean;
  hasRrn: boolean;
  hasAddress: boolean;
};

// 재직자만. 직위·부서는 lib/appointments.currentAssignment(단일 출처) —
//   drivers.rank 로 메꾸지 않습니다(직급과 직위는 다른 축).
export async function listContractEmployees(): Promise<ContractEmployee[]> {
  await requireContractAdmin();
  const [{ data: drivers }, { data: profs }] = await Promise.all([
    supabaseAdmin.from("drivers").select("id, name").order("name"),
    supabaseAdmin
      .from("employee_profiles")
      .select("driver_id, join_date, employment_status, appointments, resident_number, address"),
  ]);
  const pByD = new Map<string, Record<string, unknown>>();
  for (const p of profs ?? []) pByD.set(String((p as Record<string, unknown>).driver_id), p as Record<string, unknown>);
  const today = kstTodayYmd();
  const out: ContractEmployee[] = [];
  for (const d of drivers ?? []) {
    const id = String((d as { id: string }).id);
    const p = pByD.get(id);
    if (!p || p.employment_status === "resigned") continue;
    const { current } = currentAssignment(p.appointments, today);
    out.push({
      driverId: id,
      name: String((d as { name: string }).name),
      joinDate: (p.join_date as string | null) ?? null,
      department: current?.department ?? null,
      position: current?.title ?? null,
      hasAssignment: current !== null,
      // 주민번호·주소 값은 내려보내지 않습니다 — 있는지 여부만.
      hasRrn: String(p.resident_number ?? "").replace(/\D/g, "").length === 13,
      hasAddress: !!String(p.address ?? "").trim(),
    });
  }
  return out;
}



export type ContractInput = {
  id?: string | null;
  driverId: string;
  contractType: ContractType;
  contractStart: string;
  contractEnd: string | null;
  probation: boolean;
  probationStart: string | null;
  probationEnd: string | null;
  department: string;
  position: string;
  dutyContent: string;
  workHours: string;
  workDays: string;
  weeklyHours: number | null;
  workplace: string;
  breakTime: string;
  paymentDay: string;
};

function validate(input: ContractInput): string | null {
  if (!input.driverId) return "직원을 선택해주세요.";
  if (!isYmd(input.contractStart)) return "계약 시작일을 확인해주세요.";
  if (input.contractType === "fixed_term") {
    if (!isYmd(input.contractEnd)) return "기간제는 계약 종료일이 필요합니다.";
    if (input.contractEnd < input.contractStart) return "종료일이 시작일보다 빠릅니다.";
  }
  if (input.probation) {
    if (!isYmd(input.probationStart) || !isYmd(input.probationEnd)) return "시용기간 날짜를 확인해주세요.";
    if (input.probationEnd < input.probationStart) return "시용 종료일이 시작일보다 빠릅니다.";
  }
  if (input.weeklyHours != null && (!Number.isFinite(input.weeklyHours) || input.weeklyHours < 0 || input.weeklyHours > 52)) {
    return "주 근로시간을 확인해주세요.";
  }
  return null;
}

export async function saveContract(input: ContractInput): Promise<Result<{ id: string }>> {
  try {
    const me = await requireContractAdmin();
    const msg = validate(input);
    if (msg) return { ok: false, message: msg };
    const t = (v: string | null | undefined) => (v ?? "").trim() || null;
    const row = {
      driver_id: input.driverId,
      contract_type: input.contractType,
      contract_start: input.contractStart,
      contract_end: input.contractType === "fixed_term" ? input.contractEnd : null,
      probation_start: input.probation ? input.probationStart : null,
      probation_end: input.probation ? input.probationEnd : null,
      department: t(input.department),
      position: t(input.position),
      duty_content: t(input.dutyContent),
      work_hours: t(input.workHours),
      work_days: t(input.workDays),
      weekly_hours: input.weeklyHours,
      workplace: t(input.workplace),
      break_time: t(input.breakTime),
      payment_day: t(input.paymentDay),
    };
    if (input.id) {
      const cur = await loadRow(input.id);
      if (cur.status !== "draft") return { ok: false, message: "작성 중인 계약서만 고칠 수 있습니다. (보낸 뒤라면 먼저 발송을 취소하세요)" };
      const { error } = await supabaseAdmin.from(TABLE).update(row).eq("id", input.id).eq("status", "draft");
      if (error) throw new Error(error.message);
      revalidatePath("/hr/contracts");
      return { ok: true, id: input.id };
    }
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert({ ...row, status: "draft", created_by: me.name })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/hr/contracts");
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (e) {
    return fail(e);
  }
}

// --- 조항 문구 ----------------------------------------------------------

export async function getContractClauses(): Promise<ContractClauses> {
  await requireContractAdmin();
  return parseClauses(await readCurrentClausesRaw("employment"));
}

export async function saveContractClauses(input: ContractClauses): Promise<Result<{ clauses: ContractClauses }>> {
  try {
    await requireContractAdmin();
    // parseClauses 로 한 번 거르면 빈 칸·이상한 값은 기본 문구로 돌아갑니다.
    const clean = parseClauses(JSON.stringify(input));
    await writeSetting(CONTRACT_KINDS.employment.clausesKey, JSON.stringify(clean));
    revalidatePath("/hr/contracts");
    return { ok: true, clauses: clean };
  } catch (e) {
    return fail(e);
  }
}
