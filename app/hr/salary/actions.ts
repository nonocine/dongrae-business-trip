"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveSalaryAccess, requireSalaryAccess } from "@/lib/salaryAccess";
import {
  normalizeSalaryExtra,
  validateMonthRanges,
  type SalaryGradeRow,
  type SalaryConfigRow,
  type EmployeeSalaryProfileRow,
  type SalaryExtra,
} from "@/lib/salary";

// =====================================================================
// 급여 기준 관리 — /hr/salary (급여 1차)
//   * 접근: M0(관장·부장·master) 또는 accounting(회계) 직무 보유자만.
//     - /hr(요구: 관장·부장) 와 달리 회계 팀원도 들어와야 하므로 별도 게이트.
//   * 모든 테이블은 RLS 정책 0개 → service_role(supabaseAdmin) 경유. 이 게이트가
//     유일한 방어선이므로 조회·변경 액션 모두 진입 시 권한을 재검증합니다.
//   * 계산·명세서·발송 없음(2차). 여기서는 기준값/설정 데이터 입력·관리만.
// =====================================================================

// 페이지용 — 접근 가능 여부만. (접근 컨텍스트는 lib/salaryAccess 공용)
export async function canAccessSalary(): Promise<boolean> {
  return (await resolveSalaryAccess()) !== null;
}

// --- 정규화 ---
function toGradeRow(raw: Record<string, unknown>): SalaryGradeRow {
  return {
    id: String(raw.id ?? ""),
    year: Number(raw.year ?? 0),
    grade: String(raw.grade ?? ""),
    step: Number(raw.step ?? 0),
    base_salary: Number(raw.base_salary ?? 0),
  };
}
function toConfigRow(raw: Record<string, unknown>): SalaryConfigRow {
  return {
    id: String(raw.id ?? ""),
    year: Number(raw.year ?? 0),
    config_key: String(raw.config_key ?? ""),
    config_value: Number(raw.config_value ?? 0),
    label: (raw.label as string | null) ?? null,
  };
}
function toSalaryProfileRow(
  raw: Record<string, unknown>
): EmployeeSalaryProfileRow {
  return {
    id: String(raw.id ?? ""),
    driver_id: String(raw.driver_id ?? ""),
    year: Number(raw.year ?? 0),
    grade: String(raw.grade ?? ""),
    step: Number(raw.step ?? 0),
    start_month: Number(raw.start_month ?? 0),
    end_month: Number(raw.end_month ?? 0),
    extra: normalizeSalaryExtra(raw.extra),
  };
}

// =====================================================================
// 연도 목록 / 연도 추가(복사)
// =====================================================================
export async function listSalaryYears(): Promise<number[]> {
  await requireSalaryAccess();
  const [{ data: g }, { data: c }] = await Promise.all([
    supabaseAdmin.from("salary_grade_table").select("year"),
    supabaseAdmin.from("salary_config").select("year"),
  ]);
  const years = new Set<number>();
  for (const r of g ?? []) years.add(Number((r as { year: unknown }).year));
  for (const r of c ?? []) years.add(Number((r as { year: unknown }).year));
  return Array.from(years)
    .filter((y) => Number.isFinite(y) && y > 0)
    .sort((a, b) => b - a);
}

// 새 연도 생성 — copyFromYear 가 주어지면 호봉표+기준값을 그대로 복사.
export async function createSalaryYear(
  newYear: number,
  copyFromYear: number | null
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSalaryAccess();
    const y = Number(newYear);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      return { ok: false, message: "올바른 연도를 입력해주세요." };
    }
    const existing = await listSalaryYears();
    if (existing.includes(y)) {
      return { ok: false, message: `${y}년 데이터가 이미 존재합니다.` };
    }
    if (copyFromYear != null) {
      const { data: grades } = await supabaseAdmin
        .from("salary_grade_table")
        .select("grade, step, base_salary")
        .eq("year", copyFromYear);
      if (grades && grades.length > 0) {
        const rows = grades.map((r) => ({
          year: y,
          grade: String((r as { grade: unknown }).grade ?? ""),
          step: Number((r as { step: unknown }).step ?? 0),
          base_salary: Number((r as { base_salary: unknown }).base_salary ?? 0),
        }));
        const { error } = await supabaseAdmin
          .from("salary_grade_table")
          .insert(rows);
        if (error) throw new Error(error.message);
      }
      const { data: configs } = await supabaseAdmin
        .from("salary_config")
        .select("config_key, config_value, label")
        .eq("year", copyFromYear);
      if (configs && configs.length > 0) {
        const rows = configs.map((r) => ({
          year: y,
          config_key: String((r as { config_key: unknown }).config_key ?? ""),
          config_value: Number((r as { config_value: unknown }).config_value ?? 0),
          label: (r as { label: unknown }).label as string | null,
        }));
        const { error } = await supabaseAdmin
          .from("salary_config")
          .insert(rows);
        if (error) throw new Error(error.message);
      }
    }
    revalidatePath("/hr/salary");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "연도 생성 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 호봉표 (salary_grade_table)
