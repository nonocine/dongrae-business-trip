import { expect, test, type Browser } from "@playwright/test";
import { collectErrors, setEmployeeSession, setGoogleSession } from "./helpers";
import { HASH_TO_TAB } from "../lib/profileHrTabs";

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
  sidebar?: string; // 사이드바에서 켜져야 할 항목(aria-current=page) 이름 정규식
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

  // ── 묶음 B: 기존 탭을 주소(?tab= 등)에 남기기 ──
  // 7. 사업실적(+ 청소년 활동 하위 탭 ?sub=)
  { url: "/business-results", tab: "실적 현황", tablist: "사업실적 메뉴" },
  { url: "/business-results?tab=programs", tab: "청소년 활동", tablist: "사업실적 메뉴" },
  { url: "/business-results?tab=programs", tab: "실적 입력", tablist: "청소년 활동 보기", panel: "programs-panel-input" },
  { url: "/business-results?tab=programs&sub=list", tab: "목록", tablist: "청소년 활동 보기", panel: "programs-panel-list" },
  { url: "/business-results?tab=report", tab: "종합보고서", tablist: "사업실적 메뉴" },
  { url: "/business-results?tab=onna&year=2026&period=q1", tab: "온나", tablist: "사업실적 메뉴" },
  // 8. 직원 인사관리 — 사이드바·관리자 바로가기·채용 화면이 쓰는 주소
  { url: "/hr", tab: "인사기록카드", tablist: "인사 관리", sidebar: "직원 인사관리|전 직원 인사관리" },
  { url: "/hr?tab=records", tab: "인사기록카드", tablist: "인사 관리", sidebar: "직원 인사관리|전 직원 인사관리" },
  { url: "/hr?tab=recruitment", tab: "채용공고", tablist: "인사 관리", sidebar: "채용 관리" },
  { url: "/hr?tab=contracts", tab: "계약서", tablist: "인사 관리" },
  { url: "/hr?tab=certificates", tab: "증명서 발급", tablist: "인사 관리" },
  // 9. 상벌·급여 기준·거래처·강사비
  { url: "/hr/discipline", tab: "상벌", tablist: "상벌·인사위원회" },
  { url: "/hr/discipline?tab=incidents", tab: "경위서", tablist: "상벌·인사위원회" },
  { url: "/hr/discipline?tab=committees", tab: "인사위원회", tablist: "상벌·인사위원회" },
  { url: "/hr/salary", tab: "월별 급여", tablist: "급여", sidebar: "급여 기준 관리" },
  { url: "/hr/salary?tab=grade", tab: "호봉표", tablist: "급여", sidebar: "급여 기준 관리" },
  { url: "/hr/salary?tab=config", tab: "급여 기준값", tablist: "급여" },
  { url: "/hr/salary?tab=employee", tab: "직원별 급여 설정", tablist: "급여" },
  { url: "/hr/partners", tab: "전체", tablist: "거래처 분야", sidebar: "거래처관리" },
  { url: "/hr/partners?field=" + encodeURIComponent("시설"), tab: "시설", tablist: "거래처 분야" },
  { url: "/hr/payouts", tab: "재원별 보기", tablist: "보기", sidebar: "강사비 지출표" },
  { url: "/hr/payouts?view=person", tab: "사람별 보기", tablist: "보기" },

  // ── 깨지면 안 되는 기존 링크(이번에 안 바꾼 화면 포함) ──
  { url: "/hr/contracts?tab=salary", tab: "연봉계약서", tablist: "계약서 종류" },
  { url: "/seal-register?tab=pending", tab: "결재함", tablist: "직인사용대장 보기" },
  { url: "/seal-register?tab=ledger", tab: "전체 대장", tablist: "직인사용대장 보기" },
  { url: "/admin/erp?tab=rentals", tab: "대관 차이 대조", admin: true },
];

