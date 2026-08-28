"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireClubAccess } from "@/lib/clubAccess";
import { normalizePhone, saemAppUrl } from "@/lib/saem";
import { getInstructorIdsWithRole, addRole } from "@/lib/saemRoles";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendSlack, siteBaseUrl, slackLink } from "@/lib/slack";

const CLUB_PROJECT = "청소년동아리 Do Go Do Go 동아리";
const CLUB_ROLE = "club_teacher";

type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

export type ClubTeacherRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: string;
  password_set_at: string | null;
  alsoInstructor: boolean; // 강사 겸직 여부 (배지 표시용)
};

// 등록 UI의 "기존 강사에서 선택"용. 아직 동아리 역할이 없는 강사 목록.
export type InstructorPickRow = {
  id: string;
  name: string;
  phone: string | null;
  alreadyClub: boolean;
};

export type ClubMonthRow = {
  id: string;
  name: string;
  teacherId: string | null;
  teacherName: string | null;
  target: string | null;
  capacity: number | null;
  room: string | null;
  goal: string | null;
  registeredCount: number;
  sessionCount: number;
  submittedCount: number;
  confirmedCount: number;
  attendanceTotal: number;
  expenseTotal: number;
  reportStatus: "draft" | "submitted" | "confirmed";
};

export type ClubDashboardData = {
  configured: boolean;
  teachers: ClubTeacherRow[];
  instructors: InstructorPickRow[]; // 겸직 지정용 기존 강사 목록
  clubs: ClubMonthRow[];
};

export type ClubReportRow = {
  id: string;
  name: string;
  goal: string;
  target: string;
  registeredCount: number;
  sessions: Array<{
    date: string;
    content: string;
    location: string;
    participants: number;
  }>;
  expenses: Array<{
    date: string;
    fundingSource: string;
    budgetCategory: string;
    description: string;
    amount: number;
  }>;
};

function missingSchema(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.message?.includes("schema cache")
  );
}

function monthRange(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const next =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { start: `${year}-${mm}-01`, endExclusive: next };
}

// 동아리 역할(club_teacher)을 가진 계정 id 목록. 순수 동아리샘 + 강사 겸직자 모두 포함.
async function clubTeacherIds(): Promise<string[]> {
  return getInstructorIdsWithRole(CLUB_ROLE);
}

