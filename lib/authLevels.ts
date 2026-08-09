// 클라이언트 컴포넌트도 이 모듈을 import 합니다 — 서버 전용 모듈(googleAuth →
//   signedCookie → node:crypto)로 이어지지 않도록 순수 상수 모듈에서 가져옵니다.
import { MASTER_EMAIL } from "@/lib/authConstants";

// =====================================================================
// 직원 권한등급(auth_level) — ERP 호환 시스템 권한 코드.
//   * 직급(drivers.rank: 관장/부장/팀장/팀원)과는 별개의 "시스템 권한".
//     예) 직급=팀원 이지만 권한=M0(전체관리) 같은 예외를 표현하기 위함.
//   * employee_profiles.auth_level(text) 에 저장. ERP 와 동일 코드(M0/M1/M3)를 씁니다.
//   * M2 는 현재 미사용이나 컬럼이 자유 text 라 향후 확장 가능합니다.
//   * 이번 단계는 "토대"만 마련 — 상벌·급여 등 민감영역 실제 게이트는 다음 단계에서 사용.
// =====================================================================
export const AUTH_LEVELS = ["M0", "M1", "M3"] as const;
export type AuthLevel = (typeof AUTH_LEVELS)[number];

// 드롭다운/표시용 라벨.
export const AUTH_LEVEL_LABELS: Record<AuthLevel, string> = {
  M0: "M0 · 전체관리 (관장·부장)",
  M1: "M1 · 부서관리 (팀장)",
  M3: "M3 · 일반 (팀원·담임)",
};

// 자유 text 컬럼/폼 값 → 알려진 등급이면 그대로, 아니면 null.
export function normalizeAuthLevel(raw: unknown): AuthLevel | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  return (AUTH_LEVELS as readonly string[]).includes(s)
    ? (s as AuthLevel)
    : null;
}

// 민감영역(상벌·급여 등) 접근 가능 여부 — M0 만 허용.
//   * 이번 단계는 헬퍼만 제공하고, 실제 게이트 적용은 다음 지시문에서 사용합니다.
export function canAccessHrSensitive(
  authLevel: string | null | undefined
): boolean {
  return normalizeAuthLevel(authLevel) === "M0";
}

// 직급(rank) → 권한등급 폴백 매핑.
//   * auth_level 이 비어있는 기존 직원의 등급을 직급에서 유추(동작 보존용).
export function authLevelFromRank(rank: string | null | undefined): AuthLevel {
  switch (rank) {
    case "관장":
    case "부장":
      return "M0";
    case "팀장":
      return "M1";
    default:
      return "M3";
  }
}

// 유효 권한등급 — auth_level 이 있으면 우선, 없으면 rank 폴백.
//   * 지시문 2-3: 둘이 충돌하면 auth_level 우선. 기존 rank 게이트는 폴백으로 보존.
export function effectiveAuthLevel(
  rank: string | null | undefined,
  authLevel: string | null | undefined
): AuthLevel {
  return normalizeAuthLevel(authLevel) ?? authLevelFromRank(rank);
}

// 최고권한(M0) 직급 — 관장·부장. (master 계정은 email 로 별도 판정)
export const M0_RANKS = ["관장", "부장"] as const;

// 최고권한(M0) 판정 — 관장·부장·master@onnainna.kr 3계정이 권한을 공유합니다.
//   * 셋 중 하나라도 해당하면 M0: rank ∈ (관장,부장) OR email = master OR auth_level = 'M0'.
//   * 권한 부여(권한등급 변경)·합격자 직원 전환 등 최고권한 동작의 단일 게이트.
//   * 인자는 가진 정보만 넘기면 됩니다(없는 값은 생략/None).
export function isM0Grant(input: {
  rank?: string | null;
  email?: string | null;
  authLevel?: string | null;
}): boolean {
  const { rank, email, authLevel } = input;
  if (rank && (M0_RANKS as readonly string[]).includes(rank)) return true;
  if (email && email.trim().toLowerCase() === MASTER_EMAIL) return true;
  if (normalizeAuthLevel(authLevel) === "M0") return true;
  return false;
}
