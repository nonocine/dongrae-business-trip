// 인사발령 본인 입력·확정 액션 검증 — 실제 서버 액션을 부르고 DB·세션·슬랙만 메모리 가짜.
//   실행: node --experimental-test-module-mocks --import tsx scripts/test-appointment-actions.mts

import { mock } from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();
const url = (p: string) => pathToFileURL(path.join(root, p)).href;

let passed = 0;
function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(`FAIL: ${message}`);
  passed++;
  console.log(`  ok  ${message}`);
}

type Row = Record<string, unknown>;
const D = {
  boss: "d-boss", // 관장
  bujang: "d-bujang", // 부장
  personnel: "d-pers", // 팀장 + personnel 직무
  me: "d-me", // 일반 직원 본인
  other: "d-other", // 다른 일반 직원
};
const db: Record<string, Row[]> = {
  drivers: [
    { id: D.boss, name: "관장님", rank: "관장", is_active: true },
    { id: D.bujang, name: "부장님", rank: "부장", is_active: true },
    { id: D.personnel, name: "인사팀장", rank: "팀장", is_active: true },
    { id: D.me, name: "박준우", rank: "팀원", is_active: true },
    { id: D.other, name: "정지영", rank: "팀원", is_active: true },
  ],
  employee_roles: [{ driver_id: D.personnel, role_key: "personnel" }],
  employee_profiles: [
    { driver_id: D.boss, email: "boss@x", appointments: [] },
    { driver_id: D.bujang, email: "bujang@x", appointments: [] },
    { driver_id: D.personnel, email: "pers@x", appointments: [] },
    {
      driver_id: D.me,
      email: "me@x",
      join_date: "2024-03-01",
      // 옛 확정 항목(id·status 없음)
      appointments: [
        { type: "전보", title: "팀원", department: "청소년사업팀", duty: "", effective_date: "2025-01-01", note: "" },
      ],
    },
    {
      driver_id: D.other,
      email: "other@x",
      appointments: [
        { id: "o-1", type: "입사", title: "팀원", department: "교육문화사업팀", duty: "", effective_date: "2023-01-01", note: "" },
      ],
    },
  ],
};

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let patch: Row | null = null;
  let insertRow: Row | null = null;
  const rows = () => (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
    in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
    update: (p: Row) => ((patch = p), q),
    insert: (p: Row) => ((insertRow = p), q),
    maybeSingle: async () => ({ data: structuredClone(rows()[0] ?? null), error: null }),
    then: (resolve: (v: unknown) => void) => {
      if (insertRow) (db[table] ??= []).push(structuredClone(insertRow));
      else if (patch) for (const r of rows()) Object.assign(r, structuredClone(patch));
      resolve({ data: insertRow || patch ? null : structuredClone(rows()), error: null });
    },
  };
  return q;
}
const fakeClient = { from: (t: string) => query(t) };

let sessionName: string | null = null;
const dms: { email: string; text: string }[] = [];
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module(url("app/actions.ts"), {
  namedExports: {
    getSession: async () => (sessionName ? { kind: "employee", name: sessionName } : null),
    getGoogleSession: async () => null,
  },
});
mock.module(url("lib/supabaseAdmin.ts"), { namedExports: { supabaseAdmin: fakeClient } });
mock.module(url("lib/slack.ts"), {
  namedExports: {
    sendSlack: async () => true,
    sendSlackDM: async (email: string, text: string) => (dms.push({ email, text }), true),
    sendSlackDMDetailed: async () => ({ ok: true, reason: null }),
    siteBaseUrl: () => "https://example.test",
    slackLink: (u: string, l: string) => `<${u}|${l}>`,
  },
});

const my = await import(url("app/(app)/profile/hr/appointmentActions.ts"));
const rv = await import(url("app/(app)/hr/appointmentReviewActions.ts"));
const { currentAssignment } = await import(url("lib/appointments.ts"));

const as = (name: string | null) => (sessionName = name);
const apptsOf = (id: string) =>
  (db.employee_profiles.find((r) => r.driver_id === id)!.appointments as Row[]);