export async function getClubDashboard(
  year: number,
  month: number
): Promise<ClubDashboardData> {
  await requireClubAccess();

  // 1) 동아리 역할자 id 목록 (겸직 포함) → 계정 정보 조회
  let teacherIds: string[] = [];
  try {
    teacherIds = await clubTeacherIds();
  } catch (e) {
    // 역할 테이블이 아직 없으면 미구성으로 처리
    return { configured: false, teachers: [], instructors: [], clubs: [] };
  }

  const teacherQuery = teacherIds.length
    ? await supabaseAdmin
        .from("saem_instructors")
        .select("id,name,phone,email,status,password_set_at")
        .in("id", teacherIds)
        .order("name")
    : { data: [], error: null };
  if (missingSchema(teacherQuery.error)) {
    return { configured: false, teachers: [], instructors: [], clubs: [] };
  }
  if (teacherQuery.error) throw new Error(teacherQuery.error.message);

  // 각 동아리샘이 강사 역할도 가졌는지(겸직 배지용)
  const instructorRoleIds = new Set(
    await getInstructorIdsWithRole("instructor")
  );
  const teachers: ClubTeacherRow[] = (teacherQuery.data ?? []).map((r) => {
    const row = r as Omit<ClubTeacherRow, "alsoInstructor">;
    return { ...row, alsoInstructor: instructorRoleIds.has(row.id) };
  });

  // 2) 겸직 지정용: 아직 동아리 역할이 없는 강사 목록
  const teacherIdSet = new Set(teacherIds);
  const instrQuery = await supabaseAdmin
    .from("saem_instructors")
    .select("id,name,phone,status")
    .eq("status", "active")
    .order("name");
  if (instrQuery.error) throw new Error(instrQuery.error.message);
  const instructors: InstructorPickRow[] = (instrQuery.data ?? [])
    .filter((r) => instructorRoleIds.has(String((r as { id: string }).id)))
    .map((r) => {
      const row = r as { id: string; name: string; phone: string | null };
      return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        alreadyClub: teacherIdSet.has(row.id),
      };
    });

  // 3) 동아리 프로그램 조회
  const programQuery = await supabaseAdmin
    .from("saem_programs")
    .select("id,name,instructor_id,target,capacity,room,goal,status")
    .eq("program_type", "club")
    .eq("status", "active")
    .order("name");
  if (missingSchema(programQuery.error)) {
    return { configured: false, teachers, instructors, clubs: [] };
  }
  if (programQuery.error) throw new Error(programQuery.error.message);

  const programs = (programQuery.data ?? []) as Array<{
    id: string;
    name: string;
    instructor_id: string | null;
    target: string | null;
    capacity: number | null;
    room: string | null;
    goal: string | null;
  }>;
  if (programs.length === 0)
    return { configured: true, teachers, instructors, clubs: [] };

  const ids = programs.map((p) => p.id);
  const range = monthRange(year, month);
  const [sessionsQuery, expensesQuery, reportsQuery, enrollmentsQuery] =
    await Promise.all([
      supabaseAdmin
        .from("saem_sessions")
        .select(
          "program_id,session_date,student_count,instructor_submitted_at,staff_confirmed_at"
        )
        .in("program_id", ids)
        .gte("session_date", range.start)
        .lt("session_date", range.endExclusive),
      supabaseAdmin
        .from("club_expenses")
        .select("program_id,amount")
        .in("program_id", ids)
        .gte("expense_date", range.start)
        .lt("expense_date", range.endExclusive),
      supabaseAdmin
        .from("club_monthly_reports")
        .select("program_id,status")
        .in("program_id", ids)
        .eq("report_year", year)
        .eq("report_month", month),
      supabaseAdmin
        .from("saem_enrollments")
        .select("program_id,status")
        .in("program_id", ids)
        .eq("status", "active"),
    ]);
  for (const query of [
    sessionsQuery,
    expensesQuery,
    reportsQuery,
    enrollmentsQuery,
  ]) {
    if (query.error) throw new Error(query.error.message);
  }

  const teacherName = new Map(teachers.map((t) => [t.id, t.name]));
  const sessionsBy = new Map<string, Array<Record<string, unknown>>>();
  for (const row of sessionsQuery.data ?? []) {
    const r = row as Record<string, unknown>;
    const id = String(r.program_id);
    sessionsBy.set(id, [...(sessionsBy.get(id) ?? []), r]);
  }
  const expenseBy = new Map<string, number>();
  for (const row of expensesQuery.data ?? []) {
    const r = row as { program_id: string; amount: number };
    expenseBy.set(
      r.program_id,
      (expenseBy.get(r.program_id) ?? 0) + Number(r.amount ?? 0)
    );
  }
  const reportBy = new Map(
    (reportsQuery.data ?? []).map((r) => {
      const row = r as {
        program_id: string;
        status: "draft" | "submitted" | "confirmed";
      };
      return [row.program_id, row.status] as const;
    })
  );
  const enrolledBy = new Map<string, number>();
  for (const row of enrollmentsQuery.data ?? []) {
    const id = String((row as { program_id: string }).program_id);
    enrolledBy.set(id, (enrolledBy.get(id) ?? 0) + 1);
  }

  const clubs = programs.map((program): ClubMonthRow => {
    const sessions = sessionsBy.get(program.id) ?? [];
    return {
      id: program.id,
      name: program.name,
      teacherId: program.instructor_id,
      teacherName: program.instructor_id
        ? teacherName.get(program.instructor_id) ?? null
        : null,
      target: program.target,
      capacity: program.capacity,
      room: program.room,
      goal: program.goal,
      registeredCount: enrolledBy.get(program.id) ?? program.capacity ?? 0,
      sessionCount: sessions.length,
      submittedCount: sessions.filter((s) => s.instructor_submitted_at != null)
        .length,
      confirmedCount: sessions.filter((s) => s.staff_confirmed_at != null)
        .length,
      attendanceTotal: sessions.reduce(
        (sum, s) => sum + Number(s.student_count ?? 0),
        0
      ),
      expenseTotal: expenseBy.get(program.id) ?? 0,
      reportStatus: reportBy.get(program.id) ?? "draft",
    };
  });
  return { configured: true, teachers, instructors, clubs };
}

