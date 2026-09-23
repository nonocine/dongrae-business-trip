import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { setEmployeeSession } from "./helpers";

// =====================================================================
// /hr/saems 접근 개방(2026-09) — "누가 무엇을 보게 되는가" 를 화면에서 확인.
//
//   관장 지시로 강사·프로그램 관리를 로그인한 직원 전원에게 열되, 계좌·
//   주민번호·정산 금액·수강생 연락처는 기존 권한(M0 또는 saem 직무)에만
//   남겼습니다. 문을 넓히는 변경이라 '막혀야 하는 쪽'을 더 꼼꼼히 봅니다.
//
//   ★ 민감 항목은 화면에 안 보이는 것만으로는 부족합니다 — 서버 컴포넌트가
//     내려보낸 RSC 페이로드에 값이 남아 있으면 개발자도구에서 그대로 읽힙니다.
//     그래서 응답 본문·HTML 전체에 계좌번호 문자열이 있는지까지 봅니다.
//
//   운영 DB 의 실제 직원이라 이름은 환경변수로 받습니다(e2e/README.md).
//     E2E_SAEM_MANAGE : M0 또는 saem 직무   → 전부 보임
//     E2E_SAEM_VIEW   : 직무 없는 일반 직원 → 열람만
// =====================================================================

const MANAGE = process.env.E2E_SAEM_MANAGE || process.env.E2E_HR_NAME || "";
const VIEW = process.env.E2E_SAEM_VIEW || "";

async function as(browser: Browser, baseURL: string, who: string) {
  const ctx: BrowserContext = await browser.newContext();
  await setEmployeeSession(ctx, baseURL, who);
  return ctx;
}

// 목록 화면이 그 사람에게 내려보낸 모든 것(네트워크 응답 + 최종 HTML).
async function payloadOf(browser: Browser, baseURL: string, who: string) {
  const ctx = await as(browser, baseURL, who);
  const page = await ctx.newPage();
  const bodies: string[] = [];
  page.on("response", async (r) => {
    // 데이터가 실려 오는 응답만 본다 — dev 번들(JS 청크)에는 lib/saem.ts 의
    //   `rrnMask: s(r.rrn_mask)` 같은 '소스 코드' 가 들어 있어 값과 헷갈린다.
    const type = r.headers()["content-type"] ?? "";
    if (!/text\/html|text\/x-component/.test(type)) return;
    bodies.push(await r.text().catch(() => ""));
  });
  await page.goto("/hr/saems/instructors");
  await page.waitForLoadState("domcontentloaded");
  await page.locator("table tbody tr").first().waitFor();
  const html = await page.content();
  await ctx.close();
  return [...bodies, html].join("\n");
}

