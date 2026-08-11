"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSaemAccess } from "@/lib/saemAccess";
import { kstTodayYmd } from "@/lib/trainings";

const TERM = "saem_terms";
const PROG = "saem_programs";
const SESS = "saem_sessions";
const PROJ = "saem_projects";
const INSTR = "saem_instructors";
const ENROLL = "saem_enrollments";
const ATTEND = "saem_attendance";

export type TermOption = {
  id: string;
  name: string;
  projectName: string;
  status: string;
};

export async function getTermOptions(): Promise<TermOption[]> {
  await requireSaemAccess();
  const [{ data: terms }, { data: projs }] = await Promise.all([
    supabaseAdmin.from(TERM).select("id, name, project_id, status, start_date"),
    supabaseAdmin.from(PROJ).select("id, name"),
  ]);
  const projName = new Map(
    (projs ?? []).map((p) => [(p as { id: string }).id, (p as { name: string }).name])
  );
  return (terms ?? [])
    .map((t) => {
      const r = t as { id: string; name: string; project_id: string; status: string; start_date: string | null };
      return {
        id: r.id,
        name: r.name,
        projectName: projName.get(r.project_id) ?? "",
        status: r.status,
        _start: r.start_date ?? "",
      };
    })
    .sort((a, b) => (b._start > a._start ? 1 : -1))
    .map(({ _start, ...rest }) => {
      void _start;
      return rest;
    });
}

// SA-18. 회차별 출석 집계 — 강사가 동래샘들에서 체크한 결과(있을 때만).
//   SA-20. 합계만으로는 "누가 결석했나"를 알 수 없어 강사에게 매번 되물어야 했다.
//   그래서 결석·지각자 이름을 함께 싣는다.
//     * 출석(present)자 이름은 담지 않는다 — 필요한 정보가 아니고,
//       회차 × 인원만큼 payload 가 불어난다(결석은 소수).
//     * 학생 정보는 이름만. 연락처·생년월일·학교는 읽지 않는다.
export type AttendanceSummary = {
  present: number;
  late: number;
  absent: number;
  checked: number; // 체크된 학생 수(present+late+absent)
  absentNames: string[]; // 결석자 이름(가나다순)
  lateNames: string[]; // 지각자 이름(가나다순)
};

export type LogRow = {
  id: string;
  session_date: string | null;
  session_no: number;
  programId: string;
  programName: string;
  instructorId: string | null;
  instructorName: string | null;
  periodNo: number | null;
  timeStart: string | null;
  timeEnd: string | null;
  capacity: number | null;
  sortOrder: number;
  submitted: boolean;
  confirmed: boolean;
  student_count: number | null;
  work_hours: number | null;
  log_content: string | null;
  plan_content: string | null;
  note: string | null;
  enrolledCount: number; // 프로그램 명단(활성) 인원 — 0 이면 명단 없음
  attendance: AttendanceSummary | null; // null = 아직 출석 체크 없음
};

export type LogResult = {
  today: string;
  rows: LogRow[];
  summary: { elapsed: number; submitted: number; unsubmittedInstructors: string[] };
};