export async function getClubReportData(
  year: number,
  month: number
): Promise<ClubReportRow[]> {
  await requireClubAccess();
  const range = monthRange(year, month);
  const { data: programs, error } = await supabaseAdmin
    .from("saem_programs")
    .select("id,name,goal,target,capacity,room")
    .eq("program_type", "club")
    .eq("status", "active")
    .order("name");
  if (error) throw new Error(error.message);
  const programRows = (programs ?? []) as Array<{
    id: string;
    name: string;
    goal: string | null;
    target: string | null;
    capacity: number | null;
    room: string | null;
  }>;
  if (!programRows.length) return [];
  const ids = programRows.map((p) => p.id);
  const [sessions, expenses, enrollments] = await Promise.all([
    supabaseAdmin
      .from("saem_sessions")
      .select(
        "program_id,session_date,log_content,plan_content,activity_location,student_count"
      )
      .in("program_id", ids)
      .gte("session_date", range.start)
      .lt("session_date", range.endExclusive)
      .not("instructor_submitted_at", "is", null)
      .order("session_date"),
    supabaseAdmin
      .from("club_expenses")
      .select(
        "program_id,expense_date,funding_source,budget_category,description,amount"
      )
      .in("program_id", ids)
      .gte("expense_date", range.start)
      .lt("expense_date", range.endExclusive)
      .order("expense_date"),
    supabaseAdmin
      .from("saem_enrollments")
      .select("program_id")
      .in("program_id", ids)
      .eq("status", "active"),
  ]);
  for (const query of [sessions, expenses, enrollments]) {
    if (query.error) throw new Error(query.error.message);
  }
  const enrolled = new Map<string, number>();
  for (const row of enrollments.data ?? []) {
    const id = String((row as { program_id: string }).program_id);
    enrolled.set(id, (enrolled.get(id) ?? 0) + 1);
  }
  return programRows.map((program) => ({
    id: program.id,
    name: program.name,
    goal: program.goal ?? "",
    target: program.target ?? "청소년",
    registeredCount: enrolled.get(program.id) ?? program.capacity ?? 0,
    sessions: (sessions.data ?? [])
      .filter(
        (row) =>
          String((row as { program_id: string }).program_id) === program.id
      )
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          date: String(item.session_date ?? ""),
          content: String(item.log_content ?? item.plan_content ?? ""),
          location: String(item.activity_location ?? program.room ?? ""),
          participants: Number(item.student_count ?? 0),
        };
      }),
    expenses: (expenses.data ?? [])
      .filter(
        (row) =>
          String((row as { program_id: string }).program_id) === program.id
      )
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          date: String(item.expense_date ?? ""),
          fundingSource: String(item.funding_source ?? ""),
          budgetCategory: String(item.budget_category ?? ""),
          description: String(item.description ?? ""),
          amount: Number(item.amount ?? 0),
        };
      }),
  }));
}

