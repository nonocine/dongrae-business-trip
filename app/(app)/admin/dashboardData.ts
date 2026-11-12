import "server-only";

// =====================================================================
// 관리자 대시보드(/admin) 숫자 — 읽기 전용. 페이지가 이미 관장·master(isManagerAdmin)만 통과시킵니다.
//   * 항목마다 따로 실패해도 대시보드는 그립니다(null = "못 셌다", 0 과 구분).
//   * 데이터·테이블은 건드리지 않습니다(조회만).
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { absentTodayList, leaveBalancesOf } from "@/lib/erp/view";
import { loadErpDirectory } from "@/lib/erp/identity";

export type AdminDashboardData = {
  absent: { name: string; type: string }[] | null;
  instructorContracts: { waitingInstructor: number; waitingSeal: number } | null;
  leave5: { count: number; total: number } | null;
  system: {
    erp: { lastAt: string | null; failed24h: number } | null;
    backup: { status: string; startedAt: string; error: string | null } | null;
    // 최근 7일 문자 — failedSends: 통째로 실패(ok=false)한 발송 횟수(빨간 점),
    //   partial: ok=true 인데 일부 번호 실패(failed_count>0) — 실패 번호 수·해당 발송 횟수(노란 점).
    sms7d: { failedSends: number; partialNumbers: number; partialSends: number } | null;
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

// 최근 7일 문자 실패 — 통째 실패(ok=false) 발송 횟수와, 성공 발송 중 일부 번호 실패를 나눠 셉니다.
async function sms7d() {
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const { data, error } = await supabaseAdmin
    .from("sms_send_logs")
    .select("ok, failed_count, recipient_count")
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  const out = { failedSends: 0, partialNumbers: 0, partialSends: 0 };
  for (const r of (data ?? []) as { ok: boolean | null; failed_count: number | null }[]) {
    if (r.ok === false) {
      out.failedSends++;
      continue;
    }
    const f = Number(r.failed_count) || 0;
    if (f > 0) {
      out.partialNumbers += f;
      out.partialSends++;
    }
  }
  return out;
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
  // 결재 대기(증명서·직인·강사 계약 날인 등)는 여기서 세지 않습니다 — 페이지가
  //   lib/pendingTasks(메인 '확인할 일'·헤더 배지와 같은 함수)로 받아 그립니다.
  const [absent, ic, leave5, erp, backup, sms, sens] = await Promise.all([
    safe(absentTodayList()),
    safe(instructorContractCounts()),
    safe(leaveOver5()),
    safe(erpStatus()),
    safe(lastBackup()),
    safe(sms7d()),
    safe(sensitive7d()),
  ]);
  return {
    absent,
    instructorContracts: ic,
    leave5,
    system: { erp, backup, sms7d: sms, sensitive7d: sens },
  };
}
