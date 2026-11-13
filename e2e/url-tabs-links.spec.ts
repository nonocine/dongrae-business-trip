import { expect, test, type Browser } from "@playwright/test";
import { collectErrors, setEmployeeSession, setGoogleSession } from "./helpers";

// =====================================================================
// 화면 탭 정리 2단계 — 탭으로 나눈 화면들의 '주소 → 열리는 탭' 확인.
//
//   각 줄: 주소로 들어가면 그 탭이 선택(aria-selected)되고, 그 패널이 보여야 합니다.
//   앱 안 링크(확인할 일·아침 슬랙 DM·관리자 대시보드·사이드바)가 가리키는 주소와
//   옛 # 앵커 주소를 함께 봅니다. 조회만 합니다(아무 버튼도 누르지 않음).
//
//   E2E_HR_M0 / E2E_HR_NAME : M0(관장·부장) 직원 이름. 없으면 skip.
//   관리자 대시보드(/admin)는 구글 관장 세션(isMaster)이 필요해 따로 심습니다.
//   /sms 는 SMS_SEND_EMAILS 에 든 사람만 열립니다. 직원 비번 세션은 이메일이 없어
//     "*" 일 때만 — 로컬에서는 SMS_SEND_EMAILS='*' 로 dev 서버를 띄워 돌리세요(없으면 skip).
// =====================================================================

const WHO = process.env.E2E_HR_M0 || process.env.E2E_HR_NAME || "";

type Case = {
  url: string;
  tab: string; // 선택돼야 할 탭 이름(앞부분 일치 — 건수 숫자가 뒤에 붙음)
  panel?: string; // 보여야 할 패널 id(UrlTabs idPrefix-panel-key)
  urlHas?: RegExp; // 들어간 뒤 주소에 남아야 할 것(옛 # → ?tab= 정리 등)
  admin?: boolean; // 구글 관장 세션 필요
  sms?: boolean; // SMS_SEND_EMAILS 필요
  tablist?: string; // 탭 줄 aria-label(같은 화면에 탭 줄이 여럿일 때)
};

export const CASES: Case[] = [
  // 1. 동아리관리
  { url: "/hr/clubs", tab: "\\d+월 제출 현황", panel: "club-panel-status" },
  { url: "/hr/clubs?tab=clubs", tab: "동아리", panel: "club-panel-clubs", tablist: "동아리관리" },
  { url: "/hr/clubs?tab=teachers", tab: "동아리샘", panel: "club-panel-teachers" },
  // 2. 연차 사용촉진 — 확인할 일(leavePromotion*)이 /hr/leave-plans 로 옵니다 → 현황판
  { url: "/hr/leave-plans", tab: "현황판", panel: "leave-panel-board" },
  { url: "/hr/leave-plans?tab=plans", tab: "사용계획서", panel: "leave-panel-plans" },
  // 3. 의무교육
  { url: "/hr/trainings", tab: "이수 현황판", panel: "training-panel-board" },
  { url: "/hr/trainings?tab=list", tab: "교육 목록", panel: "training-panel-list" },
  // 4. 문자 발송 — 관리자 대시보드 문자 카드의 옛 앵커
  { url: "/sms", tab: "보내기", panel: "sms-panel-send", sms: true },
  { url: "/sms#sms-history", tab: "발송 이력", panel: "sms-panel-history", urlHas: /tab=history/, sms: true },
  { url: "/sms?tab=library", tab: "주소록·서식", panel: "sms-panel-library", sms: true },
  // 5. 명함첩
  { url: "/hr/cards", tab: "목록", panel: "cards-panel-list" },
  { url: "/hr/cards?tab=register", tab: "명함 등록", panel: "cards-panel-register" },
  // 6. 관리자 대시보드
  { url: "/admin", tab: "오늘·알림", panel: "admin-panel-today", admin: true },
  { url: "/admin?tab=hr", tab: "인사·시스템", panel: "admin-panel-hr", admin: true },
  { url: "/admin?tab=accounts", tab: "직원 계정", panel: "admin-panel-accounts", admin: true },
];

async function newPage(browser: Browser, baseURL: string, admin: boolean) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await setEmployeeSession(ctx, baseURL, WHO);
  if (admin) {
    await setGoogleSession(ctx, baseURL, {
      email: "e2e-admin@onnainna.kr",
      name: WHO,
      driverName: WHO,
      rank: "관장",
      isMaster: true,
    });
  }
  return { ctx, page: await ctx.newPage() };
}

test.describe("화면 탭 정리 2단계 — 주소로 탭 열기", () => {
  test.skip(!WHO, "E2E_HR_NAME 없음");
  for (const c of CASES) {
    test(`${c.url} → ${c.tab.replace(/\\d\+/, "N")}`, async ({ browser, baseURL }) => {
      test.skip(!!c.sms && !process.env.SMS_SEND_EMAILS, "SMS_SEND_EMAILS 없음");
      const { ctx, page } = await newPage(browser, baseURL!, !!c.admin);
      const errors = collectErrors(page);
      await page.goto(c.url);
      const scope = c.tablist ? page.getByRole("tablist", { name: c.tablist }) : page;
      const tab = scope.getByRole("tab", { name: new RegExp(`^${c.tab}`) }).first();
      await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
      if (c.panel) await expect(page.locator(`#${c.panel}`)).toBeVisible();
      if (c.urlHas) await expect(page).toHaveURL(c.urlHas);
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }

  test("탭을 누르면 주소에 남고, 달·연도를 바꿔도 보던 탭이 유지된다(동아리)", async ({
    browser,
    baseURL,
  }) => {
    const { ctx, page } = await newPage(browser, baseURL!, false);
    await page.goto("/hr/clubs");
    const list = page.getByRole("tablist", { name: "동아리관리" });
    await list.getByRole("tab", { name: /^동아리샘/ }).click();
    await expect(page).toHaveURL(/tab=teachers/);
    await page.getByRole("button", { name: "이전 달" }).click();
    await expect(page).toHaveURL(/month=/);
    await expect(page).toHaveURL(/tab=teachers/);
    await expect(list.getByRole("tab", { name: /^동아리샘/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await ctx.close();
  });

  test("명함 [+ 명함 등록] → 등록 탭, 취소 → 목록 탭", async ({ browser, baseURL }) => {
    const { ctx, page } = await newPage(browser, baseURL!, false);
    await page.goto("/hr/cards");
    await page.getByRole("button", { name: "+ 명함 등록" }).click();
    await expect(page).toHaveURL(/tab=register/);
    await expect(page.locator("#cards-panel-register")).toBeVisible();
    await page.locator("#cards-panel-register").getByRole("button", { name: "취소" }).click();
    await expect(page).not.toHaveURL(/tab=register/);
    await expect(page.locator("#cards-panel-list")).toBeVisible();
    await ctx.close();
  });
});
