// 동래방카(방과후아카데미) 권한 검증 — 실제 서버 액션·라우트·메뉴 조건을 부르고
//   DB·세션만 메모리 가짜로 바꿔 확인합니다(운영 DB 접속 없음).
//   실행: node --experimental-test-module-mocks --import tsx scripts/test-bangka-access.mts
//
//   판정: 액션이 '권한' 문구로 막히면 거부, 그 밖의 결과(성공·빈 결과·가짜 DB 때문에 난
//   다른 오류)는 게이트를 통과한 것 = 허용. 모든 액션은 첫 줄에서 권한을 봅니다.

import { mock } from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();
const { MASTER_EMAIL } = await import(pathToFileURL(path.join(root, "lib/authConstants.ts")).href);
const url = (p: string) => pathToFileURL(path.join(root, p)).href;

type Row = Record<string, unknown>;
const P = [
  { id: "d-boss", name: "관장님", rank: "관장", roles: [], label: "관장" },
  { id: "d-bujang", name: "부장님", rank: "부장", roles: [], label: "부장" },
  { id: "d-cho", name: "조유경형", rank: "팀장", roles: ["bangka"], label: "조유경형(bangka+팀장)" },
  { id: "d-park", name: "박병현형", rank: "팀원", roles: ["bangka", "saem"], label: "박병현형(bangka·saem, 팀원)" },
  { id: "d-kim", name: "김혜지형", rank: "팀장", roles: ["facility"], label: "김혜지형(다른 팀 팀장)" },
  { id: "d-staff", name: "일반직원", rank: "팀원", roles: [], label: "일반 직원" },
  // master — 구글 로그인 이메일로 M0. 직급·직무 없음.
  { id: "d-master", name: "마스터", rank: "팀원", roles: [], label: "master", master: true },
] as { id: string; name: string; rank: string; roles: string[]; label: string; master?: boolean }[];
const db: Record<string, Row[]> = {
  drivers: P.map((p) => ({ id: p.id, name: p.name, rank: p.rank })),
  employee_profiles: P.map((p) => ({ driver_id: p.id, auth_level: null })),
  employee_roles: P.flatMap((p) => p.roles.map((r) => ({ driver_id: p.id, role_key: r }))),
};

// 아무 메서드나 이어 붙일 수 있는 가짜 쿼리. eq/in 만 실제로 거릅니다.
function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const rows = () => (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then")
          return (resolve: (v: unknown) => void) =>
            resolve({ data: structuredClone(rows()), error: null, count: rows().length });
        if (prop === "maybeSingle" || prop === "single")
          return async () => ({ data: structuredClone(rows()[0] ?? null), error: null });
        if (prop === "eq") return (k: string, v: unknown) => (filters.push((r) => r[k] === v), proxy);
        if (prop === "in") return (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), proxy);
        return () => proxy;
      },
    },
  );
  return proxy;
}
const storageBucket = new Proxy({}, { get: () => async () => ({ data: null, error: { message: "fake storage" } }) });
const fakeClient = { from: (t: string) => query(t), storage: { from: () => storageBucket } };

let session: (typeof P)[number] | null = null;
mock.module("next/cache", { namedExports: { revalidatePath: () => {}, revalidateTag: () => {} } });
mock.module(url("app/actions.ts"), {
  namedExports: {
    getSession: async () => (session ? { kind: "employee", name: session.name } : null),
    getGoogleSession: async () => (session?.master ? { email: MASTER_EMAIL } : null),
    enforcePasswordChange: async () => {},
  },
});
mock.module(url("lib/supabaseAdmin.ts"), { namedExports: { supabaseAdmin: fakeClient } });

const access = await import(url("lib/bangkaAccess.ts"));
const { canSeeMenuItem, MENU_ITEMS } = await import(url("lib/menu.ts"));
const mod = {
  members: await import(url("app/(app)/bangka/members/actions.ts")),
  posts: await import(url("app/(app)/bangka/posts/actions.ts")),
  meals: await import(url("app/(app)/bangka/meals/actions.ts")),
  upload: await import(url("app/(app)/bangka/meals/upload/actions.ts")),
  events: await import(url("app/(app)/bangka/events/actions.ts")),
  absences: await import(url("app/(app)/bangka/absences/actions.ts")),
  talk: await import(url("app/(app)/bangka/talk/actions.ts")),
};
const routes = {
  "공결확인서 PDF (GET /bangka/absences/[id]/pdf)": async () =>
    (await import(url("app/(app)/bangka/absences/[id]/pdf/route.ts"))).GET(new Request("http://x/"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    }),
  "전화공결대장 엑셀 (GET /bangka/absences/ledger)": async () =>
    (await import(url("app/(app)/bangka/absences/ledger/route.ts"))).GET(new Request("http://x/?ym=2026-10")),
  "급식계획 PDF (GET /bangka/meals/plan-pdf)": async () =>
    (await import(url("app/(app)/bangka/meals/plan-pdf/route.ts"))).GET(new Request("http://x/?week=2026-10-26")),
};

