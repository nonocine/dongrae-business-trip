import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { setEmployeeSession } from "./helpers";
import { kstMonthPeriod } from "../lib/workLogPeriod";

// =====================================================================
// 강사 근무일지 "기간 선택" — 운영 DB 를 읽기만 한다.
//   * 선택 출력: 기간 안 회차 0 인 프로그램은 건너뜀, 파일명 = 실제 건수, 쪽 그림은
//     같은 기간의 개별 출력과 같다. 전부 0 이면 PDF 를 안 만든다.
//   * 개별 출력: 작은 창 → [전체] 기본(예전 파일명·같은 그림) / 기간 지정.
//   * 라우트: from·to 형식 검증 400, 개별 출력 기간 0회차 404.
//   * 폰 360px: 가로 넘침 0, 버튼·입력 44px.
//   전체(기간 없음)가 main 과 바이트까지 같은지는 시계를 고정한 별도 스크립트로 확인했다
//   (pdf-lib 가 만든 시각을 PDF 에 넣어 라우트 응답끼리는 매번 다르다).
//   E2E_SAEM_MANAGE(또는 E2E_HR_NAME): 관리 + 선택 출력 권한(관장) 직원.
//   E2E_WL_PROJECT·E2E_WL_TERM·E2E_WL_PROGRAM: 시험 대상(기본 청소년동아리·2026년·드링크레이티브
//   — 2026-09-30(말일) 회차가 있다).
// =====================================================================

const MANAGE = process.env.E2E_SAEM_MANAGE || process.env.E2E_HR_NAME || "";
const PROJECT = process.env.E2E_WL_PROJECT || "청소년동아리";
const TERM = process.env.E2E_WL_TERM || "2026년";
const PROGRAM = process.env.E2E_WL_PROGRAM || "드링크레이티브";
const SEP = { from: "2026-09-01", to: "2026-09-30" };
const EMPTY = { from: "2020-01-01", to: "2020-01-31" };

test.setTimeout(240_000);

async function open(browser: Browser, baseURL: string, width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  await setEmployeeSession(ctx, baseURL, MANAGE);
  return { ctx, page: await ctx.newPage() };
}

async function pickTerm(page: Page) {
  await page.goto("/hr/saems/programs");
  const pv = await page
    .locator('select[aria-label="프로젝트"] option', { hasText: PROJECT })
    .first()
    .getAttribute("value");
  await page.selectOption('select[aria-label="프로젝트"]', pv!);
  const termOpt = page.locator('select[aria-label="차시"] option', { hasText: TERM }).first();
  await termOpt.waitFor({ state: "attached" });
  await page.selectOption('select[aria-label="차시"]', (await termOpt.getAttribute("value"))!);
  await page.locator('[data-testid="bulk-pick"]').first().waitFor();
}

async function enabledIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="bulk-pick"]:not([disabled])')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-program-id")!));
}

async function programId(page: Page, name: string): Promise<string> {
  return (await page
    .locator(`tr:has(td:text-is("${name}")) [data-testid="bulk-pick"]`)
    .getAttribute("data-program-id"))!;
}

async function pageStreams(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((p) => {
    const c = p.node.Contents();
    const parts = c instanceof PDFArray ? c.asArray().map((r) => pdf.context.lookup(r)) : [c];
    return parts
      .map((s) =>
        s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString("latin1") : ""
      )
      .join("\n")
      .replace(/\/[A-Za-z]+-\d+(-\d+)?/g, "/R");
  });
}

async function setPeriod(page: Page, p: { from: string; to: string }) {
  await page.getByTestId("period-from").fill(p.from);
  await page.getByTestId("period-to").fill(p.to);
}

async function download(page: Page, testId: string) {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 200_000 }),
    page.getByTestId(testId).click(),
  ]);
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(readFileSync((await dl.path())!)) };
}

async function openIndividual(page: Page, name: string) {
  await page
    .locator(`tr:has(td:text-is("${name}")) button[title^="PDF 출력"]`)
    .click();
  await page.getByTestId("worklog-open").click();
  await expect(page.getByTestId("worklog-period-modal")).toBeVisible();
}

