import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { setEmployeeSession } from "./helpers";
import { supabaseAdmin } from "../lib/supabaseAdmin";

// =====================================================================
// 거래처 거래이력 (/hr/partners 상세) — 등록·수정·삭제와 "남의 기록" 차단.
//
//   * 등록은 거래처를 볼 수 있는 직원 누구나, 수정·삭제는 등록자 본인 또는 M0
//     (관장 결정 2026-08-25). 버튼 노출은 서버가 준 canEdit 로 정하고, 실제
//     차단은 액션(savePartnerLog/deletePartnerLog)이 다시 합니다.
//   * ★ 이 스펙의 핵심은 마지막 테스트입니다 — 버튼이 안 보이는 것만으로는
//     증명이 안 됩니다. 화면이 열린 뒤 DB 에서 작성자를 남으로 바꿔 두고
//     저장을 눌러, 서버가 거절하는지 봅니다(UI 를 우회한 호출과 같은 상황).
//   * 라이브 DB 에 실제로 행을 만듭니다. 만든 id 만 afterAll 에서 지웁니다.
//
//   대상은 운영 DB 의 실제 직원이라 이름을 저장소에 박지 않고 환경변수로
//   받습니다(없으면 skip). 둘 다 M0 가 아니어야 합니다 — M0 는 남의 기록도
//   고칠 수 있어 차단 테스트가 성립하지 않습니다.
//     E2E_PARTNER_A : 일반 직원 (기록을 쓰는 사람)
//     E2E_PARTNER_B : 다른 일반 직원 (남의 기록을 못 고쳐야 하는 사람)
// =====================================================================

const A = process.env.E2E_PARTNER_A || "";
const B = process.env.E2E_PARTNER_B || "";

// 테스트가 만든 행만 지우기 위한 표식 + id 수집.
const MARK = `[e2e] 거래이력 점검 ${Date.now()}`;
const created: string[] = [];

test.afterAll(async () => {
  // 표식으로도 한 번 더 훑습니다 — 도중에 실패해 id 를 못 모았을 때 대비.
  await supabaseAdmin
    .from("partner_transaction_logs")
    .delete()
    .like("content", "[e2e]%");
});

async function as(browser: Browser, baseURL: string, who: string) {
  const ctx: BrowserContext = await browser.newContext();
  await setEmployeeSession(ctx, baseURL, who);
  return ctx;
}

// 삭제는 confirm() 을 거칩니다 — Playwright 는 기본이 '취소' 라 받아줘야 합니다.
async function newPage(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  return page;
}

// 방금 만든 행을 id 로 잡습니다. revalidate 직후라 한 번 더 기다립니다.
async function logIdOf(content: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const { data } = await supabaseAdmin
      .from("partner_transaction_logs")
      .select("id")
      .eq("content", content)
      .maybeSingle();
    if (data) return String((data as { id: string }).id);
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`거래이력이 저장되지 않았습니다: ${content}`);
}

// 목록에서 첫 거래처를 열고 그 이름을 돌려줍니다(두 사람이 같은 곳을 보게).
async function openFirstPartner(page: Page): Promise<string> {
  await page.goto("/hr/partners");
  await page.waitForLoadState("domcontentloaded");
  const first = page.locator("ul > li button").first();
  const name = (await first.locator("strong").first().innerText()).trim();
  await first.click();
  await expect(page.getByRole("button", { name: "+ 이력 추가" })).toBeVisible();
  return name;
}

async function addLog(page: Page, content: string) {
  await page.getByRole("button", { name: "+ 이력 추가" }).click();
  await page.locator("#log-occurred-on").fill("2026-09-01");
  await page.locator("#log-content").fill(content);
  await page.getByRole("button", { name: "추가", exact: true }).click();
  // 성공 안내까지 봐야 '서버가 저장했다' 가 증명됩니다(화면 글자만으로는 부족).
  await expect(page.getByText("거래 이력을 추가했습니다.")).toBeVisible();
  await expect(page.locator("tr", { hasText: content })).toBeVisible();
}

