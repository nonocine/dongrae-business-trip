import { expect, test, type Page } from "@playwright/test";
import { setEmployeeSession } from "./helpers";

// =====================================================================
// PC 좌측 사이드바 (4단계)
//
//   대상은 운영 DB 의 실제 직원이라 이름을 저장소에 박지 않고 환경변수로
//   받습니다(e2e/README.md). 없으면 skip.
//     E2E_HR_M0     : M0(관장·부장)      → 관리자 영역까지 보임
//     E2E_HR_RECORDS: hr 직무만          → 관리자 영역 없음
//     E2E_HR_NONE   : 직무 없는 일반 직원 → 공통·활동일지만
// =====================================================================

const M0 = process.env.E2E_HR_M0 || process.env.E2E_HR_NAME || "";
const RECORDS_ONLY = process.env.E2E_HR_RECORDS || "";
const NO_ROLE = process.env.E2E_HR_NONE || "";

const SIDEBAR = "aside[aria-label='업무 메뉴']";

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
}

// 접힌 그룹까지 펼쳐 전체 항목을 봅니다.
async function allItems(page: Page): Promise<string[]> {
  await page.evaluate((sel) => {
    document
      .querySelectorAll(`${sel} button[aria-expanded='false']`)
      .forEach((b) => (b as HTMLElement).click());
  }, SIDEBAR);
  await page.waitForTimeout(200);
  return page
    .locator(`${SIDEBAR} a, ${SIDEBAR} span.cursor-not-allowed`)
    .allTextContents();
}

test.describe("PC 좌측 사이드바", () => {
  test.skip(!M0, "E2E_HR_M0 없음");

  test("1280px 에서 보이고, 현재 위치를 하이라이트한다", async ({
    browser,
    baseURL,
  }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await setEmployeeSession(ctx, baseURL!, M0);
    const page = await ctx.newPage();

    // 경로별로 켜져야 하는 항목. 쿼리가 갈리는 /hr 도 포함합니다.
    const cases: [string, RegExp][] = [
      ["/mail", /공용 메일함/],
      ["/hr?tab=records", /직원 인사관리|전 직원 인사관리/],
      ["/hr?tab=recruitment", /채용 관리/],
      ["/hr", /직원 인사관리|전 직원 인사관리/], // tab 없으면 records 로 열림
      ["/hr/facility/assets", /비품관리/],
      ["/hr/facility/safety", /안전점검/],
      ["/hr/salary", /급여 기준 관리/],
      ["/hr/trainings", /의무교육 현황/],
      ["/hr/certificates", /증명서 발급대장/],
      ["/hr/clubs", /동아리관리/],
      ["/hr/partners", /거래처관리/],
      ["/business-results", /사업실적/],
      ["/profile/hr", /내 인사기록카드/],
      ["/activities", /활동일지/],
    ];

    for (const [path, want] of cases) {
      await open(page, path);
      await expect(page.locator(SIDEBAR)).toBeVisible();
      // 하이라이트는 정확히 하나여야 합니다 — 같은 경로를 가리키는 항목이
      //   여럿이라도(예: /hr?tab=records) 가장 구체적인 하나만 켭니다.
      const active = page.locator(`${SIDEBAR} [aria-current='page']`);
      await expect(active).toHaveCount(1);
      await expect(active).toHaveText(want);
    }
    await ctx.close();
  });

  test("클릭하면 본문만 바뀐다(전체 새로고침 없음)", async ({
    browser,
    baseURL,
  }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await setEmployeeSession(ctx, baseURL!, M0);
    const page = await ctx.newPage();
    await open(page, "/mail");

    // 전체 새로고침이면 사라지는 표식.
    await page.evaluate(() => {
      (window as unknown as { __alive: string }).__alive = "yes";
    });

    const aside = page.locator(SIDEBAR);
    await aside.getByRole("button", { name: /시설관리/ }).click();
    await aside.getByRole("link", { name: /안전점검/ }).click();
    await page.waitForURL("**/hr/facility/safety");
    await page.waitForTimeout(800);

    expect(
      await page.evaluate(
        () => (window as unknown as { __alive?: string }).__alive,
      ),
    ).toBe("yes");
    await expect(aside.locator("[aria-current='page']")).toHaveText(/안전점검/);
    await ctx.close();
  });

  test("md 경계에서 갈린다 — 767 숨김 / 768 보임, 되돌려도 깨지지 않는다", async ({
    browser,
    baseURL,
  }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await setEmployeeSession(ctx, baseURL!, M0);
    const page = await ctx.newPage();
    await open(page, "/hr?tab=records");

    const noOverflow = () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );

    await expect(page.locator(SIDEBAR)).toBeVisible();
    expect(await noOverflow()).toBe(true);

    for (const [w, visible] of [
      [767, false],
      [768, true],
      [375, false],
      [1280, true],
    ] as [number, boolean][]) {
      await page.setViewportSize({ width: w, height: 812 });
      await page.waitForTimeout(400);
      if (visible) await expect(page.locator(SIDEBAR)).toBeVisible();
      else await expect(page.locator(SIDEBAR)).toBeHidden();
      expect(await noOverflow(), `가로 넘침 @${w}px`).toBe(true);
    }
    await ctx.close();
  });

  test("폰(375)에서는 사이드바 대신 기존 햄버거가 남는다", async ({
    browser,
    baseURL,
  }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await setEmployeeSession(ctx, baseURL!, M0);
    const page = await ctx.newPage();
    await open(page, "/");
    await expect(page.locator(SIDEBAR)).toBeHidden();
    await expect(
      page.getByRole("button", { name: "메뉴 열기" }),
    ).toBeVisible();
    await ctx.close();
  });

  test("비로그인 랜딩에는 사이드바도 헤더도 없다", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await open(page, "/");
    await expect(page.locator(SIDEBAR)).toHaveCount(0);
    await expect(page.locator("body > header")).toHaveCount(0);
    await ctx.close();
  });

  test("권한별로 menu.ts 조건대로 나온다", async ({ browser, baseURL }) => {
    const read = async (who: string) => {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      await setEmployeeSession(ctx, baseURL!, who);
      const page = await ctx.newPage();
      await open(page, "/");
      const items = (await allItems(page)).join(" ");
      const groups = await page
        .locator(`${SIDEBAR} button[aria-expanded]`)
        .allTextContents();
      await ctx.close();
      return { items, groups: groups.map((g) => g.replace("▶", "").trim()) };
    };

    // M0 — 관리자 영역이 있고 권한·직무 지정까지 보입니다.
    const m0 = await read(M0);
    expect(m0.groups).toContain("관리자 영역");
    expect(m0.items).toContain("권한·직무 지정");

    // hr 직무만 — 관리자 영역은 없고 인사 항목은 있습니다.
    if (RECORDS_ONLY) {
      const r = await read(RECORDS_ONLY);
      expect(r.groups).not.toContain("관리자 영역");
      expect(r.groups).toContain("인사");
      expect(r.items).toContain("직원 인사관리");
      // 채용은 직무가 없으면 보이면 안 됩니다(가드도 막습니다).
      expect(r.groups).not.toContain("채용");
    }

    // 직무 없음 — 공통과 레거시만.
    if (NO_ROLE) {
      const n = await read(NO_ROLE);
      expect(n.groups).toContain("공통");
      expect(n.groups).not.toContain("관리자 영역");
      expect(n.groups).not.toContain("인사");
      expect(n.groups).not.toContain("시설관리");
      expect(n.items).not.toContain("직원 인사관리");
    }
  });
});