const ID = "00000000-0000-0000-0000-000000000000";
const fd = () => new FormData();
// 화면 → 액션 목록. 인자는 형식만 맞춘 더미입니다(게이트가 먼저라 내용은 상관없음).
const ACTIONS: [string, string, () => Promise<unknown>][] = [
  ["학생·보호자", "listStudents", () => mod.members.listStudents({})],
  ["학생·보호자", "saveStudent", () => mod.members.saveStudent({ name: "x" })],
  ["학생·보호자", "setStudentLeft", () => mod.members.setStudentLeft({ id: ID, leftOn: "2026-10-01" })],
  ["학생·보호자", "restoreStudent", () => mod.members.restoreStudent(ID)],
  ["학생·보호자", "listActiveStudentsBrief", () => mod.members.listActiveStudentsBrief()],
  ["학생·보호자", "listGuardians (전화번호)", () => mod.members.listGuardians({})],
  ["학생·보호자", "getGuardianDetail (전화번호)", () => mod.members.getGuardianDetail(ID)],
  ["학생·보호자", "reissueGuardianInvite", () => mod.members.reissueGuardianInvite({ guardianId: ID })],
  ["학생·보호자", "unlockGuardian (PIN 잠금 해제)", () => mod.members.unlockGuardian(ID)],
  ["학생·보호자", "setGuardianSuspended", () => mod.members.setGuardianSuspended({ id: ID, suspended: true })],
  ["학생·보호자", "linkStudent", () => mod.members.linkStudent({ guardianId: ID, studentId: ID })],
  ["학생·보호자", "unlinkStudent", () => mod.members.unlinkStudent({ guardianId: ID, studentId: ID })],
  ["학생·보호자", "previewBulk", () => mod.members.previewBulk("")],
  ["학생·보호자", "saveBulk", () => mod.members.saveBulk("")],
  ["공지·알림장", "listPosts", () => mod.posts.listPosts({})],
  ["공지·알림장", "getPost", () => mod.posts.getPost(ID)],
  ["공지·알림장", "savePost", () => mod.posts.savePost({ type: "notice", title: "x", body: "", scope: "all" })],
  ["공지·알림장", "deletePost", () => mod.posts.deletePost(ID)],
  ["공지·알림장", "createPostUpload", () => mod.posts.createPostUpload({ postId: ID, name: "a.jpg", mime: "image/jpeg", size: 1 })],
  ["공지·알림장", "finalizePostUpload", () => mod.posts.finalizePostUpload({ postId: ID, path: "p", name: "a", mime: "image/jpeg" })],
  ["공지·알림장", "deletePostFile", () => mod.posts.deletePostFile({ postId: ID, fileId: ID })],
  ["급식", "listMeals", () => mod.meals.listMeals("2026-10")],
  ["급식", "saveMeal", () => mod.meals.saveMeal({ date: "2026-10-27", menu: "x", allergy: "" })],
  ["급식", "previewMealPaste", () => mod.meals.previewMealPaste("", "2026-10")],
  ["급식", "saveMealPaste", () => mod.meals.saveMealPaste("", "2026-10")],
  ["급식", "createMealPhotoUpload", () => mod.meals.createMealPhotoUpload({ date: "2026-10-27", name: "a.jpg", mime: "image/jpeg", size: 1 })],
  ["급식", "finalizeMealPhoto", () => mod.meals.finalizeMealPhoto({ date: "2026-10-27", path: "p", mime: "image/jpeg" })],
  ["급식", "deleteMealPhoto", () => mod.meals.deleteMealPhoto("2026-10-27")],
  ["식단표 올리기", "previewMenuXlsx", () => mod.upload.previewMenuXlsx(fd())],
  ["식단표 올리기", "saveMenuXlsx", () => mod.upload.saveMenuXlsx(fd())],
  ["연간일정", "listEvents", () => mod.events.listEvents(2026)],
  ["연간일정", "saveEvent", () => mod.events.saveEvent({ title: "x", start_date: "2026-10-27", end_date: "2026-10-27", scope: "all" })],
  ["연간일정", "deleteEvent", () => mod.events.deleteEvent(ID)],
  ["공결", "listAbsences", () => mod.absences.listAbsences({ view: "pending", ym: null })],
  ["공결", "countPendingAbsences (탭 배지)", () => mod.absences.countPendingAbsences()],
  ["공결", "listActiveStudents", () => mod.absences.listActiveStudents()],
  ["공결", "teacherCheckAbsence (담임 확인)", () => mod.absences.teacherCheckAbsence(ID)],
  ["공결", "approveAbsence (팀장 결재)", () => mod.absences.approveAbsence(ID)],
  ["공결", "rejectAbsence", () => mod.absences.rejectAbsence(ID, "사유")],
  ["공결", "createPhoneAbsence (전화 공결)", () => mod.absences.createPhoneAbsence({ studentId: ID, startDate: "2026-10-27", endDate: "2026-10-27", reasonType: "etc", reason: "x", confirmerType: "teacher" })],
  ["공결", "createAbsenceFileUpload", () => mod.absences.createAbsenceFileUpload({ absenceId: ID, name: "a.pdf", mime: "application/pdf", size: 1 })],
  ["공결", "finalizeAbsenceFile", () => mod.absences.finalizeAbsenceFile({ absenceId: ID, path: "p", name: "a", mime: "application/pdf" })],
  ["방카톡", "listTalkThreads", () => mod.talk.listTalkThreads("open", "all")],
  ["방카톡", "countOpenTalks (탭·메뉴 배지)", () => mod.talk.countOpenTalks()],
  ["방카톡", "getTalkThread", () => mod.talk.getTalkThread(ID)],
  ["방카톡", "getTalkHours", () => mod.talk.getTalkHours()],
  ["방카톡", "replyTalk (답글)", () => mod.talk.replyTalk(ID, "답글")],
  ["방카톡", "editMyReply", () => mod.talk.editMyReply(ID, ID, "고침")],
  ["방카톡", "deleteMyReply", () => mod.talk.deleteMyReply(ID, ID)],
  ["방카톡", "hideTalkMessage (가리기)", () => mod.talk.hideTalkMessage(ID, ID, "개인정보")],
  ["방카톡", "unhideTalkMessage", () => mod.talk.unhideTalkMessage(ID, ID)],
  ["방카톡", "setTalkClosed (닫기)", () => mod.talk.setTalkClosed(ID, true)],
  ["방카톡", "saveTalkSettings (운영시간 저장)", () =>
    mod.talk.saveTalkSettings({ weekdays: [1, 2, 3, 4, 5], openTime: "13:00", closeTime: "20:00", blockHolidays: true, extraClosedDates: [], closedNotice: "안내" })],
];