test.describe("거래처 거래이력", () => {
  test("일반 직원이 기록을 남기고, 날짜·내용·작성자·작성시각이 보인다", async ({
    browser,
    baseURL,
  }) => {
    test.skip(!A, "E2E_PARTNER_A 없음");
    const ctx = await as(browser, baseURL!, A);
    const page = await newPage(ctx);
    await openFirstPartner(page);

    const content = `${MARK} 등록`;
    await addLog(page, content);

    // 표의 네 칸이 모두 채워져야 합니다.
    const row = page.locator("tr", { hasText: content });
    await expect(row).toContainText("2026.09.01"); // 거래 일자
    await expect(row).toContainText(A); // 작성자 — 서버가 세션 이름으로 채운다
    await expect(row).toContainText(/\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}/); // 작성시각
    // 본인 기록이므로 버튼이 보입니다.
    await expect(row.getByRole("button", { name: "수정" })).toBeVisible();
    await expect(row.getByRole("button", { name: "삭제" })).toBeVisible();

    const { data } = await supabaseAdmin
      .from("partner_transaction_logs")
      .select("id, created_by, occurred_on")
      .eq("content", content)
      .maybeSingle();
    expect(data).not.toBeNull();
    // created_by 는 클라이언트가 보낸 값이 아니라 서버가 세션에서 채웁니다.
    expect(String((data as { created_by: string }).created_by)).toBe(A);
    expect(String((data as { occurred_on: string }).occurred_on)).toBe("2026-09-01");
    created.push(String((data as { id: string }).id));
    await ctx.close();
  });

  test("내용이 비면 거부한다", async ({ browser, baseURL }) => {
    test.skip(!A, "E2E_PARTNER_A 없음");
    const ctx = await as(browser, baseURL!, A);
    const page = await newPage(ctx);
    await openFirstPartner(page);

    await page.getByRole("button", { name: "+ 이력 추가" }).click();
    await page.locator("#log-occurred-on").fill("2026-09-01");
    await page.locator("#log-content").fill("   ");
    await page.getByRole("button", { name: "추가", exact: true }).click();
    await expect(page.getByText("거래 내용을 입력해주세요.")).toBeVisible();
    await ctx.close();
  });

  test("본인 기록은 수정·삭제된다", async ({ browser, baseURL }) => {
    test.skip(!A, "E2E_PARTNER_A 없음");
    const ctx = await as(browser, baseURL!, A);
    const page = await newPage(ctx);
    await openFirstPartner(page);

    const content = `${MARK} 수정대상`;
    await addLog(page, content);

    const fixed = `${MARK} 수정됨`;
    await page
      .locator("tr", { hasText: content })
      .getByRole("button", { name: "수정" })
      .click();
    await page.locator("#log-content").fill(fixed);
    await page.getByRole("button", { name: "수정 저장" }).click();
    await expect(page.getByText("거래 이력을 수정했습니다.")).toBeVisible();
    await expect(page.locator("tr", { hasText: fixed })).toBeVisible();

    await page
      .locator("tr", { hasText: fixed })
      .getByRole("button", { name: "삭제" })
      .click();
    await expect(page.getByText("거래 이력을 삭제했습니다.")).toBeVisible();
    await expect(page.locator("tr", { hasText: fixed })).toHaveCount(0);

    // DB 에서도 사라졌는지 — 화면만 지워지는 일이 없게.
    const { data } = await supabaseAdmin
      .from("partner_transaction_logs")
      .select("id")
      .eq("content", fixed);
    expect((data ?? []).length).toBe(0);
    await ctx.close();
  });

  test("남이 쓴 기록에는 수정·삭제 버튼이 오지 않는다", async ({
    browser,
    baseURL,
  }) => {
    test.skip(!A || !B, "E2E_PARTNER_A/B 없음");
    const actx = await as(browser, baseURL!, A);
    const apage = await newPage(actx);
    const partner = await openFirstPartner(apage);
    const content = `${MARK} 남의기록`;
    await addLog(apage, content);
    created.push(await logIdOf(content));
    await actx.close();

    const bctx = await as(browser, baseURL!, B);
    const bpage = await newPage(bctx);
    // 목록은 이름순이라 두 사람이 여는 '첫 거래처' 가 같습니다.
    //   (이름으로 찾으면 "(주)…" 의 괄호가 정규식으로 해석돼 안 잡힙니다)
    const same = await openFirstPartner(bpage);
    expect(same).toBe(partner);

    const row = bpage.locator("tr", { hasText: content });
    await expect(row).toBeVisible(); // 기록 자체는 함께 봅니다(협업 자산)
    await expect(row.getByRole("button", { name: "수정" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "삭제" })).toHaveCount(0);
    await bctx.close();
  });

  test("비공개 거래처의 이력은 일반 직원의 응답 본문에 실리지 않는다", async ({
    browser,
    baseURL,
  }) => {
    test.skip(!A, "E2E_PARTNER_A 없음");

    const ctx = await as(browser, baseURL!, A);
    const page = await newPage(ctx);
    const partner = await openFirstPartner(page);
    const content = `${MARK} 비공개확인`;
    await addLog(page, content);
    created.push(await logIdOf(content));

    const { data: p } = await supabaseAdmin
      .from("business_partners")
      .select("id, is_private")
      .eq("name", partner)
      .maybeSingle();
    const partnerId = String((p as { id: string }).id);
    const wasPrivate = (p as { is_private: boolean }).is_private === true;

    try {
      // 이 거래처만 잠시 비공개로 돌립니다(끝나면 원래대로).
      await supabaseAdmin
        .from("business_partners")
        .update({ is_private: true })
        .eq("id", partnerId);

      // 화면에서 숨기는 것으로는 부족합니다 — RSC 페이로드에 값이 남으면
      //   개발자도구에서 그대로 읽힙니다. 응답 본문 전체를 봅니다.
      const bodies: string[] = [];
      const page2 = await newPage(ctx);
      page2.on("response", async (r) => {
        const type = r.headers()["content-type"] ?? "";
        if (!/text\/html|text\/x-component/.test(type)) return;
        bodies.push(await r.text().catch(() => ""));
      });
      await page2.goto("/hr/partners");
      await page2.waitForLoadState("networkidle");
      const payload = [...bodies, await page2.content()].join("\n");
      expect(payload).not.toContain(content); // 이력
      expect(payload).not.toContain(partner); // 거래처 자체
    } finally {
      await supabaseAdmin
        .from("business_partners")
        .update({ is_private: wasPrivate })
        .eq("id", partnerId);
      await ctx.close();
    }
  });

  test("화면을 우회해도 서버가 남의 기록 수정을 거절한다", async ({
    browser,
    baseURL,
  }) => {
    test.skip(!A || !B, "E2E_PARTNER_A/B 없음");
    const ctx = await as(browser, baseURL!, A);
    const page = await newPage(ctx);
    await openFirstPartner(page);

    const content = `${MARK} 가로채기`;
    await addLog(page, content);
    const id = await logIdOf(content);
    created.push(id);

    // 화면은 그대로 둔 채(수정 버튼이 보이는 상태) 작성자만 남으로 바꿉니다.
    //   = UI 를 우회해 남의 기록에 저장을 거는 것과 같은 상황.
    await supabaseAdmin
      .from("partner_transaction_logs")
      .update({ created_by: B })
      .eq("id", id);

    await page
      .locator("tr", { hasText: content })
      .getByRole("button", { name: "수정" })
      .click();
    await page.locator("#log-content").fill(`${MARK} 가로채기 시도`);
    await page.getByRole("button", { name: "수정 저장" }).click();
    await expect(
      page.getByText("본인이 등록한 거래이력만 수정할 수 있습니다."),
    ).toBeVisible();

    // DB 값이 그대로여야 합니다.
    const { data: after } = await supabaseAdmin
      .from("partner_transaction_logs")
      .select("content")
      .eq("id", id)
      .maybeSingle();
    expect(String((after as { content: string }).content)).toBe(content);
    await ctx.close();
  });
});
