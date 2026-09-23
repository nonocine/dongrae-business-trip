import { expect, test, type Page } from "@playwright/test";
import { collectErrors, setEmployeeSession } from "./helpers";

// =====================================================================
// 공용 메일함 1단계 — 보낸메일함 · 전달 · 답장 보강 (실제 화면)
//
//   ★ 실제 발송은 기본적으로 하지 않습니다. 메일이 한 번 나가면 되돌릴 수
//     없고, 받는 주소는 사람의 개인 메일이라 저장소에 박을 값이 아닙니다.
//     E2E_FORWARD_TO 를 준 경우에만 마지막 테스트가 진짜로 한 통 보냅니다.
//     (실행 방법은 e2e/README.md 참고)
//
//   발송하지 않고 확인할 수 있는 것(첨부 파일명 인코딩·제목 접두사·인용 형태)은
//   scripts/test-mail-forward.ts 가 MIME 을 직접 만들어 검사합니다.
// =====================================================================

const NAME = process.env.E2E_HR_NAME || "";
// 진짜로 한 통 보낼 주소. 없으면 발송 테스트는 skip 됩니다.
const FORWARD_TO = process.env.E2E_FORWARD_TO || "";

const WITH_ATTACHMENT = "영어10월"; // 한글 파일명 hwp 2개가 달린 실제 메일
const WITHOUT_COPY = "로봇을 배우며"; // 10MB 초과로 사본이 없는 첨부가 있는 메일

// '원본 첨부 다시 붙이기' 블록만 — 폼에는 '완료 처리' 체크박스도 있어서
//   체크박스를 통째로 세면 그것까지 섞입니다.
//   제목 줄만 있는 안쪽 div 가 아니라 체크박스까지 품은 바깥 상자를 고릅니다.
function attachBox(page: Page) {
  return page
    .locator("div")
    .filter({ has: page.getByText("원본 첨부 다시 붙이기") })
    .filter({ has: page.locator("input[type=checkbox]") })
    .last();
}

// 검색으로 첫 메일을 열어 상세 모달까지 띄웁니다. 대상이 없으면 skip.
async function openFirstMail(page: Page, q: string) {
  await page.goto(`/mail?q=${encodeURIComponent(q)}`);
  const row = page.locator("button[aria-haspopup='dialog']").first();
  const found = await row.isVisible().catch(() => false);
  test.skip(!found, `대상 메일(${q})이 목록에 없습니다.`);
  await row.click();
  await expect(page.getByRole("dialog", { name: "메일 상세" })).toBeVisible();
}

