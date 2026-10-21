"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireBangkaAccess } from "@/lib/bangkaAccess";
import {
  inviteExpiresAt,
  inviteState,
  normalizeInviteDays,
} from "@/lib/saemInvite";
import {
  bkStudentKey,
  isBkClassCode,
  isBkLocked,
  parseBkBulkText,
  type BkBulkPlan,
  type BkBulkPlanStudent,
  type BkGuardianDetail,
  type BkGuardianRow,
  type BkGuardianStatus,
  type BkStudentInput,
  type BkStudentRow,
} from "@/lib/bangka";

// =====================================================================
// 방과후아카데미 학생·보호자 관리 서버 액션 — /bangka/members
//   * 전부 service_role(supabaseAdmin). bk_* 는 RLS 정책 0개라 진입 시 권한 재검증.
//   * 삭제는 만들지 않습니다(관장 지시) — 학생은 퇴소(status='left', left_on),
//     보호자는 정지(status='suspended')로만 내립니다.
//   * 동래방카 쪽이 읽는 값: bk_guardians.phone(숫자만)·status·pin_hash·
//     invite_token·invite_expires_at, bk_students.status·class_code.
// =====================================================================

const STUDENTS = "bk_students";
const GUARDIANS = "bk_guardians";
const LINKS = "bk_guardian_students";
const BASE = "/bangka/members";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