const DENY = /권한이 없습니다|팀장 결재는|팀장만 바꿀 수 있습니다/;
async function verdict(fn: () => Promise<unknown>): Promise<"허용" | "거부"> {
  try {
    const r = (await fn()) as { ok?: boolean; message?: string } | null;
    if (r && typeof r === "object" && r.ok === false && DENY.test(r.message ?? "")) return "거부";
    return "허용";
  } catch (e) {
    return DENY.test(e instanceof Error ? e.message : String(e)) ? "거부" : "허용";
  }
}

// 기대값
const isM0 = (p: (typeof P)[number]) => p.rank === "관장" || p.rank === "부장" || !!p.master;
const canAccess = (p: (typeof P)[number]) => isM0(p) || p.roles.includes("bangka");
const canApprove = (p: (typeof P)[number]) => isM0(p) || (p.roles.includes("bangka") && p.rank === "팀장");

let passed = 0;
const failures: string[] = [];
const check = (cond: boolean, msg: string) => (cond ? passed++ : failures.push(msg));

const table: Record<string, Record<string, string>> = {};
const put = (row: string, who: string, v: string) => ((table[row] ??= {})[who] = v);

for (const p of P) {
  session = p;
  // 메뉴(사이드바·메인 카드)
  const bangkaMenus = (MENU_ITEMS as { group: string; key: string }[]).filter((m) => m.group === "bangka");
  const seen = bangkaMenus.filter((m) => canSeeMenuItem(m as never, { isM0: isM0(p), roles: p.roles }));
  put(`메뉴 '방과후아카데미' ${bangkaMenus.length}개 보임`, p.label, seen.length === bangkaMenus.length ? "보임" : seen.length === 0 ? "숨김" : `${seen.length}개`);
  check(seen.length === (canAccess(p) ? bangkaMenus.length : 0), `${p.label} 메뉴`);

  // 화면 진입(레이아웃 가드 = resolveBangkaAccess)
  const ctx = await access.resolveBangkaAccess();
  put("화면 진입(모든 /bangka/* 레이아웃)", p.label, ctx ? "허용" : "거부→홈");
  check(!!ctx === canAccess(p), `${p.label} 화면 진입`);
  put("공결 [팀장 결재] 버튼 보임", p.label, ctx && access.canApproveAbsence(ctx) ? "보임" : "숨김");
  check((!!ctx && access.canApproveAbsence(ctx)) === canApprove(p), `${p.label} 결재 버튼`);

  for (const [screen, name, fn] of ACTIONS) {
    const v = await verdict(fn);
    put(`${screen} · ${name}`, p.label, v);
    const expected = name.startsWith("approveAbsence") || name.startsWith("saveTalkSettings") ? canApprove(p) : canAccess(p);
    check((v === "허용") === expected, `${p.label} ${name} → ${v}`);
  }
  for (const [name, fn] of Object.entries(routes)) {
    let status = 0;
    try {
      status = ((await fn()) as Response).status;
    } catch {
      status = 500; // 가짜 DB 때문에 난 오류 = 게이트 통과
    }
    const v = status === 403 ? "거부(403)" : "허용";
    put(name, p.label, v);
    check((status !== 403) === canAccess(p), `${p.label} ${name} → ${status}`);
  }
}

