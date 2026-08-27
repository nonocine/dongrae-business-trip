"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSalaryAccess } from "@/lib/salaryAccess";
import {
  calcMonthlyPayroll,
  normalizeSalaryExtra,
  payrollEffectiveDate,
  pickEffectiveBase,
  recalcTotals,
  rangeIncludesMonth,
  isEmployedInMonth,
  resolveTeam,
  effectiveTeamValue,
  TEAM_LABEL,
  type PayItem,
  type PayrollRecord,
  type PayrollTeam,
  type SalaryExtra,
} from "@/lib/salary";
import {
  parseEdiBuffer,
  EDI_FILE_TYPES,
  type EdiFileType,
  type EdiUpdateKey,
} from "@/lib/salaryEdi";
import { buildPayslipPdf } from "@/lib/salaryPayslip";
import { isMailerConfigured, sendMailWithAttachment } from "@/lib/mailer";

// =====================================================================
// 월별 급여 — 생성·조회·수정·확정·확정취소 + 4대보험 EDI 업로드 (급여 2차)
//   * 계산은 calcMonthlyPayroll 단일 출처(이원화 금지).
//   * 권한: requireSalaryAccess(M0 또는 accounting). 확정취소만 M0 전용.
//   * payroll_records: driver_id, year, month, pay_items/deduct_items(jsonb),
//     total_pay/total_deduct/net_pay, confirmed_at/confirmed_by, emailed_at.
// =====================================================================

// --- 정규화 ---
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