// =====================================================================
export async function listGradeTable(year: number): Promise<SalaryGradeRow[]> {
  await requireSalaryAccess();
  const { data, error } = await supabaseAdmin
    .from("salary_grade_table")
    .select("*")
    .eq("year", year);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toGradeRow(r as Record<string, unknown>));
}

export async function saveGradeRow(input: {
  id: string | null;
  year: number;
  grade: string;
  step: number;
  base_salary: number;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSalaryAccess();
    const year = Number(input.year);
    const grade = input.grade.trim();
    const step = Number(input.step);
    const base = Number(input.base_salary);
    if (!Number.isInteger(year) || year <= 0)
      return { ok: false, message: "연도가 올바르지 않습니다." };
    if (!grade) return { ok: false, message: "급수를 입력해주세요. (예: 6급)" };
    if (!Number.isInteger(step) || step < 0)
      return { ok: false, message: "호봉은 0 이상의 정수여야 합니다." };
    if (!Number.isFinite(base) || base < 0)
      return { ok: false, message: "기본급은 0 이상이어야 합니다." };

    // (year, grade, step) 중복 방지 — 자기 자신(id)은 제외.
    const { data: dup } = await supabaseAdmin
      .from("salary_grade_table")
      .select("id")
      .eq("year", year)
      .eq("grade", grade)
      .eq("step", step);
    const conflict = (dup ?? []).some(
      (r) => String((r as { id: unknown }).id) !== (input.id ?? "")
    );
    if (conflict) {
      return {
        ok: false,
        message: `${year}년 ${grade} ${step}호봉이 이미 있습니다.`,
      };
    }

    if (input.id) {
      const { error } = await supabaseAdmin
        .from("salary_grade_table")
        .update({ grade, step, base_salary: Math.round(base) })
        .eq("id", input.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("salary_grade_table")
        .insert({ year, grade, step, base_salary: Math.round(base) });
      if (error) throw new Error(error.message);
    }
    revalidatePath("/hr/salary");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "호봉표 저장 중 오류가 발생했습니다.",
    };
  }
}

export async function deleteGradeRow(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSalaryAccess();
    if (!id) return { ok: false, message: "삭제할 행이 없습니다." };
    const { error } = await supabaseAdmin
      .from("salary_grade_table")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/salary");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 급여 기준값 (salary_config)
// =====================================================================
export async function listConfig(year: number): Promise<SalaryConfigRow[]> {
  await requireSalaryAccess();
  const { data, error } = await supabaseAdmin
    .from("salary_config")
    .select("*")
    .eq("year", year);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toConfigRow(r as Record<string, unknown>));
}

export async function saveConfigRow(input: {
  id: string | null;
  year: number;
  config_key: string;
  config_value: number;
  label: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSalaryAccess();
    const year = Number(input.year);
    const key = input.config_key.trim();
    const value = Number(input.config_value);
    const label = input.label.trim();
    if (!Number.isInteger(year) || year <= 0)
      return { ok: false, message: "연도가 올바르지 않습니다." };
    if (!key) return { ok: false, message: "기준 key 를 입력해주세요." };
    if (!/^[a-z0-9_]+$/.test(key)) {
      return {
        ok: false,
        message: "key 는 영문 소문자·숫자·밑줄(_)만 사용할 수 있습니다.",
      };
    }
    if (!Number.isFinite(value))
      return { ok: false, message: "값(숫자)을 입력해주세요." };

    // (year, config_key) 중복 방지 — 자기 자신 제외.
    const { data: dup } = await supabaseAdmin
      .from("salary_config")
      .select("id")
      .eq("year", year)
      .eq("config_key", key);
    const conflict = (dup ?? []).some(
      (r) => String((r as { id: unknown }).id) !== (input.id ?? "")
    );
    if (conflict) {
      return {
        ok: false,
        message: `${year}년 '${key}' 기준이 이미 있습니다.`,
      };
    }

    if (input.id) {
      const { error } = await supabaseAdmin
        .from("salary_config")
        .update({
          config_key: key,
          config_value: value,
          label: label || null,
        })
        .eq("id", input.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("salary_config").insert({
        year,
        config_key: key,
        config_value: value,
        label: label || null,
      });
      if (error) throw new Error(error.message);
    }
    revalidatePath("/hr/salary");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "기준값 저장 중 오류가 발생했습니다.",
    };
  }
}

