"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CONTRACT_KINDS, isYmd } from "@/lib/contractCore";
import {
  SALARY_HOLIDAYS_KEY,
  SALARY_LIST_COLUMNS,
  mergeProfileSegments,
  parseSalaryClauses,
  splitSegmentsByConfig,
  toSalaryContract,
  type ConfigRows,
  type GradeRow,
  type HolidayDates,
  type SalaryClauses,
  type SegmentInput,
} from "@/lib/salaryContracts";
import {
  OVERRIDE_NOTE_PREFIX,
  loadCalcInputs,
  saveSalaryContractCore,
  type SalaryContractInput,
} from "@/lib/salaryContractServer";
import {
  requireContractAdmin,
  readCurrentClausesRaw,
  readSetting,
  writeSetting,
  fail,
  type Result,
} from "@/lib/contractServer";

// =====================================================================
// 연봉계약서 전용 관리자 액션 — 계산 재료·작성·일괄 작성·명절 날짜·조항 (M0 또는 hr)
//   * 보내기·서명·PDF·일괄 발송·일괄 미리보기는 근로계약서와 공용 ./workflowActions.
//   * 금액은 언제나 서버가 DB(호봉표·salary_config·명절 날짜)로 다시 계산해 저장합니다
//     (lib/salaryContractServer). 화면에서 받는 건 구간 입력과, 관장·부장이 작성 중 단계에서
//     직접 고친 항목 금액(사유 필수)뿐.
//   * DB 제약 UNIQUE(driver_id, year) — 직원·연도당 1건(무효 건 포함).
// =====================================================================

const TABLE = CONTRACT_KINDS.salary.table;

type ProfileRow = {
  driver_id: string;
  grade: string;
  step: number;
  start_month: number;
  end_month: number;
  extra: Record<string, unknown> | null;
};

export type SalaryEmployee = {
  driverId: string;
  name: string;
  defaultSegments: SegmentInput[];
  contract: { id: string; status: string } | null;
};

export type SalaryWorkspace = {
  year: number;
  holidays: HolidayDates;
  gradeRows: GradeRow[];
  configRows: ConfigRows; // salary_config 그해 행(적용 시작 월 포함)
  clauses: SalaryClauses;
  employees: SalaryEmployee[];
};