const join = { type: "입사", title: "팀원", department: "청소년사업팀", duty: "", effective_date: "2024-03-01", note: "" };

// --- 1. 본인 추가 → pending, status 위조 무시, DM 1회 ----------------------------
console.log("1. 본인 추가");
as("박준우");
let r = await my.addMyAppointment({ ...join, status: "confirmed", confirmed_by: "가짜", id: "forged" });
assert(r.ok, "본인 발령 추가 허용");
let list = apptsOf(D.me);
const added = list.at(-1)!;
assert(added.status === "pending", "status 를 confirmed 로 보내도 pending 으로 저장");
assert(added.id !== "forged" && !added.confirmed_by, "id·confirmed_by 위조 무시");
assert(list.every((a) => a.id), "옛 항목에도 id 부여");
assert(dms.length === 3 && new Set(dms.map((d) => d.email)).size === 3, "확정 권한자 3명(관장·부장·personnel)에게 DM");
assert(!dms.some((d) => ["me@x", "other@x"].includes(d.email)), "일반 직원에게는 DM 없음");
assert(typeof added.notified_at === "string", "DM 보낸 항목에 notified_at 기록");

// 같은 날 두 번째 건 — DM 묶음(추가 발송 없음)
r = await my.addMyAppointment({ ...join, type: "기타", effective_date: "2024-06-01" });
assert(r.ok && dms.length === 3, "같은 직원 같은 날 두 번째 건은 DM 다시 안 보냄");
const second = apptsOf(D.me).at(-1)!;

// --- 2. 현재 소속은 pending 무시 ---------------------------------------------
console.log("2. 현재 소속");
const cur = currentAssignment(apptsOf(D.me), "2026-10-23").current;
assert(cur?.type === "전보" && cur.effectiveDate === "2025-01-01", "현재 소속 = 확정된 전보(대기 중인 입사·기타 무시)");
const onlyPending = currentAssignment([{ ...join, status: "pending" }], "2026-10-23");
assert(onlyPending.current === null, "대기 건만 있으면 현재 소속 없음");
assert(currentAssignment([{ ...join, status: "rejected" }], "2026-10-23").current === null, "반려 건도 무시");

// --- 3. 본인 pending 수정·삭제 허용, confirmed 거부 -----------------------------
console.log("3. 본인 수정·삭제");
r = await my.updateMyAppointment(added.id, { ...join, note: "고침", status: "confirmed" });
assert(r.ok, "본인 pending 수정 허용");
let a1 = apptsOf(D.me).find((a) => a.id === added.id)!;
assert(a1.status === "pending" && a1.note === "고침", "수정 후에도 pending");
r = await my.deleteMyAppointment(second.id);
assert(r.ok && !apptsOf(D.me).some((a) => a.id === second.id), "본인 pending 삭제 허용");
const confirmedOld = apptsOf(D.me)[0];
r = await my.updateMyAppointment(confirmedOld.id, { ...join });
assert(!r.ok, "확정 항목 직접 수정 거부");
r = await my.deleteMyAppointment(confirmedOld.id);
assert(!r.ok && apptsOf(D.me).some((a) => a.id === confirmedOld.id), "확정 항목 삭제 거부");

// --- 4. 남의 것 거부 ---------------------------------------------------------
console.log("4. 다른 직원");
as("정지영");
const meBefore = JSON.stringify(apptsOf(D.me));
r = await my.updateMyAppointment(added.id, { ...join, note: "남이 고침" });
assert(!r.ok, "다른 직원이 내 pending id 로 수정 → 거부");
r = await my.deleteMyAppointment(added.id);
assert(!r.ok, "다른 직원이 내 pending id 로 삭제 → 거부");
r = await my.requestMyAppointmentChange({ id: confirmedOld.id }, { ...join });
assert(!r.ok, "다른 직원이 내 확정 id 로 수정 요청 → 거부");
assert(JSON.stringify(apptsOf(D.me)) === meBefore, "내 발령 그대로");
for (const fn of [
  () => rv.confirmEmployeeAppointment(D.me, added.id),
  () => rv.rejectEmployeeAppointment(D.me, added.id, "x"),
]) assert(!(await fn()).ok, "일반 직원(다른 직원)은 확정·반려 불가");
as("박준우");
assert(!(await rv.confirmEmployeeAppointment(D.me, added.id)).ok, "본인도 자기 것 확정 불가");
assert(apptsOf(D.me).find((a) => a.id === added.id)!.status === "pending", "여전히 pending");

