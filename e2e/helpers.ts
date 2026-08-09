import type { BrowserContext, Page } from "@playwright/test";
// SEC-3a 이후 세션 쿠키는 HMAC 서명본만 유효합니다. 테스트도 실제 로그인과 똑같이
//   signPayload 로 서명한 값을 심습니다(무서명 위조는 서버가 거부).
//   SESSION_SECRET 은 playwright.config.ts 가 .env.local 에서 읽어 주입합니다.
import { signPayload } from "../lib/signedCookie";

const GOOGLE_COOKIE = "dongrae_google_session";
const EMPLOYEE_COOKIE = "dongrae_employee";

// 구글 워크스페이스 세션 심기 — 콜백(app/api/auth/google/callback)이 발급하는 것과
//   동일한 payload 구조에 동일한 서명을 붙입니다.
export async function setGoogleSession(
  context: BrowserContext,
  baseURL: string,
  session: {
    email: string;
    name?: string;
    driverId?: string | null;
    driverName?: string | null;
    rank?: string | null;
    hasProfile?: boolean;
    isMaster?: boolean;
  }
) {
  const value = signPayload({
    email: session.email,
    name: session.name ?? "테스트직원",
    driverId: session.driverId ?? null,
    driverName: session.driverName ?? null,
    rank: session.rank ?? null,
    hasProfile: session.hasProfile ?? false,
    isMaster: session.isMaster ?? false,
  });
  // 서명본은 base64url + '.' 이라 URL 인코딩이 필요 없습니다.
  await context.addCookies([{ name: GOOGLE_COOKIE, value, url: baseURL }]);
}

// 직원 세션 심기 — getSession 이 읽는 { name } 서명본.
export async function setEmployeeSession(
  context: BrowserContext,
  baseURL: string,
  name: string
) {
  await context.addCookies([
    { name: EMPLOYEE_COOKIE, value: signPayload({ name }), url: baseURL },
  ]);
}

// 콘솔 에러 / 미처리 예외를 수집 — 하이드레이션·런타임 회귀를 브라우저 레벨에서 감지.
//   dev 모드의 리소스 404 등 잡음은 제외하고 React 경고/하이드레이션만 실패로 본다.
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    if (/hydrat|Minified React|Warning:/i.test(t)) errors.push("console: " + t);
  });
  return errors;
}
