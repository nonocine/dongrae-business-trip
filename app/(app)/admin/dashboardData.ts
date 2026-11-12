import "server-only";

// =====================================================================
// 관리자 대시보드(/admin) 숫자 — 읽기 전용. 페이지가 이미 관장·master(isManagerAdmin)만 통과시킵니다.
//   * 항목마다 따로 실패해도 대시보드는 그립니다(null = "못 셌다", 0 과 구분).
//   * 데이터·테이블은 건드리지 않습니다(조회만).
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { absentTodayList, leaveBalancesOf } from "@/lib/erp/view";
import { loadErpDirectory } from "@/lib/erp/identity";
import { countPendingSealRequests, resolveSealRegisterAccess } from "@/lib/sealRegisterServer";
import { getPendingCertRequestCount } from "@/app/(app)/hr/certificates/actions";

export type AdminDashboardData = {
  absent: { name: string; type: string }[] | null;
  approvals: { cert: number | null; seal: number | null; instructorSeal: number | null };
  instructorContracts: { waitingInstructor: number; waitingSeal: number } | null;
  leave5: { count: number; total: number } | null;
  system: {
    erp: { lastAt: string | null; failed24h: number } | null;
    backup: { status: string; startedAt: string; error: string | null } | null;
    smsFailed7d: number | null;
    sensitive7d: number | null;
  };
};

const DAY = 24 * 3600 * 1000;

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

async function instructorContractCounts() {
  const { data, error } = await supabaseAdmin
    .from("instructor_contracts")
    .select("status")
    .in("status", ["sent", "instructor_signed"]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { status: string }[];
  return {
    waitingInstructor: rows.filter((r) => r.status === "sent").length,
    waitingSeal: rows.filter((r) => r.status === "instructor_signed").length,
  };
}

// 연차 잔여 5일 이상 — 재직자(ERP 디렉터리) 중 현재 계정 잔여 기준.
async function leaveOver5() {
  const dir = await loadErpDirectory();
  const bal = await leaveBalancesOf(dir.people.map((p) => p.key));
  let count = 0;
  let total = 0;
  for (const p of dir.people) {
    const a = bal.get(p.key)?.annual;
    if (a == null) continue;
    total++;
    if (a >= 5) count++;
  }
  return { count, total };
}

async function erpStatus() {
  const since = new Date(Date.now() - DAY).toISOString();
  const [last, failed] = await Promise.all([
    supabaseAdmin.from("erp_sync_runs").select("started_at").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("erp_sync_runs").select("id", { count: "exact", head: true }).eq("ok", false).gte("started_at", since),
  ]);
  if (last.error) throw new Error(last.error.message);
  return {
    lastAt: (last.data as { started_at?: string } | null)?.started_at ?? null,
    failed24h: failed.count ?? 0,
  };
}

async function lastBackup() {
  const { data, error } = await supabaseAdmin
    .from("backup_logs")
    .select("status, started_at, error_message")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as { status: string; started_at: string; error_message: string | null };
  return { status: r.status, startedAt: r.started_at, error: r.error_message };
}

// 최근 7일 문자 실패 건수 — 실패 건수 칸 합계. 통째로 실패(ok=false)했는데 칸이 비면 수신자 수로 셉니다.
async function smsFailed7d() {
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const { data, error } = await supabaseAdmin
    .from("sms_send_logs")
    .select("ok, failed_count, recipient_count")
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  let n = 0;
  for (const r of (data ?? []) as { ok: boolean | null; failed_count: number | null; recipient_count: number | null }[]) {
    if (r.failed_count != null) n += Number(r.failed_count) || 0;
    else if (r.ok === false) n += Number(r.recipient_count) || 1;
  }
  return n;
}

async function sensitive7d() {
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const { count, error } = await supabaseAdmin
    .from("sensitive_access_logs")
    .select("id", { count: "exact", head: true })
    .gte("accessed_at", since);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function loadAdminDashboardData(): Promise<AdminDashboardData> {
  const [absent, cert, seal, ic, leave5, erp, backup, sms, sens] = await Promise.all([
    safe(absentTodayList()),
    safe(getPendingCertRequestCount()),
    safe(resolveSealRegisterAccess().then(countPendingSealRequests)),
    safe(instructorContractCounts()),
    safe(leaveOver5()),
    safe(erpStatus()),
    safe(lastBackup()),
    safe(smsFailed7d()),
    safe(sensitive7d()),
  ]);
  return {
    absent,
    approvals: { cert, seal, instructorSeal: ic?.waitingSeal ?? null },
    instructorContracts: ic,
    leave5,
    system: { erp, backup, smsFailed7d: sms, sensitive7d: sens },
  };
}
