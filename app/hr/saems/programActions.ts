"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSaemAccess } from "@/lib/saemAccess";
import {
  toProject,
  toTerm,
  toProgram,
  type SaemProject,
  type SaemTerm,
  type SaemProgram,
  type TermStatus,
} from "@/lib/saem";

const PROJ = "saem_projects";
const TERM = "saem_terms";
const PROG = "saem_programs";
const SESS = "saem_sessions";

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length ? s : null;
}
const p2 = (n: number) => String(n).padStart(2, "0");
function ymd(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}
function parseYmdMs(s: string): number | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
// 시작일 이후(포함) 첫 토요일부터 weeks 주간의 토요일. 휴강일 제외.
function computeSaturdays(
  startYmd: string,
  weeks: number,
  holidays: Set<string>
): { dates: string[]; endYmd: string | null } {
  const startMs = parseYmdMs(startYmd);
  if (startMs == null || weeks <= 0) return { dates: [], endYmd: null };
  const dow = new Date(startMs).getUTCDay(); // 0 일 ~ 6 토
  const firstSat = startMs + (((6 - dow) % 7) + 7) % 7 * 86400000;
  const dates: string[] = [];
  let lastMs = firstSat;
  for (let i = 0; i < weeks; i++) {
    const cur = firstSat + i * 7 * 86400000;
    lastMs = cur;
    const d = ymd(cur);
    if (!holidays.has(d)) dates.push(d);
  }
  return { dates, endYmd: ymd(lastMs) };
}

// --- 조회 ---
export async function listProjects(): Promise<SaemProject[]> {
  await requireSaemAccess();
  const { data } = await supabaseAdmin
    .from(PROJ)
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []).map((r) => toProject(r as Record<string, unknown>));
}

export async function listTerms(projectId: string): Promise<SaemTerm[]> {
  await requireSaemAccess();
  if (!projectId) return [];
  const { data } = await supabaseAdmin
    .from(TERM)
    .select("*")
    .eq("project_id", projectId)
    .order("start_date", { ascending: false });
  return (data ?? []).map((r) => toTerm(r as Record<string, unknown>));
}

export type ProgramRow = SaemProgram & { instructorName: string | null };
export async function listPrograms(termId: string): Promise<ProgramRow[]> {
  await requireSaemAccess();
  if (!termId) return [];
  const { data } = await supabaseAdmin
    .from(PROG)
    .select("*")
    .eq("term_id", termId)
    .order("period_no", { ascending: true })
    .order("sort_order", { ascending: true });
  const programs = (data ?? []).map((r) => toProgram(r as Record<string, unknown>));
  const insIds = [
    ...new Set(programs.map((p) => p.instructor_id).filter(Boolean) as string[]),
  ];
  const nameById = new Map<string, string>();
  if (insIds.length) {
    const { data: ins } = await supabaseAdmin
      .from("saem_instructors")
      .select("id, name")
      .in("id", insIds);
    for (const r of ins ?? [])
      nameById.set((r as { id: string }).id, (r as { name: string }).name);
  }
  return programs.map((p) => ({
    ...p,
    instructorName: p.instructor_id ? nameById.get(p.instructor_id) ?? null : null,
  }));
}

