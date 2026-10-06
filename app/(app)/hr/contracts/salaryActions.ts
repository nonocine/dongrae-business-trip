"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CONTRACT_KINDS, isYmd } from "@/lib/contractCore";
import {
  SALARY_HOLIDAYS_KEY,
  SALARY_LIST_COLUMNS,
  amountInKorean,
  computeSalaryContract,
  mergeProfileSegments,
  parseSalaryClauses,
  toSalaryContract,
  type ConfigMap,
  type GradeRow,
  type HolidayDates,
  type SalaryCalc,
  type SalaryClauses,
  type SegmentInput,
} from "@/lib/salaryContracts";
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
//   * 금액은 언제나 서버가 DB(호봉표·salary_config·명절 날짜)로 다시 계산해 저장합니다.
//     화면이 보낸 숫자는 믿지 않고, 화면에서 받는 건 구간(호봉·월·자격)과 가족수당 월액뿐.
//   * DB 제약 UNIQUE(driver_id, year) — 직원·연도당 1건(무효 건 포함).
// =====================================================================

const TABLE = CONTRACT_KINDS.salary.table;

async function loadCalcInputs(year: number): Promise<{ gradeRows: GradeRow[]; config: ConfigMap; holidays: HolidayDates }> {
  const [{ data: grades, error: gErr }, { data: cfg, error: cErr }, holidaysRaw] = await Promise.all([
    supabaseAdmin.from("salary_grade_table").select("grade, step, base_salary, effective_from").eq("year", year),
    supabaseAdmin.from("salary_config").select("config_key, config_value").eq("year", year),
    readSetting(SALARY_HOLIDAYS_KEY),
  ]);
  if (gErr) throw new Error(gErr.message);
  if (cErr) throw new Error(cErr.message);
  const config: ConfigMap = {};
  for (const r of cfg ?? []) config[String((r as { config_key: string }).config_key)] = Number((r as { config_value: unknown }).config_value);
  return {
    gradeRows: ((grades ?? []) as GradeRow[]).map((g) => ({ ...g, step: Number(g.step), base_salary: Number(g.base_salary) })),
    config,
    holidays: readHolidays(holidaysRaw, year),
  };
}

function readHolidays(raw: string | null, year: number): HolidayDates {
  try {
    const o = raw ? (JSON.parse(raw) as Record<string, { seol?: string; chuseok?: string }>) : {};
    const y = o[String(year)] ?? {};
    return { seol: isYmd(y.seol) ? y.seol : null, chuseok: isYmd(y.chuseok) ? y.chuseok : null };
  } catch {
    return { seol: null, chuseok: null };
  }
}

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
  config: ConfigMap;
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
        defaultSegments: mergeProfileSegments(rows.map((r) => ({ ...r, step: Number(r.step), extra: r.extra as never }))),
        contract: c ? { id: String(c.id), status: String(c.status) } : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { year: y, ...inputs, clauses: parseSalaryClauses(clausesRaw), employees };
}

function cleanSegments(input: SegmentInput[]): SegmentInput[] {
  return (input ?? []).slice(0, 12).map((s) => ({
    start_month: Math.trunc(Number(s.start_month)),
    end_month: Math.trunc(Number(s.end_month)),
    grade: String(s.grade ?? "").trim(),
    step: Math.trunc(Number(s.step)),
    cert_level: (["1", "2", "3"].includes(String(s.cert_level)) ? String(s.cert_level) : "") as SegmentInput["cert_level"],
    meal: s.meal !== false,
    transport: s.transport !== false,
    mgmt_target: s.mgmt_target == null ? undefined : !!s.mgmt_target,
    family_monthly: Math.max(0, Math.trunc(Number(s.family_monthly) || 0)),
  }));
}

function rowFromCalc(c: SalaryCalc) {
  return {
    year: c.year,
    period_start: c.period_start,
    period_end: c.period_end,
    base_salary: c.totals.base,
    meal_allowance: c.totals.meal,
    qualification_allowance: c.totals.cert,
    family_allowance: c.totals.family,
    management_allowance: c.totals.mgmt,
    holiday_bonus: c.totals.holiday,
    transport_allowance: c.totals.transport,
    total_annual: c.total,
    segments: c.segments,
    amount_in_korean: amountInKorean(c.total),
  };
}

function dupMessage(code?: string): string | null {
  return code === "23505"
    ? "이 직원의 같은 연도 연봉계약서가 이미 있습니다(직원·연도당 1건 — 무효 건 포함). 목록에서 기존 건을 확인해주세요."
    : null;
}

export type SalaryContractInput = {
  id?: string | null;
  driverId: string;
  year: number;
  segments: SegmentInput[];
};

export async function saveSalaryContract(input: SalaryContractInput): Promise<Result<{ id: string; total: number }>> {
  try {
    const me = await requireContractAdmin();
    if (!input.driverId) return { ok: false, message: "직원을 선택해주세요." };
    const year = Math.trunc(Number(input.year));
    const inputs = await loadCalcInputs(year);
    const calc = computeSalaryContract({ year, segments: cleanSegments(input.segments), ...inputs });
    if (calc.errors.length) return { ok: false, message: calc.errors.join(" / ") };
    const row = rowFromCalc(calc);
    if (input.id) {
      const { error, count } = await supabaseAdmin
        .from(TABLE)
        .update(row, { count: "exact" })
        .eq("id", input.id)
        .eq("driver_id", input.driverId)
        .eq("status", "draft");
      if (error) return { ok: false, message: dupMessage(error.code) ?? error.message };
      if (!count) return { ok: false, message: "작성 중인 계약서만 고칠 수 있습니다. (보낸 뒤라면 먼저 발송을 취소하세요)" };
      revalidatePath("/hr/contracts");
      return { ok: true, id: input.id, total: calc.total };
    }
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert({ ...row, driver_id: input.driverId, status: "draft", created_by: me.name })
      .select("id")
      .single();
    if (error) return { ok: false, message: dupMessage(error.code) ?? error.message };
    revalidatePath("/hr/contracts");
    return { ok: true, id: String((data as { id: string }).id), total: calc.total };
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
): Promise<Result<{ driverId: string; year: number; segments: SegmentInput[]; status: string }>> {
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
      })),
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
