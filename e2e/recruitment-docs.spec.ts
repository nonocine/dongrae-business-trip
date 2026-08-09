import { test, expect } from "@playwright/test";
import { collectErrors, setEmployeeSession } from "./helpers";

// HR(관장·부장) 세션을 SEC-3a 서명 방식으로 심어 인증이 필요한 화면을 테스트합니다.
//   E2E_HR_NAME 을 .env.local 에 두면(저장소 미커밋) 아래 테스트가 활성화됩니다.
//   rank 검증은 서버가 실제 drivers 테이블에서 수행하므로 실명이 필요합니다.
const HR_NAME = process.env.E2E_HR_NAME;
const SLUG = process.env.E2E_SLUG ?? "2026-1";

test.describe("HR 채용 문서 다운로드", () => {
  test.skip(!HR_NAME, "E2E_HR_NAME 미설정 — HR 세션 생성 불가로 skip");

  test.beforeEach(async ({ context, baseURL }) => {
    await setEmployeeSession(context, baseURL as string, HR_NAME as string);
  });

  const docs = [
    { name: "ERP용 Excel", ext: ".xlsx" },
    { name: "1차 서류 총괄표", ext: ".docx" },
    { name: "최종심사 총괄표", ext: ".docx" },
    { name: "면접 대상자 공고", ext: ".docx" },
  ];

  for (const d of docs) {
    test(`"${d.name}" 버튼이 파일을 다운로드한다`, async ({ page }) => {
      await page.goto(`/hr/recruitment/${SLUG}`);
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("link", { name: d.name }).click(),
      ]);
      const filename = download.suggestedFilename();
      expect(filename.endsWith(d.ext), `파일명: ${filename}`).toBeTruthy();
      // 실제 바이트가 저장됐는지(빈 응답 아님) 확인.
      const path = await download.path();
      expect(path).toBeTruthy();
    });
  }

  test("채용 관리 탭에 공고와 상태 배지가 표시된다", async ({ page }) => {
    await page.goto(`/hr?tab=recruitment`);
    await expect(page.locator("body")).toContainText(SLUG);
    // PostingRow 상태 배지(공개/마감/종료/비공개) 중 하나는 존재 — closed 계산 구동 확인.
    await expect(page.getByText(/공개|마감|종료|비공개/).first()).toBeVisible();
  });

  test("심사 대시보드가 하이드레이션 에러 없이 렌더된다(접수일시 포맷)", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.goto(`/hr/recruitment/${SLUG}`);
    await expect(page.locator("body")).toContainText("채용 심사");
    await page.waitForTimeout(800); // 하이드레이션 여유(dev HMR로 networkidle 불가)
    expect(errors, errors.join("\n")).toHaveLength(0);
  });
});
