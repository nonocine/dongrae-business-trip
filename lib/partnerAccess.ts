// =====================================================================
// 거래처 관리 접근 게이트 — /hr/partners
//   * 정책 (관장 결정): 기본 공개 + 예외 비공개. 열람은 **로그인한 정식 직원 누구나**,
//     is_private=true 인 거래처만 관리자(M0 또는 hr)에게 보입니다.
//     명함첩과 같은 판정을 공유합니다 → lib/directoryAccess.
//     비공개 거래처가 가려지면 그 소속 담당자(partner_contacts)도 함께 가려집니다.
//   * ⚠️ business_partners·partner_contacts 에는 외부인 연락처가 들어갑니다.
//     조회·변경 액션 모두 진입 시 재검증하고, 비공개 항목은 서버에서 걸러냅니다.
//   * 서버 전용 모듈("use server" 아님) — 서버 액션·페이지가 import 합니다.
// =====================================================================

import {
  resolveDirectoryAccess,
  requireDirectoryAccess,
  requireDirectoryManager,
  type DirectoryAccess,
} from "@/lib/directoryAccess";

export type PartnerAccess = DirectoryAccess;

const WHAT = "거래처 관리";

// 접근 컨텍스트 — 로그인 직원이면 통과. 미로그인만 null.
export async function resolvePartnerAccess(): Promise<PartnerAccess | null> {
  return resolveDirectoryAccess();
}

// 액션용 — 미로그인이면 throw.
export async function requirePartnerAccess(): Promise<PartnerAccess> {
  return requireDirectoryAccess(WHAT);
}

// 관리자 전용(공개↔비공개 전환 등) — M0·hr 아니면 throw.
export async function requirePartnerManager(): Promise<PartnerAccess> {
  return requireDirectoryManager(WHAT);
}
