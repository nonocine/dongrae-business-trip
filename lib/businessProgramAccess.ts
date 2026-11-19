// 사업실적 프로그램 관리 권한 — 서버 전용(클라이언트 import 금지).
//   대상: [프로그램 관리] 탭(?tab=registry), 분야·표시순서·대관 연결 설정과
//   그 서버 액션(app/(app)/business-results/programAdminActions·actions 의 레지스트리·대관 연결).
//   보유 = 관장·부장 등 M0(ctxIsM0) · master · employee_roles 의 'business_admin'
//   (2026-11 — 김혜지 팀장 요청으로 직무 보유자까지 넓힘).
//   ⚠️ 사업실적의 다른 관리자 판정(남의 실적 삭제 등, isManagerAdmin)은 그대로입니다.
import { getGoogleSession, getSession } from "@/app/actions";
import { ctxIsM0, resolveAuthContext } from "@/lib/authContext";
import { hasRole } from "@/lib/employeeRolesServer";

export const BUSINESS_ADMIN_ROLE_KEY = "business_admin";

export async function canManageBusinessPrograms(): Promise<boolean> {
  const g = await getGoogleSession();
  if (g?.isMaster) return true;
  const s = await getSession();
  const ctx = await resolveAuthContext(
    g,
    s && s.kind === "employee" ? { name: s.name } : null,
  );
  if (!ctx) return false;
  if (ctxIsM0(ctx)) return true;
  return !!ctx.driverId && (await hasRole(ctx.driverId, BUSINESS_ADMIN_ROLE_KEY));
}