// 동아리샘 등록.
//  - 신규(전화번호 미존재): 새 계정 생성 + club_teacher 역할 부여 + 초대링크
//  - 기존 강사(전화번호 일치): 계정을 새로 만들지 않고 club_teacher 역할만 추가(겸직)
export async function createClubTeacher(input: {
  name: string;
  phone: string;
  email?: string;
}): Promise<
  ActionResult<{ id: string; inviteUrl: string | null; merged: boolean }>
> {
  try {
    const access = await requireClubAccess();
    const name = input.name.trim();
    const phone = normalizePhone(input.phone);
    if (!name || !phone)
      return { ok: false, message: "이름과 전화번호를 입력하세요." };

    // 전화번호로 기존 계정 조회
    const { data: existing } = await supabaseAdmin
      .from("saem_instructors")
      .select("id,name")
      .eq("phone", phone)
      .maybeSingle();

    if (existing) {
      // 기존 계정이면 새로 만들지 않고 동아리 역할만 추가(겸직)
      const existingId = String((existing as { id: string }).id);
      await addRole(existingId, CLUB_ROLE, access.name);
      revalidatePath("/hr/clubs");
      return {
        ok: true,
        id: existingId,
        inviteUrl: null,
        merged: true, // 기존 강사에 역할 추가됨(신규 계정 아님)
      };
    }

    // 신규 계정 + 동아리 역할 + 초대링크
    const token = randomUUID();
    const expires = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { data, error } = await supabaseAdmin
      .from("saem_instructors")
      .insert({
        name,
        phone,
        email: input.email?.trim() || null,
        account_type: CLUB_ROLE, // 레거시 컬럼 호환(주 역할). 실제 판별은 saem_member_roles.
        status: "active",
        invite_token: token,
        invite_expires_at: expires,
        must_change_password: false,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const newId = String((data as { id: string }).id);
    await addRole(newId, CLUB_ROLE, access.name);
    revalidatePath("/hr/clubs");
    return {
      ok: true,
      id: newId,
      inviteUrl: `${saemAppUrl()}/invite/${token}`,
      merged: false,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "등록하지 못했습니다.",
    };
  }
}

// 기존 강사를 골라 동아리 역할만 추가(겸직 지정 전용).
export async function addClubRoleToInstructor(input: {
  instructorId: string;
}): Promise<ActionResult> {
  try {
    const access = await requireClubAccess();
    const id = input.instructorId?.trim();
    if (!id) return { ok: false, message: "강사를 선택하세요." };
    const { data: found } = await supabaseAdmin
      .from("saem_instructors")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!found) return { ok: false, message: "강사를 찾을 수 없습니다." };
    await addRole(id, CLUB_ROLE, access.name);
    revalidatePath("/hr/clubs");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "역할을 추가하지 못했습니다.",
    };
  }
}

async function ensureClubTerm(year: number): Promise<string> {
  let { data: project } = await supabaseAdmin
    .from("saem_projects")
    .select("id")
    .eq("name", CLUB_PROJECT)
    .maybeSingle();
  if (!project) {
    const inserted = await supabaseAdmin
      .from("saem_projects")
      .insert({
        name: CLUB_PROJECT,
        description: "청소년동아리 월간 활동·실적 관리",
        status: "active",
      })
      .select("id")
      .single();
    if (inserted.error) throw new Error(inserted.error.message);
    project = inserted.data;
  }
  const projectId = String((project as { id: string }).id);
  const termName = `${year}년`;
  let { data: term } = await supabaseAdmin
    .from("saem_terms")
    .select("id")
    .eq("project_id", projectId)
    .eq("name", termName)
    .maybeSingle();
  if (!term) {
    const inserted = await supabaseAdmin
      .from("saem_terms")
      .insert({
        project_id: projectId,
        name: termName,
        start_date: `${year}-01-01`,
        end_date: `${year}-12-31`,
        status: "active",
      })
      .select("id")
      .single();
    if (inserted.error) throw new Error(inserted.error.message);
    term = inserted.data;
  }
  return String((term as { id: string }).id);
}