// 반려 범위 — 담임 확인 뒤(teacher_checked) 반려는 결재권자만.
for (const p of P.filter(canAccess)) {
  session = p;
  const ctx = (await access.resolveBangkaAccess())!;
  put("공결 · 담임 확인 뒤 반려", p.label, access.canApproveAbsence(ctx) ? "허용" : "거부(신청 단계만)");
}
for (const p of P.filter((x) => !canAccess(x))) put("공결 · 담임 확인 뒤 반려", p.label, "거부");

// 방카톡 — 다른 직원 답글은 못 고치고 못 지움(결정 4). 박병현형 답글을 조유경형이 고치기·지우기 시도.
{
  const T = "00000000-0000-4000-8000-000000000071";
  const M = "00000000-0000-4000-8000-000000000072";
  db.bk_talk_messages = [
    { id: M, thread_id: T, author_type: "staff", staff_driver_id: "d-park", staff_name: "박병현형", body: "답", edited_at: null, deleted_at: null, hidden_at: null, hidden_by: null, hidden_reason: null, created_at: "2026-10-28T05:00:00Z" },
  ];
  const OTHER = /내가 쓴 답글만/;
  for (const [who, expectMine] of [["d-cho", false], ["d-park", true]] as const) {
    session = P.find((p) => p.id === who)!;
    const e = (await mod.talk.editMyReply(T, M, "고침")) as { ok: boolean; message?: string };
    const d = (await mod.talk.deleteMyReply(T, M)) as { ok: boolean; message?: string };
    const blocked = !e.ok && OTHER.test(e.message ?? "") && !d.ok && OTHER.test(d.message ?? "");
    put("방카톡 · 박병현형 답글 고치기·지우기", session.label, blocked ? "거부(남의 답글)" : e.ok && d.ok ? "허용(내 답글)" : `${e.message}/${d.message}`);
    check(expectMine ? e.ok && d.ok : blocked, `${session.label} 남의 답글 고치기`);
  }
  delete db.bk_talk_messages;
}

// 표 출력(마크다운)
const who = P.map((p) => p.label);
console.log(`| 화면 · 액션 | ${who.join(" | ")} |`);
console.log(`|---|${who.map(() => "---").join("|")}|`);
for (const [row, cells] of Object.entries(table)) console.log(`| ${row} | ${who.map((w) => cells[w]).join(" | ")} |`);
console.log(`\n통과 ${passed}건, 실패 ${failures.length}건`);
if (failures.length) {
  for (const f of failures) console.log("  FAIL", f);
  process.exit(1);
}