// 근무일지 조회 — termId 없으면 활성 차시 전체. date 있으면 그 날짜만.
export async function getLogs(input: {
  termId?: string;
  date?: string;
}): Promise<LogResult> {
  await requireSaemAccess();
  const today = kstTodayYmd();

  // 대상 차시.
  let termIds: string[];
  if (input.termId) {
    termIds = [input.termId];
  } else {
    const { data: activeTerms } = await supabaseAdmin
      .from(TERM)
      .select("id")
      .eq("status", "active");
    termIds = (activeTerms ?? []).map((t) => (t as { id: string }).id);
  }
  if (termIds.length === 0) {
    return { today, rows: [], summary: { elapsed: 0, submitted: 0, unsubmittedInstructors: [] } };
  }

  // 프로그램 + 강사명.
  const { data: progs } = await supabaseAdmin
    .from(PROG)
    .select(
      "id, name, instructor_id, period_no, time_start, time_end, capacity, sort_order"
    )
    .in("term_id", termIds);
  const programs = (progs ?? []) as {
    id: string;
    name: string;
    instructor_id: string | null;
    period_no: number | null;
    time_start: string | null;
    time_end: string | null;
    capacity: number | null;
    sort_order: number | null;
  }[];
  if (programs.length === 0) {
    return { today, rows: [], summary: { elapsed: 0, submitted: 0, unsubmittedInstructors: [] } };
  }
  const progById = new Map(programs.map((p) => [p.id, p]));
  const insIds = [...new Set(programs.map((p) => p.instructor_id).filter(Boolean) as string[])];
  const insName = new Map<string, string>();
  if (insIds.length) {
    const { data: ins } = await supabaseAdmin.from(INSTR).select("id, name").in("id", insIds);
    for (const r of ins ?? [])
      insName.set((r as { id: string }).id, (r as { name: string }).name);
  }

  // 세션.
  let sq = supabaseAdmin
    .from(SESS)
    .select(
      "id, program_id, session_no, session_date, plan_content, log_content, note, student_count, work_hours, instructor_submitted_at, staff_confirmed_at"
    )
    .in("program_id", programs.map((p) => p.id))
    .order("session_date", { ascending: true })
    .order("session_no", { ascending: true });
  if (input.date) sq = sq.eq("session_date", input.date);
  const { data: sess } = await sq;
  const sessionIds = (sess ?? []).map((s) => String((s as { id: string }).id));

  // SA-18. 명단(활성) 인원 + 회차별 출석 집계.
  //   명단/출석 테이블이 아직 비어 있어도 근무일지 화면은 그대로 동작해야 하므로
  //   실패는 삼키고(집계 없음) 나머지를 그린다.
  const enrolledByProgram = new Map<string, number>();
  const attendanceBySession = new Map<string, AttendanceSummary>();
  const { data: enrolls } = await supabaseAdmin
    .from(ENROLL)
    .select("program_id, status")
    .in(
      "program_id",
      programs.map((p) => p.id)
    )
    .eq("status", "active");
  for (const e of enrolls ?? []) {
    const pid = String((e as { program_id: string }).program_id);
    enrolledByProgram.set(pid, (enrolledByProgram.get(pid) ?? 0) + 1);
  }
  if (sessionIds.length) {
    const { data: atts } = await supabaseAdmin
      .from(ATTEND)
      .select("session_id, enrollment_id, status")
      .in("session_id", sessionIds);
    const attRows = (atts ?? []) as {
      session_id: string;
      enrollment_id: string;
      status: string;
    }[];

    // 결석·지각자 이름만 조회한다(출석자는 이름이 필요 없다).
    //   select 는 student_name 하나만 — 연락처·비상연락처·생년월일·학교는
    //   출결 확인에 쓰이지 않으므로 애초에 읽지 않는다.
    const namedIds = [
      ...new Set(
        attRows
          .filter((r) => r.status === "absent" || r.status === "late")
          .map((r) => String(r.enrollment_id))
      ),
    ];
    const nameById = new Map<string, string>();
    if (namedIds.length) {
      const { data: studs } = await supabaseAdmin
        .from(ENROLL)
        .select("id, student_name")
        .in("id", namedIds);
      for (const s of studs ?? []) {
        const r = s as { id: string; student_name: string | null };
        const nm = String(r.student_name ?? "").trim();
        if (nm) nameById.set(String(r.id), nm);
      }
    }

    for (const row of attRows) {
      const sid = String(row.session_id);
      const cur =
        attendanceBySession.get(sid) ??
        {
          present: 0,
          late: 0,
          absent: 0,
          checked: 0,
          absentNames: [],
          lateNames: [],
        };
      const name = nameById.get(String(row.enrollment_id));
      if (row.status === "present") cur.present += 1;
      else if (row.status === "late") {
        cur.late += 1;
        if (name) cur.lateNames.push(name);
      } else if (row.status === "absent") {
        cur.absent += 1;
        if (name) cur.absentNames.push(name);
      } else continue; // 알 수 없는 상태는 집계에서 제외
      cur.checked += 1;
      attendanceBySession.set(sid, cur);
    }

    // 이름 순서를 가나다로 고정 — 조회마다 순서가 흔들리지 않게.
    for (const s of attendanceBySession.values()) {
      s.absentNames.sort((a, b) => a.localeCompare(b, "ko"));
      s.lateNames.sort((a, b) => a.localeCompare(b, "ko"));
    }
  }

  const rows: LogRow[] = (sess ?? []).map((s) => {
    const r = s as Record<string, unknown>;
    const prog = progById.get(String(r.program_id));
    return {
      id: String(r.id),
      session_date: (r.session_date as string | null) ?? null,
      session_no: Number(r.session_no ?? 0),
      programId: String(r.program_id),
      programName: prog?.name ?? "",
      instructorId: prog?.instructor_id ?? null,
      instructorName: prog?.instructor_id ? insName.get(prog.instructor_id) ?? null : null,
      periodNo: prog?.period_no ?? null,
      timeStart: prog?.time_start ?? null,
      timeEnd: prog?.time_end ?? null,
      capacity: prog?.capacity ?? null,
      sortOrder: prog?.sort_order ?? 0,
      submitted: !!r.instructor_submitted_at,
      confirmed: !!r.staff_confirmed_at,
      student_count: (r.student_count as number | null) ?? null,
      work_hours: (r.work_hours as number | null) ?? null,
      log_content: (r.log_content as string | null) ?? null,
      plan_content: (r.plan_content as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      enrolledCount: enrolledByProgram.get(String(r.program_id)) ?? 0,
      attendance: attendanceBySession.get(String(r.id)) ?? null,
    };
  });

  // 요약 — 경과 회차(session_date <= today) 기준 제출률 + 미제출 강사.
  let elapsed = 0;
  let submitted = 0;
  const unsub = new Set<string>();
  for (const r of rows) {
    if (r.session_date && r.session_date <= today) {
      elapsed++;
      if (r.submitted) submitted++;
      else if (r.instructorName) unsub.add(r.instructorName);
    }
  }

  return {
    today,
    rows,
    summary: {
      elapsed,
      submitted,
      unsubmittedInstructors: [...unsub].sort((a, b) => a.localeCompare(b, "ko")),
    },
  };
}

// 확정(일괄) — 제출된·미확정 세션만. confirmed_by=직원명.
export async function confirmSessions(
  ids: string[]
): Promise<{ ok: true; confirmed: number } | { ok: false; message: string }> {
  try {
    const access = await requireSaemAccess();
    const list = [...new Set((ids ?? []).filter(Boolean))];
    if (list.length === 0) return { ok: false, message: "확정할 항목을 선택하세요." };
    const { data, error } = await supabaseAdmin
      .from(SESS)
      .update({
        staff_confirmed_at: new Date().toISOString(),
        confirmed_by: access.name,
      })
      .in("id", list)
      .not("instructor_submitted_at", "is", null)
      .is("staff_confirmed_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    revalidatePath("/hr/saems/logs");
    return { ok: true, confirmed: (data ?? []).length };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "확정 중 오류가 발생했습니다.",
    };
  }
}

// 확정 취소 — SA-17: 일상 운영이므로 saem 직무도 가능(M0 병목 해소).
//   단 정산에 묶인 회차는 정산부터 풀어야 한다(SA-15). 정산 확정취소는 M0 유지.
export async function unconfirmSession(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };

    const { data: row } = await supabaseAdmin
      .from(SESS)
      .select("id, settlement_id")
      .eq("id", id)
      .maybeSingle();
    if (!row) return { ok: false, message: "회차를 찾을 수 없습니다." };
    if ((row as { settlement_id: string | null }).settlement_id != null)
      return {
        ok: false,
        message:
          "정산에 묶여 있습니다. 정산 확정취소(관장)→정산 삭제 후 가능",
      };

    const { error } = await supabaseAdmin
      .from(SESS)
      .update({ staff_confirmed_at: null, confirmed_by: null })
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/saems/logs");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "확정 취소 중 오류가 발생했습니다.",
    };
  }
}

