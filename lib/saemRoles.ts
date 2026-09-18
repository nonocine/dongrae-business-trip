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

// 역할의 활성 상태. saem_instructors.status(= 동래샘들 로그인 계정 상태)와는 완전히 다른 축이다.
//   - saem_instructors.status  : 그 사람의 로그인 자체 (끄면 앱에 못 들어온다)
//   - saem_member_roles.status : 그 역할 하나만 (끄면 그 역할에서만 빠지고 로그인·다른 역할은 그대로)
// 이 파일은 후자만 다룬다. 계정 status 는 여기서 절대 건드리지 않는다.
export type SaemRoleStatus = "active" | "inactive";

export type SaemRoleRow = {
  instructorId: string;
  role: SaemRole;
  status: SaemRoleStatus;
  deactivatedAt: string | null;
  deactivatedBy: string | null;
  deactivateReason: string | null;
};

const ROLE_COLUMNS =
  "instructor_id,role,status,deactivated_at,deactivated_by,deactivate_reason";

export function isSaemRole(v: unknown): v is SaemRole {
  return typeof v === "string" && v in SAEM_ROLES;
}

export function saemRoleLabel(role: string): string {
  return (SAEM_ROLES as Record<string, string>)[role] ?? role;
}

function toRoleRow(r: Record<string, unknown>): SaemRoleRow {
  return {
    instructorId: String(r.instructor_id ?? ""),
    role: String(r.role ?? "") as SaemRole,
    status: r.status === "inactive" ? "inactive" : "active",
    deactivatedAt: (r.deactivated_at as string | null) ?? null,
    deactivatedBy: (r.deactivated_by as string | null) ?? null,
    deactivateReason: (r.deactivate_reason as string | null) ?? null,
  };
}

// 특정 계정이 가진 역할 목록을 읽는다. (로그인 후 배너 분기 등에 사용)
// 기본은 활성 역할만. 관리 화면처럼 중지된 역할까지 봐야 하면 activeOnly:false.
export async function getRolesForInstructor(
  instructorId: string,
  opts: { activeOnly?: boolean } = {}
): Promise<SaemRole[]> {
  const rows = await getRoleRowsForInstructor(instructorId, opts);
  return rows.map((r) => r.role).filter(isSaemRole);
}

// 위와 같되 상태·중지 사유까지 함께 돌려준다. (관리 화면용)
export async function getRoleRowsForInstructor(
  instructorId: string,
  opts: { activeOnly?: boolean } = {}
): Promise<SaemRoleRow[]> {
  const activeOnly = opts.activeOnly ?? true;
  let query = supabaseAdmin
    .from("saem_member_roles")
    .select(ROLE_COLUMNS)
    .eq("instructor_id", instructorId);
  if (activeOnly) query = query.eq("status", "active");
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r) => toRoleRow(r as Record<string, unknown>))
    .filter((r) => isSaemRole(r.role));
}

// 특정 역할을 가진 계정 id 목록. (예: 동아리 역할자 = 순수 동아리샘 + 강사 겸직자)
// 기본은 활성 역할만 → "동아리샘을 고르는 자리"는 이 함수만 쓰면 중지자가 자동으로 빠진다.
export async function getInstructorIdsWithRole(
  role: SaemRole,
  opts: { activeOnly?: boolean } = {}
): Promise<string[]> {
  const rows = await getRoleRowsWithRole(role, opts);
  return rows.map((r) => r.instructorId);
}

// 위와 같되 상태·중지 사유까지. 관리 화면(활성/중지 토글 목록)용.
export async function getRoleRowsWithRole(
  role: SaemRole,
  opts: { activeOnly?: boolean } = {}
): Promise<SaemRoleRow[]> {
  const activeOnly = opts.activeOnly ?? true;
  let query = supabaseAdmin
    .from("saem_member_roles")
    .select(ROLE_COLUMNS)
    .eq("role", role);
  if (activeOnly) query = query.eq("status", "active");
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toRoleRow(r as Record<string, unknown>));
}

// 계정에 역할을 추가한다(이미 활성이면 무시 = 멱등). 겸직 지정에 사용.
//   unique(instructor_id, role) 이라 중지된 행이 이미 있으면 insert 가 실패한다.
//   → 그 경우 새로 만들지 않고 그 행을 다시 활성으로 되살린다.
export async function addRole(
  instructorId: string,
  role: SaemRole,
  grantedBy?: string
): Promise<void> {
  const { data: existing, error: findError } = await supabaseAdmin
    .from("saem_member_roles")
    .select("instructor_id,role,status")
    .eq("instructor_id", instructorId)
    .eq("role", role)
    .maybeSingle();
  if (findError) throw new Error(findError.message);

  if (existing) {
    if ((existing as { status?: string }).status === "inactive") {
      await reactivateRole(instructorId, role);
    }
    return; // 이미 활성이면 할 일 없음
  }

  const { error } = await supabaseAdmin.from("saem_member_roles").insert({
    instructor_id: instructorId,
    role,
    granted_by: grantedBy ?? null,
    status: "active",
  });
  if (error) throw new Error(error.message);
}

// 역할을 중지한다. 행은 남고 status 만 inactive — 되돌릴 수 있다.
//   계정(saem_instructors.status)과 다른 역할은 건드리지 않는다.
export async function deactivateRole(
  instructorId: string,
  role: SaemRole,
  reason?: string,
  actorName?: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("saem_member_roles")
    .update({
      status: "inactive",
      deactivated_at: new Date().toISOString(),
      deactivated_by: actorName?.trim() || null,
      deactivate_reason: reason?.trim() || null,
    })
    .eq("instructor_id", instructorId)
    .eq("role", role);
  if (error) throw new Error(error.message);
}

// 중지한 역할을 다시 활성으로. 중지 기록(언제·누가·왜)은 비운다.
export async function reactivateRole(
  instructorId: string,
  role: SaemRole
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("saem_member_roles")
    .update({
      status: "active",
      deactivated_at: null,
      deactivated_by: null,
      deactivate_reason: null,
    })
    .eq("instructor_id", instructorId)
    .eq("role", role);
  if (error) throw new Error(error.message);
}

// 계정에서 역할을 아예 뺀다(행 삭제). 겸직 해제. 계정 자체는 남는다.
//   되돌릴 수 있는 "중지"가 필요하면 deactivateRole 을 쓸 것.
export async function removeRole(instructorId: string, role: SaemRole): Promise<void> {
  const { error } = await supabaseAdmin
    .from("saem_member_roles")
    .delete()
    .eq("instructor_id", instructorId)
    .eq("role", role);
  if (error) throw new Error(error.message);
}
