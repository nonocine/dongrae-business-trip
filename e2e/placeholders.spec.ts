import { expect, test } from "@playwright/test";
import { setEmployeeSession } from "./helpers";

// =====================================================================
// 낡은 자리표시자 회귀 방지.
//
//   2026-09-23: /hr 의 계약서·증명서 탭이 "곧 제공될 예정입니다" 를 띄우고
//   있었습니다. 증명서는 이미 완성돼 발급까지 18건 되고 있었고, 근로계약서도
//   인사기록카드 첨부서류로 보관 중이었습니다. 그 한 줄 때문에 관장과 담당이
//   같은 기능을 세 번이나 "대기 중" 으로 착각했습니다.
//
//   그래서 문구가 아니라 **약속** 을 검사합니다 —
//     · 있는 기능 자리에 "곧 제공" 류 문구가 다시 나타나면 실패
//     · 각 안내가 실제로 갈 곳(링크)을 들고 있는지
//   준비 중인 것(온나 실적)은 준비 중이라고 적는 게 맞으므로, 그쪽은
//   "준비 중" 을 지우라고 하지 않고 **대안 경로가 함께 있는지** 만 봅니다.
//
//     E2E_HR_M0 : 인사 화면에 들어갈 수 있는 직원(관장·부장 등)
// =====================================================================

const M0 = process.env.E2E_HR_M0 || process.env.E2E_HR_NAME || "";
const STALE = /곧 제공|예정입니다|coming soon/i;

test.describe("낡은 자리표시자", () => {
  test("/hr 계약서 탭 — '곧 제공' 대신 보관 위치를 알려 준다", async ({
    browser,
    baseURL,
  }) => {
    test.skip(!M0, "E2E_HR_M0 없음");
    const ctx = await browser.newContext();
    await setEmployeeSession(ctx, baseURL!, M0);
    const page = await ctx.newPage();
    await page.goto("/hr?tab=contracts");
    await page.waitForLoadState("domcontentloaded");

    const panel = page.locator("section", { hasText: "계약서 전용 관리 화면" });
    await expect(panel).toBeVisible();
    await expect(panel).not.toHaveText(STALE);
    // 갈 곳이 있어야 안내입니다 — 없으면 그냥 자리표시자입니다.
    await expect(
      panel.getByRole("button", { name: "인사기록카드로 이동" }),
    ).toBeVisible();
    await expect(
      panel.getByRole("link", { name: /내 인사기록카드/ }),
    ).toHaveAttribute("href", "/profile/hr");
    await ctx.close();
  });

  test("/hr 증명서 탭 — 발급대장과 본인 신청 두 곳을 모두 가리킨다", async ({
    browser,
    baseURL,
  }) => {
    test.skip(!M0, "E2E_HR_M0 없음");
    const ctx = await browser.newContext();
    await setEmployeeSession(ctx, baseURL!, M0);
    const page = await ctx.newPage();
    await page.goto("/hr?tab=certificates");
    await page.waitForLoadState("domcontentloaded");

    const panel = page.locator("section", { hasText: "증명서 발급은 이미" });
    await expect(panel).toBeVisible();
    await expect(panel).not.toHaveText(STALE);
    // 관리자용 대장과 본인 신청은 다른 자리입니다. 둘 다 있어야 합니다.
    await expect(
      panel.getByRole("link", { name: "증명서 발급대장 열기" }),
    ).toHaveAttribute("href", "/hr/certificates");
    await expect(
      panel.getByRole("link", { name: "내 증명서 신청하기" }),
    ).toHaveAttribute("href", "/profile/hr#my-certificates");

    // 링크가 실제로 열리는지 — 죽은 안내를 만들지 않기 위해.
    await panel.getByRole("link", { name: "증명서 발급대장 열기" }).click();
    await expect(page).toHaveURL(/\/hr\/certificates$/);
    await ctx.close();
  });

  test("사업실적 온나 탭 — 준비 중은 맞되 볼 수 있는 곳을 함께 준다", async ({
    browser,
    baseURL,
  }) => {
    test.skip(!M0, "E2E_HR_M0 없음");
    const ctx = await browser.newContext();
    await setEmployeeSession(ctx, baseURL!, M0);
    const page = await ctx.newPage();
    await page.goto("/business-results");
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("button", { name: "온나", exact: true }).click();

    const panel = page.locator("section", { hasText: "온나 실적 집계 화면" });
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("link", { name: /대관예약에서 온나/ }),
    ).toHaveAttribute("href", "/hr/facility/rentals");
    await ctx.close();
  });
});
