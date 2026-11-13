import { expect, test } from "@playwright/test";
import { collectErrors, setEmployeeSession } from "./helpers";

// =====================================================================
// 주소에 남는 탭(app/components/UrlTabs) — 시범 화면: 시설관리 › 대관예약.
//   ① ?tab= 로 들어오면 그 탭이 열린다(새로 고침 포함)
//   ② 탭을 누르면 주소가 바뀌고, 뒤로가기로 이전 탭에 돌아간다
//   ③ 옛 # 앵커(#summary)로 들어와도 해당 탭이 열린다
//   ④ 서버 탭(시설 ?facility=)도 주소에 남고, 화면 탭(?tab=)을 지우지 않는다
//   ⚠️ 조회 화면만 봅니다 — '지금 동기화' 버튼은 누르지 않습니다.
// =====================================================================

const WHO = process.env.E2E_HR_M0 || process.env.E2E_HR_NAME || "";
const PATH = "/hr/facility/rentals";

test.describe("주소에 남는 탭 — 대관예약", () => {
  test("탭 선택이 주소·새로 고침·뒤로가기·# 앵커와 맞물린다", async ({ browser, baseURL }) => {
    test.skip(!WHO, "E2E_HR_NAME 없음");
    const ctx = await browser.newContext();
    await setEmployeeSession(ctx, baseURL!, WHO);
    const page = await ctx.newPage();
    const errors = collectErrors(page);

    const tab = (name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });

    // 기본 = 예약 목록, 주소에 tab 없음
    await page.goto(PATH);
    await expect(tab("예약 목록")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#rental-panel-list")).toBeVisible();
    expect(page.url()).not.toContain("tab=");

    // ② 요약 탭 클릭 → ?tab=summary, 내용 전환
    await tab("월 요약").click();
    await expect(page).toHaveURL(/[?&]tab=summary/);
    await expect(page.locator("#rental-panel-summary")).toBeVisible();
    await expect(page.locator("#rental-panel-list")).toBeHidden();

    // ② 뒤로가기(같은 문서 안) → 목록, 다시 요약 클릭 → 요약
    await page.goBack();
    await expect(tab("예약 목록")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#rental-panel-list")).toBeVisible();
    await tab("월 요약").click();
    await expect(page).toHaveURL(/[?&]tab=summary/);
    await expect(page.locator("#rental-panel-summary")).toBeVisible();

    // ① 새로 고침해도 요약
    await page.reload();
    await expect(tab("월 요약")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#rental-panel-summary")).toBeVisible();

    // ② 새로 고침을 건너는 뒤로가기 → 목록.
    //   ⚠️ next dev 에서는 Next 자체가 복원 직후 주소를 ?tab=summary 로 되돌려 써서
    //     실패합니다(2026-11 실측, 운영 빌드 next start 에서는 정상). 그래서 운영 빌드로
    //     돌릴 때만 봅니다: E2E_PROD_SERVER=1 + next start 를 먼저 띄워 두기.
    if (process.env.E2E_PROD_SERVER) {
      await page.goBack();
      await expect(page).not.toHaveURL(/tab=summary/);
      await expect(tab("예약 목록")).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("#rental-panel-list")).toBeVisible();
      // 뒤로간 뒤 다시 누르기
      await tab("월 요약").click();
      await expect(tab("월 요약")).toHaveAttribute("aria-selected", "true");
      await expect(page).toHaveURL(/[?&]tab=summary/);
    }

    // ③ 옛 # 앵커
    await page.goto(`${PATH}#summary`);
    await expect(tab("월 요약")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/tab=summary/);

    // ④ 서버 탭(시설) — ?facility=onna 로 바뀌고 ?tab=summary 유지
    await page.getByRole("tab", { name: "온나", exact: true }).click();
    await expect(page).toHaveURL(/facility=onna/);
    await expect(page).toHaveURL(/tab=summary/);
    await expect(page.getByRole("tab", { name: "온나", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // 엉뚱한 탭 키는 기본 탭으로
    await page.goto(`${PATH}?tab=nope`);
    await expect(tab("예약 목록")).toHaveAttribute("aria-selected", "true");

    expect(errors).toEqual([]);
    await ctx.close();
  });
});