// 페이로드에서 `키…"값"` 형태의 첫 실제 값을 뽑는다. RSC 페이로드는 따옴표가
//   이스케이프된 채로 HTML 안에 들어 있어 정규식보다 이 편이 단단하다.
//   값이 없거나(null) 빈 문자열이면 null 을 돌려준다 — '가려졌다' 의 판정.
function pickValue(payload: string, key: string): string | null {
  let from = 0;
  for (;;) {
    const at = payload.indexOf(key, from);
    if (at < 0) return null;
    from = at + key.length;
    const rest = payload.slice(from, from + 120);
    // 키 바로 뒤: 따옴표(이스케이프 포함) → 콜론 → 따옴표 → 값.
    const colon = rest.indexOf(":");
    if (colon < 0) continue;
    const after = rest.slice(colon + 1).replace(/^[\s"\\]+/, "");
    const end = after.search(/["\\,}]/);
    const value = (end < 0 ? after : after.slice(0, end)).trim();
    if (value && value !== "null") return value;
  }
}

test.describe("/hr/saems 접근 개방", () => {
  test("직무 없는 직원도 강사 목록에 들어온다(열람)", async ({ browser, baseURL }) => {
    test.skip(!VIEW, "E2E_SAEM_VIEW 없음");
    const ctx = await as(browser, baseURL!, VIEW);
    const page = await ctx.newPage();
    await page.goto("/hr/saems/instructors");
    await page.waitForLoadState("domcontentloaded");

    await expect(page).toHaveURL(/\/hr\/saems\/instructors$/);
    await expect(page.getByRole("heading", { name: "강사·프로그램 관리" })).toBeVisible();
    // 탭은 정산만 빠진다.
    await expect(page.getByRole("link", { name: "강사 관리" })).toBeVisible();
    await expect(page.getByRole("link", { name: "정산", exact: true })).toHaveCount(0);
    // 쓰기 진입점은 없다.
    await expect(page.getByRole("button", { name: "+ 강사 등록" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "엑셀 다운로드" })).toHaveCount(0);
    await ctx.close();
  });

  test("열람자의 응답 본문에 계좌·주민번호가 없다", async ({ browser, baseURL }) => {
    test.skip(!VIEW || !MANAGE, "E2E_SAEM_VIEW/MANAGE 없음");

    // 관리자 쪽 페이로드에서 실제 계좌번호를 하나 집는다 — 비교 기준.
    const manager = await payloadOf(browser, baseURL!, MANAGE);
    const account = pickValue(manager, "bank_account");
    test.skip(!account, "계좌번호가 채워진 강사가 없어 검증 불가");

    const viewer = await payloadOf(browser, baseURL!, VIEW);
    expect(viewer).not.toContain(account!);
    // 주민번호 앞자리(rrnMask)·초대 토큰도 값이 실리면 안 된다.
    expect(pickValue(viewer, "rrnMask")).toBeNull();
    expect(pickValue(viewer, "bank_account")).toBeNull();
  });

  test("열람자는 강사 상세에 주소를 쳐도 목록으로 돌아온다", async ({
    browser,
    baseURL,
  }) => {
    test.skip(!VIEW || !MANAGE, "E2E_SAEM_VIEW/MANAGE 없음");
    const mctx = await as(browser, baseURL!, MANAGE);
    const mpage = await mctx.newPage();
    await mpage.goto("/hr/saems/instructors");
    await mpage.locator("table tbody tr").first().click();
    await mpage.waitForURL(/\/hr\/saems\/instructors\/[0-9a-f-]+$/);
    const url = mpage.url();
    await mctx.close();

    const vctx = await as(browser, baseURL!, VIEW);
    const vpage = await vctx.newPage();
    await vpage.goto(url);
    await vpage.waitForLoadState("domcontentloaded");
    await expect(vpage).toHaveURL(/\/hr\/saems\/instructors$/);
    await vctx.close();
  });

  test("열람자는 정산에 주소를 쳐도 들어가지 못한다", async ({ browser, baseURL }) => {
    test.skip(!VIEW, "E2E_SAEM_VIEW 없음");
    const ctx = await as(browser, baseURL!, VIEW);
    const page = await ctx.newPage();
    await page.goto("/hr/saems/settlements");
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveURL(/\/hr\/saems\/instructors$/);
    await ctx.close();
  });

  test("열람자는 프로그램·수강생·근무일지를 보되 편집 버튼이 없다", async ({
    browser,
    baseURL,
  }) => {
    test.skip(!VIEW, "E2E_SAEM_VIEW 없음");
    const ctx = await as(browser, baseURL!, VIEW);
    const page = await ctx.newPage();

    await page.goto("/hr/saems/programs");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("button", { name: "+ 프로그램 추가" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "프로젝트 추가" })).toHaveCount(0);
    // 강사 보수에 해당하는 열은 아예 없다.
    await expect(page.getByRole("columnheader", { name: "수강료" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "정산 방식" })).toHaveCount(0);

    await page.goto("/hr/saems/enrollments");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("button", { name: "명단 업로드" })).toHaveCount(0);

    await page.goto("/hr/saems/logs");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("button", { name: /선택 확정/ })).toHaveCount(0);
    await ctx.close();
  });

  test("관리 권한자는 지금까지처럼 전부 본다", async ({ browser, baseURL }) => {
    test.skip(!MANAGE, "E2E_SAEM_MANAGE 없음");
    const ctx = await as(browser, baseURL!, MANAGE);
    const page = await ctx.newPage();
    await page.goto("/hr/saems/instructors");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("button", { name: "+ 강사 등록" })).toBeVisible();
    await expect(page.getByRole("link", { name: "정산", exact: true })).toBeVisible();
    await ctx.close();
  });
});
