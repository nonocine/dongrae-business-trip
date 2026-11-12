import "server-only";

// =====================================================================
// "확인할 일" — 관장·부장·인사 담당이 처리해야 할 일 목록(읽기 전용, DB 변경 없음).
//
//   대상자: M0(관장·부장·master·권한등급 M0) 또는 hr 직무 보유자.
//   항목마다 '그 일을 실제로 처리할 수 있는 사람' 에게만 — 처리 액션의 가드와 같은 기준.
//     · 인사발령 정정 요청(appointments status='pending') — 인사 파일 열람(personnel) 보유자
//       (확정·반려 액션 requirePersonnel 과 같음). 직원별 한 줄.
//     · 증명서 발급 승인 대기 — M0(approveRequest 가드).
//     · 직인 결재 대기 — 직급 관장·부장, 본인 신청 제외(approveSealRequest 가드).
//     · 강사 계약서 관장 날인 대기(instructor_signed) — 관장만(직급 관장 또는 관리자 대시보드와
//       같은 관장 판정 isManagerAdmin). 2026-11 관장 지시로 M0 전체에서 좁혔습니다.
//     · 근로·연봉계약서 센터장 서명 대기(직원 서명 완료 + 센터장 서명 전) — 관장만(관장 지시).
//       서명 액션 가드는 M0 이지만 알림은 관장에게만 보냅니다.
//     · 강사 강의확인증 신청 대기(pending) — 강사관리 권한(M0 또는 saem 직무, requireSaemAccess).
//     · 연차 사용촉진 기한 경과·D-3 이내 — 대상자 전원(가드: M0·hr·인사 파일 열람).
//       계산은 관리자 대시보드와 같은 promotionAlerts 를 그대로 씁니다.
//
//   쓰는 곳: 메인 화면 '확인할 일' 카드, 헤더 배지, 관리자 대시보드 '결재 대기',
//            매일 아침 슬랙 DM(/api/cron/pending-digest).
//   세션 없이도(크론) 돌도록 '사람(TaskPerson)' 을 인자로 받습니다.
// =====================================================================

import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";
import { isPersonnelHolder } from "@/lib/personnel";
import { listRolesForDriver } from "@/lib/employeeRolesServer";
import { SEAL_APPROVER_RANKS } from "@/lib/sealRegisterServer";
import { promotionAlerts } from "@/lib/leavePromotionServer";
import { kstTodayYmd } from "@/lib/erp/duty";
import { contractsPath } from "@/lib/contractCore";

export type PendingTaskKind =
  | "appointment"
  | "certificate"
  | "seal"
  | "instructorSeal"
  | "employmentContractSign"
  | "salaryContractSign"
  | "lectureCertificate"
  | "leavePromotionOverdue"
  | "leavePromotionSoon";

export type PendingTask = {
  kind: PendingTaskKind;
  label: string; // 종류(화면 표시)
  count: number;
  names: string[]; // 대상 이름들
  href: string; // 바로가기(앱 안 상대 주소)
};

export type TaskPerson = {
  driverId: string | null;
  name: string;
  rank: string | null;
  isM0: boolean;
  // 관장 — 직급 관장 또는 isManagerAdmin(구글 관장·master). 관장 전용 항목 기준.
  isDirector: boolean;
  roles: string[];
  isPersonnel: boolean;
};

export const PENDING_TASK_LABEL: Record<PendingTaskKind, string> = {
  appointment: "인사발령 정정 요청",
  certificate: "증명서 발급 승인 대기",
  seal: "직인 결재 대기",
  instructorSeal: "강사 계약서 관장 날인 대기",
  employmentContractSign: "근로계약서 센터장 서명 대기",
  salaryContractSign: "연봉계약서 센터장 서명 대기",
  lectureCertificate: "강사 강의확인증 신청 대기",
  leavePromotionOverdue: "연차 사용촉진 기한 경과",
  leavePromotionSoon: "연차 사용촉진 기한 D-3 이내",
};

// 대상자 판정 — M0 또는 hr 직무.
export function isPendingTaskTarget(p: Pick<TaskPerson, "isM0" | "roles">): boolean {
  return p.isM0 || p.roles.includes("hr");
}

type Raw = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

// --- 사람 무관 원자료(한 요청·한 크론 실행에 한 번) ------------------------------
export type PendingTaskSource = {
  appointments: { driverId: string; name: string; count: number }[];
  certificates: string[];
  seals: { requesterDriverId: string | null; label: string }[];
  instructorSeals: { id: string; name: string; contractNo: string }[];
  // 센터장 서명 대기 계약서 — 직원 이름·주소용 키.
  employmentSign: { driverId: string; name: string }[];
  salarySign: { driverId: string; name: string; year: number | null }[];
  lectureCerts: string[];
  promo: { overdue: string[]; soon3: string[] } | null;
};