export async function deleteConfigRow(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSalaryAccess();
    if (!id) return { ok: false, message: "삭제할 행이 없습니다." };
    const { error } = await supabaseAdmin
      .from("salary_config")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/salary");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 직원별 급여 설정 (employee_salary_profiles)
// =====================================================================
export type SalaryEmployee = {
  driver_id: string;
  name: string;
  rank: string | null;
  employment_status: "active" | "resigned";
  resignation_date: string | null;
};

// 급여 설정 대상 직원 — drivers + employee_profiles 재직 상태. 재직 우선 정렬.
export async function listSalaryEmployees(): Promise<SalaryEmployee[]> {
  await requireSalaryAccess();
  const [{ data: drivers, error: dErr }, { data: profiles }] =
    await Promise.all([
      supabaseAdmin.from("drivers").select("id, name, rank, created_at"),
      supabaseAdmin
        .from("employee_profiles")
        .select("driver_id, employment_status, resignation_date"),
    ]);
  if (dErr) throw new Error(dErr.message);
  const statusMap = new Map<
    string,
    { status: "active" | "resigned"; date: string | null }
  >();
  for (const p of profiles ?? []) {
    const r = p as Record<string, unknown>;
    statusMap.set(String(r.driver_id ?? ""), {
      status: r.employment_status === "resigned" ? "resigned" : "active",
      date: (r.resignation_date as string | null) ?? null,
    });
  }
  const list = (drivers ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const id = String(r.id ?? "");
    const st = statusMap.get(id);
    return {
      driver_id: id,
      name: String(r.name ?? ""),
      rank: (r.rank as string | null) ?? null,
      employment_status: st?.status ?? "active",
      resignation_date: st?.date ?? null,
      created: String(r.created_at ?? ""),
    };
  });
  // 재직 먼저, 그 안에서 입사(created) 순.
  list.sort((a, b) => {
    if (a.employment_status !== b.employment_status)
      return a.employment_status === "active" ? -1 : 1;
    return a.created.localeCompare(b.created);
  });
  return list.map((e) => ({
    driver_id: e.driver_id,
    name: e.name,
    rank: e.rank,
    employment_status: e.employment_status,
    resignation_date: e.resignation_date,
  }));
}

export async function listEmployeeSalaryRows(
  year: number
): Promise<EmployeeSalaryProfileRow[]> {
  await requireSalaryAccess();
  const { data, error } = await supabaseAdmin
    .from("employee_salary_profiles")
    .select("*")
    .eq("year", year);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) =>
    toSalaryProfileRow(r as Record<string, unknown>)
  );
}

// 한 직원·연도의 급여 설정 행 전체 교체(구간 나눔 반영).
//   * 월 구간 겹침·범위 검증 후, 기존 행 삭제 → 신규 행 삽입.
//   * rows 가 비면 해당 직원·연도 설정을 모두 제거(초기화)합니다.
export async function saveEmployeeSalaryRows(input: {
  driverId: string;
  year: number;
  rows: {
    grade: string;
    step: number;
    start_month: number;
    end_month: number;
    extra: SalaryExtra;
  }[];
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSalaryAccess();
    const driverId = input.driverId?.trim();
    const year = Number(input.year);
    if (!driverId) return { ok: false, message: "직원이 지정되지 않았습니다." };
    if (!Number.isInteger(year) || year <= 0)
      return { ok: false, message: "연도가 올바르지 않습니다." };

    const rows = input.rows ?? [];

    // 각 행의 급수·호봉 필수 + 월 구간 검증(겹침 포함).
    for (const r of rows) {
      if (!r.grade?.trim() || !Number.isInteger(Number(r.step))) {
        return { ok: false, message: "각 구간의 급수·호봉을 선택해주세요." };
      }
    }
    const rangeCheck = validateMonthRanges(
      rows.map((r) => ({
        start_month: Number(r.start_month),
        end_month: Number(r.end_month),
      }))
    );
    if (rows.length > 0 && !rangeCheck.ok) {
      return { ok: false, message: rangeCheck.message };
    }

    // 유효 급수·호봉인지(해당 연도 호봉표에 존재) 방어적 검증.
    if (rows.length > 0) {
      const grades = await listGradeTable(year);
      const valid = new Set(grades.map((g) => `${g.grade}::${g.step}`));
      for (const r of rows) {
        if (!valid.has(`${r.grade.trim()}::${Number(r.step)}`)) {
          return {
            ok: false,
            message: `${year}년 호봉표에 없는 급수·호봉입니다: ${r.grade} ${r.step}호봉`,
          };
        }
      }
    }

    // 교체 — 기존 삭제 후 삽입.
    const { error: delErr } = await supabaseAdmin
      .from("employee_salary_profiles")
      .delete()
      .eq("driver_id", driverId)
      .eq("year", year);
    if (delErr) throw new Error(delErr.message);

    if (rows.length > 0) {
      const insertRows = rows.map((r) => ({
        driver_id: driverId,
        year,
        grade: r.grade.trim(),
        step: Number(r.step),
        start_month: Number(r.start_month),
        end_month: Number(r.end_month),
        extra: normalizeSalaryExtra(r.extra),
        updated_at: new Date().toISOString(),
      }));
      const { error: insErr } = await supabaseAdmin
        .from("employee_salary_profiles")
        .insert(insertRows);
      if (insErr) throw new Error(insErr.message);
    }

    revalidatePath("/hr/salary");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "직원 급여 설정 저장 중 오류가 발생했습니다.",
    };
  }
}
