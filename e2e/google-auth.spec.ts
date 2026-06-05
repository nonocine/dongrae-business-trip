import { test, expect, type BrowserContext } from "@playwright/test";

// Google Workspace 로그인 게이트 회귀 — 실제 구글 로그인 없이 세션 쿠키를 위조해
// (콜백이 발급하는 것과 동일 형태) HR 접근 허용/거부를 검증한다.
//   * 서버가 쿠키 값을 decodeURIComponent 하므로 encodeURIComponent 로 넣는다.
//   * onnainna.kr 도메인만 통과(parseGoogleSession 의 이중 도메인 검증).

const SLUG = process.env.E2E_SLUG ?? "2026-1";

async function setGoogleCookie(
  context: BrowserContext,
  baseURL: string,
  email: string
) {
  const value = encodeURIComponent(
    JSON.stringify({
      email,
      name: "테스트직원",
      driverId: null,
      driverName: null,
      rank: null,
      hasProfile: false,
    })
  );
  await context.addCookies([
    { name: "dongrae_google_session", value, url: baseURL },
  ]);
}

test.describe("Google Workspace 로그인 게이트", () => {
  test("onnainna.kr 세션은 HR 영역에 접근할 수 있다", async ({
    context,
    page,
    baseURL,
  }) => {
    await setGoogleCookie(context, baseURL as string, "tester@onnainna.kr");
    await page.goto("/hr");
    await expect(page).toHaveURL(/\/hr$/); // '/' 로 리다이렉트되지 않음
    await expect(page.locator("body")).toContainText("인사 관리");

    await page.goto(`/hr/recruitment/${SLUG}`);
    await expect(page.locator("body")).toContainText("채용 심사");
  });

  test("비-onnainna 도메인 세션은 거부되어 홈으로 리다이렉트된다", async ({
    context,
    page,
    baseURL,
  }) => {
    await setGoogleCookie(context, baseURL as string, "outsider@gmail.com");
    await page.goto("/hr");
    await expect(page).toHaveURL(`${baseURL}/`); // requireHrAdmin → '/'
  });
});