test.describe("근무일지 기간 선택", () => {
  test.skip(!MANAGE, "E2E_SAEM_MANAGE 없음");

  test("라우트 — from·to 형식 검증 400, 기간 0회차 404", async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL!);
    await pickTerm(page);
    const id = await programId(page, PROGRAM);
    const wl = `/hr/saems/programs/${id}/worklog`;
    const pd = `/hr/saems/programs/${id}/print-data?doc=worklog`;
    for (const q of ["from=2026-9-01&to=2026-09-30", "from=2026-09-01", "from=2026-02-30&to=2026-03-01", "from=2026-10-01&to=2026-09-30"]) {
      expect((await page.request.get(`${wl}?${q}`)).status(), `worklog ${q}`).toBe(400);
      expect((await page.request.get(`${pd}&${q}`)).status(), `print-data ${q}`).toBe(400);
    }
    expect((await page.request.get(`${wl}?from=${EMPTY.from}&to=${EMPTY.to}`)).status()).toBe(404);
    const empty = await page.request.get(`${pd}&from=${EMPTY.from}&to=${EMPTY.to}`);
    expect(empty.status()).toBe(200);
    expect((await empty.json()).sessions).toEqual([]);
    // 경계 — 9/30(말일) 회차는 9월에 들고, 10월에는 안 든다.
    const sep = await (await page.request.get(`${pd}&from=${SEP.from}&to=${SEP.to}`)).json();
    expect(sep.sessions.map((s: { session_date: string }) => s.session_date)).toContain("2026-09-30");
    const oct = await (await page.request.get(`${pd}&from=2026-10-01&to=2026-10-31`)).json();
    expect(oct.sessions.every((s: { session_date: string }) => s.session_date.startsWith("2026-10"))).toBe(true);
    // 회차 번호는 원래 번호 그대로(다시 1부터 아님).
    expect(oct.sessions[0].session_no).toBeGreaterThan(1);
    await ctx.close();
  });

  test("선택 출력 — 한 달, 0회차 건너뜀, 파일명·쪽 그림", async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL!);
    await pickTerm(page);
    const ids = await enabledIds(page);
    // 기대값 — 기간 안 회차가 있는 프로그램(표 순서)
    const has: string[] = [];
    for (const id of ids) {
      const j = await (
        await page.request.get(`/hr/saems/programs/${id}/print-data?doc=worklog&from=${SEP.from}&to=${SEP.to}`)
      ).json();
      if (j.sessions.length) has.push(id);
    }
    expect(has.length).toBeGreaterThan(0);
    expect(has.length).toBeLessThan(ids.length); // 건너뜀이 생기는 기간이어야 시험이 된다

    await page.getByTestId("bulk-pick-all").check();
    await page.getByTestId("bulk-print-open").click();
    await expect(page.getByTestId("period-all")).toHaveAttribute("aria-pressed", "true");
    await setPeriod(page, SEP);
    const r = await download(page, "bulk-save");
    expect(r.name).toMatch(new RegExp(`^강사근무일지_${SEP.from}~${SEP.to}_${TERM}_.+_${has.length}건\\.pdf$`));
    await expect(page.getByTestId("bulk-skipped")).toContainText(`건너뜀 ${ids.length - has.length}건`);

    const want: string[] = [];
    for (const id of has) {
      const res = await page.request.get(`/hr/saems/programs/${id}/worklog?from=${SEP.from}&to=${SEP.to}`);
      expect(res.status()).toBe(200);
      want.push(...(await pageStreams(new Uint8Array(await res.body()))));
    }
    const got = await pageStreams(r.bytes);
    expect(got.length).toBe(want.length);
    for (let i = 0; i < want.length; i++) expect(got[i], `쪽 ${i + 1}`).toBe(want[i]);
    await ctx.close();
  });

  test("선택 출력 — 전부 0회차면 PDF 를 안 만든다 · 거꾸로 된 기간은 막는다 · 출석부엔 기간 없음", async ({
    browser,
    baseURL,
  }) => {
    const { ctx, page } = await open(browser, baseURL!);
    await pickTerm(page);
    for (const id of (await enabledIds(page)).slice(0, 3)) await page.locator(`[data-program-id="${id}"]`).check();
    await page.getByTestId("bulk-print-open").click();
    const modal = page.getByTestId("bulk-print-modal");

    await setPeriod(page, { from: "2026-10-31", to: "2026-10-01" });
    await expect(page.getByTestId("period-error")).toContainText("시작일이 종료일보다 늦습니다");
    await expect(page.getByTestId("bulk-save")).toBeDisabled();
    await expect(page.getByTestId("bulk-preview")).toBeDisabled();

    // 빠른 버튼 — 한국시간 기준 달
    await page.getByTestId("period-last").click();
    const last = kstMonthPeriod(-1);
    await expect(page.getByTestId("period-from")).toHaveValue(last.from);
    await expect(page.getByTestId("period-to")).toHaveValue(last.to);
    await page.getByTestId("period-this").click();
    await expect(page.getByTestId("period-from")).toHaveValue(kstMonthPeriod(0).from);

    let downloaded = false;
    page.on("download", () => (downloaded = true));
    await setPeriod(page, EMPTY);
    await page.getByTestId("bulk-save").click();
    await expect(modal).toContainText("PDF를 만들지 않았습니다");
    await expect(modal).toContainText("건너뜀");
    expect(downloaded).toBe(false);

    await modal.getByText("출석부 · 출결 포함").click();
    await expect(page.getByTestId("period-picker")).toHaveCount(0);
    await expect(page.getByTestId("bulk-save")).toBeEnabled();
    await ctx.close();
  });

  test("개별 출력 — 작은 창, [전체] 그대로 · 기간 지정 · 0회차 안내", async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL!);
    await pickTerm(page);
    const id = await programId(page, PROGRAM);

    // [전체] — 기본값. 한 번에 나가고, 파일명·그림이 기간 없는 라우트(예전과 같음)와 같다.
    await openIndividual(page, PROGRAM);
    await expect(page.getByTestId("period-all")).toHaveAttribute("aria-pressed", "true");
    const all = await download(page, "worklog-download");
    expect(all.name).toBe(`${TERM}_${PROGRAM}_강사근무일지.pdf`);
    const base = await page.request.get(`/hr/saems/programs/${id}/worklog`);
    expect(await pageStreams(all.bytes)).toEqual(await pageStreams(new Uint8Array(await base.body())));

    // 기간 지정
    await openIndividual(page, PROGRAM);
    await setPeriod(page, SEP);
    const sep = await download(page, "worklog-download");
    expect(sep.name).toBe(`강사근무일지_${SEP.from}~${SEP.to}_${TERM}_${PROGRAM}_1건.pdf`);
    const ref = await page.request.get(`/hr/saems/programs/${id}/worklog?from=${SEP.from}&to=${SEP.to}`);
    expect(await pageStreams(sep.bytes)).toEqual(await pageStreams(new Uint8Array(await ref.body())));
    expect(await pageStreams(sep.bytes)).not.toEqual(await pageStreams(all.bytes));

    // 0회차 — 창 안에서 안내
    await openIndividual(page, PROGRAM);
    await setPeriod(page, EMPTY);
    await page.getByTestId("worklog-download").click();
    await expect(page.getByTestId("worklog-period-modal")).toContainText("선택한 기간에 회차가 없습니다");
    await ctx.close();
  });

  test("폭 360px — 가로 넘침 0 · 버튼·입력 44px", async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL!, 360);
    await pickTerm(page);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const check44 = async () => {
      for (const t of ["period-this", "period-last", "period-all", "period-from", "period-to"]) {
        const b = (await page.getByTestId(t).boundingBox())!;
        expect(b.height, t).toBeGreaterThanOrEqual(44);
        expect(b.x, t).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, t).toBeLessThanOrEqual(360);
      }
    };
    for (const id of (await enabledIds(page)).slice(0, 2)) await page.locator(`[data-program-id="${id}"]`).check();
    await page.getByTestId("bulk-print-open").click();
    await setPeriod(page, SEP);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await check44();
    await page.getByRole("button", { name: "닫기" }).click();

    await openIndividual(page, PROGRAM);
    await setPeriod(page, SEP);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await check44();
    expect((await page.getByTestId("worklog-download").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await ctx.close();
  });
});