// SA-17. 작성 내용 초기화 — 강사가 처음부터 다시 쓰게 되돌린다(saem 또는 M0).
//   지우는 값: log_content · note · student_count · work_hours · instructor_submitted_at
//   보존하는 값: plan_content · session_date · session_no (계획/일정은 센터가 정한 것)
//   확정된 회차는 대상 아님 — 먼저 확정 취소해야 한다.
export async function resetSession(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };

    const { data: row } = await supabaseAdmin
      .from(SESS)
      .select("id, staff_confirmed_at")
      .eq("id", id)
      .maybeSingle();
    if (!row) return { ok: false, message: "회차를 찾을 수 없습니다." };
    if ((row as { staff_confirmed_at: string | null }).staff_confirmed_at != null)
      return {
        ok: false,
        message: "확정된 회차입니다. 먼저 확정을 취소하세요.",
      };

    // 서버 재검증 — 조건을 update 절에도 걸어 경합 상황에서도 확정본을 건드리지 않는다.
    const { data, error } = await supabaseAdmin
      .from(SESS)
      .update({
        log_content: null,
        note: null,
        student_count: null,
        work_hours: null,
        instructor_submitted_at: null,
      })
      .eq("id", id)
      .is("staff_confirmed_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if ((data ?? []).length === 0)
      return { ok: false, message: "초기화하지 못했습니다. (확정 여부를 확인하세요)" };

    revalidatePath("/hr/saems/logs");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "초기화 중 오류가 발생했습니다.",
    };
  }
}
