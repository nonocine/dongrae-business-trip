import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

// .env.local(gitignore 대상)을 process.env 로 로드 — Playwright 는 자동 로드하지
// 않습니다. 직원 이름 등 민감값을 저장소에 커밋하지 않고 테스트에 주입하기 위함.
//   E2E_HR_NAME : 관장·부장 직원 이름(HR 세션 위조용). 없으면 HR 게이트 테스트 skip.
//   E2E_SLUG    : 테스트 대상 채용공고 slug (기본 2026-1)
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
} catch {
  // .env.local 이 없어도 무시 — 환경변수로 직접 줄 수 있음.
}

const PORT = 3000;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // 단일 dev 서버 + 라이브 DB 공유이므로 직렬 실행.
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // 이미 떠 있는 dev 서버가 있으면 재사용, 없으면 기동.
  webServer: {
    command: "npm run dev",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
