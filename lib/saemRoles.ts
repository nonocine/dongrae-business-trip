import { supabaseAdmin } from "@/lib/supabaseAdmin";

// 동래샘들 통합 현장앱의 역할 값. 새 직종은 여기에 추가만 하면 된다.
// (앱 구조를 바꾸지 않고 역할만 늘리는 것이 이 설계의 핵심)
export const SAEM_ROLES = {
  instructor: "강사",
  club_teacher: "동아리지도자",
  // 향후 확장 예정:
  // part_time: "일일알바",
  // afterschool: "방과후아카데미",
  // onnago: "온나고 일일강사",
} as const;

export type SaemRole = keyof typeof SAEM_ROLES;

export function isSaemRole(v: unknown): v is SaemRole {
  return typeof v === "string" && v in SAEM_ROLES;
}

export function saemRoleLabel(role: string): string {
  return (SAEM_ROLES as Record<string, string>)[role] ?? role;
}

// 특정 계정이 가진 역할 목록을 읽는다. (로그인 후 배너 분기 등에 사용)
export async function getRolesForInstructor(instructorId: string): Promise<SaemRole[]> {
  const { data, error } = await supabaseAdmin
    .from("saem_member_roles")
    .select("role")
    .eq("instructor_id", instructorId);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r) => String((r as { role: string }).role))
    .filter(isSaemRole);
}

// 특정 역할을 가진 계정 id 목록을 읽는다. (예: 동아리 역할자 전부 = 순수 동아리샘 + 강사 겸직자)
export async function getInstructorIdsWithRole(role: SaemRole): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("saem_member_roles")
    .select("instructor_id")
    .eq("role", role);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => String((r as { instructor_id: string }).instructor_id));
}

// 계정에 역할을 추가한다(이미 있으면 무시 = 멱등). 겸직 지정에 사용.
export async function addRole(
  instructorId: string,
  role: SaemRole,
  grantedBy?: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("saem_member_roles")
    .upsert(
      { instructor_id: instructorId, role, granted_by: grantedBy ?? null },
      { onConflict: "instructor_id,role", ignoreDuplicates: true }
    );
  if (error) throw new Error(error.message);
}

// 계정에서 역할을 뺀다. (겸직 해제. 계정 자체는 남는다)
export async function removeRole(instructorId: string, role: SaemRole): Promise<void> {
  const { error } = await supabaseAdmin
    .from("saem_member_roles")
    .delete()
    .eq("instructor_id", instructorId)
    .eq("role", role);
  if (error) throw new Error(error.message);
}
