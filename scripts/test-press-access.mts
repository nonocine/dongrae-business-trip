// 보도자료 기자 화면 — 관장 전용 접근 검증. 운영 DB 접속 없음.
//   실제 page·서버 액션·isManagerAdmin(app/actions)을 부르고, 쿠키·DB·redirect 만 가짜.
//   세션은 실제 서명 쿠키(signPayload)로 만들어 isManagerAdmin 판정을 그대로 탑니다.
//   실행: node --experimental-test-module-mocks --import tsx scripts/test-press-access.mts

import { mock } from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { randomBytes } from "node:crypto";

// 이 실행에서만 쓰는 서명 키 — 실제 SESSION_SECRET 과 무관합니다.
const ephemeralKey = randomBytes(32).toString("hex");
process.env.SESSION_SECRET = ephemeralKey;

const root = process.cwd();
const url = (p: string) => pathToFileURL(path.join(root, p)).href;

let passed = 0;
function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(`FAIL: ${message}`);
  passed++;
  console.log(`  ok  ${message}`);
}

// --- 가짜 쿠키 · DB · redirect -------------------------------------------
let cookieValue: string | null = null;
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "dongrae_google_session" && cookieValue ? { name, value: cookieValue } : undefined,
      set: () => {},
      delete: () => {},
    }),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
class Redirect extends Error {}
mock.module("next/navigation", {
  namedExports: {
    redirect: (to: string) => {
      throw new Redirect(`NEXT_REDIRECT:${to}`);
    },
  },
});

// 어떤 체인이든 받아 주는 가짜 클라이언트 — 건드린 테이블만 기록합니다.
const touched: string[] = [];
function chain(): unknown {
  const result = { data: [], error: null };
  const p: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => void) => res(result);
      if (prop === "maybeSingle" || prop === "single") return async () => ({ data: null, error: null });
      return () => p;
    },
  });
  return p;
}
const fakeClient = {
  from: (t: string) => {
    touched.push(t);
    return chain();
  },
};
mock.module(url("lib/supabaseAdmin.ts"), { namedExports: { supabaseAdmin: fakeClient } });

const { signPayload } = await import(url("lib/signedCookie.ts"));
const actions = await import(url("app/(app)/press/actions.ts"));
const page = (await import(url("app/(app)/press/page.tsx"))).default;
const { MENU_ITEMS, canSeeMenuItem } = await import(url("lib/menu.ts"));

type Who = { label: string; session: Record<string, unknown> | null; allowed: boolean };
const base = { driverId: "d", hasProfile: true, isMaster: false };
const people: Who[] = [
  { label: "관장", session: { ...base, email: "boss@onnainna.kr", name: "관장", driverName: "관장", rank: "관장" }, allowed: true },
  { label: "master", session: { ...base, email: "master@onnainna.kr", name: "master", driverName: null, rank: null, isMaster: true }, allowed: true },
  { label: "부장", session: { ...base, email: "bujang@onnainna.kr", name: "부장", driverName: "부장", rank: "부장" }, allowed: false },
  // personnel 은 직무(employee_roles)라 직급은 팀장 — 관장 전용 판정과 무관하게 거부돼야 합니다.
  { label: "personnel(팀장)", session: { ...base, email: "pers@onnainna.kr", name: "인사", driverName: "인사", rank: "팀장" }, allowed: false },
  { label: "일반 직원", session: { ...base, email: "staff@onnainna.kr", name: "직원", driverName: "직원", rank: "팀원" }, allowed: false },
  { label: "로그인 안 함", session: null, allowed: false },
];

const calls: [string, () => Promise<unknown>][] = [
  ["loadPressData", () => actions.loadPressData()],
  ["createManualReporter", () => actions.createManualReporter({ name: "가짜", outlet: "가짜일보" })],
  ["updateReporterManual", () => actions.updateReporterManual("x", { memo: "위조" })],
  ["deleteReporter", () => actions.deleteReporter("x")],
  ["applyPendingEmail", () => actions.applyPendingEmail("x")],
  ["dismissPendingEmail", () => actions.dismissPendingEmail("x")],
];

for (const who of people) {
  console.log(`${who.label} (${who.allowed ? "허용" : "거부"})`);
  cookieValue = who.session ? signPayload(who.session) : null;

  for (const [name, call] of calls) {
    touched.length = 0;
    let threw: unknown = null;
    try {
      await call();
    } catch (e) {
      threw = e;
    }
    const pressTouched = touched.some((t) => t.startsWith("press_"));
    if (who.allowed) {
      assert(!threw && pressTouched, `${name} 실행됨`);
    } else {
      assert(
        threw instanceof Error && threw.message.includes("관장만") && !pressTouched,
        `${name} 거부 · press 테이블 손대지 않음`,
      );
    }
  }

  touched.length = 0;
  let redirected: string | null = null;
  try {
    await page({ searchParams: Promise.resolve({}) });
  } catch (e) {
    if (e instanceof Redirect) redirected = e.message;
    else throw e;
  }
  if (who.allowed) assert(redirected === null, "화면 열림");
  else
    assert(
      redirected === "NEXT_REDIRECT:/" && !touched.some((t) => t.startsWith("press_")),
      "화면 → 홈으로 튕김 · 명단 조회 안 함",
    );
}

// 메뉴 — 관리자 영역 "보도자료 기자" 는 isManagerAdmin 일 때만.
console.log("메뉴");
const item = MENU_ITEMS.find((i: { key: string }) => i.key === "admin-press");
assert(item && item.group === "admin" && item.href === "/press", "관리자 영역에 /press 항목");
assert(canSeeMenuItem(item, { isM0: true, roles: [], isManagerAdmin: true }), "관장·master 에게 보임");
assert(!canSeeMenuItem(item, { isM0: true, roles: [], isManagerAdmin: false, isPersonnel: true }), "부장(M0·personnel)에게 안 보임");
assert(!canSeeMenuItem(item, { isM0: false, roles: ["personnel"], isPersonnel: true }), "personnel 직무에게 안 보임");
assert(!canSeeMenuItem(item, { isM0: false, roles: [] }), "일반 직원에게 안 보임");

console.log(`\n보도자료 접근 검증 통과 — ${passed}개`);