export type InstructorOption = { id: string; name: string };
export async function listInstructorOptions(): Promise<InstructorOption[]> {
  await requireSaemAccess();
  const { data } = await supabaseAdmin
    .from("saem_instructors")
    .select("id, name, status")
    .eq("status", "active");
  return (data ?? [])
    .map((r) => ({ id: (r as { id: string }).id, name: (r as { name: string }).name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

// --- 프로젝트 / 차시 ---
export async function createProject(
  name: string,
  description?: string
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    const nm = clean(name);
    if (!nm) return { ok: false, message: "프로젝트명을 입력하세요." };
    const { data: maxRow } = await supabaseAdmin
      .from(PROJ)
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder =
      Number((maxRow as { sort_order?: number } | null)?.sort_order ?? 0) + 1;
    const { data, error } = await supabaseAdmin
      .from(PROJ)
      .insert({ name: nm, description: clean(description), status: "active", sort_order: nextOrder })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/hr/saems/programs");
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "오류가 발생했습니다." };
  }
}

export async function createTerm(input: {
  projectId: string;
  name: string;
  startDate?: string;
  endDate?: string;
  status?: TermStatus;
}): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    const nm = clean(input.name);
    if (!input.projectId || !nm)
      return { ok: false, message: "프로젝트와 차시명을 입력하세요." };
    const { data, error } = await supabaseAdmin
      .from(TERM)
      .insert({
        project_id: input.projectId,
        name: nm,
        start_date: clean(input.startDate),
        end_date: clean(input.endDate),
        status: input.status ?? "draft",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/hr/saems/programs");
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "오류가 발생했습니다." };
  }
}

export async function updateTermStatus(
  termId: string,
  status: TermStatus
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    if (!termId || !["draft", "active", "closed"].includes(status))
      return { ok: false, message: "잘못된 요청입니다." };
    const { error } = await supabaseAdmin
      .from(TERM)
      .update({ status })
      .eq("id", termId);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/saems/programs");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "오류가 발생했습니다." };
  }
}

// --- 차시 복사(프로그램 전체 복제 + 새 회차 생성) ---
export async function copyTerm(input: {
  sourceTermId: string;
  name: string;
  startDate: string;
  weeks: number;
  holidays: string[];
}): Promise<{ ok: true; id: string; programs: number; sessions: number } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    const nm = clean(input.name);
    if (!input.sourceTermId || !nm || !input.startDate)
      return { ok: false, message: "차시명·시작일을 입력하세요." };
    const weeks = Math.max(1, Math.round(Number(input.weeks) || 0));
    const holidays = new Set((input.holidays ?? []).filter(Boolean));
    const { dates, endYmd } = computeSaturdays(input.startDate, weeks, holidays);
    if (dates.length === 0)
      return { ok: false, message: "생성할 회차 날짜가 없습니다. 시작일·주차를 확인하세요." };

    // 원본 차시 → 프로젝트·프로그램.
    const { data: srcTerm } = await supabaseAdmin
      .from(TERM)
      .select("id, project_id")
      .eq("id", input.sourceTermId)
      .maybeSingle();
    if (!srcTerm) return { ok: false, message: "원본 차시를 찾을 수 없습니다." };
    const projectId = (srcTerm as { project_id: string }).project_id;

    // 새 차시.
    const { data: newTerm, error: tErr } = await supabaseAdmin
      .from(TERM)
      .insert({
        project_id: projectId,
        name: nm,
        start_date: input.startDate,
        end_date: endYmd,
        status: "draft",
      })
      .select("id")
      .single();
    if (tErr) throw new Error(tErr.message);
    const newTermId = String((newTerm as { id: string }).id);

    // 원본 프로그램 복제.
    const { data: srcPrograms } = await supabaseAdmin
      .from(PROG)
      .select("*")
      .eq("term_id", input.sourceTermId);
    const src = (srcPrograms ?? []).map((r) => toProgram(r as Record<string, unknown>));
    let sessionCount = 0;
    for (const p of src) {
      const { data: np, error: pErr } = await supabaseAdmin
        .from(PROG)
        .insert({
          term_id: newTermId,
          name: p.name,
          instructor_id: p.instructor_id,
          period_no: p.period_no,
          time_start: p.time_start,
          time_end: p.time_end,
          target: p.target,
          capacity: p.capacity,
          tuition: p.tuition,
          room: p.room,
          hourly_rate: p.hourly_rate,
          status: "active",
          sort_order: p.sort_order,
        })
        .select("id")
        .single();
      if (pErr) throw new Error(pErr.message);
      const newProgId = String((np as { id: string }).id);
      const rows = dates.map((d, i) => ({
        program_id: newProgId,
        session_no: i + 1,
        session_date: d,
      }));
      if (rows.length) {
        const { error: sErr } = await supabaseAdmin.from(SESS).insert(rows);
        if (sErr) throw new Error(sErr.message);
        sessionCount += rows.length;
      }
    }

    revalidatePath("/hr/saems/programs");
    return { ok: true, id: newTermId, programs: src.length, sessions: sessionCount };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "복사 중 오류가 발생했습니다." };
  }
}