function cleanStr(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

function fail(e: unknown, fallback: string): { ok: false; message: string } {
  return { ok: false, message: e instanceof Error ? e.message : fallback };
}

// 동래방카 주소 — Vercel 환경변수 BANGKA_BASE_URL. 없으면 null(링크를 만들지 않음:
//   틀린 주소로 보낸 링크는 조용히 실패하므로 기본값을 두지 않습니다).
function bangkaBaseUrl(): string | null {
  const v = (process.env.BANGKA_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return v || null;
}

function revalidateAll(guardianId?: string) {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/guardians`);
  if (guardianId) revalidatePath(`${BASE}/guardians/${guardianId}`);
}

// 가입 여부 = PIN 이 있고 초대중이 아님. 초대 링크 재발급은 PIN 을 지우고
//   invited 로 되돌리므로 그 순간부터 다시 '미가입' 입니다.
function guardianInviteState(g: {
  status: string;
  pin_hash: string | null;
  pin_set_at: string | null;
  invite_expires_at: string | null;
}) {
  const registered = g.status !== "invited" && !!g.pin_hash;
  return inviteState({
    password_set_at: registered ? (g.pin_set_at ?? "registered") : null,
    invite_expires_at: g.invite_expires_at,
  });
}

// =====================================================================
// 학생
// =====================================================================

export async function listStudents(filters: {
  classCode?: string;
  status?: string;
}): Promise<BkStudentRow[]> {
  await requireBangkaAccess();
  let q = supabaseAdmin
    .from(STUDENTS)
    .select(
      "id, name, school, grade, class_code, status, enrolled_on, left_on, memo, bk_guardian_students(bk_guardians(id, name, status))"
    )
    .order("class_code", { ascending: true })
    .order("name", { ascending: true });
  if (filters.classCode && isBkClassCode(filters.classCode))
    q = q.eq("class_code", filters.classCode);
  if (filters.status === "active" || filters.status === "left")
    q = q.eq("status", filters.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  type Raw = Omit<BkStudentRow, "guardians"> & {
    bk_guardian_students: { bk_guardians: { id: string; name: string; status: string } | null }[];
  };
  return ((data ?? []) as unknown as Raw[]).map(({ bk_guardian_students, ...s }) => ({
    ...s,
    guardians: bk_guardian_students
      .map((l) => l.bk_guardians)
      .filter((g): g is NonNullable<typeof g> => !!g),
  }));
}

export async function saveStudent(input: BkStudentInput): Promise<Result<{ id: string }>> {
  try {
    await requireBangkaAccess();
    const name = cleanStr(input.name);
    if (!name) return { ok: false, message: "이름을 입력하세요." };
    if (!isBkClassCode(input.class_code))
      return { ok: false, message: "반을 고르세요(이음반/지음반)." };
    const enrolled = cleanStr(input.enrolled_on);
    if (enrolled && !/^\d{4}-\d{2}-\d{2}$/.test(enrolled))
      return { ok: false, message: "입소일 형식이 올바르지 않습니다." };

    const row = {
      name,
      school: cleanStr(input.school),
      grade: cleanStr(input.grade),
      class_code: input.class_code,
      enrolled_on: enrolled,
      memo: cleanStr(input.memo),
    };

    if (input.id) {
      const { error } = await supabaseAdmin
        .from(STUDENTS)
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq("id", input.id);
      if (error) throw new Error(error.message);
      revalidateAll();
      return { ok: true, id: input.id };
    }
    const { data, error } = await supabaseAdmin
      .from(STUDENTS)
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidateAll();
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (e) {
    return fail(e, "학생을 저장하지 못했습니다.");
  }
}

// 퇴소 — 삭제 대신. 동래방카 세션의 연결 학생에서 바로 빠집니다(status='active' 만 읽음).
export async function setStudentLeft(input: {
  id: string;
  leftOn: string;
}): Promise<Result> {
  try {
    await requireBangkaAccess();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.leftOn ?? ""))
      return { ok: false, message: "퇴소일을 입력하세요." };
    const { error } = await supabaseAdmin
      .from(STUDENTS)
      .update({ status: "left", left_on: input.leftOn, updated_at: new Date().toISOString() })
      .eq("id", input.id);
    if (error) throw new Error(error.message);
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return fail(e, "퇴소 처리하지 못했습니다.");
  }
}

// 퇴소 취소 — 잘못 누른 경우 되돌리기.
export async function restoreStudent(id: string): Promise<Result> {
  try {
    await requireBangkaAccess();
    const { error } = await supabaseAdmin
      .from(STUDENTS)
      .update({ status: "active", left_on: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return fail(e, "재원으로 되돌리지 못했습니다.");
  }
}

// 보호자 상세의 [학생 연결] 드롭다운용 — 재원생만.
export async function listActiveStudentsBrief(): Promise<
  { id: string; name: string; school: string | null; grade: string | null; class_code: string }[]
> {
  await requireBangkaAccess();
  const { data, error } = await supabaseAdmin
    .from(STUDENTS)
    .select("id, name, school, grade, class_code")
    .eq("status", "active")
    .order("class_code", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as {
    id: string;
    name: string;
    school: string | null;
    grade: string | null;
    class_code: string;
  }[];
}

// =====================================================================
// 보호자
// =====================================================================

const GUARDIAN_COLS =
  "id, name, phone, relation, status, pin_hash, pin_set_at, invite_token, invite_expires_at, failed_attempts, locked_until, last_login_at, memo, bk_guardian_students(bk_students(id, name, class_code, status))";

type GuardianRaw = {
  id: string;
  name: string;
  phone: string;
  relation: string | null;
  status: BkGuardianStatus;
  pin_hash: string | null;
  pin_set_at: string | null;
  invite_token: string | null;
  invite_expires_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  memo: string | null;
  bk_guardian_students: {
    bk_students: { id: string; name: string; class_code: string; status: string } | null;
  }[];
};

// pin_hash·invite_token 은 여기서 떼어 내 화면으로 보내지 않습니다.
function toGuardianRow(g: GuardianRaw, nowMs: number): BkGuardianRow {
  return {
    id: g.id,
    name: g.name,
    phone: g.phone,
    relation: g.relation,
    status: g.status,
    last_login_at: g.last_login_at,
    locked: isBkLocked(g.locked_until, nowMs),
    invite: guardianInviteState(g),
    students: g.bk_guardian_students
      .map((l) => l.bk_students)
      .filter((s): s is NonNullable<typeof s> => !!s)
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
  };
}

export async function listGuardians(filters: { status?: string }): Promise<BkGuardianRow[]> {
  await requireBangkaAccess();
  let q = supabaseAdmin.from(GUARDIANS).select(GUARDIAN_COLS).order("name", { ascending: true });
  if (filters.status === "invited" || filters.status === "active" || filters.status === "suspended")
    q = q.eq("status", filters.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const now = Date.now();
  return ((data ?? []) as unknown as GuardianRaw[]).map((g) => toGuardianRow(g, now));
}

export async function getGuardianDetail(id: string): Promise<BkGuardianDetail | null> {
  await requireBangkaAccess();
  const { data, error } = await supabaseAdmin
    .from(GUARDIANS)
    .select(GUARDIAN_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const g = data as unknown as GuardianRaw;
  const now = Date.now();
  const row = toGuardianRow(g, now);
  const base = bangkaBaseUrl();
  const linkLive = row.invite.kind === "valid" && !!g.invite_token;
  return {
    ...row,
    failed_attempts: g.failed_attempts,
    locked_until: g.locked_until,
    pin_set_at: g.pin_set_at,
    memo: g.memo,
    inviteUrl: linkLive && base ? `${base}/invite/${g.invite_token}` : null,
    inviteExpiresAt: linkLive ? g.invite_expires_at : null,
  };
}

// 초대 링크 (재)발급 — 동래샘들 reissueInvite 와 같은 UX(7/14/30일, 기본 14일).
//   · 토큰: 랜덤 24바이트 hex. 덮어쓰므로 옛 링크는 즉시 무효.
//   · 이미 PIN 을 정한 보호자에게 발급하면 PIN 을 지우고 invited 로 되돌립니다
//     (PIN 분실 시 재설정 경로가 이것뿐입니다). 잠금·실패 횟수도 함께 초기화.
//   · 정지된 보호자는 거부 — 먼저 정지 해제(재발급이 정지를 몰래 풀지 않도록).
export async function reissueGuardianInvite(input: {
  guardianId: string;
  days?: number;
}): Promise<Result<{ url: string; expiresAt: string; name: string }>> {
  try {
    await requireBangkaAccess();
    const base = bangkaBaseUrl();
    if (!base)
      return {
        ok: false,
        message: "BANGKA_BASE_URL 환경변수가 없어 링크를 만들 수 없습니다(Vercel 환경변수 등록 필요).",
      };

    const { data: g } = await supabaseAdmin
      .from(GUARDIANS)
      .select("id, name, status")
      .eq("id", input.guardianId)
      .maybeSingle();
    if (!g) return { ok: false, message: "보호자를 찾을 수 없습니다." };
    if ((g as { status: string }).status === "suspended")
      return { ok: false, message: "정지된 보호자입니다. 먼저 [정지 해제]를 하세요." };

    const days = normalizeInviteDays(input.days);
    const token = randomBytes(24).toString("hex");
    const expiresAt = inviteExpiresAt(days);
    // 조회와 갱신 사이에 정지됐을 수 있어 조건을 한 번 더 겁니다.
    const { data: updated, error } = await supabaseAdmin
      .from(GUARDIANS)
      .update({
        invite_token: token,
        invite_expires_at: expiresAt,
        status: "invited",
        pin_hash: null,
        pin_set_at: null,
        must_change_pin: true,
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.guardianId)
      .neq("status", "suspended")
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated || updated.length === 0)
      return { ok: false, message: "방금 정지된 보호자입니다. 새로고침해 주세요." };

    revalidateAll(input.guardianId);
    return {
      ok: true,
      url: `${base}/invite/${token}`,
      expiresAt,
      name: String((g as { name: string }).name ?? ""),
    };
  } catch (e) {
    return fail(e, "초대 링크를 발급하지 못했습니다.");
  }
}

export async function unlockGuardian(id: string): Promise<Result> {
  try {
    await requireBangkaAccess();
    const { error } = await supabaseAdmin
      .from(GUARDIANS)
      .update({ failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidateAll(id);
    return { ok: true };
  } catch (e) {
    return fail(e, "잠금을 해제하지 못했습니다.");
  }
}

// 정지 ↔ 해제. 삭제 대신 쓰는 유일한 내리기 수단입니다.
//   · 정지: 동래방카가 매 요청 status='active' 를 확인하므로 즉시 로그아웃 효과.
//     살아 있는 초대 링크도 함께 지웁니다(정지 중 가입 방지).
//   · 해제: PIN 이 있으면 active, 아직 가입 전이었으면 invited(링크는 새로 발급).
export async function setGuardianSuspended(input: {
  id: string;
  suspended: boolean;
}): Promise<Result> {
  try {
    await requireBangkaAccess();
    const { data: g } = await supabaseAdmin
      .from(GUARDIANS)
      .select("id, status, pin_hash")
      .eq("id", input.id)
      .maybeSingle();
    if (!g) return { ok: false, message: "보호자를 찾을 수 없습니다." };
    const now = new Date().toISOString();
    const patch = input.suspended
      ? { status: "suspended", invite_token: null, invite_expires_at: null, updated_at: now }
      : {
          status: (g as { pin_hash: string | null }).pin_hash ? "active" : "invited",
          updated_at: now,
        };
    const { error } = await supabaseAdmin.from(GUARDIANS).update(patch).eq("id", input.id);
    if (error) throw new Error(error.message);
    revalidateAll(input.id);
    return { ok: true };
  } catch (e) {
    return fail(e, "상태를 바꾸지 못했습니다.");
  }
}

export async function linkStudent(input: {
  guardianId: string;
  studentId: string;
}): Promise<Result> {
  try {
    await requireBangkaAccess();
    const { error } = await supabaseAdmin
      .from(LINKS)
      .upsert(
        { guardian_id: input.guardianId, student_id: input.studentId },
        { onConflict: "guardian_id,student_id", ignoreDuplicates: true }
      );
    if (error) throw new Error(error.message);
    revalidateAll(input.guardianId);
    return { ok: true };
  } catch (e) {
    return fail(e, "학생을 연결하지 못했습니다.");
  }
}

export async function unlinkStudent(input: {
  guardianId: string;
  studentId: string;
}): Promise<Result> {
  try {
    await requireBangkaAccess();
    const { error } = await supabaseAdmin
      .from(LINKS)
      .delete()
      .eq("guardian_id", input.guardianId)
      .eq("student_id", input.studentId);
    if (error) throw new Error(error.message);
    revalidateAll(input.guardianId);
    return { ok: true };
  } catch (e) {
    return fail(e, "연결을 해제하지 못했습니다.");
  }
}

// =====================================================================
// 일괄 등록 — 붙여넣기 → 미리보기 → 저장
//   미리보기와 저장이 같은 buildBulkPlan 을 씁니다. 저장은 클라이언트가 보낸
//   계획이 아니라 원문을 서버에서 다시 해석합니다(미리보기 뒤 DB 가 바뀌었어도
//   그 시점 기준으로 맞게 저장).
//   · 학생: 같은 이름·학교·학년·반 재원생이 있으면 새로 만들지 않고 그 학생에
//     보호자만 연결 → 같은 내용을 두 번 붙여 넣어도 중복이 생기지 않습니다.
//   · 보호자: phone(숫자만)으로 있으면 연결만, 없으면 status='invited' 로 생성.
//     초대 링크는 만들지 않습니다(보호자 상세에서 발급).
// =====================================================================

async function buildBulkPlan(text: string): Promise<BkBulkPlan> {
  const lines = parseBkBulkText(text);
  const errors: { line: number; message: string }[] = [];
  for (const l of lines) for (const m of l.errors) errors.push({ line: l.line, message: m });

  // 붙여넣기 안에서 같은 전화번호에 다른 이름 → 어느 쪽이 맞는지 모르므로 오류.
  const nameByPhone = new Map<string, { name: string; line: number }>();
  for (const l of lines) {
    if (!l.phone || l.errors.length) continue;
    const prev = nameByPhone.get(l.phone);
    if (prev && prev.name !== l.guardianName)
      errors.push({
        line: l.line,
        message: `같은 전화번호가 ${prev.line}번째 줄에서는 "${prev.name}"입니다`,
      });
    else if (!prev) nameByPhone.set(l.phone, { name: l.guardianName, line: l.line });
  }

  // 학생 단위로 묶기.
  const groups = new Map<string, BkBulkPlanStudent>();
  for (const l of lines) {
    if (l.errors.length || !l.classCode) continue;
    const key = bkStudentKey({ name: l.name, school: l.school, grade: l.grade, class_code: l.classCode });
    let s = groups.get(key);
    if (!s) {
      s = {
        lines: [],
        name: l.name,
        school: l.school,
        grade: l.grade,
        class_code: l.classCode,
        existingId: null,
        guardians: [],
      };
      groups.set(key, s);
    }
    s.lines.push(l.line);
    if (l.phone && !s.guardians.some((g) => g.phone === l.phone))
      s.guardians.push({
        name: l.guardianName,
        relation: l.relation,
        phone: l.phone,
        existingId: null,
        existingName: null,
        alreadyLinked: false,
      });
  }
  const students = [...groups.values()];

  // 기존 재원생 대조.
  const { data: existingStudents, error: e1 } = await supabaseAdmin
    .from(STUDENTS)
    .select("id, name, school, grade, class_code")
    .eq("status", "active");
  if (e1) throw new Error(e1.message);
  const studentIdByKey = new Map<string, string>();
  for (const s of (existingStudents ?? []) as {
    id: string;
    name: string;
    school: string | null;
    grade: string | null;
    class_code: string;
  }[])
    studentIdByKey.set(bkStudentKey(s), s.id);
  for (const s of students) s.existingId = studentIdByKey.get(bkStudentKey(s)) ?? null;

  // 기존 보호자 대조(전화번호).
  const phones = [...new Set(students.flatMap((s) => s.guardians.map((g) => g.phone)))];
  const guardianByPhone = new Map<string, { id: string; name: string }>();
  if (phones.length > 0) {
    const { data, error } = await supabaseAdmin
      .from(GUARDIANS)
      .select("id, name, phone")
      .in("phone", phones);
    if (error) throw new Error(error.message);
    for (const g of (data ?? []) as { id: string; name: string; phone: string }[])
      guardianByPhone.set(g.phone, { id: g.id, name: g.name });
  }

  // 이미 있는 연결(기존 학생 × 기존 보호자).
  const existingStudentIds = students.map((s) => s.existingId).filter((v): v is string => !!v);
  const linked = new Set<string>();
  if (existingStudentIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from(LINKS)
      .select("guardian_id, student_id")
      .in("student_id", existingStudentIds);
    if (error) throw new Error(error.message);
    for (const l of (data ?? []) as { guardian_id: string; student_id: string }[])
      linked.add(`${l.guardian_id}|${l.student_id}`);
  }

  for (const s of students)
    for (const g of s.guardians) {
      const found = guardianByPhone.get(g.phone);
      g.existingId = found?.id ?? null;
      g.existingName = found?.name ?? null;
      g.alreadyLinked = !!(found && s.existingId && linked.has(`${found.id}|${s.existingId}`));
    }

  const newGuardianPhones = new Set(
    students.flatMap((s) => s.guardians.filter((g) => !g.existingId).map((g) => g.phone))
  );
  const existingGuardianIds = new Set(
    students.flatMap((s) => s.guardians.map((g) => g.existingId).filter((v): v is string => !!v))
  );
  return {
    errors: errors.sort((a, b) => a.line - b.line),
    students,
    summary: {
      newStudents: students.filter((s) => !s.existingId).length,
      existingStudents: students.filter((s) => s.existingId).length,
      newGuardians: newGuardianPhones.size,
      existingGuardians: existingGuardianIds.size,
      newLinks: students.reduce((n, s) => n + s.guardians.filter((g) => !g.alreadyLinked).length, 0),
    },
  };
}

export async function previewBulk(text: string): Promise<Result<{ plan: BkBulkPlan }>> {
  try {
    await requireBangkaAccess();
    return { ok: true, plan: await buildBulkPlan(text) };
  } catch (e) {
    return fail(e, "미리보기를 만들지 못했습니다.");
  }
}

// 보호자 id — 있으면 그대로, 없으면 invited 로 생성. 동시에 같은 번호가
//   생성되면(UNIQUE phone) 다시 조회해 그 행을 씁니다.
async function ensureGuardian(
  g: { name: string; relation: string; phone: string },
  cache: Map<string, string>
): Promise<string> {
  const hit = cache.get(g.phone);
  if (hit) return hit;
  const { data, error } = await supabaseAdmin
    .from(GUARDIANS)
    .insert({ name: g.name, relation: cleanStr(g.relation), phone: g.phone, status: "invited" })
    .select("id")
    .single();
  let id: string;
  if (error) {
    const { data: again } = await supabaseAdmin
      .from(GUARDIANS)
      .select("id")
      .eq("phone", g.phone)
      .maybeSingle();
    if (!again) throw new Error(`보호자 생성 실패(${g.name}): ${error.message}`);
    id = String((again as { id: string }).id);
  } else {
    id = String((data as { id: string }).id);
  }
  cache.set(g.phone, id);
  return id;
}

export async function saveBulk(text: string): Promise<
  Result<{ students: number; guardians: number; links: number }>
> {
  try {
    await requireBangkaAccess();
    const plan = await buildBulkPlan(text);
    if (plan.errors.length > 0)
      return { ok: false, message: `오류 ${plan.errors.length}건을 먼저 고쳐 주세요.` };
    if (plan.students.length === 0) return { ok: false, message: "저장할 줄이 없습니다." };

    // REST 라 트랜잭션이 없습니다. 중간에 실패해도 같은 내용을 다시 저장하면
    //   이미 만든 학생·보호자·연결은 건너뛰므로 이어서 마저 들어갑니다.
    const guardianIds = new Map<string, string>();
    for (const s of plan.students)
      for (const g of s.guardians) if (g.existingId) guardianIds.set(g.phone, g.existingId);
    let createdStudents = 0;
    let createdGuardians = 0;
    let createdLinks = 0;

    for (const s of plan.students) {
      let studentId = s.existingId;
      if (!studentId) {
        const { data, error } = await supabaseAdmin
          .from(STUDENTS)
          .insert({
            name: s.name,
            school: cleanStr(s.school),
            grade: cleanStr(s.grade),
            class_code: s.class_code,
          })
          .select("id")
          .single();
        if (error) throw new Error(`학생 저장 실패(${s.name}): ${error.message}`);
        studentId = String((data as { id: string }).id);
        createdStudents++;
      }
      for (const g of s.guardians) {
        if (g.alreadyLinked) continue;
        const before = guardianIds.size;
        const guardianId = await ensureGuardian(g, guardianIds);
        if (guardianIds.size > before) createdGuardians++;
        const { error } = await supabaseAdmin
          .from(LINKS)
          .upsert(
            { guardian_id: guardianId, student_id: studentId },
            { onConflict: "guardian_id,student_id", ignoreDuplicates: true }
          );
        if (error) throw new Error(`연결 실패(${s.name}–${g.name}): ${error.message}`);
        createdLinks++;
      }
    }

    revalidateAll();
    return { ok: true, students: createdStudents, guardians: createdGuardians, links: createdLinks };
  } catch (e) {
    return fail(e, "일괄 등록을 저장하지 못했습니다.");
  }
}
