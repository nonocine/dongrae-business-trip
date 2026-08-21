// =====================================================================
// 공용 비밀번호 관리 — 공용 상수·타입 (클라이언트도 import 하는 순수 모듈).
//   * 암복호화(lib/credentialCrypto)와 접근 판정(lib/credentialAccess)은 서버
//     전용입니다. 화면이 쓰는 라벨·카테고리·행 타입만 여기 둡니다.
//   * ⚠️ CredentialRow 에는 password_encrypted 가 **없습니다**. 목록 응답에
//     암호문을 실어 보내지 않는 것이 이 기능의 핵심 규칙입니다. 평문은 개별
//     열람 액션(revealCredential)만 반환합니다.
// =====================================================================

export const CREDENTIAL_CATEGORIES = ["메일", "구매", "은행", "기타"] as const;
export type CredentialCategory = (typeof CREDENTIAL_CATEGORIES)[number];

// 자유 text 컬럼 값 → 알려진 카테고리(모르면 "기타").
export function normalizeCredentialCategory(v: unknown): CredentialCategory {
  const s = typeof v === "string" ? v.trim() : "";
  return (CREDENTIAL_CATEGORIES as readonly string[]).includes(s)
    ? (s as CredentialCategory)
    : "기타";
}

export const CREDENTIAL_CATEGORY_BADGE: Record<CredentialCategory, string> = {
  메일: "bg-navy-soft text-navy",
  구매: "bg-success-soft text-success",
  은행: "bg-warning-soft text-warning",
  기타: "bg-surface text-ink-muted",
};

// 목록 행 — 비밀번호는 담기지 않습니다(화면에서는 항상 ●●●●●●).
export type CredentialRow = {
  id: string;
  name: string;
  category: CredentialCategory;
  account: string;
  url: string;
  memo: string;
  createdBy: string;
  updatedOn: string; // KST "YYYY.MM.DD" (없으면 "")
  // 열람자 — M0 에게만 채워 보냅니다(누가 볼 수 있는지 관리 화면 표시용).
  viewerIds: string[];
  viewerNames: string[];
  // 이 항목을 수정할 수 있는지 — M0 이거나 내가 등록한 항목. 서버에서 판정한
  //   값이며(등록자 driver_id 는 내려보내지 않습니다), 실제 차단은 액션이 다시
  //   확인합니다.
  canEdit: boolean;
};

// 열람자 지정 체크박스 목록에 쓰는 직원 한 명.
export type CredentialStaff = {
  driverId: string;
  name: string;
  rank: string | null;
};

// 화면의 비밀번호 자리 — 실제 값과 무관한 고정 표시.
export const CREDENTIAL_MASK = "••••••••";
