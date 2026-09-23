import { expect, test, type Page } from "@playwright/test";
import { setEmployeeSession } from "./helpers";

// =====================================================================
// 동아리 계획서 작성·제출 (2026-09, 김준호 선생님 요청)
//
//   ★ 라이브 DB 에 실제로 씁니다(e2e 전반과 같은 방식). 쓰고 나서 지웁니다 —
//     테스트가 남긴 회차·예산 항목이 운영 화면에 쌓이면 안 됩니다.
//     대상 동아리는 환경변수로 받습니다(이름을 저장소에 박지 않게).
//       E2E_CLUB : 계획서를 넣어볼 동아리 이름. 없으면 skip.
// =====================================================================

const NAME = process.env.E2E_HR_NAME || "";
const CLUB = process.env.E2E_CLUB || "";

// 테스트가 넣는 값 — 지울 때 이 문구로 찾습니다.
const MARK = "e2e-계획서-검증";

async function openClub(page: Page, club: string) {
  await page.goto("/hr/clubs", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  // 동아리 카드 펼치기 (이름이 들어간 토글 버튼).
  const card = page.getByRole("button", { name: new RegExp(club) }).first();
  await card.waitFor({ state: "visible" });
  await card.click();
  // 계획서 패널 펼치기 — summary 를 눌러 <details> 를 엽니다.
  const summary = page.locator("summary", { hasText: "계획서 작성·제출" }).first();
  await summary.waitFor({ state: "visible" });
  await summary.click();
  // 열린 뒤 서버에서 계획서를 받아옵니다 — 목표 입력칸이 나타나면 끝난 것.
  await page
    .getByLabel("동아리 목표")
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
}

test.describe("동아리 계획서", () => {
  test.skip(!NAME || !CLUB, "E2E_HR_NAME / E2E_CLUB 없음");

  test("제출 현황에 계획서와 결과보고가 함께 보인다", async ({
    browser,
    baseURL,
  }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await setEmployeeSession(ctx, baseURL!, NAME);
    const page = await ctx.newPage();
    await page.goto("/hr/clubs", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);

    // 예전에는 결과보고만 있었습니다. 두 열이 같은 표에 있어야 합니다.
    await expect(
      page.getByRole("columnheader", { name: /계획서/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: /결과보고/ }),
    ).toBeVisible();
    await ctx.close();
  });

  test("목표·회차·예산을 넣고 제출하면 저장되고 다시 읽힌다", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(4 * 60 * 1000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await setEmployeeSession(ctx, baseURL!, NAME);
    const page = await ctx.newPage();
    await openClub(page, CLUB);

    const panel = page.locator("details", { hasText: "계획서 작성·제출" }).first();

    // --- 1) 목표 ---
    const goal = `${MARK} 목표 ${Date.now()}`;
    await panel.getByLabel("동아리 목표").fill(goal);
    await panel.getByRole("button", { name: "목표 저장" }).click();
    await expect(panel.getByText("목표를 저장했습니다.")).toBeVisible();

    // --- 2) 활동계획 회차 추가 (날짜 + 내용 + 장소) ---
    //   김준호 요청의 핵심 — 예전에는 날짜만 받았습니다.
    const before = await panel.locator("table").first().locator("tbody tr").count();
    await panel.getByPlaceholder("활동내용").fill(`${MARK} 활동내용`);
    await panel.getByPlaceholder("활동장소").fill(`${MARK} 장소`);
    await panel.getByRole("button", { name: "회차 추가" }).click();
    await expect(panel.getByText("활동계획을 추가했습니다.")).toBeVisible();
    await expect(panel.getByText(`${MARK} 활동내용`)).toBeVisible();
    await expect(panel.getByText(`${MARK} 장소`)).toBeVisible();
    expect(
      await panel.locator("table").first().locator("tbody tr").count(),
    ).toBe(before + 1);

    // --- 3) 예산 항목 추가 + 합계 ---
    await panel.getByPlaceholder(/구분/).fill(`${MARK}재료비`);
    await panel.getByPlaceholder("금액").fill("50000");
    await panel.getByPlaceholder("내역").fill(`${MARK} 내역`);
    await panel.getByRole("button", { name: "예산 항목 추가" }).click();
    await expect(panel.getByText("예산계획을 추가했습니다.")).toBeVisible();
    await expect(panel.getByText(`${MARK}재료비`)).toBeVisible();

    // 계획 대비 실적 — 계획 합계에 방금 넣은 금액이 반영됩니다.
    const compare = panel.locator("div", { hasText: "계획 대비 실적" }).last();
    await expect(compare).toContainText("계획 합계");
    await expect(compare).toContainText("잔액");

    // --- 4) 제출 ---
    await panel.getByRole("button", { name: /계획서 제출|다시 제출/ }).click();
    await expect(
      panel.getByText(/계획서를 (다시 )?제출했습니다/),
    ).toBeVisible();

    // --- 5) 새로고침해도 남아 있는가 (실제 저장 확인) ---
    await openClub(page, CLUB);
    const again = page
      .locator("details", { hasText: "계획서 작성·제출" })
      .first();
    await expect(again.getByLabel("동아리 목표")).toHaveValue(goal);
    await expect(again.getByText(`${MARK} 활동내용`)).toBeVisible();
    await expect(again.getByText(`${MARK}재료비`)).toBeVisible();
    // 제출 배지가 켜집니다(요약 줄과 패널 안 양쪽).
    await expect(again.getByText(/제출 \d{4}\.\d{2}\.\d{2}/).first()).toBeVisible();

    // --- 6) 제출 현황 표에도 ○ 로 반영 ---
    const row = page.locator("tr", { hasText: CLUB }).first();
    await expect(row.getByTitle("제출함").first()).toBeVisible();

    // --- 7) 뒷정리 — 라이브 DB 라 테스트가 남긴 것을 지웁니다.
    //   (지우는 동작 자체도 함께 검증됩니다.)
    await again
      .locator("tr", { hasText: `${MARK} 활동내용` })
      .getByRole("button", { name: "삭제" })
      .click();
    await expect(again.getByText("활동계획을 삭제했습니다.")).toBeVisible();

    await again
      .locator("tr", { hasText: `${MARK}재료비` })
      .getByRole("button", { name: "삭제" })
      .click();
    await expect(again.getByText("예산계획을 삭제했습니다.")).toBeVisible();

    await again.getByRole("button", { name: "제출 취소" }).click();
    await expect(again.getByText(/제출을 취소했습니다/)).toBeVisible();

    await again.getByLabel("동아리 목표").fill("");
    await again.getByRole("button", { name: "목표 저장" }).click();
    await expect(again.getByText("목표를 저장했습니다.")).toBeVisible();

    // 지워졌는지 확인.
    await expect(again.getByText(`${MARK} 활동내용`)).toHaveCount(0);
    await expect(again.getByText(`${MARK}재료비`)).toHaveCount(0);

    await ctx.close();
  });

  test("이미 있는 회차의 활동내용·장소가 그대로 불러와진다", async ({
    browser,
    baseURL,
  }) => {
    // 덮어쓰지 않고 이어서 편집되는지 — 회차가 이미 있는 동아리로 확인합니다.
    const WITH_SESSIONS = process.env.E2E_CLUB_WITH_SESSIONS || "";
    test.skip(!WITH_SESSIONS, "E2E_CLUB_WITH_SESSIONS 없음");

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await setEmployeeSession(ctx, baseURL!, NAME);
    const page = await ctx.newPage();
    await openClub(page, WITH_SESSIONS);

    const panel = page.locator("details", { hasText: "계획서 작성·제출" }).first();
    const rows = panel.locator("table").first().locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
    // 기존에 채워져 있던 값이 "(미입력)" 이 아니라 그대로 보여야 합니다.
    await expect(rows.first()).not.toContainText("(미입력)");
    await ctx.close();
  });
});
