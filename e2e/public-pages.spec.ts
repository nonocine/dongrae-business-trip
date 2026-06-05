import { test, expect, type Page } from "@playwright/test";

// 콘솔 에러 / 미처리 예외를 수집 — 하이드레이션·런타임 회귀(특히 lint 리팩터로
// 손댄 클라이언트 컴포넌트)를 브라우저 레벨에서 잡기 위함.
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    // dev 모드 리소스 404 등 잡음은 제외하고 React 경고/하이드레이션만 실패 처리.
    if (/hydrat|Minified React|Warning:/i.test(t)) errors.push("console: " + t);
  });
  return errors;
}

const SLUG = process.env.E2E_SLUG ?? "2026-1";

test.describe("공개 채용 페이지 (무인증)", () => {
  test("공고 상세가 렌더되고 런타임 에러가 없다", async ({ page }) => {
    const errors = collectErrors(page);
    const res = await page.goto(`/recruitment/${SLUG}`);
    expect(res?.status() ?? 0).toBeLessThan(400);
    await expect(page.locator("body")).toContainText("직원채용");
    await page.waitForTimeout(800); // 하이드레이션 여유(dev HMR로 networkidle 불가)
    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("지원 페이지(ApplyForm)가 에러 없이 마운트된다", async ({ page }) => {
    const errors = collectErrors(page);
    const res = await page.goto(`/recruitment/${SLUG}/apply`);
    expect(res?.status() ?? 0).toBeLessThan(400);
    await page.waitForTimeout(800); // 하이드레이션 여유(dev HMR로 networkidle 불가)
    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("면접 채점 진입(InterviewFlow)이 에러 없이 마운트된다", async ({ page }) => {
    const errors = collectErrors(page);
    const res = await page.goto(`/recruitment/${SLUG}/interview`);
    expect(res?.status() ?? 0).toBeLessThan(400);
    await expect(page.locator("body")).toContainText("면접");
    // intro 단계 — 심사위원 이름 입력칸이 보여야 한다.
    await expect(page.locator('input[placeholder="홍길동"]')).toBeVisible();
    await page.waitForTimeout(800); // 하이드레이션 여유(dev HMR로 networkidle 불가)
    expect(errors, errors.join("\n")).toHaveLength(0);
  });
});
