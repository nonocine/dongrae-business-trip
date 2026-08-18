// =====================================================================
// 주소록(명함첩·거래처 관리) 공용 접근 컨텍스트
//   * 정책 (관장 결정): **기본 공개 + 예외 비공개**.
//     - 열람: 로그인한 정식 직원이면 누구나. 협업 자산이라 시설·회계 담당도 봅니다.
//     - 단 is_private=true 로 표시된 항목은 관리자(M0 또는 hr 직무)만.
//     - 공개↔비공개 전환, 비공개 항목의 수정·삭제도 관리자만.
//   * 이전에는 M0·hr 만 화면 자체에 들어올 수 있었습니다(businessCardAccess).
//     그 판정은 여기서 isManager 로 남아 "비공개 항목 취급 권한"이 되었습니다.
//   * ⚠️ 비공개 항목이 일반 직원에게 새지 않도록, 목록·상세·이미지 URL 모두
//     **서버에서** is_private 를 확인합니다. 클라이언트 필터는 표시용일 뿐입니다.
//   * 서버 전용 모듈("use server" 아님) — 서버 액션·페이지가 import 합니다.
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";
import { listRolesForDriver } from "@/lib/employeeRolesServer";

export type DirectoryAccess = {
  name: string;
  driverId: string | null;
  isM0: boolean;
  // M0(관장·부장·master) 또는 hr(인사) 직무.
  //   비공개 항목의 열람·수정·삭제, 공개↔비공개 전환 권한을 가릅니다.
  isManager: boolean;
};

// 접근 컨텍스트 — 로그인한 직원이면 통과(비관리자는 isManager=false).
//   미로그인만 null 입니다. (페이지는 redirect, 액션은 throw)
export async function resolveDirectoryAccess(): Promise<DirectoryAccess | null> {
  const me = await getSession();
  if (!me || me.kind !== "employee" || !me.name.trim()) return null;
  const g = await getGoogleSession();

  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("id, rank")
    .eq("name", me.name.trim())
    .maybeSingle();
  const driverId =
    driver && typeof (driver as { id?: unknown }).id === "string"
      ? String((driver as { id: string }).id)
      : null;
  const rank = (driver as { rank?: string | null } | null)?.rank ?? null;

  let authLevel: string | null = null;
  if (driverId) {
    const { data: prof } = await supabaseAdmin
      .from("employee_profiles")
      .select("auth_level")
      .eq("driver_id", driverId)
      .maybeSingle();
    authLevel =
      (prof as { auth_level?: string | null } | null)?.auth_level ?? null;
  }

  const isM0 = isM0Grant({ rank, email: g?.email, authLevel });
  const roles = driverId ? await listRolesForDriver(driverId) : [];
  return {
    name: me.name.trim(),
    driverId,
    isM0,
    isManager: isM0 || roles.includes("hr"),
  };
}

// 액션용 — 미로그인이면 throw. what 은 안내 문구에 들어갈 화면 이름.
export async function requireDirectoryAccess(
  what: string,
): Promise<DirectoryAccess> {
  const ctx = await resolveDirectoryAccess();
  if (!ctx) throw new Error(`${what} 접근 권한이 없습니다. 로그인해 주세요.`);
  return ctx;
}

// 관리자 전용 동작(공개↔비공개 전환, 비공개 항목 수정·삭제)용 — 미통과면 throw.
//   UI 를 우회한 서버 액션 직접 호출을 여기서 막습니다.
export async function requireDirectoryManager(
  what: string,
): Promise<DirectoryAccess> {
  const ctx = await requireDirectoryAccess(what);
  if (!ctx.isManager) {
    throw new Error(
      `${what}의 비공개 항목은 관장·부장 또는 인사 담당자만 다룰 수 있습니다.`,
    );
  }
  return ctx;
}
