// =====================================================================
// 인사발령(employee_profiles.appointments jsonb) 읽기·쓰기 — 서버 전용.
//   * 규칙(상태·확정·반려)은 lib/appointments.ts 순수 함수. 여기는 DB·슬랙만.
//   * 본인 액션(app/(app)/profile/hr/appointmentActions)과 확정·반려 액션
//     (app/(app)/hr/appointmentReviewActions), 관리 화면 저장이 같이 씁니다.
// =====================================================================

import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  normalizeAppointmentList,
  type EmployeeAppointment,
} from "@/lib/supabase";
import { appointmentStatusOf } from "@/lib/appointments";
import { PERSONNEL_RANKS, PERSONNEL_ROLE_KEY } from "@/lib/personnel";
import { sendSlackDM, siteBaseUrl, slackLink } from "@/lib/slack";
import { kstTodayYmd } from "@/lib/trainings";

// id 가 없는 항목(관리 화면에서 만든 것·기존 데이터)에 id 를 붙입니다.
//   수정 요청이 원 항목을 id(original_id)로 가리키기 때문입니다.
export function withAppointmentIds(
  list: EmployeeAppointment[]
): EmployeeAppointment[] {
  return list.map((a) => (a.id ? a : { ...a, id: randomUUID() }));
}

export type StoredAppointments = {
  exists: boolean; // employee_profiles 행이 있는가
  joinDate: string | null;
  list: EmployeeAppointment[];
};

export async function loadAppointments(
  driverId: string
): Promise<StoredAppointments> {
  const { data, error } = await supabaseAdmin
    .from("employee_profiles")
    .select("appointments, join_date")
    .eq("driver_id", driverId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { appointments?: unknown; join_date?: unknown } | null;
  return {
    exists: !!row,
    joinDate: typeof row?.join_date === "string" ? row.join_date : null,
    list: normalizeAppointmentList(row?.appointments ?? []),
  };
}

// appointments 칸만 씁니다(행이 없으면 만듭니다 — 다른 칸은 건드리지 않음).
export async function saveAppointments(
  driverId: string,
  list: EmployeeAppointment[],
  exists: boolean
): Promise<EmployeeAppointment[]> {
  const appointments = withAppointmentIds(list);
  const updated_at = new Date().toISOString();
  const { error } = exists
    ? await supabaseAdmin
        .from("employee_profiles")
        .update({ appointments, updated_at })
        .eq("driver_id", driverId)
    : await supabaseAdmin
        .from("employee_profiles")
        .insert({ driver_id: driverId, appointments, updated_at });
  if (error) throw new Error(error.message);
  return appointments;
}

// 확정 권한자(관장·부장·personnel 직무) 중 재직자의 이메일 — 슬랙 DM 대상.
//   master 계정은 drivers 행이 없어 제외됩니다. 요청한 본인은 뺍니다.
async function reviewerEmails(exceptDriverId: string): Promise<string[]> {
  const [{ data: byRank }, { data: byRole }] = await Promise.all([
    supabaseAdmin
      .from("drivers")
      .select("id")
      .in("rank", [...PERSONNEL_RANKS])
      .eq("is_active", true),
    supabaseAdmin
      .from("employee_roles")
      .select("driver_id")
      .eq("role_key", PERSONNEL_ROLE_KEY),
  ]);
  const roleIds = ((byRole ?? []) as { driver_id?: unknown }[])
    .map((r) => String(r.driver_id ?? ""))
    .filter(Boolean);
  // 직무로 받은 사람도 퇴사자는 빼야 해서 drivers 를 다시 봅니다.
  const { data: activeRole } = roleIds.length
    ? await supabaseAdmin
        .from("drivers")
        .select("id")
        .in("id", roleIds)
        .eq("is_active", true)
    : { data: [] };
  const ids = new Set(
    [...(byRank ?? []), ...(activeRole ?? [])]
      .map((r) => String((r as { id?: unknown }).id ?? ""))
      .filter((id) => id && id !== exceptDriverId)
  );
  if (ids.size === 0) return [];
  const { data: profs } = await supabaseAdmin
    .from("employee_profiles")
    .select("email")
    .in("driver_id", [...ids]);
  return [
    ...new Set(
      ((profs ?? []) as { email?: unknown }[])
        .map((p) => (typeof p.email === "string" ? p.email.trim() : ""))
        .filter(Boolean)
    ),
  ];
}

const KST_DAY = (iso: string | undefined): string | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
};

// 대기 건이 생겼을 때 확정 권한자에게 슬랙 DM — 같은 직원 건은 하루(KST) 한 번.
//   오늘 이미 보낸 항목(notified_at)이 있으면 건너뜁니다. 보냈으면 그 항목에
//   notified_at 을 찍은 새 목록을 돌려줍니다(호출부가 저장). 실패해도 throw 없음.
export async function notifyReviewersOnce(
  driverId: string,
  employeeName: string,
  list: EmployeeAppointment[],
  newItemId: string
): Promise<EmployeeAppointment[]> {
  const today = kstTodayYmd();
  if (list.some((a) => KST_DAY(a.notified_at) === today)) return list;
  try {
    const emails = await reviewerEmails(driverId);
    if (emails.length === 0) return list;
    const pending = list.filter((a) => appointmentStatusOf(a) === "pending");
    const base = siteBaseUrl();
    const text =
      `📋 ${employeeName}님이 인사발령을 올렸습니다(확인 대기 ${pending.length}건).\n` +
      pending
        .slice(0, 5)
        .map(
          (a) =>
            `• ${a.original_id ? "[수정 요청] " : ""}${a.type} ${a.effective_date || "(발령일 없음)"} ${[a.department, a.title].filter(Boolean).join(" ")}`.trimEnd()
        )
        .join("\n") +
      (base ? `\n• ${slackLink(`${base}/hr`, "인사기록 관리에서 확정하기")}` : "");
    const results = await Promise.all(emails.map((e) => sendSlackDM(e, text)));
    if (!results.some(Boolean)) return list;
    const at = new Date().toISOString();
    return list.map((a) => (a.id === newItemId ? { ...a, notified_at: at } : a));
  } catch (e) {
    console.warn("[appointments] 확정 권한자 DM 실패:", e instanceof Error ? e.message : e);
    return list;
  }
}
