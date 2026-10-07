import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  clubLogLock,
  normalizeStudentCount,
  normalizeWorkHours,
  type ClubLogLock,
} from "@/lib/clubLog";

// =====================================================================
// 동아리 활동일지 조회·저장 — 서버 전용 (김준호 선생님 요청 2026-10-07)
//   동래샘들과 같은 saem_sessions 에 씁니다(양쪽 어디서 써도 같은 행).
//   권한 확인은 호출부(hr/clubs/actions — requireClubAccess) 책임입니다.
//   잠금·상태 규칙은 lib/clubLog(순수 함수).
// =====================================================================

function missingSchema(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.message?.includes("schema cache")
  );
}

type SessionLockRow = {
  id: string;
  program_id: string;
  session_date: string | null;
  staff_confirmed_at: string | null;
  settlement_id: string | null;
  instructor_signed_at: string | null;
};

// 그 동아리·연·월의 월간보고가 확정됐는지.
async function isMonthReportConfirmed(
  programId: string,
  ymd: string | null
): Promise<boolean> {
  if (!ymd || !/^\d{4}-\d{2}/.test(ymd)) return false;
  const { data, error } = await supabaseAdmin
    .from("saem_club_monthly_reports")
    .select("status")
    .eq("program_id", programId)
    .eq("report_year", Number(ymd.slice(0, 4)))
    .eq("report_month", Number(ymd.slice(5, 7)))
    .maybeSingle();
  if (missingSchema(error)) return false;
  if (error) throw new Error(error.message);
  return (data as { status?: string } | null)?.status === "confirmed";
}

// 회차 하나를 읽고 잠금 판정. 동아리 회차가 아니면 throw.
//   날짜를 옮기면 옮겨 갈 달의 월간보고 확정 여부도 봅니다.
export async function loadClubSessionLock(
  sessionId: string,
  nextDate?: string
): Promise<{ row: SessionLockRow; lock: ClubLogLock }> {
  const { data, error } = await supabaseAdmin
    .from("saem_sessions")
    .select("id,program_id,session_date,staff_confirmed_at,settlement_id,instructor_signed_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("회차를 찾을 수 없습니다.");
  const row = data as SessionLockRow;
  const { data: program } = await supabaseAdmin
    .from("saem_programs")
    .select("id")
    .eq("id", row.program_id)
    .eq("program_type", "club")
    .maybeSingle();
  if (!program) throw new Error("동아리 회차가 아닙니다.");

  const monthReportConfirmed =
    (await isMonthReportConfirmed(row.program_id, row.session_date)) ||
    (!!nextDate &&
      nextDate.slice(0, 7) !== (row.session_date ?? "").slice(0, 7) &&
      (await isMonthReportConfirmed(row.program_id, nextDate)));
  return {
    row,
    lock: clubLogLock({
      staffConfirmedAt: row.staff_confirmed_at,
      settlementId: row.settlement_id,
      monthReportConfirmed,
    }),
  };
}

export type ClubLogSession = {
  id: string;
  sessionNo: number;
  date: string;
  planContent: string; // 참고용(계획서 편집기에서 고칩니다)
  logContent: string;
  location: string;
  workHours: number | null;
  studentCount: number | null;
  submittedAt: string | null;
  signedAt: string | null;
  staffConfirmedAt: string | null;
  lock: ClubLogLock;
};

export type ClubLogData = {
  programId: string;
  name: string;
  year: number;
  sessions: ClubLogSession[];
};

// 한 동아리의 한 해 활동일지(날짜·회차 순).
export async function loadClubLogs(
  programId: string,
  year: number
): Promise<ClubLogData | null> {
  if (!programId) return null;
  const { data: program, error: programError } = await supabaseAdmin
    .from("saem_programs")
    .select("id,name")
    .eq("id", programId)
    .eq("program_type", "club")
    .maybeSingle();
  if (missingSchema(programError)) return null;
  if (programError) throw new Error(programError.message);
  if (!program) return null;

  const [sessionQuery, reportQuery] = await Promise.all([
    supabaseAdmin
      .from("saem_sessions")
      .select(
        "id,session_no,session_date,plan_content,log_content,activity_location,work_hours,student_count,instructor_submitted_at,instructor_signed_at,staff_confirmed_at,settlement_id"
      )
      .eq("program_id", programId)
      .gte("session_date", `${year}-01-01`)
      .lt("session_date", `${year + 1}-01-01`)
      .order("session_date")
      .order("session_no"),
    supabaseAdmin
      .from("saem_club_monthly_reports")
      .select("report_month,status")
      .eq("program_id", programId)
      .eq("report_year", year),
  ]);
  if (sessionQuery.error) throw new Error(sessionQuery.error.message);
  if (reportQuery.error && !missingSchema(reportQuery.error))
    throw new Error(reportQuery.error.message);
  const confirmedMonths = new Set(
    ((reportQuery.data ?? []) as { report_month: number; status: string }[])
      .filter((r) => r.status === "confirmed")
      .map((r) => Number(r.report_month))
  );

  const num = (v: unknown) =>
    v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v);
  const sessions = ((sessionQuery.data ?? []) as Record<string, unknown>[]).map(
    (r): ClubLogSession => {
      const date = String(r.session_date ?? "");
      const staffConfirmedAt = (r.staff_confirmed_at as string | null) ?? null;
      return {
        id: String(r.id),
        sessionNo: Number(r.session_no ?? 0),
        date,
        planContent: String(r.plan_content ?? ""),
        logContent: String(r.log_content ?? ""),
        location: String(r.activity_location ?? ""),
        workHours: num(r.work_hours),
        studentCount: num(r.student_count),
        submittedAt: (r.instructor_submitted_at as string | null) ?? null,
        signedAt: (r.instructor_signed_at as string | null) ?? null,
        staffConfirmedAt,
        lock: clubLogLock({
          staffConfirmedAt,
          settlementId: (r.settlement_id as string | null) ?? null,
          monthReportConfirmed: confirmedMonths.has(Number(date.slice(5, 7))),
        }),
      };
    }
  );
  return {
    programId,
    name: String((program as { name?: string }).name ?? ""),
    year,
    sessions,
  };
}

