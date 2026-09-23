import { expect, test, type Page } from "@playwright/test";
import { setEmployeeSession } from "./helpers";

// =====================================================================
// 업무 메뉴 — PC 좌측 사이드바(4단계) + 폰 드로어(5단계)
//
//   ★ 둘은 같은 트리(lib/menu.ts → lib/menuTree.ts)를 그립니다. 그래서 이
//     스펙의 핵심은 "권한별로 PC 와 폰에 보이는 항목이 완전히 같은가" 입니다.
//     하나라도 어긋나면 메뉴가 다시 두 곳에서 따로 사는 것입니다.
//
//   대상은 운영 DB 의 실제 직원이라 이름을 환경변수로 받습니다(없으면 skip).
//     E2E_HR_M0     : M0(관장·부장)      → 관리자 영역까지
//     E2E_HR_RECORDS: hr 직무만          → 관리자 영역 없음
//     E2E_HR_NONE   : 직무 없는 일반 직원 → 공통 + 이전 기능만
// =====================================================================

const M0 = process.env.E2E_HR_M0 || process.env.E2E_HR_NAME || "";
const RECORDS_ONLY = process.env.E2E_HR_RECORDS || "";
const NO_ROLE = process.env.E2E_HR_NONE || "";

const SIDEBAR = "aside[aria-label='업무 메뉴']";
const DRAWER = "[data-drawer='menu']";

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
}

// 접힌 그룹까지 펼쳐 전체 항목 라벨을 모읍니다(배지 숫자는 뗍니다).
async function itemsIn(page: Page, root: string): Promise<string[]> {
  await page.evaluate((sel) => {
    document
      .querySelectorAll(`${sel} button[aria-expanded='false']`)
      .forEach((b) => (b as HTMLElement).click());
  }, root);
  await page.waitForTimeout(200);
  const raw = await page
    .locator(`${root} a, ${root} span.cursor-not-allowed`)
    .allTextContents();
  return raw.map((t) => t.replace(/\d+\+?$/, "").trim()).filter(Boolean);
}

