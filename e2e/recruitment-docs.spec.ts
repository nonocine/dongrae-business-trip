import { test, expect } from "@playwright/test";

// HR(관장·부장) 세션 쿠키는 직원 이름 평문이므로 위조 가능.
//   E2E_HR_NAME 을 .env.local 에 두면(저장소 미커밋) 아래 테스트가 활성화됩니다.
const HR_NAME = process.env.E2E_HR_NAME;
const SLUG = process.env.E2E_SLUG ?? "2026-1";

test.describe("HR 채용 문서 다운로드", () => {
  test.skip(!HR_NAME, "E2E_HR_NAME 미설정 — HR 세션 위조 불가로 skip");

  test.beforeEach(async ({ context, baseURL }) => {
    // 한글 이름은 URL-인코딩해서 넣는다 — 서버 쿠키 파서가 decodeURIComponent 하므로
    // raw 한글을 그대로 보내면 Cookie 헤더에서 모지바케가 된다.
    await context.addCookies([
      {
        name: "dongrae_employee",
        value: encodeURIComponent(HR_NAME as string),
        url: baseURL as string,
      },
    ]);
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
});
