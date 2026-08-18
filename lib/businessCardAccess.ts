// =====================================================================
// 명함첩 접근 게이트 — /hr/cards
//   * 정책 (관장 결정): 기본 공개 + 예외 비공개. 열람은 **로그인한 정식 직원 누구나**,
//     is_private=true 인 명함만 관리자(M0 또는 hr)에게 보입니다.
//     판정은 거래처 관리와 공유합니다 → lib/directoryAccess.
//     (예전에는 이 파일이 M0·hr 만 통과시켰습니다. 그 조건은 ctx.isManager 로 남아
//      "비공개 명함을 다룰 수 있는가"를 가르는 기준이 되었습니다.)
//   * ⚠️ business_cards 에는 외부인 연락처가 들어갑니다. 조회·변경 액션 모두
//     진입 시 재검증하고, 비공개 명함은 서버에서 걸러 내보내지 않습니다.
//   * 서버 전용 모듈("use server" 아님) — 서버 액션·페이지가 import 합니다.
// =====================================================================

import {
  resolveDirectoryAccess,
  requireDirectoryAccess,
  requireDirectoryManager,
  type DirectoryAccess,
} from "@/lib/directoryAccess";

export type CardAccess = DirectoryAccess;

const WHAT = "명함첩";

// 접근 컨텍스트 — 로그인 직원이면 통과. 미로그인만 null.
export async function resolveCardAccess(): Promise<CardAccess | null> {
  return resolveDirectoryAccess();
}

// 액션용 — 미로그인이면 throw.
export async function requireCardAccess(): Promise<CardAccess> {
  return requireDirectoryAccess(WHAT);
}

// 관리자 전용(공개↔비공개 전환 등) — M0·hr 아니면 throw.
export async function requireCardManager(): Promise<CardAccess> {
  return requireDirectoryManager(WHAT);
}
