import "server-only";

// =====================================================================
// 연차 사용촉진 — 서버 조회(직원별 상태판·알림). 쓰기는 app/(app)/hr/leave-plans/promotionActions.ts.
//   * 대상: 재직 직원(drivers.is_active, employee_profiles.employment_status ≠ resigned).
//   * 미사용 일수 = ERP 연차 잔여(erp_leave_balances), 실제 사용 = ERP 연가(erp_duties 진행·완료).
//   * 기존 leave_plan_requests(사용계획서, employee_id = drivers.id)는 읽기만 해서 연결합니다.
//   * leave_promotion_notices.employee_id 는 employee_profiles.id 입니다(계획서와 다름 — 주의).
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { currentAssignment } from "@/lib/appointments";
import { normalizeLeavePlan, type LeavePlanEntry } from "@/lib/leavePlan";
import { listRolesForDriver } from "@/lib/employeeRolesServer";
import { resolvePersonnelViewer } from "@/lib/personnelAccess";
import { annualLeaveDatesByEmployee, erpLastSyncedAt, leaveBalancesOf, resolveErpViewer, type ErpViewer } from "@/lib/erp/view";
import { kstTodayYmd } from "@/lib/erp/duty";
import {
  REPLY_DAYS,
  addDays,
  daysBetween,
  noticeCompleted,
  scheduleFor,
  stepState,
  tracksFor,
  type DeliveryMethod,
  type PromotionSchedule,
  type PromotionStage,
  type PromotionTrack,
  type StepState,
} from "@/lib/leavePromotion";

export const PROMO_TABLE = "leave_promotion_notices";

// --- 접근: 관장(M0)·hr 직무·인사 파일 열람 보유자 ------------------------------------
export type PromotionAccess = ErpViewer & { isPersonnel: boolean };
export async function resolveLeavePromotionAccess(): Promise<PromotionAccess | null> {
  const v = await resolveErpViewer();
  if (!v) return null;
  const [roles, pv] = await Promise.all([
    v.driverId ? listRolesForDriver(v.driverId) : Promise.resolve([] as string[]),
    resolvePersonnelViewer().catch(() => null),
  ]);
  const isPersonnel = !!pv?.isPersonnel;
  if (!v.isM0 && !roles.includes("hr") && !isPersonnel) return null;
  return { ...v, isPersonnel };
}
export async function requireLeavePromotionAccess(): Promise<PromotionAccess> {
  const a = await resolveLeavePromotionAccess();
  if (!a) throw new Error("연차 사용촉진 권한이 없습니다. (관장·부장·인사 담당)");
  return a;
}

// --- 상태판 ---------------------------------------------------------------
export type NoticeInfo = {
  id: string;
  stage: PromotionStage;
  createdAt: string;
  sentAt: string | null;
  sentBy: string | null;
  method: DeliveryMethod | null;
  completed: boolean;
  unusedDays: number;
  unusedSource: string;
  designatedDates: string[];
  hasPdf: boolean;
  hasReceipt: boolean;
  erpDocumentNumber: number | null;
  acknowledgedAt: string | null;
  memo: string | null;
};

export type PromotionRow = {
  key: string;
  profileId: string;
  driverId: string;
  name: string;
  department: string | null;
  joinDate: string | null;
  track: PromotionTrack;
  schedule: PromotionSchedule;
  erpLinked: boolean;
  unusedErp: number | null;
  needed: boolean; // 미사용 연차가 있어 촉진 대상
  stage1: NoticeInfo | null;
  stage1State: StepState | "na";
  plan: { id: string; submittedAt: string | null; totalDays: number | null; entries: LeavePlanEntry[] } | null;
  planDue: string | null;
  planState: StepState | "na";
  missedDates: string[]; // 계획했는데(지난 날) ERP 연가가 없는 날
  stage2: NoticeInfo | null;
  stage2State: StepState | "na";
  forfeitDays: number | null; // 연말(사용기한) 소멸 예정 = 현재 ERP 잔여
};