// 그 해 급여설정이 있는 재직 직원 + 계산 재료. 화면이 미리보기를 직접 계산하도록 넘깁니다.
export async function getSalaryWorkspace(year: number): Promise<SalaryWorkspace> {
  await requireContractAdmin();
  const y = Math.trunc(Number(year)) || new Date().getFullYear();
  const [inputs, { data: profs }, { data: drivers }, { data: emp }, { data: existing }, clausesRaw] = await Promise.all([
    loadCalcInputs(y),
    supabaseAdmin.from("employee_salary_profiles").select("driver_id, grade, step, start_month, end_month, extra").eq("year", y),
    supabaseAdmin.from("drivers").select("id, name"),
    supabaseAdmin.from("employee_profiles").select("driver_id, employment_status"),
    supabaseAdmin.from(TABLE).select("id, driver_id, status").eq("year", y),
    readCurrentClausesRaw("salary"),
  ]);
  const nameById = new Map((drivers ?? []).map((d) => [String((d as { id: string }).id), String((d as { name: string }).name)]));
  const resigned = new Set(
    (emp ?? []).filter((e) => (e as { employment_status?: string }).employment_status === "resigned").map((e) => String((e as { driver_id: string }).driver_id))
  );
  const byDriver = new Map<string, ProfileRow[]>();
  for (const p of (profs ?? []) as ProfileRow[]) {
    const id = String(p.driver_id);
    if (resigned.has(id)) continue;
    byDriver.set(id, [...(byDriver.get(id) ?? []), p]);
  }
  const contractBy = new Map((existing ?? []).map((c) => [String((c as { driver_id: string }).driver_id), c as { id: string; status: string }]));
  const employees: SalaryEmployee[] = [...byDriver.entries()]
    .map(([driverId, rows]) => {
      const c = contractBy.get(driverId);
      return {
        driverId,
        name: nameById.get(driverId) ?? "(알 수 없음)",
        // 급여설정 구간 → 같은 조건끼리 합친 뒤, 수당 단가가 바뀌는 달(예: 교통보조비 8월)에서 다시 나눕니다.
        defaultSegments: splitSegmentsByConfig(
          mergeProfileSegments(rows.map((r) => ({ ...r, step: Number(r.step), extra: r.extra as never }))),
          inputs.configRows
        ),
        contract: c ? { id: String(c.id), status: String(c.status) } : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { year: y, ...inputs, clauses: parseSalaryClauses(clausesRaw), employees };
}

export type { SalaryContractInput } from "@/lib/salaryContractServer";

export async function saveSalaryContract(input: SalaryContractInput): Promise<Result<{ id: string; total: number }>> {
  try {
    const me = await requireContractAdmin();
    const res = await saveSalaryContractCore(input, me);
    if (res.ok) revalidatePath("/hr/contracts");
    return res;
  } catch (e) {
    return fail(e);
  }
}

// 선택한 직원들을 급여설정 기본 구간으로 한꺼번에 '작성 중' 저장(연말 일괄).
//   가족수당·관리업무수당도 급여설정(extra) 기준으로 자동 계산됩니다.
export async function bulkCreateSalaryDrafts(
  year: number,
  driverIds: string[]
): Promise<Result<{ created: string[]; skipped: { name: string; reason: string }[] }>> {
  try {
    await requireContractAdmin();
    const ws = await getSalaryWorkspace(year);
    const created: string[] = [];
    const skipped: { name: string; reason: string }[] = [];
    for (const id of driverIds.slice(0, 60)) {
      const e = ws.employees.find((x) => x.driverId === id);
      if (!e) {
        skipped.push({ name: id, reason: "급여설정 없음" });
        continue;
      }
      if (e.contract) {
        skipped.push({ name: e.name, reason: "이미 계약서 있음" });
        continue;
      }
      const res = await saveSalaryContract({ driverId: id, year: ws.year, segments: e.defaultSegments });
      if (res.ok) created.push(e.name);
      else skipped.push({ name: e.name, reason: res.message });
    }
    revalidatePath("/hr/contracts");
    return { ok: true, created, skipped };
  } catch (e) {
    return fail(e);
  }
}

// 수정 폼용 — 저장된 구간을 입력 형태로.
export async function getSalaryContractForEdit(
  id: string
): Promise<Result<{ driverId: string; year: number; segments: SegmentInput[]; status: string; overrideReason: string }>> {
  try {
    await requireContractAdmin();
    const { data, error } = await supabaseAdmin.from(TABLE).select(SALARY_LIST_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, message: "계약서를 찾을 수 없습니다." };
    const c = toSalaryContract(data as unknown as Record<string, unknown>, "");
    return {
      ok: true,
      driverId: c.driver_id,
      year: c.year,
      status: c.status,
      segments: c.segments.map((s) => ({
        start_month: s.start_month,
        end_month: s.end_month,
        grade: s.grade,
        step: s.step,
        cert_level: s.cert_level,
        meal: s.meal,
        transport: s.transport,
        mgmt_target: s.mgmt_target,
        family_monthly: s.family_monthly,
        ...(s.overrides ? { overrides: s.overrides } : {}),
      })),
      // 다시 열면 지난번 수정 사유를 채워 둡니다("금액 직접 수정: 사유 (이름, 날짜)" → 사유).
      overrideReason: c.note?.startsWith(OVERRIDE_NOTE_PREFIX)
        ? c.note.slice(OVERRIDE_NOTE_PREFIX.length).replace(/\s*\([^()]*\)$/, "")
        : "",
    };
  } catch (e) {
    return fail(e);
  }
}

// 명절 날짜(연도별). 음력이라 해마다 화면에서 넣습니다.
export async function saveSalaryHolidays(year: number, dates: HolidayDates): Promise<Result> {
  try {
    await requireContractAdmin();
    const y = String(Math.trunc(Number(year)));
    for (const [label, d] of [["설", dates.seol], ["추석", dates.chuseok]] as const) {
      if (d && (!isYmd(d) || !d.startsWith(`${y}-`))) return { ok: false, message: `${label} 날짜는 ${y}년 날짜여야 합니다.` };
    }
    const raw = await readSetting(SALARY_HOLIDAYS_KEY);
    let all: Record<string, unknown> = {};
    try {
      all = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      all = {};
    }
    all[y] = { seol: dates.seol || null, chuseok: dates.chuseok || null };
    await writeSetting(SALARY_HOLIDAYS_KEY, JSON.stringify(all));
    revalidatePath("/hr/contracts");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveSalaryClauses(input: SalaryClauses): Promise<Result<{ clauses: SalaryClauses }>> {
  try {
    await requireContractAdmin();
    const clean = parseSalaryClauses(JSON.stringify(input));
    await writeSetting(CONTRACT_KINDS.salary.clausesKey, JSON.stringify(clean));
    revalidatePath("/hr/contracts");
    return { ok: true, clauses: clean };
  } catch (e) {
    return fail(e);
  }
}
