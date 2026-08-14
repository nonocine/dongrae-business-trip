import { test, expect } from "@playwright/test";
import { collectErrors, setEmployeeSession } from "./helpers";
import { createClient } from "@supabase/supabase-js";

// 강의확인증 발급대장(2부-a) — 담당자 검토·수정·승인/반려를 브라우저에서 검증합니다.
//   * 승인/반려는 실제 서버액션 → 실제 DB 갱신이라, 검증에는 pending 행이 필요합니다.
//     라이브 DB 를 쓰므로 테스트 전용 행을 심고 끝나면 반드시 지웁니다.
//     - 지우는 대상은 MARK 로 시작하는 applicant_name 뿐입니다(실제 신청 보호).
//     - cert_no 는 실제 채번과 겹치지 않게 9900번대를 씁니다.
//   * ⚠️ 주민번호는 이 기능 어디에도 없습니다(컬럼 자체가 없음).
const HR_NAME = process.env.E2E_HR_NAME;
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CERT = "saem_lecture_certificates";
const MARK = "[E2E테스트]";
const YEAR = 2999; // 실제 발급연도와 절대 겹치지 않는 값

const db = URL_ && KEY ? createClient(URL_, KEY, { auth: { persistSession: false } }) : null;

// instructor_id 는 NOT NULL — 아무 강사나 하나 빌려 쓴다(그 강사 데이터는 건드리지 않음).
let instructorId = "";
async function anyInstructorId(): Promise<string> {
  if (instructorId) return instructorId;
  const { data } = await db!.from("saem_instructors").select("id").limit(1).maybeSingle();
  instructorId = String((data as { id?: string } | null)?.id ?? "");
  return instructorId;
}

async function seed(certNo: number, name: string) {
  const { data, error } = await db!
    .from(CERT)
    .insert({
      instructor_id: await anyInstructorId(),
      cert_year: YEAR,
      cert_no: certNo,
      applicant_name: `${MARK} ${name}`,
      address: "부산광역시 동래구 시험로 1",
      lecture_content: "E2E 검증용 강의내용",
      lecture_period: "2026. 3. 2. ~ 2026. 8. 29.",
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed 실패: ${error.message}`);
  return String((data as { id: string }).id);
}

async function readRow(id: string) {
  const { data } = await db!
    .from(CERT)
    .select("status, reject_reason, reviewed_by, reviewed_at, applicant_name, lecture_content")
    .eq("id", id)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

test.describe("강의확인증 발급대장", () => {
  test.skip(!HR_NAME, "E2E_HR_NAME 미설정 — HR 세션 생성 불가로 skip");
  test.skip(!db, "Supabase service_role 미설정 — 테스트 행을 심을 수 없어 skip");

  // 어떤 경로로 끝나든(실패·중단 포함) 테스트 행을 남기지 않는다.
  test.afterAll(async () => {
    if (!db) return;
    await db.from(CERT).delete().eq("cert_year", YEAR).like("applicant_name", `${MARK}%`);
  });

  test.describe("담당자 세션", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await setEmployeeSession(context, baseURL as string, HR_NAME as string);
    });

    test("탭·목록에 신청이 뜨고 하이드레이션 에러가 없다", async ({ page }) => {
      const id = await seed(9901, "목록");
      const errors = collectErrors(page);
      await page.goto("/hr/saems/certificates");

      await expect(page.getByRole("link", { name: "강의확인증" })).toBeVisible();
      await expect(page.locator("body")).toContainText("강의확인증 발급대장");
      // 발급번호·강사명·상태·출력일자(미출력이면 "-")
      await expect(page.locator("body")).toContainText(`제${YEAR}년-9901호`);
      await expect(page.locator("body")).toContainText(`${MARK} 목록`);
      await expect(page.getByText("신청중").first()).toBeVisible();

      await page.waitForTimeout(800);
      expect(errors, errors.join("\n")).toHaveLength(0);
      expect(await readRow(id)).not.toBeNull();
    });

    test("상세를 열어 내용을 수정·저장한다", async ({ page }) => {
      const id = await seed(9902, "수정");
      await page.goto("/hr/saems/certificates");
      await page.getByText(`${MARK} 수정`).first().click();

      await expect(page.getByRole("heading", { name: `제${YEAR}년-9902호` })).toBeVisible();
      await page.getByRole("button", { name: "내용 수정" }).click();
      await page.getByRole("textbox").nth(2).fill("수정된 강의내용 E2E");
      await page.getByRole("button", { name: "저장" }).click();

      await expect(page.locator("body")).toContainText("수정했습니다.");
      await expect
        .poll(async () => (await readRow(id))?.lecture_content)
        .toBe("수정된 강의내용 E2E");
      // 수정만으로는 상태가 바뀌지 않는다.
      expect((await readRow(id))?.status).toBe("pending");
    });

    test("승인하면 status·reviewed_by·reviewed_at 이 기록된다", async ({ page }) => {
      const id = await seed(9903, "승인");
      await page.goto("/hr/saems/certificates");
      await page.getByText(`${MARK} 승인`).first().click();
      await page.getByRole("button", { name: "승인", exact: true }).click();

      await expect(page.locator("body")).toContainText("승인했습니다.");
      await expect.poll(async () => (await readRow(id))?.status).toBe("approved");
      const row = await readRow(id);
      expect(row?.reviewed_by).toBe(HR_NAME);
      expect(row?.reviewed_at).toBeTruthy();
    });

    test("반려하면 사유와 함께 rejected 로 기록된다", async ({ page }) => {
      const id = await seed(9904, "반려");
      await page.goto("/hr/saems/certificates");
      await page.getByText(`${MARK} 반려`).first().click();
      await page.getByRole("button", { name: "반려", exact: true }).click();

      const why = "강의일자가 위촉 기간과 다릅니다.";
      await page.getByPlaceholder("예: 강의일자가").fill(why);
      // 확인 패널의 반려 버튼(마지막)이 실제 제출.
      await page.getByRole("button", { name: "반려", exact: true }).last().click();

      await expect(page.locator("body")).toContainText("반려했습니다.");
      await expect.poll(async () => (await readRow(id))?.status).toBe("rejected");
      const row = await readRow(id);
      expect(row?.reject_reason).toBe(why);
      expect(row?.reviewed_by).toBe(HR_NAME);
    });

    test("처리된 신청은 수정·승인·반려 버튼이 없다", async ({ page }) => {
      const id = await seed(9905, "잠금");
      await db!.from(CERT).update({ status: "approved", reviewed_by: "이민정" }).eq("id", id);

      await page.goto("/hr/saems/certificates");
      await page.getByText(`${MARK} 잠금`).first().click();
      await expect(page.locator("body")).toContainText(
        "처리된 신청은 수정할 수 없습니다."
      );
      await expect(page.getByRole("button", { name: "내용 수정" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "승인", exact: true })).toHaveCount(0);
    });
  });

  test("세션 없이 접근하면 막힌다", async ({ page }) => {
    await seed(9906, "무권한");
    await page.goto("/hr/saems/certificates");
    // 레이아웃 가드가 홈으로 돌려보낸다 — 발급대장 내용이 보이면 안 된다.
    await expect(page.locator("body")).not.toContainText("강의확인증 발급대장");
    await expect(page.locator("body")).not.toContainText(MARK);
  });
});
