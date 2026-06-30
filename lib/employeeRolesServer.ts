// =====================================================================
// 직원 직무(employee_roles) — 서버 전용 판정 헬퍼.
//   * employee_roles 는 RLS 정책 0개(anon 차단)라 service_role(supabaseAdmin)로만
//     접근합니다. 따라서 이 모듈은 서버(서버액션/서버컴포넌트)에서만 import 하세요.
//   * 순수 상수/타입은 lib/employeeRoles.ts(클라이언트 안전)에 분리돼 있습니다.
//   * 대시보드의 "직무별 메뉴 노출" 등에 쓰일 토대 헬퍼입니다.
// =====================================================================
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// 한 직원에게 부여된 직무 key 목록.
export async function listRolesForDriver(
  driverId: string
): Promise<string[]> {
  if (!driverId) return [];
  const { data, error } = await supabaseAdmin
    .from("employee_roles")
    .select("role_key")
    .eq("driver_id", driverId);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r) => String((r as { role_key?: unknown }).role_key ?? ""))
    .filter((k) => k.length > 0);
}

// 특정 직원이 특정 직무를 가졌는지.
export async function hasRole(
  driverId: string,
  roleKey: string
): Promise<boolean> {
  if (!driverId || !roleKey) return false;
  const { data, error } = await supabaseAdmin
    .from("employee_roles")
    .select("id")
    .eq("driver_id", driverId)
    .eq("role_key", roleKey)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

// 세션 형태(앱 Session 과 호환되는 최소 형태) — 직원 세션의 이름으로 직무를 조회.
type SessionLike = { kind: string; name?: string } | null | undefined;

// 현재 로그인 직원의 직무 목록. 직원 세션이 아니면 빈 배열.
//   * 직원 식별은 세션 이름 → drivers.name 매칭(기존 getMyDriver 와 동일 기준).
export async function getMyRoles(session: SessionLike): Promise<string[]> {
  if (!session || session.kind !== "employee" || !session.name) return [];
  const { data: drv, error } = await supabaseAdmin
    .from("drivers")
    .select("id")
    .eq("name", session.name)
    .maybeSingle();
  if (error || !drv) return [];
  const id = (drv as { id?: unknown }).id;
  if (typeof id !== "string" || !id) return [];
  return listRolesForDriver(id);
}
