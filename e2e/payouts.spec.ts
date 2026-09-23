import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { setEmployeeSession } from "./helpers";

// =====================================================================
// 강사비 지출표 (/hr/payouts) — 회계 전용 화면.
//
//   계좌번호와 지급 금액이 나오는 화면이라 "누가 못 들어오는가" 를 먼저
//   봅니다. 가드는 급여 모듈과 같은 resolveSalaryAccess(M0 또는 accounting).
//   강사관리를 여는 f44f0ef 의 '열람' 권한으로는 들어올 수 없어야 합니다.
//
//   운영 DB 의 실제 직원이라 이름은 환경변수로 받습니다(없으면 skip).
//     E2E_ACCT       : accounting 직무 또는 M0  → 통과
//     E2E_ACCT_DENY  : 회계가 아닌 직원          → "/" 로 차단
// =====================================================================

const ACCT = process.env.E2E_ACCT || process.env.E2E_HR_NAME || "";
const DENY = process.env.E2E_ACCT_DENY || "";

async function as(browser: Browser, baseURL: string, who: string) {
  const ctx: BrowserContext = await browser.newContext();
  await setEmployeeSession(ctx, baseURL, who);
  return ctx;
}

test.describe("강사비 지출표", () => {
  test("회계 담당은 들어와서 재원별·사람별을 모두 본다", async ({
    browser,
    baseURL,
  }) => {
    test.skip(!ACCT, "E2E_ACCT 없음");
    const ctx = await as(browser, baseURL!, ACCT);
    const page = await ctx.newPage();
    await page.goto("/hr/payouts");
    await page.waitForLoadState("domcontentloaded");

    await expect(page).toHaveURL(/\/hr\/payouts$/);
    await expect(
      page.getByRole("heading", { name: "강사비 지출표" })
    ).toBeVisible();

    // 기본은 이번 달 — 해당 정산이 없을 수 있으므로 전체 기간으로 넓힌다.
    await page.getByRole("button", { name: "전체 기간" }).click();
    await expect(page.getByText("실지급액").first()).toBeVisible();

    // 재원별(기본) → 사람별 전환이 되고, 사람별에서 재원 내역이 펼쳐진다.
    await expect(
      page.getByRole("heading", { name: "재원별 지출 내역" })
    ).toBeVisible();
    await page.getByRole("button", { name: "사람별 보기" }).click();
    await expect(
      page.getByRole("heading", { name: "사람별 지출 내역" })
    ).toBeVisible();
    // 여러 재원에 걸친 사람이 있으면 배지로 표시된다(실측 5명).
    await expect(page.getByText(/재원 \d+$/).first()).toBeVisible();
    await ctx.close();
  });

  test("지급 전 확인 필요 목록이 표 위에 먼저 나온다", async ({
    browser,
    baseURL,
  }) => {
    test.skip(!ACCT, "E2E_ACCT 없음");
    const ctx = await as(browser, baseURL!, ACCT);
    const page = await ctx.newPage();
    await page.goto("/hr/payouts");
    await page.getByRole("button", { name: "전체 기간" }).click();

    const warn = page.getByRole("heading", { name: /지급 전 확인 필요 \d+건/ });
    await expect(warn).toBeVisible();
    // 경고 구역이 결과 표보다 위에 있어야 한다 — 이체하다 막히기 전에 본다.
    const warnBox = await warn.boundingBox();
    const tableBox = await page
      .getByRole("heading", { name: /지출 내역$/ })
      .boundingBox();
    expect(warnBox!.y).toBeLessThan(tableBox!.y);
    await ctx.close();
  });

  test("엑셀이 내려받아지고 파일명이 조건을 담는다", async ({
    browser,
    baseURL,
  }) => {
    test.skip(!ACCT, "E2E_ACCT 없음");
    const ctx = await as(browser, baseURL!, ACCT);
    const page = await ctx.newPage();
    await page.goto("/hr/payouts");
    await page.getByRole("button", { name: "전체 기간" }).click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "엑셀 내려받기" }).click(),
    ]);
    const name = download.suggestedFilename();
    expect(name).toMatch(/^강사비지출표_재원별_.*\.xlsx$/);
    await ctx.close();
  });

  test("회계가 아닌 직원은 화면도 엑셀도 막힌다", async ({ browser, baseURL }) => {
    test.skip(!DENY, "E2E_ACCT_DENY 없음");
    const ctx = await as(browser, baseURL!, DENY);
    const page = await ctx.newPage();

    await page.goto("/hr/payouts");
    await page.waitForLoadState("domcontentloaded");
    await expect(page).not.toHaveURL(/\/hr\/payouts/);

    // 라우트는 레이아웃 가드 밖이라 따로 확인한다.
    const res = await page.request.get("/hr/payouts/export");
    expect(res.status()).toBe(403);
    await ctx.close();
  });
});