export async function createClub(input: {
  year: number;
  name: string;
  teacherId?: string | null;
  target?: string;
  capacity?: number | null;
  room?: string;
  goal?: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    await requireClubAccess();
    const name = input.name.trim();
    if (!name) return { ok: false, message: "동아리명을 입력하세요." };
    if (input.teacherId) {
      // 담당샘은 "동아리 역할을 가진 사람"이어야 한다(겸직 강사 포함).
      const teacherIds = new Set(await clubTeacherIds());
      if (!teacherIds.has(input.teacherId)) {
        return { ok: false, message: "동아리 역할을 가진 담당샘을 선택하세요." };
      }
      const { data: teacher } = await supabaseAdmin
        .from("saem_instructors")
        .select("id")
        .eq("id", input.teacherId)
        .eq("status", "active")
        .maybeSingle();
      if (!teacher)
        return { ok: false, message: "활성 상태의 담당샘을 선택하세요." };
    }
    const termId = await ensureClubTerm(input.year);
    const { data: businessProgram } = await supabaseAdmin
      .from("business_programs")
      .select("id")
      .eq("name", CLUB_PROJECT)
      .maybeSingle();
    const { data, error } = await supabaseAdmin
      .from("saem_programs")
      .insert({
        term_id: termId,
        name,
        instructor_id: input.teacherId || null,
        target: input.target?.trim() || "청소년",
        capacity:
          input.capacity == null
            ? null
            : Math.max(0, Math.round(input.capacity)),
        room: input.room?.trim() || null,
        goal: input.goal?.trim() || null,
        program_type: "club",
        business_program_id:
          (businessProgram as { id?: string } | null)?.id ?? null,
        status: "active",
        pay_type: "hourly",
        hourly_rate: 0,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/hr/clubs");
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "등록하지 못했습니다.",
    };
  }
}

async function requireClubProgram(programId: string) {
  const { data } = await supabaseAdmin
    .from("saem_programs")
    .select("id,capacity")
    .eq("id", programId)
    .eq("program_type", "club")
    .maybeSingle();
  if (!data) throw new Error("동아리를 찾을 수 없습니다.");
  return data as { id: string; capacity: number | null };
}

export async function addClubSession(input: {
  programId: string;
  date: string;
}): Promise<ActionResult> {
  try {
    await requireClubAccess();
    await requireClubProgram(input.programId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      return { ok: false, message: "활동일을 선택하세요." };
    }
    const { data: latest } = await supabaseAdmin
      .from("saem_sessions")
      .select("session_no")
      .eq("program_id", input.programId)
      .order("session_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextNo =
      Number((latest as { session_no?: number } | null)?.session_no ?? 0) + 1;
    const { error } = await supabaseAdmin.from("saem_sessions").insert({
      program_id: input.programId,
      session_no: nextNo,
      session_date: input.date,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/hr/clubs");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "활동일을 추가하지 못했습니다.",
    };
  }
}

export async function addClubExpense(input: {
  programId: string;
  date: string;
  fundingSource?: string;
  budgetCategory: string;
  description: string;
  amount: number;
}): Promise<ActionResult> {
  try {
    const access = await requireClubAccess();
    await requireClubProgram(input.programId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !input.description.trim()) {
      return { ok: false, message: "지출일과 지출내역을 입력하세요." };
    }
    const amount = Math.max(0, Math.round(Number(input.amount) || 0));
    const { error } = await supabaseAdmin.from("club_expenses").insert({
      program_id: input.programId,
      expense_date: input.date,
      funding_source: input.fundingSource?.trim() || "동래구동아리지원사업비",
      budget_category: input.budgetCategory.trim() || "사업비",
      description: input.description.trim(),
      amount,
      created_by: access.name,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/hr/clubs");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "지출을 저장하지 못했습니다.",
    };
  }
}

export async function confirmClubReport(input: {
  programId: string;
  year: number;
  month: number;
}): Promise<ActionResult> {
  try {
    const access = await requireClubAccess();
    const program = await requireClubProgram(input.programId);
    const { data: clubRow } = await supabaseAdmin
      .from("saem_programs")
      .select("name")
      .eq("id", input.programId)
      .maybeSingle();
    const range = monthRange(input.year, input.month);
    const [sessions, expenses, enrollments] = await Promise.all([
      supabaseAdmin
        .from("saem_sessions")
        .select("student_count,instructor_submitted_at")
        .eq("program_id", input.programId)
        .gte("session_date", range.start)
        .lt("session_date", range.endExclusive),
      supabaseAdmin
        .from("club_expenses")
        .select("amount")
        .eq("program_id", input.programId)
        .gte("expense_date", range.start)
        .lt("expense_date", range.endExclusive),
      supabaseAdmin
        .from("saem_enrollments")
        .select("id")
        .eq("program_id", input.programId)
        .eq("status", "active"),
    ]);
    for (const query of [sessions, expenses, enrollments]) {
      if (query.error) throw new Error(query.error.message);
    }
    const sessionRows = (sessions.data ?? []) as Array<{
      student_count: number | null;
      instructor_submitted_at: string | null;
    }>;
    if (sessionRows.length === 0)
      return { ok: false, message: "이 달에 등록된 활동이 없습니다." };
    if (sessionRows.some((s) => !s.instructor_submitted_at)) {
      return { ok: false, message: "아직 제출되지 않은 활동일지가 있습니다." };
    }
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from("club_monthly_reports").upsert(
      {
        program_id: input.programId,
        report_year: input.year,
        report_month: input.month,
        status: "confirmed",
        registered_count: enrollments.data?.length ?? program.capacity ?? 0,
        attendance_total: sessionRows.reduce(
          (sum, row) => sum + Number(row.student_count ?? 0),
          0
        ),
        expense_total: (expenses.data ?? []).reduce(
          (sum, row) => sum + Number((row as { amount: number }).amount ?? 0),
          0
        ),
        submitted_at: now,
        confirmed_at: now,
        confirmed_by: access.name,
        updated_at: now,
      },
      { onConflict: "program_id,report_year,report_month" }
    );
    if (error) throw new Error(error.message);
    revalidatePath("/hr/clubs");

    // Slack 알림(본작업과 격리: 실패해도 throw 안 함)
    try {
      const base = siteBaseUrl();
      const link = base
        ? slackLink(
            `${base}/hr/clubs?year=${input.year}&month=${input.month}`,
            "동아리관리에서 확인"
          )
        : "동업자씨 동아리관리에서 확인";
      await sendSlack(
        "SLACK_WEBHOOK_CLUBS",
        `✅ ${String(
          (clubRow as { name?: string } | null)?.name ?? "동아리"
        )} ${input.year}년 ${input.month}월 결과보고 확정 - ${access.name}\n${link}`
      );
    } catch {
      // 알림 실패는 무시
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "월간보고를 확정하지 못했습니다.",
    };
  }
}

export async function syncClubBusinessResult(input: {
  year: number;
  month: number;
}): Promise<ActionResult<{ resultId: string }>> {
  try {
    const access = await requireClubAccess();
    const range = monthRange(input.year, input.month);
    const { data: reports, error: reportError } = await supabaseAdmin
      .from("club_monthly_reports")
      .select("program_id,registered_count,attendance_total")
      .eq("report_year", input.year)
      .eq("report_month", input.month)
      .eq("status", "confirmed");
    if (reportError) throw new Error(reportError.message);
    if (!reports?.length)
      return { ok: false, message: "확정된 동아리 월간보고가 없습니다." };
    const programIds = reports.map((r) =>
      String((r as { program_id: string }).program_id)
    );
    const [programQuery, sessionQuery, registryQuery] = await Promise.all([
      supabaseAdmin.from("saem_programs").select("id,name").in("id", programIds),
      supabaseAdmin
        .from("saem_sessions")
        .select("id,program_id,session_date,log_content,student_count")
        .in("program_id", programIds)
        .gte("session_date", range.start)
        .lt("session_date", range.endExclusive)
        .not("instructor_submitted_at", "is", null),
      supabaseAdmin
        .from("business_programs")
        .select("id,category_id")
        .eq("name", CLUB_PROJECT)
        .maybeSingle(),
    ]);
    for (const query of [programQuery, sessionQuery, registryQuery]) {
      if (query.error) throw new Error(query.error.message);
    }
    const programs = programQuery.data;
    const sessions = sessionQuery.data;
    const registry = registryQuery.data;
    const programName = new Map(
      (programs ?? []).map((row) => {
        const r = row as { id: string; name: string };
        return [r.id, r.name];
      })
    );
    let category = "학교밖 청소년 활동지원 강화";
    const registryRow = registry as { id: string; category_id: string } | null;
    if (registryRow?.category_id) {
      const { data: cat } = await supabaseAdmin
        .from("business_categories")
        .select("name")
        .eq("id", registryRow.category_id)
        .maybeSingle();
      category = String((cat as { name?: string } | null)?.name ?? category);
    }
    const sessionRows = (sessions ?? []) as Array<{
      id: string;
      program_id: string;
      session_date: string;
      log_content: string | null;
      student_count: number | null;
    }>;
    const registered = reports.reduce(
      (sum, row) =>
        sum + Number((row as { registered_count: number }).registered_count ?? 0),
      0
    );
    const attendance = reports.reduce(
      (sum, row) =>
        sum + Number((row as { attendance_total: number }).attendance_total ?? 0),
      0
    );
    const sourceKey = `${input.year}-${String(input.month).padStart(2, "0")}`;
    const payload = {
      report_year: input.year,
      report_month: input.month,
      category,
      program_id: registryRow?.id ?? null,
      program_name: CLUB_PROJECT,
      manager_name: access.name,
      sessions: sessionRows.length,
      operating_days: new Set(sessionRows.map((s) => s.session_date)).size,
      participants: registered,
      participants_youth: registered,
      participants_other: 0,
      attendance,
      attendance_youth: attendance,
      attendance_other: 0,
      youth_uses: registered,
      other_uses: 0,
      status: "draft",
      author_name: access.name,
      updated_by: access.name,
      updated_at: new Date().toISOString(),
      source_type: "club_monthly",
      source_key: sourceKey,
    };
    const { data: result, error } = await supabaseAdmin
      .from("business_results")
      .upsert(payload, { onConflict: "source_type,source_key" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const resultId = String((result as { id: string }).id);
    const deleted = await supabaseAdmin
      .from("business_result_details")
      .delete()
      .eq("result_id", resultId);
    if (deleted.error) throw new Error(deleted.error.message);
    if (sessionRows.length) {
      const details = sessionRows
        .sort((a, b) => a.session_date.localeCompare(b.session_date))
        .map((session, index) => ({
          result_id: resultId,
          entry_type: "date",
          entry_date: session.session_date,
          session_no: null,
          session_days: null,
          content: `${programName.get(session.program_id) ?? "동아리"} · ${
            session.log_content ?? "활동"
          }`,
          participants_youth: Number(session.student_count ?? 0),
          participants_other: 0,
          room_youth: 0,
          room_other: 0,
          sort_order: index + 1,
        }));
      const inserted = await supabaseAdmin
        .from("business_result_details")
        .insert(details);
      if (inserted.error) throw new Error(inserted.error.message);
    }
    revalidatePath("/hr/clubs");
    revalidatePath("/business-results");
    return { ok: true, resultId };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "사업실적을 반영하지 못했습니다.",
    };
  }
}