export type ClubLogInput = {
  sessionId: string;
  date: string;
  location: string;
  workHours: number | null;
  studentCount: number | null;
  logContent: string;
  submit: boolean;
  confirmSigned?: boolean;
};

// 활동일지 저장 — submit=true 면 제출(instructor_submitted_at)까지.
//   * 이미 제출된 일지를 고쳐 다시 제출하면 제출 시각만 새로 찍습니다(동래샘들과 같음).
//   * 강사 손서명(instructor_signed_at)은 찍지도 지우지도 않습니다.
//   * 강사가 서명 제출한 일지를 고칠 때는 confirmSigned=true 가 있어야 저장됩니다.
export async function writeClubLog(
  input: ClubLogInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { ok: false, message: "활동일을 선택하세요." };
  }
  const { row, lock } = await loadClubSessionLock(input.sessionId, input.date);
  if (lock.locked) return { ok: false, message: lock.message };
  if (row.instructor_signed_at && !input.confirmSigned) {
    return {
      ok: false,
      message:
        "강사가 동래샘들에서 서명해 제출한 일지입니다. 고치면 서명 뒤 내용이 바뀝니다. 확인란에 체크한 뒤 저장하세요.",
    };
  }
  const logContent = input.logContent.trim();
  if (input.submit && !logContent) {
    return { ok: false, message: "활동 내용을 입력해야 제출할 수 있습니다." };
  }
  const update: Record<string, unknown> = {
    session_date: input.date,
    activity_location: input.location.trim() || null,
    work_hours: normalizeWorkHours(input.workHours),
    student_count: normalizeStudentCount(input.studentCount),
    log_content: logContent || null,
  };
  if (input.submit) update.instructor_submitted_at = new Date().toISOString();
  const { error, count } = await supabaseAdmin
    .from("saem_sessions")
    .update(update, { count: "exact" })
    .eq("id", input.sessionId)
    // 확정·정산이 그사이 걸렸으면 덮어쓰지 않습니다.
    .is("staff_confirmed_at", null)
    .is("settlement_id", null);
  if (error) throw new Error(error.message);
  if (!count) {
    return {
      ok: false,
      message: "그사이 확정되었거나 정산에 들어간 회차입니다. 새로고침해 확인해주세요.",
    };
  }
  return { ok: true };
}