async function loadAppointmentsPending(): Promise<PendingTaskSource["appointments"]> {
  const { data, error } = await supabaseAdmin.from("employee_profiles").select("driver_id, appointments");
  if (error) throw new Error(error.message);
  const rows: { driverId: string; count: number }[] = [];
  for (const r of (data ?? []) as Raw[]) {
    const list = Array.isArray(r.appointments) ? (r.appointments as Raw[]) : [];
    const n = list.filter((a) => s(a?.status) === "pending").length;
    if (n > 0 && r.driver_id) rows.push({ driverId: s(r.driver_id), count: n });
  }
  if (!rows.length) return [];
  const { data: drv } = await supabaseAdmin.from("drivers").select("id, name").in("id", rows.map((r) => r.driverId));
  const nameOf = new Map(((drv ?? []) as Raw[]).map((d) => [s(d.id), s(d.name)]));
  return rows
    .map((r) => ({ ...r, name: nameOf.get(r.driverId) || "(이름 없음)" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

// 직원 서명은 끝났고 센터장 서명이 비어 있는 계약서(근로·연봉).
async function loadEmployerSignPending(table: "employment_contracts" | "salary_contracts") {
  const cols = table === "salary_contracts" ? "driver_id, year" : "driver_id";
  const { data, error } = await supabaseAdmin
    .from(table)
    .select(cols)
    .eq("status", "signed")
    .is("employer_signed_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as { driver_id: string | null; year?: number | null }[];
}

async function driverNames(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const { data } = await supabaseAdmin.from("drivers").select("id, name").in("id", uniq);
  return new Map(((data ?? []) as Raw[]).map((d) => [s(d.id), s(d.name)]));
}

async function loadLectureCertsPending(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("saem_lecture_certificates")
    .select("instructor_id, applicant_name")
    .eq("status", "pending")
    .order("created_at");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Raw[];
  const ids = [...new Set(rows.map((r) => s(r.instructor_id)).filter(Boolean))];
  const { data: ins } = ids.length
    ? await supabaseAdmin.from("saem_instructors").select("id, name").in("id", ids)
    : { data: [] as Raw[] };
  const nameOf = new Map(((ins ?? []) as Raw[]).map((r) => [s(r.id), s(r.name)]));
  return rows.map((r) => nameOf.get(s(r.instructor_id)) || s(r.applicant_name) || "(이름 없음)");
}

export async function loadPendingTaskSource(): Promise<PendingTaskSource> {
  const year = Number(kstTodayYmd().slice(0, 4));
  const [appointments, certs, seals, ic, promo, empSign, salSign, lectureCerts] = await Promise.all([
    loadAppointmentsPending(),
    supabaseAdmin.from("certificate_requests").select("employee_name, cert_type").eq("status", "pending").order("requested_at"),
    supabaseAdmin.from("seal_requests").select("requester_driver_id, requester_name, title").eq("status", "pending").order("updated_at"),
    supabaseAdmin
      .from("instructor_contracts")
      .select("id, contract_no, instructor_name_snapshot")
      .eq("status", "instructor_signed")
      .is("employer_signed_at", null)
      .order("instructor_signed_at"),
    promotionAlerts(year).catch(() => null),
    loadEmployerSignPending("employment_contracts"),
    loadEmployerSignPending("salary_contracts"),
    loadLectureCertsPending(),
  ]);
  const names = await driverNames([...empSign, ...salSign].map((r) => s(r.driver_id)));
  const nm = (id: unknown) => names.get(s(id)) || "(이름 없음)";
  if (certs.error) throw new Error(certs.error.message);
  if (seals.error) throw new Error(seals.error.message);
  if (ic.error) throw new Error(ic.error.message);
  const promoName = (a: { name: string; step: string }) => `${a.name}(${a.step})`;
  return {
    appointments,
    certificates: ((certs.data ?? []) as Raw[]).map((r) => s(r.employee_name) || "(이름 없음)"),
    seals: ((seals.data ?? []) as Raw[]).map((r) => ({
      requesterDriverId: r.requester_driver_id ? s(r.requester_driver_id) : null,
      label: [s(r.requester_name), s(r.title)].filter(Boolean).join(" · ") || "(신청)",
    })),
    instructorSeals: ((ic.data ?? []) as Raw[]).map((r) => ({
      id: s(r.id),
      name: s(r.instructor_name_snapshot) || "(이름 없음)",
      contractNo: s(r.contract_no),
    })),
    employmentSign: empSign.map((r) => ({ driverId: s(r.driver_id), name: nm(r.driver_id) })),
    salarySign: salSign.map((r) => ({ driverId: s(r.driver_id), name: nm(r.driver_id), year: r.year ?? null })),
    lectureCerts,
    promo: promo ? { overdue: promo.overdue.map(promoName), soon3: promo.soon3.map(promoName) } : null,
  };
}

// 요청 하나에 한 번(메인 카드·헤더 배지·관리자 대시보드가 같은 요청 안에서 부름).
const loadSourceCached = cache(loadPendingTaskSource);

// --- 사람별 목록 --------------------------------------------------------------
export function tasksFromSource(p: TaskPerson, src: PendingTaskSource): PendingTask[] {
  if (!isPendingTaskTarget(p)) return [];
  const out: PendingTask[] = [];
  const push = (kind: PendingTaskKind, names: string[], href: string, count = names.length) => {
    if (count > 0) out.push({ kind, label: PENDING_TASK_LABEL[kind], count, names, href });
  };

  if (p.isPersonnel) {
    for (const a of src.appointments) {
      push(
        "appointment",
        [a.name],
        `/hr?tab=records&driver=${encodeURIComponent(a.driverId)}&section=appointment`,
        a.count,
      );
    }
  }
  if (p.isM0) push("certificate", src.certificates, "/hr/certificates");
  if (p.rank && (SEAL_APPROVER_RANKS as readonly string[]).includes(p.rank)) {
    push(
      "seal",
      src.seals.filter((x) => !p.driverId || x.requesterDriverId !== p.driverId).map((x) => x.label),
      "/seal-register",
    );
  }
  if (p.isDirector) {
    // 바로가기 규칙(아침 슬랙 DM 도 같은 href): 1건이면 그 계약서로 바로, 2건 이상이면 대기만 거른 목록.
    const ic = src.instructorSeals;
    push("instructorSeal", ic.map((x) => x.name), instructorSealHref(ic));
    // 근로·연봉계약서 — 같은 패턴. 1건이면 그 직원 + 대기만(그 계약서 한 줄), 여러 건이면 대기만.
    //   일괄 서명은 없습니다(법적 서명이라 건별로).
    const e = src.employmentSign;
    push(
      "employmentContractSign",
      e.map((x) => x.name),
      contractsPath({ tab: "employment", driverId: e.length === 1 ? e[0].driverId : null, filter: "sign_pending" }),
    );
    const sl = src.salarySign;
    const years = [...new Set(sl.map((x) => x.year).filter((y): y is number => y != null))];
    push(
      "salaryContractSign",
      sl.map((x) => (x.year ? `${x.name}(${x.year})` : x.name)),
      contractsPath({
        tab: "salary",
        year: years.length === 1 ? years[0] : null,
        driverId: sl.length === 1 ? sl[0].driverId : null,
        filter: "sign_pending",
      }),
    );
  }
  if (p.isM0 || p.roles.includes("saem")) push("lectureCertificate", src.lectureCerts, "/hr/saems/certificates");
  if (src.promo) {
    push("leavePromotionOverdue", src.promo.overdue, "/hr/leave-plans");
    push("leavePromotionSoon", src.promo.soon3, "/hr/leave-plans");
  }
  return out;
}

// 강사 계약서 관장 날인 바로가기 — 1건이면 그 계약서 창(맨 위 [직인 날인]), 여러 건이면 날인 대기 목록.
export function instructorSealHref(list: { id: string }[]): string {
  return list.length === 1
    ? `/hr/saems/contracts?contract=${encodeURIComponent(list[0].id)}`
    : "/hr/saems/contracts?filter=seal_pending";
}

export async function pendingTasksFor(p: TaskPerson): Promise<PendingTask[]> {
  if (!isPendingTaskTarget(p)) return [];
  return tasksFromSource(p, await loadSourceCached());
}

export function pendingTaskTotal(tasks: PendingTask[]): number {
  return tasks.reduce((n, t) => n + t.count, 0);
}

// --- 사람 만들기 ---------------------------------------------------------------
// 직원 한 명(drivers.id)으로 — 크론·보고용(세션 없음). master(구글 계정) 판정은 하지 않습니다.
export async function taskPersonOfDriver(d: { id: string; name: string; rank: string | null }): Promise<TaskPerson> {
  const [roles, prof] = await Promise.all([
    listRolesForDriver(d.id),
    supabaseAdmin.from("employee_profiles").select("auth_level").eq("driver_id", d.id).maybeSingle(),
  ]);
  const authLevel = (prof.data as { auth_level?: string | null } | null)?.auth_level ?? null;
  return {
    driverId: d.id,
    name: d.name,
    rank: d.rank,
    isM0: isM0Grant({ rank: d.rank, authLevel }),
    isDirector: d.rank === "관장",
    roles,
    isPersonnel: isPersonnelHolder({ rank: d.rank, roles }),
  };
}

// 재직 중인 대상자 전원(M0 또는 hr 직무) — 크론이 돌며 사람별로 DM.
export async function listPendingTaskTargets(): Promise<TaskPerson[]> {
  const { data, error } = await supabaseAdmin.from("drivers").select("id, name, rank, is_active");
  if (error) throw new Error(error.message);
  const active = ((data ?? []) as Raw[]).filter((d) => d.is_active !== false && d.id && d.name);
  const people = await Promise.all(
    active.map((d) => taskPersonOfDriver({ id: s(d.id), name: s(d.name), rank: d.rank ? s(d.rank) : null })),
  );
  return people.filter(isPendingTaskTarget);
}
