import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { setEmployeeSession } from "./helpers";

// =====================================================================
// 프로그램 관리 "선택 출력"(일괄 출력) — 운영 DB 를 읽기만 한다.
//   * 합친 PDF 의 각 쪽 그림(콘텐츠 스트림)이 개별 출력 라우트 PDF 와 같은지 본다.
//     폰트·이미지 리소스 이름만 문서마다 달라서 그 부분은 지우고 비교한다.
//   * 한 건 실패 시 나머지는 합치고 실패 이름을 알려 주는지(요청을 일부러 500 으로).
//   * 폰 폭에서 가로 넘침 0, 체크박스·버튼 44px 이상.
//   E2E_SAEM_MANAGE(또는 E2E_HR_NAME): 관리 권한 직원 / E2E_SAEM_VIEW: 열람만(403 확인).
//   E2E_BULK_PROJECT·E2E_BULK_TERM: 시험할 프로젝트·차시(기본 청소년동아리·2026년).
// =====================================================================

const MANAGE = process.env.E2E_SAEM_MANAGE || process.env.E2E_HR_NAME || "";
const VIEW = process.env.E2E_SAEM_VIEW || "";
const PROJECT = process.env.E2E_BULK_PROJECT || "청소년동아리";
const TERM = process.env.E2E_BULK_TERM || "2026년";
const ATT_PROJECT = process.env.E2E_BULK_ATT_PROJECT || "동래미래";
const ATT_TERM = process.env.E2E_BULK_ATT_TERM || "3차시";

test.setTimeout(240_000);

async function open(browser: Browser, baseURL: string, width = 1280) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    acceptDownloads: true,
  });
  await setEmployeeSession(ctx, baseURL, MANAGE);
  const page = await ctx.newPage();
  return { ctx, page };
}

async function pickTerm(page: Page, project: string, term: string) {
  await page.goto("/hr/saems/programs");
  const pv = await page
    .locator('select[aria-label="프로젝트"] option', { hasText: project })
    .first()
    .getAttribute("value");
  await page.selectOption('select[aria-label="프로젝트"]', pv!);
  const termOpt = page.locator('select[aria-label="차시"] option', { hasText: term }).first();
  await termOpt.waitFor({ state: "attached" });
  await page.selectOption('select[aria-label="차시"]', (await termOpt.getAttribute("value"))!);
  await page.locator('[data-testid="bulk-pick"]').first().waitFor();
}

async function enabledIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="bulk-pick"]:not([disabled])')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-program-id")!));
}

// 쪽 그림을 비교용 문자열로 — 리소스 이름(/NanumGothic-1234, /Image-5 …)만 지운다.
async function pageStreams(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((p) => {
    const c = p.node.Contents();
    const parts = c instanceof PDFArray ? c.asArray().map((r) => pdf.context.lookup(r)) : [c];
    return parts
      .map((s) =>
        s instanceof PDFRawStream
          ? Buffer.from(decodePDFRawStream(s).decode()).toString("latin1")
          : ""
      )
      .join("\n")
      .replace(/\/[A-Za-z]+-\d+(-\d+)?/g, "/R");
  });
}

async function saveBulk(page: Page, doc: RegExp) {
  await page.getByTestId("bulk-print-open").click();
  await page.getByTestId("bulk-print-modal").getByText(doc).click();
  const t0 = Date.now();
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 200_000 }),
    page.getByTestId("bulk-save").click(),
  ]);
  const ms = Date.now() - t0;
  const bytes = new Uint8Array(readFileSync((await dl.path())!));
  return { name: dl.suggestedFilename(), bytes, ms };
}

async function expectSameAsIndividual(
  page: Page,
  ids: string[],
  merged: Uint8Array,
  path: (id: string) => string
) {
  const want: string[] = [];
  for (const id of ids) {
    const r = await page.request.get(path(id));
    expect(r.status()).toBe(200);
    want.push(...(await pageStreams(new Uint8Array(await r.body()))));
  }
  const got = await pageStreams(merged);
  expect(got.length).toBe(want.length);
  for (let i = 0; i < want.length; i++) expect(got[i], `쪽 ${i + 1}`).toBe(want[i]);
}