// --- 5. 수정 요청(확정 항목) ---------------------------------------------------
console.log("5. 수정 요청");
r = await my.requestMyAppointmentChange({ id: confirmedOld.id }, { ...join, type: "전보", effective_date: "2025-01-01", title: "주임" });
assert(r.ok, "확정 항목 수정 요청 허용");
const req = apptsOf(D.me).at(-1)!;
assert(req.status === "pending" && req.original_id === confirmedOld.id, "요청은 pending + original_id");
assert(apptsOf(D.me).find((a) => a.id === confirmedOld.id)!.title === "팀원", "원본은 그대로");
r = await my.requestMyAppointmentChange({ id: confirmedOld.id }, { ...join, type: "전보", effective_date: "2025-01-01", title: "선임" });
assert(!r.ok, "같은 원본에 대기 중인 요청이 있으면 또 요청 거부");

// --- 6. 확정·반려: 관장·부장·personnel 만 ---------------------------------------
console.log("6. 확정·반려");
as("관장님");
r = await rv.confirmEmployeeAppointment(D.me, added.id);
assert(r.ok && apptsOf(D.me).find((a) => a.id === added.id)!.status === "confirmed", "관장 확정");
assert(apptsOf(D.me).find((a) => a.id === added.id)!.confirmed_by === "관장님", "confirmed_by 기록");
as("인사팀장");
r = await rv.confirmEmployeeAppointment(D.me, req.id);
assert(r.ok, "personnel 팀장 확정(수정 요청)");
list = apptsOf(D.me);
assert(!list.some((a) => a.id === req.id), "요청 항목은 사라지고");
const replaced = list.find((a) => a.id === confirmedOld.id)!;
assert(replaced.title === "주임" && replaced.status === "confirmed", "원본 자리가 바뀐 내용으로 교체");
assert(currentAssignment(list, "2026-10-23").current?.title === "주임", "확정 후 현재 소속 반영");

as("박준우");
r = await my.addMyAppointment({ ...join, type: "기타", effective_date: "2026-01-01" });
const third = apptsOf(D.me).at(-1)!;
as("부장님");
assert(!(await rv.rejectEmployeeAppointment(D.me, third.id, "  ")).ok, "사유 없는 반려 거부");
r = await rv.rejectEmployeeAppointment(D.me, third.id, "날짜 확인 필요");
const rej = apptsOf(D.me).find((a) => a.id === third.id)!;
assert(r.ok && rej.status === "rejected" && rej.reject_reason === "날짜 확인 필요", "부장 반려(사유 기록)");
assert(!(await rv.confirmEmployeeAppointment(D.me, third.id)).ok, "반려된 건은 바로 확정 불가");
as("박준우");
r = await my.updateMyAppointment(third.id, { ...join, type: "기타", effective_date: "2026-02-01" });
assert(r.ok && apptsOf(D.me).find((a) => a.id === third.id)!.status === "pending", "반려 건 고쳐 다시 올리면 pending");
r = await my.updateMyAppointment(added.id, { ...join });
assert(!r.ok, "확정된(방금 확정된) 건은 본인 수정 거부");

// --- 7. 로그인 없음 ----------------------------------------------------------
as(null);
assert(!(await my.addMyAppointment(join)).ok, "로그인 없음 → 추가 거부");
assert(!(await rv.confirmEmployeeAppointment(D.me, third.id)).ok, "로그인 없음 → 확정 거부");

console.log(`\n${passed} passed`);