test.describe("공용 메일함 — 보낸메일함 · 전달", () => {
  test.skip(!NAME, "E2E_HR_NAME 이 없어 로그인 세션을 만들 수 없습니다.");

  test.beforeEach(async ({ context, baseURL }) => {
    await setEmployeeSession(context, baseURL!, NAME);
  });

  test("보낸메일함 폴더가 보낸 이력을 모아 보여준다", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/mail?status=sent");

    await expect(
      page.getByRole("heading", { name: "보낸메일함" }),
    ).toBeVisible();

    // 관장이 실제로 보낸 답장 1건이 DB 에 있습니다. 비어 있지 않아야 합니다.
    await expect(page.getByText("아직 보낸 메일이 없습니다.")).toHaveCount(0);

    // 종류 배지와 발송 상태가 한 줄에 보입니다.
    await expect(page.getByText("답장", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("발송", { exact: true }).first()).toBeVisible();

    // 원본으로 건너뛰기 — 원본 메일 상세가 열려야 합니다.
    await page.getByRole("button", { name: "원본 메일 보기" }).first().click();
    await expect(page.getByRole("dialog", { name: "메일 상세" })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("전달 폼은 받는사람이 비어 있고 제목이 FW: 로 시작한다", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await openFirstMail(page, WITH_ATTACHMENT);

    await page.getByRole("button", { name: "↪ 전달" }).click();
    await expect(
      page.getByRole("heading", { name: "전달 작성" }),
    ).toBeVisible();

    // 받는사람은 비어 있어야 합니다 — 원본 보낸사람에게 되돌아가면 사고입니다.
    const to = page.getByLabel("받는사람");
    await expect(to).toHaveValue("");

    const subject = await page.getByLabel("제목", { exact: true }).inputValue();
    expect(subject.startsWith("FW: ")).toBe(true);

    // 원본 첨부가 미리 켜져 있어야 합니다(전달은 첨부째 넘기는 것이 보통).
    const checked = attachBox(page).locator("input[type=checkbox]:checked");
    expect(await checked.count()).toBeGreaterThan(0);

    // 받는사람이 비어 있으면 보내기가 막혀 있어야 합니다.
    await expect(page.getByRole("button", { name: "보내기" })).toBeDisabled();

    expect(errors).toEqual([]);
  });

  test("사본이 없는 첨부는 다시 붙일 수 없다", async ({ page }) => {
    const errors = collectErrors(page);
    await openFirstMail(page, WITHOUT_COPY);
    await page.getByRole("button", { name: "↪ 전달" }).click();

    // 사본이 없는 첨부의 체크박스는 비활성이고 이유가 함께 보입니다.
    const dead = page
      .locator("label", { hasText: "사본을 저장하지 않았습니다" })
      .first();
    await expect(dead).toBeVisible();
    await expect(dead.locator("input[type=checkbox]")).toBeDisabled();

    expect(errors).toEqual([]);
  });

  test("답장 폼에 참조 칸이 있고 원본 첨부는 꺼져 있다", async ({ page }) => {
    const errors = collectErrors(page);
    await openFirstMail(page, WITH_ATTACHMENT);

    await page.getByRole("button", { name: "↩ 답장" }).click();
    await expect(
      page.getByRole("heading", { name: "답장 작성" }),
    ).toBeVisible();

    // 받는사람은 원본 보낸사람으로 채워집니다.
    await expect(page.getByLabel("받는사람")).not.toHaveValue("");
    const subject = await page.getByLabel("제목", { exact: true }).inputValue();
    expect(subject.startsWith("RE: ")).toBe(true);

    // 참조 칸(1단계 추가).
    await expect(page.getByLabel("참조 (선택)")).toBeVisible();

    // 답장은 원본 첨부를 되돌려 보낼 일이 드물어 기본 해제입니다.
    await expect(
      attachBox(page).locator("input[type=checkbox]:checked"),
    ).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  // --- 실제 발송 (옵트인) ------------------------------------------------
  //   E2E_FORWARD_TO=you@example.com npx playwright test e2e/mail-send.spec.ts
  test("전달을 실제로 한 통 보낸다 (E2E_FORWARD_TO 필요)", async ({ page }) => {
    test.skip(
      !FORWARD_TO,
      "E2E_FORWARD_TO 가 없어 실제 발송은 건너뜁니다(메일은 되돌릴 수 없습니다).",
    );
    const errors = collectErrors(page);
    await openFirstMail(page, WITH_ATTACHMENT);

    await page.getByRole("button", { name: "↪ 전달" }).click();
    await page.getByLabel("받는사람").fill(FORWARD_TO);
    await page
      .getByLabel("본문")
      .fill("자동 검증 발송입니다. 첨부 파일명이 원본 그대로인지 확인해주세요.");

    await page.getByRole("button", { name: "보내기" }).click();

    // 성공 안내가 뜨고, 보낸 이력에 '전달' 이 쌓여야 합니다.
    await expect(page.getByText("전달을(를) 보냈습니다.")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText("보낸 이력", { exact: false }).first(),
    ).toBeVisible();

    // 보낸메일함에도 전달로 남아야 합니다.
    await page.goto("/mail?status=sent");
    await expect(page.getByText("전달", { exact: true }).first()).toBeVisible();

    expect(errors).toEqual([]);
  });
});
