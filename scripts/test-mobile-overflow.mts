// 모든 화면 휴대폰·PC 폭 점검 — npm run test:mobile-overflow
//
//   하는 일
//     1) 가짜 Supabase(scripts/mobileCheck/fakeSupabase.mts)를 띄웁니다. 운영 DB 에는
//        연결하지 않습니다 — 앱의 Supabase 주소·키를 가짜 서버로 바꿔 띄우고, 카카오·구글·
//        대관 API 키도 무효값으로 덮어써 외부 호출을 막습니다.
//     2) 그 설정으로 `next dev` 를 띄우고, 가짜 관장(모든 직무·master) 세션 쿠키를 심어
//        로그인 후 들어갈 수 있는 화면 전부를 390·430·360·1280px 로 엽니다.
//     3) 화면마다 잽니다.
//        · 가로 넘침: document 너비 > 화면 너비. 넘치게 만든 요소(가로 스크롤 상자 밖)를 함께 적음
//        · 카드 넘침: 버튼·글이 가장 가까운 테두리 상자(카드) 밖으로 나감(문서 폭은 그대로여도)
//        · 작은 버튼: 휴대폰에서 높이 40px 미만인 버튼·링크 버튼·입력칸
//          (제외: 탭 role=tab — 트랙 포함 40px / 표 안 / 배경·테두리 없는 글자형 버튼 / 스위치)
//        · 입력칸 글자 16px 미만(아이폰이 확대해 버림)
//        · 잘린 글자: overflow 로 숨겨졌는데 말줄임표도 없는 글
//   옵션
//     --only=/mail,/hr        일부 화면만
//     --shots=<폴더>          화면마다 캡처 저장(폭별)
//     --port=3210             앱 포트(가짜 DB 는 +1)
//     --json=<파일>           결과를 JSON 으로도 저장
//     --widths=390,360        일부 폭만(기본 390·430·360·1280)
//     --full=1                --shots 캡처를 화면 전체 길이로
//     --font=1.3              휴대폰 '글꼴 크기 크게' 흉내(기본 글자 16px × 배율)
//   ★ Windows Git Bash: `/mail` 처럼 / 로 시작하는 인자를 C:/Program Files/Git/mail 로 바꿔 버려
//     --only 가 조용히 빠집니다. 앞에 MSYS_NO_PATHCONV=1 을 붙이세요(PowerShell·cmd 는 상관없음).
//       MSYS_NO_PATHCONV=1 npm run test:mobile-overflow -- --only=/mail,/hr
//   종료 코드: 휴대폰 폭 가로 넘침·카드 넘침이 하나라도 있으면 1.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "@playwright/test";
import { BOSS_NAME, schemaFile, startFakeSupabase } from "./mobileCheck/fakeSupabase.mjs";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const PORT = Number(arg("port") ?? 3210);
const DB_PORT = PORT + 1;
const SHOTS = arg("shots");
const FONT = Number(arg("font") ?? 1);
const SECRET = "mobile-check-only-secret-not-production-0123456789";

