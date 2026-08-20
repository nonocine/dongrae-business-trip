// =====================================================================
// 공용 비밀번호 관리 접근 게이트 — /hr/credentials
//   * 정책 (관장 결정):
//     - 열람: M0(관장·부장·master)는 전 항목. 그 외 직원은 credential_viewers
//       에 지정된 항목만. 지정되지 않은 항목은 목록에서도 보이지 않습니다
//       (존재 자체를 숨김 — 비공개 거래처와 같은 방식).
//     - 등록·수정·삭제·열람자 지정: M0 만.
//   * 판정은 기존 방식 재사용 — getSession(직원 세션) + drivers 연결(driver_id)
//     + isM0Grant(rank·구글 이메일·auth_level).
//   * driver_id 가 없는 세션(명부에 없는 이름)은 열람자 지정 대상이 될 수 없어
//     비M0 라면 아무 항목도 보이지 않습니다 — 의도된 동작입니다.
//   * 서버 전용 모듈("use server" 아님) — 서버 액션·페이지가 import 합니다.
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";

export type CredentialAccess = {
  name: string;
  driverId: string | null;
  // M0 = 전 항목 열람 + 등록·수정·삭제·열람자 지정.
  isM0: boolean;
};

const WHAT = "비밀번호 관리";

// 접근 컨텍스트 — 로그인한 직원이면 통과(비M0 는 지정된 항목만 보게 됩니다).
//   미로그인만 null 입니다. (페이지는 redirect, 액션은 throw)
export async function resolveCredentialAccess(): Promise<CredentialAccess | null> {
  const me = await getSession();
  if (!me || me.kind !== "employee" || !me.name.trim()) return null;
  const g = await getGoogleSession();

  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("id, rank")
    .eq("name", me.name.trim())
    .maybeSingle();
  const row = driver as { id?: unknown; rank?: string | null } | null;
  const driverId = typeof row?.id === "string" ? String(row.id) : null;

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

  return {
    name: me.name.trim(),
    driverId,
    isM0: isM0Grant({ rank: row?.rank ?? null, email: g?.email, authLevel }),
  };
}

// 액션용 — 미로그인이면 throw.
export async function requireCredentialAccess(): Promise<CredentialAccess> {
  const ctx = await resolveCredentialAccess();
  if (!ctx) throw new Error(`${WHAT} 접근 권한이 없습니다. 로그인해 주세요.`);
  return ctx;
}

// 관리 동작(등록·수정·삭제·열람자 지정) — M0 아니면 throw.
//   UI 를 우회한 서버 액션 직접 호출을 여기서 막습니다.
export async function requireCredentialManager(): Promise<CredentialAccess> {
  const ctx = await requireCredentialAccess();
  if (!ctx.isM0) {
    throw new Error(`${WHAT} 등록·수정·삭제는 관장·부장만 할 수 있습니다.`);
  }
  return ctx;
}
