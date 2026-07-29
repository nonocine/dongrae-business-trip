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

export type LogRow = {
  id: string;
  session_date: string | null;
  session_no: number;
  programId: string;
  programName: string;
  instructorId: string | null;
  instructorName: string | null;
  submitted: boolean;
  confirmed: boolean;
  student_count: number | null;
  work_hours: number | null;
  log_content: string | null;
  plan_content: string | null;
  note: string | null;
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
    .select("id, name, instructor_id")
    .in("term_id", termIds);
  const programs = (progs ?? []) as {
    id: string;
    name: string;
    instructor_id: string | null;
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
      submitted: !!r.instructor_submitted_at,
      confirmed: !!r.staff_confirmed_at,
      student_count: (r.student_count as number | null) ?? null,
      work_hours: (r.work_hours as number | null) ?? null,
      log_content: (r.log_content as string | null) ?? null,
      plan_content: (r.plan_content as string | null) ?? null,
      note: (r.note as string | null) ?? null,
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

// 확정 취소 — M0 전용.
export async function unconfirmSession(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess({ onlyM0: true });
    if (!id) return { ok: false, message: "대상이 없습니다." };
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
