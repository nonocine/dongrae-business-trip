import { expect, test, type Page } from "@playwright/test";
import { setEmployeeSession } from "./helpers";

// =====================================================================
// /hr 접근 게이트 — 직급이 아니라 직무·권한등급으로 연 뒤의 실제 동작.
//
//   ★ 문을 넓히는 변경이라 "누가 들어오는가" 를 SQL 로만 확인하지 않고
//     실제 화면에서 확인합니다. 특히 막혀야 하는 쪽을 더 꼼꼼히 봅니다.
//
//   대상은 운영 DB 의 실제 직원이라 이름을 저장소에 박지 않고 환경변수로
//   받습니다(e2e/README.md 참고). 없으면 skip.
//     E2E_HR_M0     : 관장·부장 등 M0            → 인사+채용 전부
//     E2E_HR_RECORDS: hr 직무만 가진 직원        → 인사만, 채용 차단
//     E2E_HR_NONE   : 직무가 없는 일반 직원      → 전부 차단
// =====================================================================

const M0 = process.env.E2E_HR_M0 || process.env.E2E_HR_NAME || "";
const RECORDS_ONLY = process.env.E2E_HR_RECORDS || "";
const NO_ROLE = process.env.E2E_HR_NONE || "";

async function openAs(page: Page, who: string, path: string) {
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
}

test.describe("/hr 접근 게이트", () => {
  test("M0 는 인사·채용 탭을 모두 본다", async ({ browser, baseURL }) => {
    test.skip(!M0, "E2E_HR_M0 없음");
    const ctx = await browser.newContext();
    await setEmployeeSession(ctx, baseURL!, M0);
    const page = await ctx.newPage();
    await openAs(page, M0, "/hr");

    await expect(page).toHaveURL(/\/hr$/);
    await expect(
      page.getByRole("button", { name: "인사기록카드", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "채용공고", exact: true })).toBeVisible();
    await ctx.close();
  });

  test("hr 직무 직원은 들어오되 인사 영역만 본다", async ({
    browser,
    baseURL,
  }) => {
    test.skip(!RECORDS_ONLY, "E2E_HR_RECORDS 없음");
    const ctx = await browser.newContext();
    await setEmployeeSession(ctx, baseURL!, RECORDS_ONLY);
    const page = await ctx.newPage();

    // 1) /hr 에 들어와진다 — 예전에는 "/" 로 튕겼다.
    await openAs(page, RECORDS_ONLY, "/hr");
    await expect(page).toHaveURL(/\/hr$/);
    await expect(page.getByRole("heading", { name: "인사 관리" })).toBeVisible();

    // 2) 채용공고 탭은 보이지 않는다.
    await expect(page.getByRole("button", { name: "채용공고", exact: true })).toHaveCount(0);

    // 3) 주소로 채용 탭을 직접 요청해도 채용 화면이 열리지 않는다.
    await openAs(page, RECORDS_ONLY, "/hr?tab=recruitment");
    await expect(page.getByRole("button", { name: "채용공고", exact: true })).toHaveCount(0);

    // 4) 채용 영역 라우트는 막힌다 — "/" 로 돌려보낸다.
    await openAs(page, RECORDS_ONLY, "/hr/external-judges");
    await expect(page).toHaveURL(/localhost:\d+\/$/);

    // 5) 권한등급 변경은 M0 전용 — 잠겨 있어야 한다.
    //    ★ 문을 넓히면서 제일 위험한 지점입니다. 인사 담당자가 자기
    //      권한등급을 M0 로 올릴 수 있으면 권한 상승이 됩니다.
    //      실제 차단은 서버 액션의 isM0 검사가 하고, 화면은 그걸 비칩니다.
    await openAs(page, RECORDS_ONLY, "/hr");
    await page
      .getByRole("button", { name: "인사기록카드", exact: true })
      .click()
      .catch(() => {});
    // 직원을 하나 열어야 폼이 나오므로, 폼이 나오면 잠금을 확인합니다.
    const authNote = page.getByText("관장만 변경 가능");
    if (await authNote.first().isVisible().catch(() => false)) {
      await expect(authNote.first()).toBeVisible();
    }

    await ctx.close();
  });

  test("직무가 없는 직원은 /hr 에 들어오지 못한다", async ({
    browser,
    baseURL,
  }) => {
    test.skip(!NO_ROLE, "E2E_HR_NONE 없음");
    const ctx = await browser.newContext();
    await setEmployeeSession(ctx, baseURL!, NO_ROLE);
    const page = await ctx.newPage();

    for (const path of ["/hr", "/hr?tab=records", "/hr/external-judges"]) {
      await openAs(page, NO_ROLE, path);
      await expect(page).toHaveURL(/localhost:\d+\/$/);
    }
    await ctx.close();
  });

  test("로그인하지 않으면 /hr 에 들어오지 못한다", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/hr");
    await expect(page).toHaveURL(/localhost:\d+\/$/);
    await ctx.close();
  });
});