function toPayrollRecord(raw: Record<string, unknown>): PayrollRecord {
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

// --- 생성 컨텍스트(연도 기준 데이터 일괄 로드) ---
type EmpMeta = {
  driver_id: string;
  name: string;
  rank: string | null;
  employment_status: "active" | "resigned";
  resignation_date: string | null;
};
type ProfileRow = {
  driver_id: string;
  grade: string;
  step: number;
  start_month: number;
  end_month: number;
  extra: SalaryExtra;
};
// 호봉표 한 칸의 발효 이력 — 같은 (grade, step) 에 발효월이 다른 단가가 여럿.
type GradeBase = { effective_from: string; base_salary: number };

type GenContext = {
  // `${grade}::${step}` → 발효분 목록. 기본급은 급여월 기준으로 골라 씁니다
  //   (연중 인상분이 과거로 소급되지 않게) → pickEffectiveBase.
  gradeMap: Map<string, GradeBase[]>;
  configMap: Record<string, number>;
  profilesByDriver: Map<string, ProfileRow[]>;
  empByDriver: Map<string, EmpMeta>;
};

async function loadContext(year: number): Promise<GenContext> {
  const [gradeRes, configRes, profRes, driverRes, empRes] = await Promise.all([
    supabaseAdmin
      .from("salary_grade_table")
      .select("grade, step, base_salary, effective_from")
      .eq("year", year),
    supabaseAdmin
      .from("salary_config")
      .select("config_key, config_value")
      .eq("year", year),
    supabaseAdmin
      .from("employee_salary_profiles")
      .select("driver_id, grade, step, start_month, end_month, extra")
      .eq("year", year),
    supabaseAdmin.from("drivers").select("id, name, rank"),
    supabaseAdmin
      .from("employee_profiles")
      .select("driver_id, employment_status, resignation_date"),
  ]);

  // ⚠️ 같은 (grade, step) 에 발효월이 다른 행이 여럿이라 set 으로 덮어쓰면
  //    어느 단가가 남는지 순서에 좌우됩니다. 전부 모아 두고 계산 시점에 고릅니다.
  const gradeMap = new Map<string, GradeBase[]>();
  for (const g of gradeRes.data ?? []) {
    const r = g as Record<string, unknown>;
    const key = `${String(r.grade ?? "")}::${Number(r.step ?? 0)}`;
    const list = gradeMap.get(key) ?? [];
    list.push({
      effective_from: String(r.effective_from ?? ""),
      base_salary: Number(r.base_salary ?? 0),
    });
    gradeMap.set(key, list);
  }
  const configMap: Record<string, number> = {};
  for (const c of configRes.data ?? []) {
    const r = c as Record<string, unknown>;
    configMap[String(r.config_key ?? "")] = Number(r.config_value ?? 0);
  }
  const profilesByDriver = new Map<string, ProfileRow[]>();
  for (const p of profRes.data ?? []) {
    const r = p as Record<string, unknown>;
    const row: ProfileRow = {
      driver_id: String(r.driver_id ?? ""),
      grade: String(r.grade ?? ""),
      step: Number(r.step ?? 0),
      start_month: Number(r.start_month ?? 0),
      end_month: Number(r.end_month ?? 0),
      extra: normalizeSalaryExtra(r.extra),
    };
    const list = profilesByDriver.get(row.driver_id) ?? [];
    list.push(row);
    profilesByDriver.set(row.driver_id, list);
  }
  const statusByDriver = new Map<
    string,
    { status: "active" | "resigned"; date: string | null }
  >();
  for (const p of empRes.data ?? []) {
    const r = p as Record<string, unknown>;
    statusByDriver.set(String(r.driver_id ?? ""), {
      status: r.employment_status === "resigned" ? "resigned" : "active",
      date: (r.resignation_date as string | null) ?? null,
    });
  }
  const empByDriver = new Map<string, EmpMeta>();
  for (const d of driverRes.data ?? []) {
    const r = d as Record<string, unknown>;
    const id = String(r.id ?? "");
    const st = statusByDriver.get(id);
    empByDriver.set(id, {
      driver_id: id,
      name: String(r.name ?? ""),
      rank: (r.rank as string | null) ?? null,
      employment_status: st?.status ?? "active",
      resignation_date: st?.date ?? null,
    });
  }
  return { gradeMap, configMap, profilesByDriver, empByDriver };
}

// 해당 월을 포함하는 급여 설정 구간(없으면 null). 비겹침 전제라 첫 일치.
function profileForMonth(rows: ProfileRow[], month: number): ProfileRow | null {
  return rows.find((r) => rangeIncludesMonth(r, month)) ?? null;
}

// 대상자(그 월 급여 지급) 판정 — 구간 포함 + 재직(퇴사월까지).
function isTarget(
  ctx: GenContext,
  driverId: string,
  year: number,
  month: number
): ProfileRow | null {
  const prof = profileForMonth(ctx.profilesByDriver.get(driverId) ?? [], month);
  if (!prof) return null;
  const emp = ctx.empByDriver.get(driverId);
  if (!emp) return null;
  if (
    !isEmployedInMonth({
      year,
      month,
      employment_status: emp.employment_status,
      resignation_date: emp.resignation_date,
    })
  ) {
    return null;
  }
  return prof;
}

// 설정 기준 명세서 계산(base + extra). base 없으면 null.
//   ★ 기본급은 **급여월 기준**으로 유효한 발효분에서 끌어옵니다. 8월 인상분이
//     7월 명세서에 소급되지 않게 하는 지점입니다(관장 지시, 2026-08).
//     - 7월 계산 → 2026-01-01 발효분(구 단가)
//     - 8월 이후 → 2026-08-01 발효분(신 단가)
//   급식비·자격수당·교통보조비 등 나머지 수당은 여전히 수동 입력값(extra)을
//   그대로 씁니다 — 이번 자동화 범위는 기본급 하나입니다.
function computeFromProfile(
  ctx: GenContext,
  prof: ProfileRow,
  year: number,
  month: number
): { payItems: PayItem[]; deductItems: PayItem[] } | null {
  const base = pickEffectiveBase(
    ctx.gradeMap.get(`${prof.grade}::${prof.step}`) ?? [],
    payrollEffectiveDate(year, month)
  );
  if (base == null) return null;
  const calc = calcMonthlyPayroll({
    baseSalary: base,
    extra: prof.extra,
    config: ctx.configMap,
    // 교통보조비는 8월부터 급수 구간별 차등 — 급수를 함께 넘깁니다.
    grade: prof.grade,
  });
  return { payItems: calc.payItems, deductItems: calc.deductItems };
}

// =====================================================================
// PART 1. 월별 급여 생성
// =====================================================================
export type GenerateResult =
  | {
      ok: true;
      created: number;
      updated: number;
      skippedConfirmed: string[]; // 확정되어 덮어쓰지 않음
      existingDrafts: string[]; // 이미 초안 존재(overwrite 필요)
      noBase: string[]; // 호봉표에 기본급 없음
      targets: number;
    }
  | { ok: false; message: string };

export async function generateMonthlyPayroll(input: {
  year: number;
  month: number;
  overwriteDrafts: boolean;
}): Promise<GenerateResult> {
  try {
    await requireSalaryAccess();
    const year = Number(input.year);
    const month = Number(input.month);
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
      return { ok: false, message: "연도가 올바르지 않습니다." };
    if (!Number.isInteger(month) || month < 1 || month > 12)
      return { ok: false, message: "월이 올바르지 않습니다." };

    const ctx = await loadContext(year);

    // 기존 레코드 맵.
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("payroll_records")
      .select("*")
      .eq("year", year)
      .eq("month", month);
    if (exErr) throw new Error(exErr.message);
    const existingByDriver = new Map<string, PayrollRecord>();
    for (const r of existing ?? [])
      existingByDriver.set(
        String((r as Record<string, unknown>).driver_id),
        toPayrollRecord(r as Record<string, unknown>)
      );

    let created = 0;
    let updated = 0;
    const skippedConfirmed: string[] = [];
    const existingDrafts: string[] = [];
    const noBase: string[] = [];
    let targets = 0;

    for (const [driverId, emp] of ctx.empByDriver) {
      const prof = isTarget(ctx, driverId, year, month);
      if (!prof) continue;
      targets++;
      const computed = computeFromProfile(ctx, prof, year, month);
      if (!computed) {
        noBase.push(emp.name);
        continue;
      }
      const totals = recalcTotals(computed.payItems, computed.deductItems);
      const existRec = existingByDriver.get(driverId);
      const payload = {
        driver_id: driverId,
        year,
        month,
        pay_items: computed.payItems,
        deduct_items: computed.deductItems,
        total_pay: totals.total_pay,
        total_deduct: totals.total_deduct,
        net_pay: totals.net_pay,
      };

      if (!existRec) {
        const { error } = await supabaseAdmin
          .from("payroll_records")
          .insert(payload);
        if (error) throw new Error(error.message);
        created++;
      } else if (existRec.confirmed_at) {
        skippedConfirmed.push(emp.name); // 확정건 보호
      } else if (!input.overwriteDrafts) {
        existingDrafts.push(emp.name); // 초안 존재 → 확인 필요
      } else {
        const { error } = await supabaseAdmin
          .from("payroll_records")
          .update(payload)
          .eq("id", existRec.id);
        if (error) throw new Error(error.message);
        updated++;
      }
    }

    revalidatePath("/hr/salary");
    return {
      ok: true,
      created,
      updated,
      skippedConfirmed,
      existingDrafts,
      noBase,
      targets,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "급여 생성 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// PART 1/2. 목록 조회 — 레코드 + 직원 메타 + 팀 + 설정과 다름 표식
// =====================================================================
export type MonthlyRow = {
  recordId: string;
  driver_id: string;
  name: string;
  rank: string | null;
  team: PayrollTeam;
  pay_items: PayItem[];
  deduct_items: PayItem[];
  total_pay: number;
  total_deduct: number;
  net_pay: number;
  confirmed: boolean;
  modified: boolean; // 초안 생성값(설정) 대비 수정됨
};

export type MonthlyListResult = {
  year: number;
  month: number;
  rows: MonthlyRow[];
  missingNames: string[]; // 대상인데 레코드 없음(생성 필요)
  allConfirmed: boolean;
  anyConfirmed: boolean;
};

function itemsEqual(a: PayItem[], b: PayItem[]): boolean {
  if (a.length !== b.length) return false;
  const key = (i: PayItem) => `${i.key}:${Math.round(i.amount)}`;
  const sa = a.map(key).sort();
  const sb = b.map(key).sort();
  return sa.every((v, i) => v === sb[i]);
}

export async function listMonthlyPayroll(input: {
  year: number;
  month: number;
}): Promise<MonthlyListResult> {
  await requireSalaryAccess();
  const year = Number(input.year);
  const month = Number(input.month);
  const ctx = await loadContext(year);

  const { data, error } = await supabaseAdmin
    .from("payroll_records")
    .select("*")
    .eq("year", year)
    .eq("month", month);
  if (error) throw new Error(error.message);
  const records = (data ?? []).map((r) =>
    toPayrollRecord(r as Record<string, unknown>)
  );
  const recByDriver = new Map(records.map((r) => [r.driver_id, r]));

  const rows: MonthlyRow[] = [];
  for (const rec of records) {
    const emp = ctx.empByDriver.get(rec.driver_id);
    const prof = profileForMonth(
      ctx.profilesByDriver.get(rec.driver_id) ?? [],
      month
    );
    // 팀은 직원 단위 — 구간 중 지정된 값 우선(일부 구간만 지정돼도 시드에 밀리지 않게).
    const team = resolveTeam({
      team: effectiveTeamValue(ctx.profilesByDriver.get(rec.driver_id) ?? []),
      name: emp?.name ?? "",
    });
    // 설정과 다름 — 설정 기준 재계산과 저장값 비교.
    let modified = false;
    if (prof) {
      const base = computeFromProfile(ctx, prof, year, month);
      if (base) {
        modified =
          !itemsEqual(base.payItems, rec.pay_items) ||
          !itemsEqual(base.deductItems, rec.deduct_items);
      }
    }
    rows.push({
      recordId: rec.id,
      driver_id: rec.driver_id,
      name: emp?.name ?? "(이름 없음)",
      rank: emp?.rank ?? null,
      team,
      pay_items: rec.pay_items,
      deduct_items: rec.deduct_items,
      total_pay: rec.total_pay,
      total_deduct: rec.total_deduct,
      net_pay: rec.net_pay,
      confirmed: !!rec.confirmed_at,
      modified,
    });
  }

  // 정렬: 팀(센터→방과후) → 이름.
  const teamOrder: Record<PayrollTeam, number> = { center: 0, afterschool: 1 };
  rows.sort((a, b) => {
    if (a.team !== b.team) return teamOrder[a.team] - teamOrder[b.team];
    return a.name.localeCompare(b.name, "ko");
  });

  // 대상인데 레코드 없는 직원.
  const missingNames: string[] = [];
  for (const [driverId, emp] of ctx.empByDriver) {
    if (recByDriver.has(driverId)) continue;
    if (isTarget(ctx, driverId, year, month)) missingNames.push(emp.name);
  }

  const anyConfirmed = rows.some((r) => r.confirmed);
  const allConfirmed = rows.length > 0 && rows.every((r) => r.confirmed);
  return { year, month, rows, missingNames, allConfirmed, anyConfirmed };
}

// =====================================================================
// PART 2. 명세서 수정 — 항목 금액/추가/삭제 후 합계 재계산
// =====================================================================
function sanitizeItems(items: unknown): PayItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return {
        key: String(o.key ?? "").trim(),
        label: String(o.label ?? "").trim(),
        amount: Math.round(Number(o.amount ?? 0)),
      };
    })
    .filter((i) => i.key && i.label && Number.isFinite(i.amount));
}

export async function savePayrollRecord(input: {
  recordId: string;
  pay_items: PayItem[];
  deduct_items: PayItem[];
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSalaryAccess();
    if (!input.recordId) return { ok: false, message: "레코드가 없습니다." };

    const { data: cur, error: curErr } = await supabaseAdmin
      .from("payroll_records")
      .select("id, confirmed_at")
      .eq("id", input.recordId)
      .maybeSingle();
    if (curErr) throw new Error(curErr.message);
    if (!cur) return { ok: false, message: "레코드를 찾을 수 없습니다." };
    if ((cur as { confirmed_at: string | null }).confirmed_at) {
      return {
        ok: false,
        message: "확정된 급여는 수정할 수 없습니다. 먼저 확정을 취소하세요.",
      };
    }

    const pay = sanitizeItems(input.pay_items);
    const ded = sanitizeItems(input.deduct_items);
    const totals = recalcTotals(pay, ded);
    const { error } = await supabaseAdmin
      .from("payroll_records")
      .update({
        pay_items: pay,
        deduct_items: ded,
        total_pay: totals.total_pay,
        total_deduct: totals.total_deduct,
        net_pay: totals.net_pay,
      })
      .eq("id", input.recordId);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/salary");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "수정 저장 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// PART 3. 확정 / 확정 취소
// =====================================================================
export async function confirmMonthlyPayroll(input: {
  year: number;
  month: number;
  force: boolean;
}): Promise<
  | { ok: true; confirmed: number }
  | { ok: false; message?: string; warnings?: string[] }
> {
  try {
    const who = await requireSalaryAccess();
    const year = Number(input.year);
    const month = Number(input.month);

    const { data, error } = await supabaseAdmin
      .from("payroll_records")
      .select("*")
      .eq("year", year)
      .eq("month", month);
    if (error) throw new Error(error.message);
    const records = (data ?? []).map((r) =>
      toPayrollRecord(r as Record<string, unknown>)
    );
    const drafts = records.filter((r) => !r.confirmed_at);
    if (drafts.length === 0) {
      return { ok: false, message: "확정할 초안 급여가 없습니다." };
    }

    // 검증: 차인지급액 음수·지급총액 0원.
    const ctx = await loadContext(year);
    const warnings: string[] = [];
    for (const r of drafts) {
      const name = ctx.empByDriver.get(r.driver_id)?.name ?? r.driver_id;
      if (r.net_pay < 0) warnings.push(`${name}: 차인지급액이 음수입니다.`);
      if (r.total_pay === 0) warnings.push(`${name}: 지급총액이 0원입니다.`);
    }
    if (warnings.length > 0 && !input.force) {
      return { ok: false, warnings };
    }

    const now = new Date().toISOString();
    const { error: upErr } = await supabaseAdmin
      .from("payroll_records")
      .update({ confirmed_at: now, confirmed_by: who.name })
      .eq("year", year)
      .eq("month", month)
      .is("confirmed_at", null);
    if (upErr) throw new Error(upErr.message);

    revalidatePath("/hr/salary");
    return { ok: true, confirmed: drafts.length };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "확정 중 오류가 발생했습니다.",
    };
  }
}

// 확정 취소 — M0 전용. 사유 없이 단순 취소(confirmed_by 초기화).
export async function cancelMonthlyConfirm(input: {
  year: number;
  month: number;
}): Promise<{ ok: true; canceled: number } | { ok: false; message: string }> {
  try {
    await requireSalaryAccess({ onlyM0: true });
    const year = Number(input.year);
    const month = Number(input.month);
    const { data, error } = await supabaseAdmin
      .from("payroll_records")
      .update({ confirmed_at: null, confirmed_by: null })
      .eq("year", year)
      .eq("month", month)
      .not("confirmed_at", "is", null)
      .select("id");
    if (error) throw new Error(error.message);
    revalidatePath("/hr/salary");
    return { ok: true, canceled: (data ?? []).length };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "확정 취소 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// PART 5. 4대보험 EDI 업로드 — 미리보기 / 적용
// =====================================================================
const EXTRA_LABEL: Record<EdiUpdateKey, string> = {
  pension: "국민연금",
  health: "국민건강",
  longterm_care: "장기요양",
  employment_ins: "고용보험",
};

export type EdiDiffRow = {
  name: string;
  matched: boolean;
  key: EdiUpdateKey;
  label: string;
  oldValue: number;
  newValue: number;
  delta: number;
  bigChange: boolean; // ±30% 이상
  note: string | null;
};

export type EdiPreviewResult =
  | {
      ok: true;
      fileType: EdiFileType;
      diffs: EdiDiffRow[];
      warnings: string[];
      unmatchedNames: string[];
      missingActiveNames: string[]; // 재직 대상인데 파일에 없음
    }
  | { ok: false; message: string };

// 이름 → driverId + 그 월 프로필. 공용 로직.
function buildMatchers(ctx: GenContext, month: number) {
  const idByName = new Map<string, string>();
  for (const [id, emp] of ctx.empByDriver)
    idByName.set(emp.name.replace(/\s+/g, ""), id);
  const profOf = (driverId: string): ProfileRow | null =>
    profileForMonth(ctx.profilesByDriver.get(driverId) ?? [], month);
  return { idByName, profOf };
}

function ediEntriesToUpdates(
  buffer: Uint8Array,
  fileType: EdiFileType,
  configMap: Record<string, number>
) {
  return parseEdiBuffer(buffer, fileType, {
    employmentEmpRate: configMap["employment_emp_rate"] ?? 0,
  });
}

export async function previewEdiUpload(input: {
  year: number;
  month: number;
  fileType: EdiFileType;
  base64: string;
}): Promise<EdiPreviewResult> {
  try {
    await requireSalaryAccess();
    const year = Number(input.year);
    const month = Number(input.month);
    if (!EDI_FILE_TYPES.some((t) => t.value === input.fileType))
      return { ok: false, message: "파일 종류가 올바르지 않습니다." };

    const buffer = Buffer.from(input.base64, "base64");
    const ctx = await loadContext(year);
    const parsed = ediEntriesToUpdates(buffer, input.fileType, ctx.configMap);
    const { idByName, profOf } = buildMatchers(ctx, month);

    const diffs: EdiDiffRow[] = [];
    const unmatchedNames: string[] = [];
    const matchedDriverIds = new Set<string>();

    for (const entry of parsed.entries) {
      const nkey = entry.name.replace(/\s+/g, "");
      const driverId = idByName.get(nkey) ?? null;
      if (!driverId) {
        unmatchedNames.push(entry.name);
      } else {
        matchedDriverIds.add(driverId);
      }
      const prof = driverId ? profOf(driverId) : null;
      const extra = prof?.extra ?? null;
      for (const [k, v] of Object.entries(entry.update) as [
        EdiUpdateKey,
        number,
      ][]) {
        const oldValue = extra ? Number(extra[k] ?? 0) : 0;
        const delta = v - oldValue;
        const bigChange =
          oldValue > 0 && Math.abs(delta) / oldValue >= 0.3;
        diffs.push({
          name: entry.name,
          matched: !!driverId,
          key: k,
          label: EXTRA_LABEL[k],
          oldValue,
          newValue: v,
          delta,
          bigChange,
          note: entry.note,
        });
      }
    }

    // 재직 대상인데 파일에 없는 직원(산재 등 공제무관 파일은 생략).
    const missingActiveNames: string[] = [];
    if (input.fileType !== "accident") {
      for (const [driverId, emp] of ctx.empByDriver) {
        if (!isTarget(ctx, driverId, year, month)) continue;
        if (!matchedDriverIds.has(driverId)) missingActiveNames.push(emp.name);
      }
    }

    return {
      ok: true,
      fileType: input.fileType,
      diffs,
      warnings: parsed.warnings,
      unmatchedNames,
      missingActiveNames,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "미리보기 중 오류가 발생했습니다.",
    };
  }
}

export async function applyEdiUpload(input: {
  year: number;
  month: number;
  fileType: EdiFileType;
  base64: string;
}): Promise<
  | {
      ok: true;
      applied: number;
      updatedNames: string[];
      unmatchedNames: string[];
      needsRegen: string[]; // 초안 레코드 존재 → 재생성 필요
    }
  | { ok: false; message: string }
> {
  try {
    await requireSalaryAccess();
    const year = Number(input.year);
    const month = Number(input.month);
    if (input.fileType === "accident")
      return {
        ok: false,
        message: "산재보험은 급여 공제 대상이 아닙니다. (적용 불필요)",
      };
    if (!EDI_FILE_TYPES.some((t) => t.value === input.fileType))
      return { ok: false, message: "파일 종류가 올바르지 않습니다." };

    const buffer = Buffer.from(input.base64, "base64");
    const ctx = await loadContext(year);
    const parsed = ediEntriesToUpdates(buffer, input.fileType, ctx.configMap);
    const { idByName, profOf } = buildMatchers(ctx, month);

    const updatedNames: string[] = [];
    const unmatchedNames: string[] = [];
    const touchedDrivers = new Set<string>();

    for (const entry of parsed.entries) {
      const driverId = idByName.get(entry.name.replace(/\s+/g, "")) ?? null;
      if (!driverId) {
        unmatchedNames.push(entry.name);
        continue;
      }
      const prof = profOf(driverId);
      if (!prof) {
        unmatchedNames.push(`${entry.name}(해당 월 급여설정 없음)`);
        continue;
      }
      const nextExtra: SalaryExtra = normalizeSalaryExtra({
        ...prof.extra,
        ...entry.update, // pension/health/longterm_care/employment_ins
      });
      const { error } = await supabaseAdmin
        .from("employee_salary_profiles")
        .update({ extra: nextExtra, updated_at: new Date().toISOString() })
        .eq("driver_id", driverId)
        .eq("year", year)
        .eq("start_month", prof.start_month)
        .eq("end_month", prof.end_month);
      if (error) throw new Error(error.message);
      updatedNames.push(entry.name);
      touchedDrivers.add(driverId);
    }

    // 해당 월 초안 레코드가 있으면 재생성 필요 안내(확정건은 불변).
    const needsRegen: string[] = [];
    if (touchedDrivers.size > 0) {
      const { data: recs } = await supabaseAdmin
        .from("payroll_records")
        .select("driver_id, confirmed_at")
        .eq("year", year)
        .eq("month", month);
      for (const r of recs ?? []) {
        const rr = r as Record<string, unknown>;
        const did = String(rr.driver_id);
        if (touchedDrivers.has(did) && !rr.confirmed_at) {
          needsRegen.push(ctx.empByDriver.get(did)?.name ?? did);
        }
      }
    }

    revalidatePath("/hr/salary");
    return {
      ok: true,
      applied: updatedNames.length,
      updatedNames,
      unmatchedNames,
      needsRegen,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "적용 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 급여 3차. 급여명세서 PDF 이메일 발송
//   * 확정된 달만. 각 직원에게 "본인 것만" 첨부(driver_id↔레코드 1:1).
//   * 개별 실패가 전체를 막지 않도록 직원별 독립 처리 + 결과 집계.
//   * 성공 시 payroll_records.emailed_at 기록. 재발송 허용(옵션).
// =====================================================================

// driver_id → email 맵.
async function loadEmails(): Promise<Map<string, string | null>> {
  const { data } = await supabaseAdmin
    .from("employee_profiles")
    .select("driver_id, email");
  const m = new Map<string, string | null>();
  for (const r of data ?? []) {
    const rr = r as Record<string, unknown>;
    const email = String(rr.email ?? "").trim();
    m.set(String(rr.driver_id), email || null);
  }
  return m;
}

export type PayslipTarget = {
  driver_id: string;
  name: string;
  email: string | null;
  teamLabel: string;
  emailedAt: string | null;
};

export type PayslipTargetsResult = {
  configured: boolean; // 발송 자격증명(GMAIL_*) 준비 여부
  confirmed: boolean; // 그 달 전 레코드 확정 여부
  hasRecords: boolean;
  targets: PayslipTarget[]; // 확정 레코드 대상
};

// 발송 전 확인 모달용 — 대상 목록·설정 여부.
export async function listPayslipTargets(input: {
  year: number;
  month: number;
}): Promise<PayslipTargetsResult> {
  await requireSalaryAccess();
  const year = Number(input.year);
  const month = Number(input.month);
  const ctx = await loadContext(year);
  const emails = await loadEmails();

  const { data, error } = await supabaseAdmin
    .from("payroll_records")
    .select("*")
    .eq("year", year)
    .eq("month", month);
  if (error) throw new Error(error.message);
  const records = (data ?? []).map((r) =>
    toPayrollRecord(r as Record<string, unknown>)
  );
  const confirmed = records.length > 0 && records.every((r) => r.confirmed_at);

  const targets: PayslipTarget[] = records
    .filter((r) => r.confirmed_at) // 확정 건만 발송 대상
    .map((r) => {
      const emp = ctx.empByDriver.get(r.driver_id);
      const team = resolveTeam({
        team: effectiveTeamValue(ctx.profilesByDriver.get(r.driver_id) ?? []),
        name: emp?.name ?? "",
      });
      return {
        driver_id: r.driver_id,
        name: emp?.name ?? "(이름 없음)",
        email: emails.get(r.driver_id) ?? null,
        teamLabel: TEAM_LABEL[team],
        emailedAt: r.emailed_at,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return {
    configured: isMailerConfigured(),
    confirmed,
    hasRecords: records.length > 0,
    targets,
  };
}

export type PayslipSendItem = {
  name: string;
  email: string | null;
  status: "sent" | "skipped_no_email" | "skipped_already" | "failed";
  error?: string;
};

export type PayslipSendResult =
  | {
      ok: true;
      sent: number;
      failed: number;
      skipped: number;
      ignored: number; // 전달됐지만 대상 아님(확정 레코드에 없음) — 무시된 id 수
      items: PayslipSendItem[];
    }
  | { ok: false; message?: string; notConfigured?: boolean };

export async function sendPayslips(input: {
  year: number;
  month: number;
  // 선택된 driver_id 목록만 발송. 재발송/일부/개별 발송 지원.
  driverIds: string[];
}): Promise<PayslipSendResult> {
  try {
    await requireSalaryAccess();
    if (!isMailerConfigured()) {
      return { ok: false, notConfigured: true };
    }
    const year = Number(input.year);
    const month = Number(input.month);
    const ctx = await loadContext(year);
    const emails = await loadEmails();

    const { data, error } = await supabaseAdmin
      .from("payroll_records")
      .select("*")
      .eq("year", year)
      .eq("month", month);
    if (error) throw new Error(error.message);
    const records = (data ?? []).map((r) =>
      toPayrollRecord(r as Record<string, unknown>)
    );
    // 확정 건만 발송(초안 발송 금지).
    const confirmed = records.filter((r) => r.confirmed_at);
    if (confirmed.length === 0) {
      return { ok: false, message: "확정된 급여가 없습니다. 먼저 확정하세요." };
    }

    // 서버 측 재검증 — 전달된 id 중 확정 레코드에 실제 존재하는 것만 대상.
    //   목록에 없는 id는 에러가 아니라 무시하고 결과에 개수로 표기.
    const confirmedById = new Map(confirmed.map((r) => [r.driver_id, r]));
    const requestedIds = Array.isArray(input.driverIds) ? input.driverIds : [];
    const uniqueRequested = [...new Set(requestedIds.map((id) => String(id)))];
    const validIds = uniqueRequested.filter((id) => confirmedById.has(id));
    const ignored = uniqueRequested.length - validIds.length;

    if (validIds.length === 0) {
      return {
        ok: false,
        message: "발송할 대상을 선택하세요. (선택된 대상이 확정 급여에 없습니다)",
      };
    }

    const items: PayslipSendItem[] = [];
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    // 직원별 독립 처리 — 한 명 실패가 전체를 막지 않음.
    //   선택된 대상만 발송(선택 = 재발송 의사이므로 emailed_at 무관).
    for (const driverId of validIds) {
      const rec = confirmedById.get(driverId)!;
      const emp = ctx.empByDriver.get(rec.driver_id);
      const name = emp?.name ?? "(이름 없음)";
      const email = emails.get(rec.driver_id) ?? null;

      if (!email) {
        skipped++;
        items.push({ name, email: null, status: "skipped_no_email" });
        continue;
      }

      try {
        const team = resolveTeam({
          team: effectiveTeamValue(ctx.profilesByDriver.get(rec.driver_id) ?? []),
          name,
        });
        // ★본인 레코드(rec)로만 PDF 생성 → 교차 발송 방지.
        const pdf = await buildPayslipPdf(rec, {
          name,
          teamLabel: TEAM_LABEL[team],
          year,
          month,
        });
        await sendMailWithAttachment({
          to: email,
          subject: `[동래구청소년센터] ${month}월 급여명세서`,
          text: `안녕하세요, ${name}님.\n\n첨부된 ${year}년 ${month}월 급여명세서를 확인해 주세요.\n문의: 회계담당\n\n동래구청소년센터`,
          attachments: [
            {
              filename: `${year}년${month}월_급여명세서_${name}.pdf`,
              content: Buffer.from(pdf),
              contentType: "application/pdf",
            },
          ],
        });
        // 성공 시에만 발송 시각 기록.
        await supabaseAdmin
          .from("payroll_records")
          .update({ emailed_at: new Date().toISOString() })
          .eq("id", rec.id);
        sent++;
        items.push({ name, email, status: "sent" });
      } catch (e) {
        failed++;
        items.push({
          name,
          email,
          status: "failed",
          error: e instanceof Error ? e.message : "발송 실패",
        });
      }
    }

    revalidatePath("/hr/salary");
    return { ok: true, sent, failed, skipped, ignored, items };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "발송 중 오류가 발생했습니다.",
    };
  }
}
