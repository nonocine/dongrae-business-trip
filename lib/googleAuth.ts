// =====================================================================
// Google Workspace OAuth 세션 — 공용 상수·타입·직렬화
//   * "use server" 파일(app/actions.ts)은 async 함수만 export 할 수 있어
//     상수/타입은 이 순수 모듈에 둡니다. 라우트 핸들러와 액션이 공유합니다.
//   * 보안 경계: onnainna.kr 도메인 계정만 허용(Google Workspace Internal).
//     콜백에서 발급, 매 사용처에서 도메인 재검증.
// =====================================================================

export const GOOGLE_SESSION_COOKIE = "dongrae_google_session";
// 세션 8시간 — 업무 단위 만료.
export const GOOGLE_SESSION_MAX_AGE = 60 * 60 * 8;
// 허용 도메인 — Google 콘솔 Internal 설정 + 콜백/세션 양쪽에서 이중 검증.
export const GOOGLE_WORKSPACE_DOMAIN = "onnainna.kr";

// 마스터 계정 — employee_profiles 매핑 없이도 무조건 관장 권한으로 통과.
export const MASTER_EMAIL = "master@onnainna.kr";

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

// 쿠키 문자열 → GoogleSession. 파싱 실패·도메인 불일치 시 null.
export function parseGoogleSession(
  raw: string | undefined | null
): GoogleSession | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<GoogleSession>;
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
  } catch {
    return null;
  }
}

export function serializeGoogleSession(s: GoogleSession): string {
  return JSON.stringify(s);
}
