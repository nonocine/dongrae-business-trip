"use server";

// =====================================================================
// 상조회 장부 — MU-2 (연도 조회 / 월 회비 기입 / 세입·세출 추가 / 수정·삭제)
//   * 접근: M0 또는 mutual 직무. 모든 액션이 진입 시 재검증(RLS 정책 0개).
//   * 이월(carryOver)은 별도 컬럼을 두지 않고 "그 연도 1월 1일 이전 전체 순액"으로
//     계산한다 → 과거 장부를 이관하면 이월이 자동으로 맞는다(단일 진실).
//   * 금액은 프리셋으로 자동 계산하되 항상 담당이 수정할 수 있다(미납·실비 정산).
//   * created_by 에 담당자 이름을 남긴다.
// =====================================================================

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireMutualAccess } from "@/lib/mutualAccess";
import { kstTodayYmd } from "@/lib/trainings";
import {
  BIRTHDAY_AHEAD_DAYS,
  YEAR_END_BONUS_MIN_BALANCE,
  YEAR_END_BONUS_UNIT,
  birthdaysWithin,
  hasFeeForMonth,
  isYmd,
  monthlyFeeAmount,
  monthlyFeeDescription,
  monthlyTotals,
  mutualCategory,
  normalizeKind,
  sumEntries,
  yearOf,
  type BirthdaySoon,
  type MonthlyTotals,
  type MutualKind,
  type MutualTotals,
} from "@/lib/mutual";

const LEDGER = "mutual_ledger";
const MEM = "mutual_members";
const DRV = "drivers";
const PROF = "employee_profiles";

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length ? s : null;
}
function toAmount(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
}

// =====================================================================
// 조회
// =====================================================================
export type LedgerRow = {
  id: string;
  entry_date: string;
  kind: MutualKind;
  category: string;
  description: string;
  amount: number;
  employee_id: string | null;
  employeeName: string | null;
  created_by: string | null;
  created_at: string | null;
};

export type MemberOption = {
  employee_id: string;
  name: string;
  birthDate: string | null;
  status: string;
};

export type LedgerView = {
  year: number;
  years: number[]; // 데이터가 있는 연도 + 올해(내림차순)
  rows: LedgerRow[];
  carryOver: number; // 전년도 말 잔액
  totals: MutualTotals;
  balance: number; // 이월 + 세입 − 세출
  monthly: MonthlyTotals[];
  feeMonths: boolean[]; // [0]=1월 … 이미 회비가 기입된 달
  activeMembers: number;
  memberOptions: MemberOption[]; // 대상 직원 선택용(활동·일시정지)
  today: string;
  // MU-3 배너 — Cron 알림과 같은 내용.
  birthdaysSoon: BirthdaySoon[];
  yearEndBonus: { eligible: boolean; members: number; total: number } | null;
  isM0: boolean;
};

