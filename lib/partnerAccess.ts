// =====================================================================
// 거래처 관리 접근 게이트 — /hr/partners
//   * 명함첩(lib/businessCardAccess)과 **같은 조건**입니다: M0(관장·부장·master)
//     또는 hr(인사) 직무. 두 화면은 2단계에서 서로 연결되므로 한쪽만 볼 수 있는
//     상태가 생기면 안 되고, 판정 로직을 두 벌 두면 어긋납니다 → 그대로 위임합니다.
//   * ⚠️ business_partners·partner_contacts 에는 외부인 연락처가 들어갑니다.
//     이 게이트가 유일한 방어선이라 조회·변경 액션 모두 진입 시 재검증합니다.
//   * 서버 전용 모듈("use server" 아님) — 서버 액션·페이지가 import 합니다.
// =====================================================================

import { resolveCardAccess, type CardAccess } from "@/lib/businessCardAccess";

export type PartnerAccess = CardAccess;

// 접근 컨텍스트 — 권한 없으면 null. (페이지는 redirect, 액션은 throw)
export async function resolvePartnerAccess(): Promise<PartnerAccess | null> {
  return resolveCardAccess();
}

// 액션용 — 미통과면 throw.
export async function requirePartnerAccess(): Promise<PartnerAccess> {
  const ctx = await resolvePartnerAccess();
  if (!ctx) {
    throw new Error("거래처 관리 권한이 없습니다. (관장·부장 또는 인사 담당자)");
  }
  return ctx;
}
