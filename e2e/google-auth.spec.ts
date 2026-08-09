import { test, expect } from "@playwright/test";
import { setGoogleSession } from "./helpers";

// Google Workspace 로그인 게이트 회귀 — 실제 구글 로그인 없이, 콜백이 발급하는 것과
// 동일한 "서명된" 세션 쿠키를 심어 HR 접근 허용/거부를 검증한다.
//   * SEC-3a 이후 무서명 쿠키는 서버가 거부하므로 반드시 signPayload 로 서명한다.
//   * onnainna.kr 도메인만 통과(parseGoogleSession 의 도메인 재검증).
//   * requireHrAdmin 은 rank ∈ (관장·부장) 또는 master 만 통과시키므로
//     허용 케이스는 rank 를 관장으로 준다.

const SLUG = process.env.E2E_SLUG ?? "2026-1";

test.describe("Google Workspace 로그인 게이트", () => {
  test("onnainna.kr 세션은 HR 영역에 접근할 수 있다", async ({
    context,
    page,
    baseURL,
  }) => {
    await setGoogleSession(context, baseURL as string, {
      email: "tester@onnainna.kr",
      rank: "관장",
    });
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
    await setGoogleSession(context, baseURL as string, {
      email: "outsider@gmail.com",
      rank: "관장",
    });
    await page.goto("/hr");
    await expect(page).toHaveURL(`${baseURL}/`); // requireHrAdmin → '/'
  });

  test("서명 없는 위조 쿠키는 거부된다 (SEC-3a 회귀)", async ({
    context,
    page,
    baseURL,
  }) => {
    // 서명 도입 전 방식 그대로 — 평문 JSON 을 심으면 미인증으로 떨어져야 한다.
    await context.addCookies([
      {
        name: "dongrae_google_session",
        value: encodeURIComponent(
          JSON.stringify({
            email: "tester@onnainna.kr",
            name: "위조",
            driverId: null,
            driverName: null,
            rank: "관장",
            hasProfile: false,
            isMaster: true,
          })
        ),
        url: baseURL as string,
      },
    ]);
    await page.goto("/hr");
    await expect(page).toHaveURL(`${baseURL}/`);
  });
});
