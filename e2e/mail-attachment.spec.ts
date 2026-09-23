import { expect, test, type Page } from "@playwright/test";
import { stat, readFile } from "node:fs/promises";
import { collectErrors, setEmployeeSession } from "./helpers";

// =====================================================================
// 공용 메일함 첨부 다운로드 (0단계) — 실제 화면에서 실제로 받아 확인합니다.
//
//   ★ 헤더만 보고 판단하면 안 됩니다. curl 은 Content-Disposition 의
//     filename* 를 읽지 않고 filename= 만 보므로, 퍼센트 인코딩된 값을 그대로
//     파일명으로 씁니다(그래서 curl 로는 고쳐졌는지 알 수 없습니다).
//     여기서는 크로미움이 실제로 제안하는 이름을 봅니다.
//
//   ★ 단언은 "화면에 보이는 이름 == 실제로 받아진 이름" 입니다. 파일명을 상수로
//     박아두면 그 메일이 휴지통에서 영구 삭제되는 날 테스트가 깨집니다.
//
//   라이브 DB 를 읽습니다(e2e 전반과 동일). 쓰기는 하지 않습니다 — 상세를
//   열지 않으므로 opened_at 도 건드리지 않습니다. 대상 메일이 사라졌으면
//   실패가 아니라 skip 합니다.
// =====================================================================

const NAME = process.env.E2E_HR_NAME || "";

// 검색어로 찾습니다(UUID 를 박지 않기 위해). 사라지면 skip 됩니다.
const WITH_KOREAN_ATTACHMENT = "영어10월"; // 한글 파일명 hwp 2개
const WITHOUT_COPY = "로봇을 배우며"; // 10MB 초과로 사본이 없는 첨부
const NO_ATTACHMENT = "일하는 방식의 전환"; // 첨부 없는 메일

// .hwp 5.0 은 복합 문서(CFB) 라 이 8바이트로 시작합니다. 오류 HTML 을 받아놓고
//   "받아졌다" 고 착각하지 않으려는 확인입니다.
const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

// 목록에서 첫 행의 📎 를 펼칩니다. 대상이 없으면 skip.
async function expandFirstAttachment(page: Page, q: string) {
  await page.goto(`/mail?q=${encodeURIComponent(q)}`);
  const clip = page.getByRole("button", { name: /첨부 \d+개 보기/ }).first();
  const found = await clip.isVisible().catch(() => false);
  test.skip(!found, `대상 메일(${q})이 목록에 없습니다.`);
  await clip.click();
}

test.describe("공용 메일함 첨부 다운로드", () => {
  // 로그인 없이는 목록 자체를 볼 수 없으므로 이름이 없으면 전부 skip합니다.
  test.skip(!NAME, "E2E_HR_NAME 이 없어 로그인 세션을 만들 수 없습니다.");

  test.beforeEach(async ({ context, baseURL }) => {
    await setEmployeeSession(context, baseURL!, NAME);
  });

  test("목록에서 상세를 열지 않고, 화면에 보이는 이름 그대로 받는다", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await expandFirstAttachment(page, WITH_KOREAN_ATTACHMENT);

    // 펼친 띠의 첫 첨부. 칩은 "📎 <파일명> (<크기>)" 형태입니다.
    const link = page.locator("a[href^='/api/mail/attachment/']").first();
    await expect(link).toBeVisible();
    const shown = ((await link.textContent()) ?? "")
      .replace(/^\s*📎\s*/, "")
      .replace(/\s*\([^()]*\)\s*$/, "")
      .trim();

    // 이 테스트가 지키려는 것은 한글 파일명이므로, 한글이 아니면 의미가 없습니다.
    expect(shown).toMatch(/[가-힣]/);

    // 링크 클릭이 곧 다운로드 — 팝업이 뜨지 않으므로 차단될 여지가 없습니다.
    //   (0단계 이전에는 await 뒤 window.open 이라 사파리에서 막혔습니다.)
    const downloadPromise = page.waitForEvent("download");
    await link.click();
    const download = await downloadPromise;

    // ★ 핵심 — 0단계 이전에는 "1-26105.hwp" 처럼 ASCII 키 이름으로 받아졌습니다.
    expect(download.suggestedFilename()).toBe(shown);

    // 이름만 맞고 내용이 빈 파일이면 의미가 없습니다.
    const path = await download.path();
    expect((await stat(path)).size).toBeGreaterThan(0);
    if (shown.toLowerCase().endsWith(".hwp")) {
      const head = (await readFile(path)).subarray(0, 8);
      expect(head.equals(CFB_MAGIC)).toBe(true);
    }

    // 상세 모달은 열리지 않았어야 합니다(첨부만 받고 목록에 머무름).
    await expect(page.getByRole("dialog", { name: "메일 상세" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("사본이 없는 첨부는 이유를 알린다(조용히 실패하지 않음)", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await expandFirstAttachment(page, WITHOUT_COPY);

    // 사본이 없는 첨부는 링크가 아니라 버튼 + "사본 없음" 표시입니다.
    const dead = page.locator("button", { hasText: "사본 없음" }).first();
    await expect(dead).toBeVisible();
    await dead.click();

    // 눌렀을 때 이유가 화면에 뜹니다. 10MB 초과와 업로드 실패를 구분합니다.
    await expect(
      page.getByText(/사본을 저장하지 않았습니다|사본 저장에 실패했습니다/),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("첨부가 없는 메일에는 📎 자체가 없다", async ({ page }) => {
    // 쉼표는 getMailList 가 or() 문법 보호를 위해 공백으로 바꾸므로 검색어에
    //   넣지 않습니다("AI 시대, 일하는…" 으로 찾으면 제목과 어긋납니다).
    await page.goto(`/mail?q=${encodeURIComponent(NO_ATTACHMENT)}`);
    const row = page.locator(`text=${NO_ATTACHMENT}`).first();
    test.skip(
      !(await row.isVisible().catch(() => false)),
      "대상 메일이 목록에 없습니다.",
    );
    await expect(
      page.getByRole("button", { name: /첨부 \d+개 보기/ }),
    ).toHaveCount(0);
  });

  test("로그인하지 않으면 첨부를 받을 수 없다", async ({ browser, page }) => {
    // 실재하는 첨부 주소를 목록에서 얻은 뒤, 쿠키 없는 컨텍스트로 같은 곳을 칩니다.
    await expandFirstAttachment(page, WITH_KOREAN_ATTACHMENT);
    const href = await page
      .locator("a[href^='/api/mail/attachment/']")
      .first()
      .getAttribute("href");
    expect(href).toBeTruthy();

    const fresh = await browser.newContext();
    const res = await fresh.request.get(href!, { maxRedirects: 0 });
    expect(res.status()).toBe(401);
    await fresh.close();
  });

  test("잘못된 순번은 파일 대신 사유를 돌려준다", async ({ page }) => {
    await expandFirstAttachment(page, WITH_KOREAN_ATTACHMENT);
    const href = await page
      .locator("a[href^='/api/mail/attachment/']")
      .first()
      .getAttribute("href");
    const base = href!.replace(/\/\d+$/, "");

    // 존재하지 않는 순번 — 302 로 Storage 에 넘어가면 안 됩니다.
    const over = await page.request.get(`${base}/99`, { maxRedirects: 0 });
    expect(over.status()).toBe(404);

    // 음수·문자 순번도 파일을 내주지 않습니다.
    const bad = await page.request.get(`${base}/-1`, { maxRedirects: 0 });
    expect(bad.status()).toBe(400);
  });
});
