// =====================================================================
// 연봉계약서 저장 — 서버 전용("use server" 아님). 권한 확인은 호출부(salaryActions)가
//   requireContractAdmin 으로 하고 그 결과(me)를 넘깁니다. 이 함수 자체는 액션으로
//   노출되지 않습니다.
//   * 금액은 언제나 서버가 DB(호봉표·salary_config·명절 날짜)로 다시 계산합니다.
//     화면이 보낸 숫자 중 믿는 것은 구간 입력과, 관장·부장이 직접 고친 항목 금액(overrides)뿐.
//   * 직접 고친 금액이 있으면(2026-10 관장 요청 — 교통보조비 인상 등):
//       · 관장·부장(M0, isM0Grant 판정)만 저장할 수 있고
//       · 수정 사유 한 줄이 필수이며 note 에 "금액 직접 수정: 사유 (이름, 날짜)" 로 남습니다.
//   * 수정은 작성 중(draft)일 때만 — 보낸 뒤·체결 후에는 update 조건(status=draft)에서 막힙니다.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CONTRACT_KINDS, defaultContractDate, isYmd } from "@/lib/contractCore";
import {
  SALARY_HOLIDAYS_KEY,
  amountInKorean,
  cleanOverrides,
  computeSalaryContract,
  hasOverrides,
  splitSegmentsByConfig,
  type ConfigRows,
  type GradeRow,
  type HolidayDates,
  type SalaryCalc,
  type SegmentInput,
} from "@/lib/salaryContracts";
import { readSetting, type Result } from "@/lib/contractServer";
import { loadSalaryConfigRows } from "@/lib/salaryConfigServer";

const TABLE = CONTRACT_KINDS.salary.table;
export const OVERRIDE_NOTE_PREFIX = "금액 직접 수정: ";

export async function loadCalcInputs(
  year: number
): Promise<{ gradeRows: GradeRow[]; configRows: ConfigRows; holidays: HolidayDates }> {
  const [{ data: grades, error: gErr }, configRows, holidaysRaw] = await Promise.all([
    supabaseAdmin.from("salary_grade_table").select("grade, step, base_salary, effective_from").eq("year", year),
    loadSalaryConfigRows(year),
    readSetting(SALARY_HOLIDAYS_KEY),
  ]);
  if (gErr) throw new Error(gErr.message);
  return {
    gradeRows: ((grades ?? []) as GradeRow[]).map((g) => ({ ...g, step: Number(g.step), base_salary: Number(g.base_salary) })),
    configRows,
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

export function cleanSegments(input: SegmentInput[]): SegmentInput[] {
  return (input ?? []).slice(0, 12).map((s) => {
    const overrides = cleanOverrides(s.overrides);
    return {
      start_month: Math.trunc(Number(s.start_month)),
      end_month: Math.trunc(Number(s.end_month)),
      grade: String(s.grade ?? "").trim(),
      step: Math.trunc(Number(s.step)),
      cert_level: (["1", "2", "3"].includes(String(s.cert_level)) ? String(s.cert_level) : "") as SegmentInput["cert_level"],
      meal: s.meal !== false,
      transport: s.transport !== false,
      mgmt_target: s.mgmt_target == null ? undefined : !!s.mgmt_target,
      family_monthly: Math.max(0, Math.trunc(Number(s.family_monthly) || 0)),
      ...(overrides ? { overrides } : {}),
    };
  });
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
    ? "이 직원의 같은 연도 연봉계약서가 이미 있습니다(직원·연도당 1건 — 무효 건은 빼고 셉니다). 목록에서 기존 건을 확인해주세요."
    : null;
}

export type SalaryContractInput = {
  id?: string | null;
  driverId: string;
  year: number;
  segments: SegmentInput[];
  overrideReason?: string | null; // 금액을 직접 고쳤을 때 필수
};

export async function saveSalaryContractCore(
  input: SalaryContractInput,
  me: { name: string; isM0: boolean }
): Promise<Result<{ id: string; total: number }>> {
  if (!input.driverId) return { ok: false, message: "직원을 선택해주세요." };
  const year = Math.trunc(Number(input.year));
  const inputs = await loadCalcInputs(year);
  // 수당 단가가 바뀌는 달에서 구간을 나눠 저장합니다(화면과 같은 함수 — 이미 나뉘었으면 그대로).
  const segments = splitSegmentsByConfig(cleanSegments(input.segments), inputs.configRows);
  const calc = computeSalaryContract({ year, segments, ...inputs });
  if (calc.errors.length) return { ok: false, message: calc.errors.join(" / ") };

  // 계산값과 같은 '고친 금액' 은 계산 단계에서 빠지므로, 실제로 다른 값만 남습니다.
  const overridden = hasOverrides(calc.segments);
  const reason = (input.overrideReason ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (overridden && !me.isM0) {
    return { ok: false, message: "항목 금액 직접 수정은 관장·부장만 할 수 있습니다. (계산값으로 되돌린 뒤 저장하세요)" };
  }
  if (overridden && !reason) return { ok: false, message: "금액을 고쳤으면 수정 사유를 한 줄 적어주세요." };
  const kstDay = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const note = overridden ? `${OVERRIDE_NOTE_PREFIX}${reason} (${me.name}, ${kstDay})` : null;

  // 계약일 = 계약 시작일(또는 그 달 1일) — 관장 원칙. 시작일을 바꾸면 따라 바뀝니다.
  let currentDate: string | null = null;
  if (input.id) {
    const { data: cur } = await supabaseAdmin.from(TABLE).select("contract_date").eq("id", input.id).maybeSingle();
    currentDate = (cur as { contract_date?: string | null } | null)?.contract_date ?? null;
  }
  const row = { ...rowFromCalc(calc), note, contract_date: defaultContractDate(calc.period_start, currentDate) };
  if (input.id) {
    const { error, count } = await supabaseAdmin
      .from(TABLE)
      .update(row, { count: "exact" })
      .eq("id", input.id)
      .eq("driver_id", input.driverId)
      .eq("status", "draft");
    if (error) return { ok: false, message: dupMessage(error.code) ?? error.message };
    if (!count) {
      return {
        ok: false,
        message: "작성 중인 계약서만 고칠 수 있습니다. 보낸 뒤에는 수정할 수 없습니다 — 직원 서명 전이면 [발송 취소] 후 고치세요.",
      };
    }
    return { ok: true, id: input.id, total: calc.total };
  }
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({ ...row, driver_id: input.driverId, status: "draft", created_by: me.name })
    .select("id")
    .single();
  if (error) return { ok: false, message: dupMessage(error.code) ?? error.message };
  return { ok: true, id: String((data as { id: string }).id), total: calc.total };
}