// /profile/hr# 앵커 전체(lib/profileHrTabs HASH_TO_TAB) → 내 인사기록 탭 이름.
const MY_HR_LABEL: Record<string, string> = {
  info: "내 정보",
  contracts: "내 계약서",
  certs: "증명서",
  trainings: "내 의무교육",
  erpLeave: "복무 기록",
  leave: "연차 사용계획서",
  discipline: "경위서",
};

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
      if (c.sidebar) {
        await expect(
          page.locator("aside[aria-label='업무 메뉴'] [aria-current='page']").first(),
        ).toHaveText(new RegExp(c.sidebar));
      }
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }

  test("/profile/hr# 앵커 전체가 해당 탭을 연다", async ({ browser, baseURL }) => {
    const { ctx, page } = await newPage(browser, baseURL!, false);
    for (const [hash, key] of Object.entries(HASH_TO_TAB)) {
      // 실제 링크처럼 다른 문서에서 들어옵니다(같은 문서 안 goto 는 해시만 바뀌어 다른 경로).
      await page.goto("about:blank");
      await page.goto(`/profile/hr#${hash}`);
      const tab = page.getByRole("tablist", { name: "내 인사기록" }).getByRole("tab", {
        name: new RegExp(`^${MY_HR_LABEL[key]}`),
      });
      await expect(tab, `#${hash}`).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
    }
    await ctx.close();
  });

  test("확인할 일 링크: /hr?tab=records&driver=…&section=appointment → 그 직원 카드의 인사발령", async ({
    browser,
    baseURL,
  }) => {
    const { ctx, page } = await newPage(browser, baseURL!, false);
    await page.goto("/hr?tab=records");
    // 직원 하나를 골라 그 id 로 확인할 일과 같은 주소를 만듭니다.
    const opt = page.locator("select option[value]:not([value=''])").first();
    const driverId = await opt.getAttribute("value");
    expect(driverId).toBeTruthy();
    await page.goto(`/hr?tab=records&driver=${driverId}&section=appointment`);
    const section = page.getByRole("tablist", { name: "인사기록카드 항목" });
    await expect(section.getByRole("tab", { name: /^인사발령/ })).toHaveAttribute(
      "aria-selected",
      "true",
      { timeout: 20_000 },
    );
    // 항목 탭을 누르면 &section= 이 바뀌고 driver 는 유지
    await section.getByRole("tab", { name: /^학력/ }).click();
    await expect(page).toHaveURL(/section=education/);
    await expect(page).toHaveURL(new RegExp(`driver=${driverId}`));
    // 새로 고침해도 같은 직원·같은 항목
    await page.reload();
    await expect(section.getByRole("tab", { name: /^학력/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("select").first()).toHaveValue(driverId!);
    // 직원을 바꾸면 항목은 기본정보로
    const other = await page
      .locator(`select option[value]:not([value='']):not([value='${driverId}'])`)
      .first()
      .getAttribute("value");
    if (other) {
      await page.locator("select").first().selectOption(other);
      await expect(page).toHaveURL(new RegExp(`driver=${other}`));
      await expect(page).not.toHaveURL(/section=/);
      await expect(section.getByRole("tab", { name: /^기본정보/ })).toHaveAttribute("aria-selected", "true");
    }
    // 상위 탭 이동 → ?tab= 남김, 뒤로가기 → 인사기록카드
    await page.getByRole("tablist", { name: "인사 관리" }).getByRole("tab", { name: /^채용공고/ }).click();
    await expect(page).toHaveURL(/tab=recruitment/);
    await page.goBack();
    await expect(
      page.getByRole("tablist", { name: "인사 관리" }).getByRole("tab", { name: /^인사기록카드/ }),
    ).toHaveAttribute("aria-selected", "true");
    await ctx.close();
  });

  test("확인할 일 기타 링크가 열린다", async ({ browser, baseURL }) => {
    const { ctx, page } = await newPage(browser, baseURL!, false);
    for (const url of [
      "/hr/certificates",
      "/seal-register",
      "/hr/saems/certificates",
      "/hr/saems/contracts?filter=seal_pending",
      "/hr/leave-plans",
    ]) {
      const res = await page.goto(url);
      expect(res?.status(), url).toBeLessThan(400);
      expect(new URL(page.url()).pathname, url).toBe(url.split("?")[0]);
    }
    await ctx.close();
  });

  test("사업실적: 목록 하위 탭의 [수정]은 입력 하위 탭으로", async ({ browser, baseURL }) => {
    const { ctx, page } = await newPage(browser, baseURL!, false);
    await page.goto("/business-results?tab=programs&sub=list");
    const sub = page.getByRole("tablist", { name: "청소년 활동 보기" });
    await expect(sub.getByRole("tab", { name: /^목록/ })).toHaveAttribute("aria-selected", "true");
    const edit = page.locator("#programs-panel-list").getByRole("button", { name: "수정" }).first();
    if (await edit.count()) {
      await edit.click();
      await expect(page).not.toHaveURL(/sub=list/);
      await expect(page.locator("#programs-panel-input")).toBeVisible();
    }
    await ctx.close();
  });

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