test.describe("선택 출력", () => {
  test.skip(!MANAGE, "E2E_SAEM_MANAGE 없음");

  test("3건 근무일지 — 개별 출력과 쪽마다 같다", async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL!);
    await pickTerm(page, PROJECT, TERM);
    await expect(page.getByTestId("bulk-print-open")).toBeDisabled();
    const ids = (await enabledIds(page)).slice(0, 3);
    for (const id of ids) await page.locator(`[data-program-id="${id}"]`).check();
    await expect(page.getByTestId("bulk-print-open")).toHaveText("선택 출력 (3건)");
    const r = await saveBulk(page, /강사 근무일지/);
    console.log(`3건 근무일지: ${r.name} ${(r.bytes.length / 1e6).toFixed(2)}MB ${r.ms}ms`);
    expect(r.name).toMatch(/^강사근무일지_.+_3건\.pdf$/);
    await expectSameAsIndividual(page, ids, r.bytes, (id) => `/hr/saems/programs/${id}/worklog`);
    await ctx.close();
  });

  test("전체 선택 근무일지 — 한 파일, 폰트 1회", async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL!);
    await pickTerm(page, PROJECT, TERM);
    const ids = await enabledIds(page);
    await page.getByTestId("bulk-pick-all").check();
    await expect(page.getByTestId("bulk-print-open")).toHaveText(`선택 출력 (${ids.length}건)`);
    const r = await saveBulk(page, /강사 근무일지/);
    console.log(
      `전체 ${ids.length}건 근무일지: ${r.name} ${(r.bytes.length / 1e6).toFixed(2)}MB ${r.ms}ms`
    );
    expect(r.bytes.length).toBeLessThan(4_000_000); // 폰트가 건수만큼 반복되면 수십 MB
    await expectSameAsIndividual(page, ids, r.bytes, (id) => `/hr/saems/programs/${id}/worklog`);
    await ctx.close();
  });

  test("전체 선택 출석부(출결 포함·빈 양식) — 개별 출력과 같다", async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL!);
    await pickTerm(page, ATT_PROJECT, ATT_TERM);
    const ids = await enabledIds(page);
    await page.getByTestId("bulk-pick-all").check();
    const a = await saveBulk(page, /출결 포함/);
    console.log(`전체 ${ids.length}건 출석부: ${a.name} ${(a.bytes.length / 1e6).toFixed(2)}MB ${a.ms}ms`);
    await expectSameAsIndividual(page, ids, a.bytes, (id) => `/hr/saems/programs/${id}/attendance-sheet`);
    await page.getByRole("button", { name: "닫기" }).click();
    const b = await saveBulk(page, /빈 양식/);
    console.log(`전체 ${ids.length}건 빈 출석부: ${b.name} ${(b.bytes.length / 1e6).toFixed(2)}MB ${b.ms}ms`);
    expect(b.name).toMatch(/^출석부_빈양식_/);
    await expectSameAsIndividual(
      page,
      ids,
      b.bytes,
      (id) => `/hr/saems/programs/${id}/attendance-sheet?blank=1`
    );
    await ctx.close();
  });

  test("한 건 실패 — 나머지는 합치고 이름을 알려 준다", async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL!);
    await pickTerm(page, PROJECT, TERM);
    const ids = (await enabledIds(page)).slice(0, 3);
    const badName = await page
      .locator(`tr:has([data-program-id="${ids[1]}"]) td`)
      .nth(1)
      .innerText();
    await page.route(`**/programs/${ids[1]}/print-data**`, (r) =>
      r.fulfill({ status: 500, body: "일부러 낸 오류" })
    );
    for (const id of ids) await page.locator(`[data-program-id="${id}"]`).check();
    const r = await saveBulk(page, /강사 근무일지/);
    expect(r.name).toMatch(/_2건\.pdf$/);
    await expect(page.getByTestId("bulk-result")).toContainText(`실패 1건`);
    await expect(page.getByTestId("bulk-result")).toContainText(badName.trim());
    await expectSameAsIndividual(
      page,
      [ids[0], ids[2]],
      r.bytes,
      (id) => `/hr/saems/programs/${id}/worklog`
    );
    await ctx.close();
  });

  test("미리보기는 새 창에 PDF 를 연다", async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL!);
    await pickTerm(page, PROJECT, TERM);
    const ids = (await enabledIds(page)).slice(0, 2);
    for (const id of ids) await page.locator(`[data-program-id="${id}"]`).check();
    await page.getByTestId("bulk-print-open").click();
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByTestId("bulk-preview").click(),
    ]);
    // 헤드리스 크로미움은 PDF 뷰어가 없어 PDF 로 이동하면 '다운로드'로 처리한다.
    //   (실제 브라우저에서는 새 창에 PDF 가 열린다) — 둘 중 하나면 통과.
    const dl = popup.waitForEvent("download", { timeout: 60_000 }).then((d) => d.url());
    const nav = expect
      .poll(() => popup.url(), { timeout: 60_000 })
      .toMatch(/^blob:/)
      .then(() => popup.url());
    expect(await Promise.any([dl, nav])).toMatch(/^blob:/);
    await ctx.close();
  });

  for (const w of [360, 390, 430, 1280]) {
    test(`폭 ${w}px — 가로 넘침 0 · 누르는 곳 44px · 저장 동작`, async ({ browser, baseURL }) => {
      const { ctx, page } = await open(browser, baseURL!, w);
      await pickTerm(page, PROJECT, TERM);
      const ids = (await enabledIds(page)).slice(0, 2);
      for (const id of ids) await page.locator(`[data-program-id="${id}"]`).check();
      const overflow = () =>
        page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(await overflow()).toBeLessThanOrEqual(0);

      const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
      for (const sel of [
        'label:has([data-testid="bulk-pick"])',
        'label:has([data-testid="bulk-pick-all"])',
        '[data-testid="bulk-print-open"]',
      ]) {
        const b = await box(sel);
        expect(b.height, sel).toBeGreaterThanOrEqual(44);
        expect(b.width, sel).toBeGreaterThanOrEqual(44);
      }
      await page.getByTestId("bulk-print-open").click();
      expect(await overflow()).toBeLessThanOrEqual(0);
      for (const sel of ['[data-testid="bulk-preview"]', '[data-testid="bulk-save"]']) {
        expect((await box(sel)).height, sel).toBeGreaterThanOrEqual(44);
      }
      const [dl] = await Promise.all([
        page.waitForEvent("download", { timeout: 120_000 }),
        page.getByTestId("bulk-save").click(),
      ]);
      expect(dl.suggestedFilename()).toMatch(/_2건\.pdf$/);
      await ctx.close();
    });
  }

  test("열람만 하는 직원은 데이터 라우트가 403", async ({ browser, baseURL }) => {
    test.skip(!VIEW, "E2E_SAEM_VIEW 없음");
    const m = await open(browser, baseURL!);
    await pickTerm(m.page, PROJECT, TERM);
    const [id] = await enabledIds(m.page);
    await m.ctx.close();

    const ctx = await browser.newContext();
    await setEmployeeSession(ctx, baseURL!, VIEW);
    const page = await ctx.newPage();
    for (const doc of ["worklog", "attendance"]) {
      const r = await page.request.get(`/hr/saems/programs/${id}/print-data?doc=${doc}`);
      expect(r.status()).toBe(403);
    }
    await page.goto("/hr/saems/programs");
    await expect(page.getByTestId("bulk-print-open")).toHaveCount(0);
    await ctx.close();
  });
});