const ID = "00000000-0000-4000-8000-000000000001";
// 활동(activities.id)은 숫자 id.
const ACT_ID = "1";
// 로그인 후 화면 전체(app 아래 page.tsx). 동적 경로는 가짜 id 로 채웁니다.
const ROUTES = [
  "/", "/activities", `/activities/${ACT_ID}`, `/activities/${ACT_ID}/edit`, "/admin", "/announcements",
  "/bangka/absences", "/bangka/absences?view=all", "/bangka/absences?view=phone", "/bangka/events", "/bangka/meals",
  "/bangka/meals/upload", "/bangka/members", "/bangka/members/bulk", "/bangka/members/guardians",
  `/bangka/members/guardians/${ID}`, "/bangka/posts", `/bangka/posts/${ID}`, "/bangka/posts/new",
  "/business-results", "/hr", "/hr/backup", "/hr/cards", "/hr/certificates", "/hr/clubs", "/hr/contracts",
  "/hr/credentials", "/hr/discipline", "/hr/evaluations", "/hr/external-judges", "/hr/facility/assets",
  "/hr/facility/driving", "/hr/facility/locations", "/hr/facility/rentals", "/hr/facility/safety",
  `/hr/facility/safety/${ID}`, "/hr/leave-plans", "/hr/mutual/ledger", "/hr/mutual/closing",
  "/hr/mutual/members", "/hr/mutual/policy", "/hr/org-records", "/hr/partners", "/hr/payouts",
  "/hr/recruitment/2026-1", "/hr/recruitment/2026-1/judges", "/hr/saems/instructors", "/hr/saems/certificates",
  "/hr/saems/enrollments", `/hr/saems/instructors/${ID}`, "/hr/saems/logs", "/hr/saems/programs",
  "/hr/saems/settlements", `/hr/saems/settlements/${ID}`, "/hr/salary", "/hr/seal", "/hr/trainings", "/mail",
  "/new", "/new/business_trip", "/press", "/profile/hr", "/profile/password", "/profile/pin",
  "/recruitment", "/recruitment/2026-1", "/recruitment/2026-1/apply", `/trips/${ID}`,
];
const only = arg("only")?.split(",");
const routes = only ? ROUTES.filter((r) => only.includes(r)) : ROUTES;
const unknownOnly = only?.filter((r) => !ROUTES.includes(r)) ?? [];
if (unknownOnly.length) console.log(`--only 중 목록에 없는 화면(건너뜀): ${unknownOnly.join(", ")} — Git Bash 면 MSYS_NO_PATHCONV=1 을 붙이세요`);
const WIDTHS = [
  { name: "390", width: 390, height: 844, mobile: true },
  { name: "430", width: 430, height: 932, mobile: true },
  { name: "360", width: 360, height: 780, mobile: true },
  { name: "1280", width: 1280, height: 800, mobile: false },
].filter((w) => !arg("widths") || arg("widths")!.split(",").includes(w.name));

type Finding = {
  route: string;
  width: string;
  finalUrl: string;
  docWidth: number;
  viewWidth: number;
  culprits: string[];
  cardEscapes: string[];
  smallTargets: string[];
  smallInputs: string[];
  consoleErrors: string[];
  clipped: string[];
  error?: string;
};