export type PromotionBoard = {
  year: number;
  today: string;
  rows: PromotionRow[];
  syncedLeave: string | null;
  syncedDuties: string | null;
};

function toNotice(r: Record<string, unknown>): NoticeInfo {
  const dates = Array.isArray(r.designated_dates) ? (r.designated_dates as unknown[]).map(String) : [];
  return {
    id: String(r.id),
    stage: Number(r.stage) === 2 ? 2 : 1,
    createdAt: String(r.created_at ?? ""),
    sentAt: (r.sent_at as string | null) ?? null,
    sentBy: (r.sent_by as string | null) ?? null,
    method: (["paper", "erp", "app", "email"].includes(String(r.delivery_method)) ? r.delivery_method : null) as DeliveryMethod | null,
    completed: noticeCompleted({
      delivery_method: (r.delivery_method as string | null) ?? null,
      signed_receipt_path: (r.signed_receipt_path as string | null) ?? null,
      erp_document_id: (r.erp_document_id as number | null) ?? null,
    }),
    unusedDays: Number(r.unused_days ?? 0),
    unusedSource: String(r.unused_source ?? "erp"),
    designatedDates: dates,
    hasPdf: !!r.pdf_path,
    hasReceipt: !!r.signed_receipt_path,
    erpDocumentNumber: r.erp_document_number == null ? null : Number(r.erp_document_number),
    acknowledgedAt: (r.acknowledged_at as string | null) ?? null,
    memo: (r.memo as string | null) ?? null,
  };
}

const kstDateOf = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10) : null);

