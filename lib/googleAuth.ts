// =====================================================================
// Google Workspace OAuth 세션 — 공용 상수·타입·직렬화
//   * "use server" 파일(app/actions.ts)은 async 함수만 export 할 수 있어
//     상수/타입은 이 순수 모듈에 둡니다. 라우트 핸들러와 액션이 공유합니다.
//   * 보안 경계: onnainna.kr 도메인 계정만 허용(Google Workspace Internal).
//     콜백에서 발급, 매 사용처에서 도메인 재검증.
//   * SEC-3a: 쿠키 값은 HMAC 서명본입니다(lib/signedCookie.ts).
// =====================================================================

import { signPayload, verifyPayload } from "@/lib/signedCookie";
// 상수는 lib/authConstants.ts 에 있습니다 — 클라이언트에서 쓰이는 lib/authLevels.ts 가
//   이 파일(서명·node:crypto 포함)을 끌어오지 않도록 분리했습니다. 기존 import 경로
//   호환을 위해 여기서 그대로 re-export 합니다.
import {
  GOOGLE_WORKSPACE_DOMAIN,
  MASTER_EMAIL,
} from "@/lib/authConstants";

export { GOOGLE_WORKSPACE_DOMAIN, MASTER_EMAIL };

export const GOOGLE_SESSION_COOKIE = "dongrae_google_session";
// 세션 8시간 — 업무 단위 만료.
export const GOOGLE_SESSION_MAX_AGE = 60 * 60 * 8;

export type GoogleSession = {
  email: string;
  name: string; // 구글 표시 이름(매칭 시 직원 이름으로 대체)
  driverId: string | null;
  driverName: string | null;
  rank: string | null;
  hasProfile: boolean;
  // 마스터 계정 여부 — true 면 rank 와 무관하게 관장 권한.
  isMaster: boolean;
};

// 이메일이 허용 도메인인지 — 대소문자 무시.
export function isAllowedGoogleEmail(
  email: string | null | undefined
): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(`@${GOOGLE_WORKSPACE_DOMAIN}`);
}

// 마스터 계정 이메일인지 — 대소문자 무시.
export function isMasterEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === MASTER_EMAIL;
}

// 쿠키 문자열 → GoogleSession. 서명 불일치·파싱 실패·도메인 불일치 시 null.
//   * SEC-3a: 검증은 2중 —
//     1) HMAC 서명 검증(위조 차단). 실패하면 즉시 null.
//     2) 기존 필드 타입체크 + 도메인 재검증(기존 안전장치 그대로 유지).
//   * 무서명 쿠키를 받아주는 폴백은 없습니다 — 있으면 1)이 무의미해집니다.
export function parseGoogleSession(
  raw: string | undefined | null
): GoogleSession | null {
  const o = verifyPayload<Partial<GoogleSession>>(raw);
  if (!o) return null;
  if (
    typeof o?.email !== "string" ||
    typeof o?.name !== "string" ||
    !isAllowedGoogleEmail(o.email) // 도메인 재검증(이중 안전장치)
  ) {
    return null;
  }
  return {
    email: o.email,
    name: o.name,
    driverId: typeof o.driverId === "string" ? o.driverId : null,
    driverName: typeof o.driverName === "string" ? o.driverName : null,
    rank: typeof o.rank === "string" ? o.rank : null,
    hasProfile: o.hasProfile === true,
    isMaster: o.isMaster === true,
  };
}

// GoogleSession → 서명된 쿠키 문자열.
export function serializeGoogleSession(s: GoogleSession): string {
  return signPayload(s);
}