async function measure(page: Page, mobile: boolean) {
  return page.evaluate((mobile) => {
    const vw = document.documentElement.clientWidth;
    const desc = (el: Element) => {
      const cls = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 4).join(".");
      const txt = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
      return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${txt ? ` "${txt}"` : ""}`;
    };
    // 가로 스크롤·숨김 상자 안쪽은 페이지를 밀지 않으므로 제외
    const clippedByAncestor = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
      }
      return false;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const all = [...document.body.querySelectorAll("*")];
    // 넘친 요소 중 '가장 바깥'(부모는 안 넘친) 것만 — 원인 후보
    const over = all.filter((el) => visible(el) && el.getBoundingClientRect().right > vw + 1 && !clippedByAncestor(el));
    const overSet = new Set(over);
    const culprits = over
      .filter((el) => !el.parentElement || !overSet.has(el.parentElement))
      .slice(0, 6)
      .map((el) => `${desc(el)} → ${Math.round(el.getBoundingClientRect().right)}px`);
    const smallTargets: string[] = [];
    const smallInputs: string[] = [];
    if (mobile) {
      for (const el of document.querySelectorAll("button, a[class*='btn'], a[class*='h-['], input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]), select, textarea")) {
        if (!visible(el) || el.closest("[role=tablist]") || el.closest("table")) continue;
        // 글자만 있는 링크형 버튼(배경·테두리 없음)과 켜고 끄는 스위치는 '버튼'이 아니라 따로 셉니다.
        const cs = getComputedStyle(el);
        const plain = cs.backgroundColor === "rgba(0, 0, 0, 0)" && parseFloat(cs.borderTopWidth) === 0 && el.tagName === "BUTTON";
        if (plain || el.getAttribute("role") === "switch" || el.querySelector(":scope > svg:only-child, :scope > span.sr-only")) continue;
        const r = el.getBoundingClientRect();
        if (r.height < 40 && el.tagName !== "TEXTAREA") smallTargets.push(`${desc(el)} (${Math.round(r.height)}px)`);
        if (/INPUT|SELECT|TEXTAREA/.test(el.tagName) && parseFloat(getComputedStyle(el).fontSize) < 16)
          smallInputs.push(`${desc(el)} (${getComputedStyle(el).fontSize})`);
      }
    }
    // 카드 밖으로 나간 요소: 화면 폭 안에 있어도 가장 가까운 테두리 상자(카드)의 오른쪽·왼쪽 선을 넘으면 넘침.
    //   (2026-10 동아리샘 목록 — 버튼이 카드 테두리를 뚫었는데 문서 폭은 안 늘어 위 검사에 안 잡힘)
    const cardEscapes: string[] = [];
    if (mobile) {
      const boxOf = (el: Element) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (parseFloat(s.borderLeftWidth) > 0 && parseFloat(s.borderRightWidth) > 0 && parseFloat(s.borderTopLeftRadius) > 0) return p;
        }
        return null;
      };
      for (const el of document.querySelectorAll("button, a, span, input, select")) {
        if (!visible(el) || clippedByAncestor(el) || el.closest("[role=dialog]")) continue;
        const box = boxOf(el);
        if (!box) continue;
        const r = el.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        if (r.right > b.right + 1 || r.left < b.left - 1) cardEscapes.push(`${desc(el)} → 카드 ${desc(box).slice(0, 40)}`);
      }
      // 글자 넘침: 상자는 제자리인데 안의 글(띄어쓰기 없는 큰 금액 등)이 상자 밖으로 삐져나감.
      //   요소 자체는 안 넘쳐서 위 두 검사에 안 잡힘(2026-10 비품관리 "취득가액 합").
      for (const el of all) {
        const s = getComputedStyle(el);
        if (s.display === "inline" || s.overflowX !== "visible" || !visible(el) || clippedByAncestor(el)) continue;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
        if (el.scrollWidth > el.clientWidth + 1) cardEscapes.push(`글자 ${desc(el)} (${el.scrollWidth}>${el.clientWidth}px)`);
      }
    }
    const clipped: string[] = [];
    for (const el of all) {
      const s = getComputedStyle(el);
      if (s.overflowX !== "hidden" || s.textOverflow === "ellipsis" || !visible(el)) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
      if (el.scrollWidth > el.clientWidth + 1) clipped.push(desc(el));
    }
    return {
      docWidth: document.documentElement.scrollWidth,
      viewWidth: vw,
      culprits,
      cardEscapes: [...new Set(cardEscapes)].slice(0, 6),
      smallTargets: [...new Set(smallTargets)].slice(0, 8),
      smallInputs: [...new Set(smallInputs)].slice(0, 5),
      clipped: clipped.slice(0, 5),
      errorPage: /This page couldn.t load|Application error|Unhandled Runtime Error/.test(document.body.innerText),
    };
  }, mobile);
}

async function waitFor(url: string, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status > 0) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`서버가 뜨지 않음: ${url}`);
}

const root = process.cwd();
process.env.SESSION_SECRET = SECRET;
const { signPayload } = await import(pathToFileURL(path.join(root, "lib/signedCookie.ts")).href);
const { MASTER_EMAIL } = await import(pathToFileURL(path.join(root, "lib/authConstants.ts")).href);

const fake = startFakeSupabase(DB_PORT, schemaFile);
const fakeUrl = `http://127.0.0.1:${DB_PORT}`;
const env = {
  ...process.env,
  // ★ 운영 연결 차단 — .env.local 보다 프로세스 환경이 우선합니다(@next/env).
  NEXT_PUBLIC_SUPABASE_URL: fakeUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-anon",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service",
  SESSION_SECRET: SECRET,
  CREDENTIAL_MASTER_KEY: "0".repeat(64),
  KAKAO_REST_API_KEY: "disabled",
  KAKAO_CLIENT_SECRET: "disabled",
  GOOGLE_CLIENT_ID: "disabled",
  GOOGLE_CLIENT_SECRET: "disabled",
  RENTAL_API_KEY: "disabled",
  VERCEL_OIDC_TOKEN: "disabled",
  ADMIN_PASSWORD: "disabled",
  NEXT_TELEMETRY_DISABLED: "1",
};
const next = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "-p", String(PORT)], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let nextLog = "";
next.stdout.on("data", (d) => (nextLog += d));
next.stderr.on("data", (d) => (nextLog += d));
const base = `http://localhost:${PORT}`;
const findings: Finding[] = [];
try {
  await waitFor(base + "/recruitment", 180_000);
  // 운영 주소로 나가는지 마지막 확인 — 앱이 실제로 가짜 서버를 보는지
  if (!nextLog.includes("Ready")) console.log("(next dev 준비 로그 없음 — 계속 진행)");

  const browser = await chromium.launch();
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: SHOTS ? 2 : 1, locale: "ko-KR", isMobile: w.mobile, hasTouch: w.mobile });
    await ctx.addCookies([
      { name: "dongrae_employee", value: signPayload({ name: BOSS_NAME }), url: base },
      {
        name: "dongrae_google_session",
        value: signPayload({ email: MASTER_EMAIL, name: BOSS_NAME, driverId: null, driverName: BOSS_NAME, rank: "관장", hasProfile: true, isMaster: true }),
        url: base,
      },
    ]);
    // tsx(esbuild)가 함수에 붙이는 __name 보조함수 — page.evaluate 안에서도 있게.
    await ctx.addInitScript("window.__name = (f) => f;");
    // 스플래시(세션당 1회) 건너뛰기
    await ctx.addInitScript(() => {
      try {
        sessionStorage.setItem("dongrae_splash_seen", "1");
      } catch {}
    });
    const page = await ctx.newPage();
    // 화면마다 브라우저 콘솔 오류(수화 불일치 등 — 개발 화면 "N Issue" 의 내용)를 모음.
    let consoleErrors: string[] = [];
    page.on("console", async (m) => {
      if (m.type() !== "error") return;
      // React 경고는 "%s" 자리에 값이 따로 와서 채워 적고, 불러오기 실패는 어느 주소인지 붙임.
      const vals = await Promise.all(m.args().slice(1).map((a) => a.jsonValue().catch(() => "")));
      let text = m.text().split("\n")[0];
      for (const v of vals) text = text.replace("%s", String(v).split("\n")[0].slice(0, 60));
      const at = /Failed to load resource/.test(text) ? ` ← ${m.location().url}` : "";
      consoleErrors.push(`${text.slice(0, 160)}${at}`);
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.split("\n")[0].slice(0, 160)}`));
    for (const route of routes) {
      const f: Finding = { route, width: w.name, finalUrl: "", docWidth: 0, viewWidth: w.width, culprits: [], cardEscapes: [], smallTargets: [], smallInputs: [], clipped: [], consoleErrors: [] };
      consoleErrors = [];
      try {
        await page.goto(base + route, { waitUntil: "networkidle", timeout: 240_000 });
        // --font=1.3 : 휴대폰 '글꼴 크기 크게'처럼 기본 글자(rem)를 키움. 화면이 다 뜬 뒤 스타일 태그로 넣습니다
        //   — <html style> 을 미리 바꾸면 서버 HTML 과 달라 개발 화면에 hydration "1 Issue" 가 뜸(앱 오류 아님).
        if (FONT !== 1) await page.addStyleTag({ content: `html { font-size: ${16 * FONT}px !important; }` });
        await page.waitForTimeout(600);
        const m = await measure(page, w.mobile);
        Object.assign(f, m, { finalUrl: page.url().replace(base, "") });
        if (m.errorPage) f.error = "오류 화면";
        if (SHOTS) {
          mkdirSync(SHOTS, { recursive: true });
          const file = route.replace(/^\//, "").replace(/[/?=&]/g, "_") || "home";
          await page.screenshot({ path: path.join(SHOTS, `${file}-${w.name}.png`), fullPage: !!arg("full") });
        }
      } catch (e) {
        f.error = (e as Error).message.split("\n")[0];
      }
      f.consoleErrors = [...new Set(consoleErrors)].slice(0, 3);
      findings.push(f);
      const over = f.docWidth > f.viewWidth;
      console.log(
        `${w.name.padStart(4)} ${route.padEnd(42)} ${over ? `넘침 ${f.docWidth}px` : f.cardEscapes.length ? `카드 넘침 ${f.cardEscapes.length}` : "ok"}${f.error ? ` [${f.error}]` : ""}${
          f.finalUrl && f.finalUrl.split("?")[0] !== route.split("?")[0] ? ` → ${f.finalUrl}` : ""
        }`,
      );
    }
    await ctx.close();
  }
  await browser.close();
} finally {
  next.kill();
  fake.server.close();
}

// ---- 보고 ----
const mobileOver = findings.filter((f) => WIDTHS.find((w) => w.name === f.width)!.mobile && (f.docWidth > f.viewWidth || f.cardEscapes.length > 0));
console.log("\n## 가로 넘침");
for (const f of findings.filter((f) => f.docWidth > f.viewWidth)) console.log(`- ${f.width}px ${f.route}: ${f.docWidth}px\n    ${f.culprits.join("\n    ")}`);
console.log("\n## 카드 테두리 밖으로 나간 요소(휴대폰 폭)");
for (const f of findings.filter((f) => f.cardEscapes.length)) console.log(`- ${f.width}px ${f.route}:\n    ${f.cardEscapes.join("\n    ")}`);
console.log("\n## 휴대폰 작은 버튼·입력칸(40px 미만)");
for (const f of findings.filter((f) => f.width === "390" && f.smallTargets.length)) console.log(`- ${f.route}: ${f.smallTargets.join(" | ")}`);
console.log("\n## 입력칸 글자 16px 미만");
for (const f of findings.filter((f) => f.width === "390" && f.smallInputs.length)) console.log(`- ${f.route}: ${f.smallInputs.join(" | ")}`);
console.log("\n## 잘린 글자");
for (const f of findings.filter((f) => f.width === "390" && f.clipped.length)) console.log(`- ${f.route}: ${f.clipped.join(" | ")}`);
console.log("\n## 콘솔 오류(개발 화면 Issue)");
for (const f of findings.filter((f) => f.consoleErrors.length)) console.log(`- ${f.width}px ${f.route}: ${f.consoleErrors.join(" | ")}`);
console.log("\n## 열리지 않은 화면");
for (const f of findings.filter((f) => f.error)) console.log(`- ${f.width}px ${f.route}: ${f.error}`);
console.log(`\n가짜 DB 쓰기 요청(운영 DB 아님, 기록만): ${fake.writes.length}건 ${[...new Set(fake.writes)].slice(0, 10).join(", ")}`);
const json = arg("json");
if (json) writeFileSync(json, JSON.stringify({ findings, writes: fake.writes }, null, 1));
console.log(`\n휴대폰 폭 가로·카드 넘침 ${mobileOver.length}건 / 점검 ${findings.length}건`);
process.exit(mobileOver.length ? 1 : 0);