// --- 프로그램 CRUD ---
export type ProgramInput = {
  name: string;
  instructor_id: string | null;
  period_no: number | null;
  time_start: string | null;
  time_end: string | null;
  target: string | null;
  capacity: number | null;
  tuition: number | null;
  room: string | null;
  hourly_rate: number | null;
};
function progPayload(i: ProgramInput) {
  const num = (v: number | null) => (v == null || Number.isNaN(v) ? null : v);
  return {
    name: (i.name ?? "").trim(),
    instructor_id: i.instructor_id || null,
    period_no: num(i.period_no),
    time_start: clean(i.time_start),
    time_end: clean(i.time_end),
    target: clean(i.target),
    capacity: num(i.capacity),
    tuition: num(i.tuition),
    room: clean(i.room),
    hourly_rate: num(i.hourly_rate),
  };
}

export async function addProgram(
  termId: string,
  input: ProgramInput
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    const payload = progPayload(input);
    if (!termId || !payload.name)
      return { ok: false, message: "차시와 프로그램명을 확인하세요." };
    // sort_order = 현재 최대+1.
    const { data: maxRow } = await supabaseAdmin
      .from(PROG)
      .select("sort_order")
      .eq("term_id", termId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder =
      Number((maxRow as { sort_order?: number } | null)?.sort_order ?? 0) + 1;
    const { data, error } = await supabaseAdmin
      .from(PROG)
      .insert({ ...payload, term_id: termId, status: "active", sort_order: nextOrder })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const newId = String((data as { id: string }).id);

    // 같은 차시의 기존 프로그램 회차 날짜를 그대로 부여(있으면).
    const { data: sibling } = await supabaseAdmin
      .from(PROG)
      .select("id")
      .eq("term_id", termId)
      .neq("id", newId)
      .limit(1)
      .maybeSingle();
    if (sibling) {
      const { data: sess } = await supabaseAdmin
        .from(SESS)
        .select("session_no, session_date")
        .eq("program_id", (sibling as { id: string }).id)
        .order("session_no", { ascending: true });
      const rows = (sess ?? []).map((s) => ({
        program_id: newId,
        session_no: (s as { session_no: number }).session_no,
        session_date: (s as { session_date: string | null }).session_date,
      }));
      if (rows.length) await supabaseAdmin.from(SESS).insert(rows);
    }

    revalidatePath("/hr/saems/programs");
    return { ok: true, id: newId };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "추가 중 오류가 발생했습니다." };
  }
}

export async function updateProgram(
  id: string,
  input: ProgramInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    const payload = progPayload(input);
    if (!id || !payload.name) return { ok: false, message: "프로그램명을 확인하세요." };
    const { error } = await supabaseAdmin.from(PROG).update(payload).eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/saems/programs");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "수정 중 오류가 발생했습니다." };
  }
}

// 삭제 — 제출 기록(instructor_submitted_at)이 있는 회차가 없을 때만.
export async function deleteProgram(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const { data: submitted } = await supabaseAdmin
      .from(SESS)
      .select("id")
      .eq("program_id", id)
      .not("instructor_submitted_at", "is", null)
      .limit(1)
      .maybeSingle();
    if (submitted)
      return { ok: false, message: "제출된 근무일지가 있어 삭제할 수 없습니다." };
    await supabaseAdmin.from(SESS).delete().eq("program_id", id);
    const { error } = await supabaseAdmin.from(PROG).delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/saems/programs");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다." };
  }
}
