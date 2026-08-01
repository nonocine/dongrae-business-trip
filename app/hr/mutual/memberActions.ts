"use server";

// =====================================================================
// 상조회 회원 관리 — MU-1
//   * 접근: M0 또는 mutual 직무. 모든 액션이 진입 시 재검증(RLS 정책 0개).
//   * 생일·입사일은 mutual_members 에 중복 저장하지 않는다 — 인사기록
//     (employee_profiles)을 조회해 합쳐서 보여준다(단일 진실).
//   * employee_id = drivers.id (급여·연차 모듈과 같은 직원 식별자).
// =====================================================================

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireMutualAccess } from "@/lib/mutualAccess";
import {
  normalizeMemberStatus,
  type MutualMemberStatus,
} from "@/lib/mutual";
import { kstTodayYmd } from "@/lib/trainings";

const MEM = "mutual_members";
const LEDGER = "mutual_ledger";
const DRV = "drivers";
const PROF = "employee_profiles";

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length ? s : null;
}

// 재직자 + 인사기록(생일·입사일·재직상태).
type RosterEntry = {
  driver_id: string;
  name: string;
  rank: string | null;
  birthDate: string | null;
  joinDate: string | null;
  resigned: boolean;
};

async function loadRoster(): Promise<RosterEntry[]> {
  const [{ data: drivers, error: dErr }, { data: profs, error: pErr }] =
    await Promise.all([
      supabaseAdmin.from(DRV).select("id, name, rank, is_active"),
      supabaseAdmin
        .from(PROF)
        .select("driver_id, birth_date, join_date, employment_status"),
    ]);
  if (dErr) throw new Error(dErr.message);
  if (pErr) throw new Error(pErr.message);

  const profByDriver = new Map<string, Record<string, unknown>>();
  for (const p of profs ?? []) {
    const r = p as Record<string, unknown>;
    profByDriver.set(String(r.driver_id ?? ""), r);
  }

  const out: RosterEntry[] = [];
  for (const d of drivers ?? []) {
    const r = d as Record<string, unknown>;
    const id = String(r.id ?? "");
    if (!id) continue;
    const prof = profByDriver.get(id);
    const resigned =
      r.is_active === false ||
      String(prof?.employment_status ?? "active") === "resigned";
    out.push({
      driver_id: id,
      name: String(r.name ?? ""),
      rank: clean(r.rank as string | null),
      birthDate: (prof?.birth_date as string | null) ?? null,
      joinDate: (prof?.join_date as string | null) ?? null,
      resigned,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

// =====================================================================
// 조회
// =====================================================================
export type MutualMemberRow = {
  id: string | null; // null = 아직 상조회 회원이 아님(재직자 후보)
  employee_id: string;
  name: string;
  rank: string | null;
  birthDate: string | null;
  joinDate: string | null;
  resigned: boolean; // 퇴직한 직원(회원 기록만 남은 경우)
  status: MutualMemberStatus | null;
  joined_on: string | null;
  left_on: string | null;
  memo: string | null;
  ledgerCount: number; // 이 회원이 대상인 장부 행 수(삭제 가능 판정)
};

export type MutualMemberOverview = {
  rows: MutualMemberRow[];
  activeCount: number;
  pausedCount: number;
  leftCount: number;
  notJoinedCount: number;
  today: string;
  isM0: boolean;
};

export async function getMemberOverview(): Promise<MutualMemberOverview> {
  const ctx = await requireMutualAccess();
  const [roster, { data: mems, error }] = await Promise.all([
    loadRoster(),
    supabaseAdmin.from(MEM).select("*"),
  ]);
  if (error) throw new Error(error.message);

  const memByEmp = new Map<string, Record<string, unknown>>();
  for (const m of mems ?? []) {
    const r = m as Record<string, unknown>;
    memByEmp.set(String(r.employee_id ?? ""), r);
  }

  // 회원이 대상인 장부 행 수 — 완전 삭제 가능 여부 판정용.
  const ledgerCount = new Map<string, number>();
  const { data: led } = await supabaseAdmin
    .from(LEDGER)
    .select("employee_id")
    .not("employee_id", "is", null);
  for (const l of led ?? []) {
    const id = String((l as { employee_id: string }).employee_id);
    ledgerCount.set(id, (ledgerCount.get(id) ?? 0) + 1);
  }

  const rosterById = new Map(roster.map((r) => [r.driver_id, r]));
  const rows: MutualMemberRow[] = roster.map((r) => {
    const m = memByEmp.get(r.driver_id);
    return {
      id: m ? String(m.id) : null,
      employee_id: r.driver_id,
      name: r.name,
      rank: r.rank,
      birthDate: r.birthDate,
      joinDate: r.joinDate,
      resigned: r.resigned,
      status: m ? normalizeMemberStatus(m.status) : null,
      joined_on: (m?.joined_on as string | null) ?? null,
      left_on: (m?.left_on as string | null) ?? null,
      memo: (m?.memo as string | null) ?? null,
      ledgerCount: ledgerCount.get(r.driver_id) ?? 0,
    };
  });

  // drivers 에 없는(삭제된) 회원 기록도 빠뜨리지 않는다.
  for (const [empId, m] of memByEmp) {
    if (rosterById.has(empId)) continue;
    rows.push({
      id: String(m.id),
      employee_id: empId,
      name: "(삭제된 직원)",
      rank: null,
      birthDate: null,
      joinDate: null,
      resigned: true,
      status: normalizeMemberStatus(m.status),
      joined_on: (m.joined_on as string | null) ?? null,
      left_on: (m.left_on as string | null) ?? null,
      memo: (m.memo as string | null) ?? null,
      ledgerCount: ledgerCount.get(empId) ?? 0,
    });
  }

  return {
    rows,
    activeCount: rows.filter((r) => r.status === "active").length,
    pausedCount: rows.filter((r) => r.status === "paused").length,
    leftCount: rows.filter((r) => r.status === "left").length,
    notJoinedCount: rows.filter((r) => r.status == null && !r.resigned).length,
    today: kstTodayYmd(),
    isM0: ctx.isM0,
  };
}

// 그 달에 회비를 낼 active 회원 수 — 장부의 [월 회비 기입]이 쓴다.
export async function countActiveMembers(): Promise<number> {
  await requireMutualAccess();
  const { count, error } = await supabaseAdmin
    .from(MEM)
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// =====================================================================
// 가입(일괄) — 이미 회원인 사람은 건너뛴다. 탈퇴자를 다시 고르면 활동으로 복귀.
// =====================================================================
export async function joinMembers(input: {
  employeeIds: string[];
  joinedOn?: string | null;
}): Promise<
  | { ok: true; added: number; reactivated: number; skipped: number }
  | { ok: false; message: string }
> {
  try {
    await requireMutualAccess();
    const ids = [...new Set((input.employeeIds ?? []).filter(Boolean))];
    if (!ids.length) return { ok: false, message: "가입할 직원을 선택하세요." };

    // 재직자인지 서버에서 재확인(화면 값만 믿지 않음).
    const roster = await loadRoster();
    const allowed = new Set(roster.filter((r) => !r.resigned).map((r) => r.driver_id));
    if (ids.some((id) => !allowed.has(id)))
      return { ok: false, message: "재직자가 아닌 대상이 포함되어 있습니다." };

    const joinedOn = clean(input.joinedOn) ?? kstTodayYmd();
    const { data: existing, error: exErr } = await supabaseAdmin
      .from(MEM)
      .select("id, employee_id, status")
      .in("employee_id", ids);
    if (exErr) throw new Error(exErr.message);
    const prevByEmp = new Map(
      ((existing ?? []) as Record<string, unknown>[]).map((r) => [
        String(r.employee_id),
        { id: String(r.id), status: normalizeMemberStatus(r.status) },
      ])
    );

    let added = 0;
    let reactivated = 0;
    let skipped = 0;
    const toInsert: Record<string, unknown>[] = [];

    for (const id of ids) {
      const prev = prevByEmp.get(id);
      if (!prev) {
        toInsert.push({ employee_id: id, status: "active", joined_on: joinedOn });
        continue;
      }
      if (prev.status === "active") {
        skipped++;
        continue;
      }
      // 일시정지·탈퇴 → 활동 복귀(탈퇴일 비움).
      const { error } = await supabaseAdmin
        .from(MEM)
        .update({ status: "active", left_on: null })
        .eq("id", prev.id);
      if (error) throw new Error(error.message);
      reactivated++;
    }

    if (toInsert.length) {
      const { error } = await supabaseAdmin.from(MEM).insert(toInsert);
      if (error) throw new Error(error.message);
      added = toInsert.length;
    }

    revalidatePath("/hr/mutual/members");
    revalidatePath("/hr/mutual/ledger");
    return { ok: true, added, reactivated, skipped };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "가입 처리 중 오류가 발생했습니다.",
    };
  }
}

// 상태 변경 — 활동/일시정지/탈퇴. 탈퇴 시 left_on 을 채우고, 복귀 시 비운다.
export async function setMemberStatus(input: {
  memberId: string;
  status: MutualMemberStatus;
  leftOn?: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireMutualAccess();
    const status = normalizeMemberStatus(input.status);
    if (!input.memberId) return { ok: false, message: "대상이 없습니다." };

    const payload: Record<string, unknown> = { status };
    payload.left_on =
      status === "left" ? clean(input.leftOn) ?? kstTodayYmd() : null;

    const { data, error } = await supabaseAdmin
      .from(MEM)
      .update(payload)
      .eq("id", input.memberId)
      .select("id");
    if (error) throw new Error(error.message);
    if ((data ?? []).length === 0)
      return { ok: false, message: "회원을 찾을 수 없습니다." };

    revalidatePath("/hr/mutual/members");
    revalidatePath("/hr/mutual/ledger");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "상태 변경 중 오류가 발생했습니다.",
    };
  }
}

// 메모 저장(가입 경위·미납 사유 등).
export async function setMemberMemo(input: {
  memberId: string;
  memo: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireMutualAccess();
    if (!input.memberId) return { ok: false, message: "대상이 없습니다." };
    const { error } = await supabaseAdmin
      .from(MEM)
      .update({ memo: clean(input.memo) })
      .eq("id", input.memberId);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/mutual/members");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "메모 저장 중 오류가 발생했습니다.",
    };
  }
}

// 회원 기록 완전 삭제 — 장부에 이 회원이 대상인 행이 있으면 막는다(탈퇴로 유도).
export async function deleteMember(
  memberId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireMutualAccess();
    if (!memberId) return { ok: false, message: "대상이 없습니다." };
    const { data: row } = await supabaseAdmin
      .from(MEM)
      .select("id, employee_id")
      .eq("id", memberId)
      .maybeSingle();
    if (!row) return { ok: false, message: "회원을 찾을 수 없습니다." };

    const { count } = await supabaseAdmin
      .from(LEDGER)
      .select("id", { count: "exact", head: true })
      .eq("employee_id", String((row as { employee_id: string }).employee_id));
    if ((count ?? 0) > 0)
      return {
        ok: false,
        message: `장부에 이 회원 관련 행이 ${count}건 있어 삭제할 수 없습니다. '탈퇴'로 처리하세요.`,
      };

    const { error } = await supabaseAdmin.from(MEM).delete().eq("id", memberId);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/mutual/members");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.",
    };
  }
}