export async function loadPromotionBoard(year: number): Promise<PromotionBoard> {
  const today = kstTodayYmd();
  const [{ data: drivers }, { data: profs }, { data: notices }, { data: plans }, syncedLeave, syncedDuties, leaveDates] =
    await Promise.all([
      supabaseAdmin.from("drivers").select("id, name, is_active"),
      supabaseAdmin
        .from("employee_profiles")
        .select("id, driver_id, employment_status, join_date, appointments, erp_employee_id"),
      supabaseAdmin.from(PROMO_TABLE).select("*").eq("year", year),
      supabaseAdmin.from("leave_plan_requests").select("id, employee_id, submitted_at, total_days, plan").eq("year", year),
      erpLastSyncedAt("leaveBalances"),
      erpLastSyncedAt("duties"),
      annualLeaveDatesByEmployee(year),
    ]);
  const drvMap = new Map(((drivers ?? []) as { id: string; name: string; is_active: boolean | null }[]).map((d) => [d.id, d]));
  const profRows = ((profs ?? []) as Record<string, unknown>[]).filter((p) => {
    const d = drvMap.get(String(p.driver_id));
    return d && d.is_active !== false && p.employment_status !== "resigned";
  });
  const erpIds = profRows.map((p) => p.erp_employee_id).filter((v): v is string => typeof v === "string" && !!v);
  const bal = await leaveBalancesOf(erpIds);
  const noticeBy = new Map<string, NoticeInfo>();
  for (const n of (notices ?? []) as Record<string, unknown>[])
    noticeBy.set(`${n.employee_id}:${n.track}:${n.stage}`, toNotice(n));
  const planBy = new Map(
    ((plans ?? []) as Record<string, unknown>[]).map((p) => [
      String(p.employee_id),
      {
        id: String(p.id),
        submittedAt: (p.submitted_at as string | null) ?? null,
        totalDays: p.total_days == null ? null : Number(p.total_days),
        entries: normalizeLeavePlan(p.plan),
      },
    ])
  );

  const rows: PromotionRow[] = [];
  for (const p of profRows) {
    const profileId = String(p.id);
    const driverId = String(p.driver_id);
    const joinDate = typeof p.join_date === "string" && p.join_date ? p.join_date.slice(0, 10) : null;
    const erpId = typeof p.erp_employee_id === "string" ? p.erp_employee_id : null;
    const unusedErp = erpId ? bal.get(erpId)?.annual ?? null : null;
    const tracks = tracksFor(year, joinDate);
    tracks.forEach((track, ti) => {
      const schedule = scheduleFor(track, year, joinDate);
      const s1 = noticeBy.get(`${profileId}:${track}:1`) ?? null;
      const s2 = noticeBy.get(`${profileId}:${track}:2`) ?? null;
      // 계획서는 연도·직원 단위(기존 표) — 첫 track 에 붙입니다.
      const plan = ti === 0 ? planBy.get(driverId) ?? null : null;
      const needed = unusedErp == null ? true : unusedErp > 0;
      const stage1State = !needed && !s1 ? "na" : stepState({ done: !!s1?.completed, due: schedule.stage1.end, start: schedule.stage1.start, today });
      const sentDate = kstDateOf(s1?.sentAt ?? null);
      const planDue = sentDate ? addDays(sentDate, REPLY_DAYS) : null;
      const planState: StepState | "na" = !needed && !plan
        ? "na"
        : !sentDate && !plan?.submittedAt
          ? "waiting"
          : stepState({ done: !!plan?.submittedAt, due: planDue, today });
      // 계획 대비 실제 — 이미 지난 계획일 중 ERP 연가가 없는 날.
      const used = erpId ? leaveDates.get(erpId) : undefined;
      const missedDates = (plan?.entries ?? [])
        .map((e) => e.date)
        .filter((d) => d < today && !(used?.has(d) ?? false));
      // 2차 — 계획서를 냈고 지정 통보서가 없으면 '해당 없음'(사용 시기를 직원이 정함).
      const stage2State: StepState | "na" =
        (!needed && !s2) || (plan?.submittedAt && !s2)
          ? "na"
          : stepState({ done: !!s2?.completed, due: schedule.stage2Due, start: planDue ?? schedule.stage1.end, today });
      rows.push({
        key: `${profileId}:${track}`,
        profileId,
        driverId,
        name: drvMap.get(driverId)?.name ?? "(이름 없음)",
        department: currentAssignment(p.appointments, today).current?.department ?? null,
        joinDate,
        track,
        schedule,
        erpLinked: !!erpId,
        unusedErp,
        needed,
        stage1: s1,
        stage1State,
        plan,
        planDue,
        planState,
        missedDates,
        stage2: s2,
        stage2State,
        forfeitDays: unusedErp,
      });
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "ko") || a.track.localeCompare(b.track));
  return { year, today, rows, syncedLeave, syncedDuties };
}

// --- 관리자 대시보드 알림(D-14·D-3·경과) ---------------------------------------------
export type PromotionAlert = { name: string; step: string; due: string; left: number };
export async function promotionAlerts(year: number): Promise<{
  soon14: PromotionAlert[];
  soon3: PromotionAlert[];
  overdue: PromotionAlert[];
}> {
  const board = await loadPromotionBoard(year);
  const out = { soon14: [] as PromotionAlert[], soon3: [] as PromotionAlert[], overdue: [] as PromotionAlert[] };
  for (const r of board.rows) {
    const steps: { label: string; state: StepState | "na"; due: string | null }[] = [
      { label: "1차 촉구", state: r.stage1State, due: r.schedule.stage1.end },
      { label: "사용계획 회신", state: r.planState, due: r.planDue },
      { label: "2차 지정 통보", state: r.stage2State, due: r.schedule.stage2Due },
    ];
    for (const s of steps) {
      if (!s.due || s.state === "na" || s.state === "done" || s.state === "waiting") continue;
      const left = daysBetween(board.today, s.due);
      const a = { name: r.name, step: s.label, due: s.due, left };
      if (left < 0) out.overdue.push(a);
      else if (left <= 3) out.soon3.push(a);
      else if (left <= 14) out.soon14.push(a);
    }
  }
  const byDue = (x: PromotionAlert, y: PromotionAlert) => x.due.localeCompare(y.due);
  out.soon14.sort(byDue);
  out.soon3.sort(byDue);
  out.overdue.sort(byDue);
  return out;
}