test.describe("업무 메뉴", () => {
  test.skip(!M0, "E2E_HR_M0 없음");

  test("1280px: 현재 위치 하이라이트 + 메인 상단 고정", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(3 * 60 * 1000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await setEmployeeSession(ctx, baseURL!, M0);
    const page = await ctx.newPage();

    const cases: [string, RegExp][] = [
      ["/", /메인/],
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
      ["/activities", /활동일지/], // 레거시(이전 기능 구역)도 잡혀야 합니다
    ];

    for (const [path, want] of cases) {
      await open(page, path);
      await expect(page.locator(SIDEBAR)).toBeVisible();
      const active = page.locator(`${SIDEBAR} [aria-current='page']`);
      await expect(active, `하이라이트 @${path}`).toHaveCount(1);
      await expect(active, `하이라이트 @${path}`).toHaveText(want);
    }

    // '메인' 은 맨 위 — 첫 링크여야 합니다.
    await open(page, "/mail");
    await expect(page.locator(`${SIDEBAR} a`).first()).toHaveText(/메인/);
    await ctx.close();
  });

  test("레거시는 '이전 기능' 으로 맨 아래에 있고 여전히 들어가진다", async ({
    browser,
    baseURL,
  }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await setEmployeeSession(ctx, baseURL!, M0);
    const page = await ctx.newPage();
    await open(page, "/mail");

    const aside = page.locator(SIDEBAR);
    await expect(aside.getByText("이전 기능")).toBeVisible();

    // 사이드바의 마지막 링크 두 개가 레거시여야 합니다(맨 아래).
    const labels = await aside.locator("a").allTextContents();
    expect(labels.slice(-2).map((t) => t.trim())).toEqual([
      "📒활동일지",
      "✍️활동 작성",
    ]);

    // 지운 것이 아니라 내린 것 — 눌러서 그대로 들어갑니다.
    await aside.getByRole("link", { name: /활동일지/ }).click();
    await page.waitForURL("**/activities");
    await expect(aside.locator("[aria-current='page']")).toHaveText(/활동일지/);
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

  test("md 경계에서 갈린다 — 767 숨김 / 768 보임, 되돌려도 안 깨진다", async ({
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

  test("폰 드로어: 열기 → 하이라이트 → 클릭하면 이동하고 닫힌다", async ({
    browser,
    baseURL,
  }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await setEmployeeSession(ctx, baseURL!, M0);
    const page = await ctx.newPage();
    await open(page, "/mail");

    // 폰에서는 사이드바가 없고 햄버거가 있습니다.
    await expect(page.locator(SIDEBAR)).toBeHidden();
    await page.getByRole("button", { name: "메뉴 열기" }).click();
    const drawer = page.locator(DRAWER);
    await expect(drawer).toBeVisible();

    // 지금 위치(/mail)가 드로어에서도 강조됩니다.
    await expect(drawer.locator("[aria-current='page']")).toHaveText(
      /공용 메일함/,
    );
    // 레거시는 '이전 기능' 으로 맨 아래.
    await expect(drawer.getByText("이전 기능")).toBeVisible();

    // 항목을 누르면 이동하고 드로어가 닫힙니다.
    await drawer.getByRole("link", { name: /동아리관리/ }).click();
    await page.waitForURL("**/hr/clubs");
    await expect(drawer).toBeHidden();
    await ctx.close();
  });

  test("권한 3종 — PC 사이드바와 폰 드로어 항목이 완전히 같다", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(3 * 60 * 1000);

    const read = async (who: string) => {
      const pc = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await setEmployeeSession(pc, baseURL!, who);
      const p1 = await pc.newPage();
      await open(p1, "/");
      const sidebar = await itemsIn(p1, SIDEBAR);
      const groups = (
        await p1.locator(`${SIDEBAR} button[aria-expanded]`).allTextContents()
      ).map((g) => g.replace("▶", "").trim());
      await pc.close();

      const mo = await browser.newContext({ viewport: { width: 375, height: 812 } });
      await setEmployeeSession(mo, baseURL!, who);
      const p2 = await mo.newPage();
      await open(p2, "/");
      await p2.getByRole("button", { name: "메뉴 열기" }).click();
      await p2.waitForTimeout(300);
      const drawer = await itemsIn(p2, DRAWER);
      await mo.close();

      return { sidebar, groups, drawer };
    };

    // M0 — 관리자 영역까지.
    const m0 = await read(M0);
    expect(m0.groups).toContain("관리자 영역");
    expect(m0.sidebar.join(" ")).toContain("권한·직무 지정");
    // ★ 핵심 — 폰 드로어는 사이드바와 같은 항목을 같은 순서로 보여야 합니다.
    //   드로어에는 하단 계정 메뉴(내 인사기록카드/비밀번호 변경/관리자
    //   대시보드)가 더 있으므로, 사이드바 항목이 드로어 앞부분과 일치하는지 봅니다.
    expect(m0.drawer.slice(0, m0.sidebar.length)).toEqual(m0.sidebar);

    if (RECORDS_ONLY) {
      const r = await read(RECORDS_ONLY);
      expect(r.groups).not.toContain("관리자 영역");
      expect(r.groups).toContain("인사");
      expect(r.groups).not.toContain("채용");
      expect(r.drawer.slice(0, r.sidebar.length)).toEqual(r.sidebar);
    }

    if (NO_ROLE) {
      const n = await read(NO_ROLE);
      expect(n.groups).toContain("공통");
      expect(n.groups).not.toContain("관리자 영역");
      expect(n.groups).not.toContain("인사");
      expect(n.groups).not.toContain("시설관리");
      expect(n.sidebar.join(" ")).not.toContain("직원 인사관리");
      // 레거시는 직무와 무관하게 누구나 — 맨 아래에 남아 있어야 합니다.
      expect(n.sidebar.join(" ")).toContain("활동일지");
      expect(n.drawer.slice(0, n.sidebar.length)).toEqual(n.sidebar);
    }
  });

  test("비로그인 랜딩에는 사이드바도 헤더도 없다", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await open(page, "/");
    await expect(page.locator(SIDEBAR)).toHaveCount(0);
    await expect(page.locator("body > header")).toHaveCount(0);
    await ctx.close();
  });
});