async function loadMemberOptions(): Promise<MemberOption[]> {
  const [{ data: mems }, { data: drivers }, { data: profs }] = await Promise.all([
    supabaseAdmin.from(MEM).select("employee_id, status"),
    supabaseAdmin.from(DRV).select("id, name"),
    supabaseAdmin.from(PROF).select("driver_id, birth_date"),
  ]);
  const nameById = new Map(
    (drivers ?? []).map((d) => [
      String((d as { id: string }).id),
      String((d as { name: string }).name ?? ""),
    ])
  );
  const birthById = new Map(
    (profs ?? []).map((p) => [
      String((p as { driver_id: string }).driver_id),
      ((p as { birth_date: string | null }).birth_date ?? null) as string | null,
    ])
  );
  return ((mems ?? []) as Record<string, unknown>[])
    .map((m) => {
      const id = String(m.employee_id ?? "");
      return {
        employee_id: id,
        name: nameById.get(id) ?? "(삭제된 직원)",
        birthDate: birthById.get(id) ?? null,
        status: String(m.status ?? "active"),
      };
    })
    .filter((m) => m.status !== "left")
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export async function getLedger(yearInput?: number): Promise<LedgerView> {
  const ctx = await requireMutualAccess();
  const today = kstTodayYmd();
  const thisYear = Number(today.slice(0, 4));

  const { data: allDates } = await supabaseAdmin
    .from(LEDGER)
    .select("entry_date");
  const years = [
    ...new Set([
      thisYear,
      ...((allDates ?? []).map((r) =>
        yearOf(String((r as { entry_date: string }).entry_date))
      ) ?? []),
    ]),
  ]
    .filter((y) => Number.isFinite(y) && y > 1900)
    .sort((a, b) => b - a);

  const year =
    yearInput && Number.isFinite(yearInput) && yearInput > 1900
      ? Math.round(yearInput)
      : years[0] ?? thisYear;

  // 그 연도 행 + 이월 계산용 이전 전체 행(금액만).
  const [{ data: rows, error }, { data: before }, memberOptions] =
    await Promise.all([
      supabaseAdmin
        .from(LEDGER)
        .select("*")
        .gte("entry_date", `${year}-01-01`)
        .lte("entry_date", `${year}-12-31`)
        .order("entry_date", { ascending: true })
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from(LEDGER)
        .select("kind, amount, entry_date")
        .lt("entry_date", `${year}-01-01`),
      loadMemberOptions(),
    ]);
  if (error) throw new Error(error.message);

  const nameByEmp = new Map(memberOptions.map((m) => [m.employee_id, m.name]));
  // 장부 대상이 회원 목록에 없을 수도 있다(탈퇴자) → drivers 로 보완.
  const missing = [
    ...new Set(
      ((rows ?? []) as Record<string, unknown>[])
        .map((r) => (r.employee_id == null ? "" : String(r.employee_id)))
        .filter((id) => id && !nameByEmp.has(id))
    ),
  ];
  if (missing.length) {
    const { data: extra } = await supabaseAdmin
      .from(DRV)
      .select("id, name")
      .in("id", missing);
    for (const d of extra ?? [])
      nameByEmp.set(
        String((d as { id: string }).id),
        String((d as { name: string }).name ?? "")
      );
  }

  const ledgerRows: LedgerRow[] = ((rows ?? []) as Record<string, unknown>[]).map(
    (r) => {
      const empId = r.employee_id == null ? null : String(r.employee_id);
      return {
        id: String(r.id ?? ""),
        entry_date: String(r.entry_date ?? ""),
        kind: normalizeKind(r.kind),
        category: String(r.category ?? ""),
        description: String(r.description ?? ""),
        amount: toAmount(r.amount),
        employee_id: empId,
        employeeName: empId ? nameByEmp.get(empId) ?? null : null,
        created_by: (r.created_by as string | null) ?? null,
        created_at: (r.created_at as string | null) ?? null,
      };
    }
  );

  const carryOver = sumEntries(
    ((before ?? []) as Record<string, unknown>[]).map((r) => ({
      entry_date: String(r.entry_date ?? ""),
      kind: normalizeKind(r.kind),
      amount: toAmount(r.amount),
    }))
  ).net;

  const totals = sumEntries(ledgerRows);
  const balance = carryOver + totals.net;
  const activeMembers = memberOptions.filter((m) => m.status === "active").length;

  const feeMonths = Array.from({ length: 12 }, (_, i) =>
    hasFeeForMonth(ledgerRows, year, i + 1)
  );

  // MU-3 배너 — 활동·일시정지 회원의 향후 7일 생일.
  const birthdaysSoon = birthdaysWithin(
    memberOptions
      .filter((m) => m.status === "active")
      .map((m) => ({ name: m.name, birthDate: m.birthDate })),
    today,
    BIRTHDAY_AHEAD_DAYS
  );
  // 연말상여 제안 — 잔액이 기준 이상이고 12월일 때 노출(Cron 은 12/1 하루만).
  const inDecember = Number(today.slice(5, 7)) === 12 && year === thisYear;
  const yearEndBonus = inDecember
    ? {
        eligible: balance >= YEAR_END_BONUS_MIN_BALANCE,
        members: activeMembers,
        total: activeMembers * YEAR_END_BONUS_UNIT,
      }
    : null;

  return {
    year,
    years,
    rows: ledgerRows,
    carryOver,
    totals,
    balance,
    monthly: monthlyTotals(ledgerRows),
    feeMonths,
    activeMembers,
    memberOptions,
    today,
    birthdaysSoon,
    yearEndBonus,
    isM0: ctx.isM0,
  };
}

// =====================================================================
// 월 회비 기입 — 그 달 active 회원 n × 15,000. 이미 기입된 달은 거부.
// =====================================================================
export async function previewMonthlyFee(input: {
  year: number;
  month: number;
}): Promise<
  | { ok: true; members: number; amount: number; description: string; entryDate: string }
  | { ok: false; message: string }
> {
  try {
    await requireMutualAccess();
    const year = Math.round(Number(input.year));
    const month = Math.round(Number(input.month));
    if (!Number.isFinite(year) || month < 1 || month > 12)
      return { ok: false, message: "연·월을 확인하세요." };

    const { count } = await supabaseAdmin
      .from(MEM)
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    const members = count ?? 0;
    // 기입일 = 그 달 말일(급여공제 시점). 미래 달도 담당이 필요하면 쓸 수 있다.
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      ok: true,
      members,
      amount: monthlyFeeAmount(members),
      description: monthlyFeeDescription(month, members),
      entryDate: `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "계산 중 오류가 발생했습니다.",
    };
  }
}

export async function addMonthlyFee(input: {
  year: number;
  month: number;
  amount: number; // 미납 등 예외 시 수정 가능
  description?: string;
  entryDate?: string;
}): Promise<{ ok: true; amount: number } | { ok: false; message: string }> {
  try {
    const ctx = await requireMutualAccess();
    const year = Math.round(Number(input.year));
    const month = Math.round(Number(input.month));
    if (!Number.isFinite(year) || month < 1 || month > 12)
      return { ok: false, message: "연·월을 확인하세요." };

    // 중복 기입 방지 — 서버에서 재확인(화면 비활성만 믿지 않음).
    const { data: existing } = await supabaseAdmin
      .from(LEDGER)
      .select("entry_date, kind, category")
      .eq("kind", "income")
      .eq("category", "fee")
      .gte("entry_date", `${year}-01-01`)
      .lte("entry_date", `${year}-12-31`);
    const rows = ((existing ?? []) as Record<string, unknown>[]).map((r) => ({
      entry_date: String(r.entry_date ?? ""),
      kind: normalizeKind(r.kind),
      category: String(r.category ?? ""),
    }));
    if (hasFeeForMonth(rows, year, month))
      return { ok: false, message: `${month}월 회비는 이미 기입되어 있습니다.` };

    const amount = toAmount(input.amount);
    if (amount <= 0) return { ok: false, message: "금액을 확인하세요." };

    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const fallbackDate = `${year}-${String(month).padStart(2, "0")}-${String(
      last
    ).padStart(2, "0")}`;
    const entryDate = isYmd(input.entryDate ?? "") ? input.entryDate! : fallbackDate;
    if (yearOf(entryDate) !== year)
      return { ok: false, message: "기입일이 선택한 연도와 다릅니다." };

    const { count } = await supabaseAdmin
      .from(MEM)
      .select("id", { count: "exact", head: true })
      .eq("status", "active");

    const { error } = await supabaseAdmin.from(LEDGER).insert({
      entry_date: entryDate,
      kind: "income",
      category: "fee",
      description:
        clean(input.description) ?? monthlyFeeDescription(month, count ?? 0),
      amount,
      created_by: ctx.name,
    });
    if (error) throw new Error(error.message);

    revalidatePath("/hr/mutual/ledger");
    return { ok: true, amount };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "기입 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 세입·세출 행 추가 / 수정 / 삭제
// =====================================================================
export type LedgerInput = {
  entryDate: string;
  kind: MutualKind;
  category: string;
  description: string;
  amount: number;
  employeeId: string | null;
};

function validate(input: LedgerInput): string | null {
  if (!isYmd(input.entryDate)) return "날짜를 확인하세요.";
  const cat = mutualCategory(input.category);
  if (!cat) return "사유(카테고리)를 선택하세요.";
  if (cat.kind !== normalizeKind(input.kind))
    return "사유와 세입/세출 구분이 맞지 않습니다.";
  if (!clean(input.description)) return "적요를 입력하세요.";
  if (toAmount(input.amount) <= 0) return "금액을 0보다 크게 입력하세요.";
  return null;
}

export async function addLedgerEntry(
  input: LedgerInput
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const ctx = await requireMutualAccess();
    const err = validate(input);
    if (err) return { ok: false, message: err };

    const { data, error } = await supabaseAdmin
      .from(LEDGER)
      .insert({
        entry_date: input.entryDate,
        kind: normalizeKind(input.kind),
        category: input.category,
        description: clean(input.description),
        amount: toAmount(input.amount),
        employee_id: clean(input.employeeId),
        created_by: ctx.name,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    revalidatePath("/hr/mutual/ledger");
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "추가 중 오류가 발생했습니다.",
    };
  }
}

export async function updateLedgerEntry(
  id: string,
  input: LedgerInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const ctx = await requireMutualAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const err = validate(input);
    if (err) return { ok: false, message: err };

    const { data, error } = await supabaseAdmin
      .from(LEDGER)
      .update({
        entry_date: input.entryDate,
        kind: normalizeKind(input.kind),
        category: input.category,
        description: clean(input.description),
        amount: toAmount(input.amount),
        employee_id: clean(input.employeeId),
        // 마지막으로 손댄 사람을 남긴다(장부 추적).
        created_by: ctx.name,
      })
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if ((data ?? []).length === 0)
      return { ok: false, message: "행을 찾을 수 없습니다." };

    revalidatePath("/hr/mutual/ledger");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "수정 중 오류가 발생했습니다.",
    };
  }
}

export async function deleteLedgerEntry(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireMutualAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const { data, error } = await supabaseAdmin
      .from(LEDGER)
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if ((data ?? []).length === 0)
      return { ok: false, message: "행을 찾을 수 없습니다." };
    revalidatePath("/hr/mutual/ledger");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.",
    };
  }
}
