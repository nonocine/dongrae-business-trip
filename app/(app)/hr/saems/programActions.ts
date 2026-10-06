"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSaemAccess, requireSaemView } from "@/lib/saemAccess";
import {
  toProject,
  toTerm,
  toProgram,
  normalizePayType,
  type SaemProject,
  type SaemTerm,
  type SaemProgram,
  type TermStatus,
  type PayType,
} from "@/lib/saem";
import {
  buildSessionDates,
  lastSessionDate,
  normalizeHolidays,
  normalizeWeekday,
  normalizeWeekdays,
  weekdaysLabel,
} from "@/lib/saemSchedule";

const PROJ = "saem_projects";
const TERM = "saem_terms";
const PROG = "saem_programs";
const SESS = "saem_sessions";
const SETT = "saem_settlements";

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length ? s : null;
}

// 회차 스케줄 입력(프로그램 실제값). 2026-10 부터 요일은 여러 개(weekdays).
//   단일 요일 컬럼(session_weekday)은 하위호환으로 "첫 요일"을 함께 저장합니다.
export type SessionSchedule = {
  start: string | null;
  weekdays: number[]; // 비면 회차 생성 시 토요일(옛 기본값)
  weeks: number | null; // 회차 수
  holidays: string[];
};

// 스케줄이 회차를 만들 수 있는 상태인지. 시작일·회차수가 있어야 한다.
function scheduleDates(sc: SessionSchedule): string[] {
  if (!sc.start || !sc.weeks || sc.weeks <= 0) return [];
  return buildSessionDates({
    start: sc.start,
    weekdays: sc.weekdays.length ? sc.weekdays : [6],
    weeks: sc.weeks,
    holidays: sc.holidays,
  });
}

// weekdays 가 오면 그것을, 옛 호출부처럼 weekday 하나만 오면 그것을 씁니다.
function normSchedule(
  sc: (Partial<SessionSchedule> & { weekday?: number | null }) | undefined
): SessionSchedule {
  const weeks = sc?.weeks == null ? null : Math.max(0, Math.round(Number(sc.weeks) || 0));
  const many = normalizeWeekdays(sc?.weekdays);
  return {
    start: clean(sc?.start),
    weekdays: many.length ? many : sc?.weekday == null ? [] : [normalizeWeekday(sc.weekday)],
    weeks: weeks && weeks > 0 ? weeks : null,
    holidays: normalizeHolidays(sc?.holidays),
  };
}

// DB 저장값 — 배열 + 하위호환 단일 컬럼(첫 요일).
function weekdayColumns(weekdays: number[]) {
  return {
    session_weekdays: weekdays.length ? weekdays : null,
    session_weekday: weekdays.length ? weekdays[0] : null,
  };
}

// --- 조회 ---
// 조회는 로그인 직원 누구나(관장 지시). 쓰기는 아래 그대로 requireSaemAccess.
export async function listProjects(): Promise<SaemProject[]> {
  await requireSaemView();
  const { data } = await supabaseAdmin
    .from(PROJ)
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []).map((r) => toProject(r as Record<string, unknown>));
}

export async function listTerms(projectId: string): Promise<SaemTerm[]> {
  await requireSaemView();
  if (!projectId) return [];
  const { data } = await supabaseAdmin
    .from(TERM)
    .select("*")
    .eq("project_id", projectId)
    .order("start_date", { ascending: false });
  return (data ?? []).map((r) => toTerm(r as Record<string, unknown>));
}

export type ProgramRow = SaemProgram & {
  instructorName: string | null;
  sessionCount: number;
  lockedCount: number; // 제출·확정·정산 귀속 회차 — 재생성 시 보존된다
  firstSessionDate: string | null;
  lastSessionDate: string | null;
};
export async function listPrograms(termId: string): Promise<ProgramRow[]> {
  const view = await requireSaemView();
  if (!termId) return [];
  const { data } = await supabaseAdmin
    .from(PROG)
    .select("*")
    .eq("term_id", termId)
    .order("period_no", { ascending: true })
    .order("sort_order", { ascending: true });
  // 단가·정산율·수강료는 강사 보수(=정산 금액)에 해당한다. 열람만 하는
  //   직원에게는 서버에서 비워 보낸다 — 화면에서 숨기는 것으로는 RSC
  //   페이로드에 값이 그대로 남는다.
  const programs = (data ?? [])
    .map((r) => toProgram(r as Record<string, unknown>))
    .map((p) =>
      view.canManage
        ? p
        : {
            ...p,
            tuition: null,
            hourly_rate: null,
            deduction_rate: null,
            share_rate: null,
          }
    );
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

  // 회차 현황 한 번에 — 0회차 프로그램 판별·재생성 경고용.
  const stat = new Map<
    string,
    { count: number; locked: number; first: string | null; last: string | null }
  >();
  if (programs.length) {
    const { data: sess } = await supabaseAdmin
      .from(SESS)
      .select(
        "program_id, session_date, instructor_submitted_at, staff_confirmed_at, settlement_id"
      )
      .in(
        "program_id",
        programs.map((p) => p.id)
      );
    for (const r of sess ?? []) {
      const row = r as Record<string, unknown>;
      const pid = String(row.program_id ?? "");
      const cur =
        stat.get(pid) ?? { count: 0, locked: 0, first: null, last: null };
      cur.count += 1;
      if (
        row.instructor_submitted_at != null ||
        row.staff_confirmed_at != null ||
        row.settlement_id != null
      )
        cur.locked += 1;
      const d = (row.session_date as string | null) ?? null;
      if (d) {
        if (!cur.first || d < cur.first) cur.first = d;
        if (!cur.last || d > cur.last) cur.last = d;
      }
      stat.set(pid, cur);
    }
  }

  return programs.map((p) => {
    const st = stat.get(p.id);
    return {
      ...p,
      instructorName: p.instructor_id ? nameById.get(p.instructor_id) ?? null : null,
      sessionCount: st?.count ?? 0,
      lockedCount: st?.locked ?? 0,
      firstSessionDate: st?.first ?? null,
      lastSessionDate: st?.last ?? null,
    };
  });
}

export type InstructorOption = { id: string; name: string };
export async function listInstructorOptions(): Promise<InstructorOption[]> {
  await requireSaemView();
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

export type TermInput = {
  name: string;
  startDate?: string;
  endDate?: string;
  status?: TermStatus;
  // 기본 스케줄(프리필용) — 이미 만든 프로그램의 회차는 건드리지 않는다.
  defaultWeekday?: number | null;
  defaultWeeks?: number | null;
  defaultHolidays?: string[];
};

function termSchedulePayload(input: TermInput) {
  return {
    default_weekday:
      input.defaultWeekday == null ? null : normalizeWeekday(input.defaultWeekday),
    default_weeks:
      input.defaultWeeks == null || Number(input.defaultWeeks) <= 0
        ? null
        : Math.round(Number(input.defaultWeeks)),
    default_holidays: normalizeHolidays(input.defaultHolidays),
  };
}

export async function createTerm(
  input: TermInput & { projectId: string }
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
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
        ...termSchedulePayload(input),
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

// 차시 수정 — 기간·기본 스케줄만 변경. 이미 만든 프로그램의 회차는 그대로.
export async function updateTerm(
  termId: string,
  input: TermInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    const nm = clean(input.name);
    if (!termId || !nm) return { ok: false, message: "차시명을 입력하세요." };
    const { error } = await supabaseAdmin
      .from(TERM)
      .update({
        name: nm,
        start_date: clean(input.startDate),
        end_date: clean(input.endDate),
        ...termSchedulePayload(input),
      })
      .eq("id", termId);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/saems/programs");
    return { ok: true };
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
  weekday?: number | null;
  weeks: number;
  holidays: string[];
}): Promise<{ ok: true; id: string; programs: number; sessions: number } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    const nm = clean(input.name);
    if (!input.sourceTermId || !nm || !input.startDate)
      return { ok: false, message: "차시명·시작일을 입력하세요." };
    const weeks = Math.max(1, Math.round(Number(input.weeks) || 0));
    const weekday = normalizeWeekday(input.weekday ?? 6);
    const holidays = normalizeHolidays(input.holidays);
    // 공용 계산 사용 — 휴강일은 건너뛰되 회차 수를 채운다(SA-13).
    const dates = buildSessionDates({
      start: input.startDate,
      weekday,
      weeks,
      holidays,
    });
    const endYmd = lastSessionDate(dates);
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
        // 복사에 쓴 스케줄을 새 차시의 기본값으로 남긴다.
        default_weekday: weekday,
        default_weeks: weeks,
        default_holidays: holidays,
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
      // 주 2회 이상 프로그램은 자기 요일을 유지합니다(차시 복사 요일 하나로 덮으면
      //   월·수 수업이 토요일 1회로 바뀌어 버립니다). 회차 수는 "주 수 × 주당 횟수".
      //   주 1회 프로그램은 예전처럼 복사 창의 요일을 따릅니다.
      const multi = p.session_weekdays.length > 1;
      const pWeekdays = multi ? p.session_weekdays : [weekday];
      const pDates = multi
        ? buildSessionDates({ start: input.startDate, weekdays: pWeekdays, weeks: weeks * pWeekdays.length, holidays })
        : dates;
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
          deduction_rate: p.deduction_rate,
          pay_type: p.pay_type,
          share_rate: p.share_rate,
          status: "active",
          sort_order: p.sort_order,
          // 복제 프로그램도 자기 스케줄을 갖는다(이후 개별 수정 가능).
          session_start: pDates[0] ?? input.startDate,
          ...weekdayColumns(pWeekdays),
          session_weeks: pDates.length,
          session_holidays: holidays,
        })
        .select("id")
        .single();
      if (pErr) throw new Error(pErr.message);
      const newProgId = String((np as { id: string }).id);
      const rows = pDates.map((d, i) => ({
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
  // 과목 — 강사비 지급대장 C열. 비면 지급대장이 name 으로 폴백한다.
  subject: string | null;
  instructor_id: string | null;
  period_no: number | null;
  time_start: string | null;
  time_end: string | null;
  target: string | null;
  capacity: number | null;
  tuition: number | null;
  room: string | null;
  hourly_rate: number | null;
  deduction_rate: number | null;
  // ST-5. 정산 방식 + 분배율. hourly 면 share_rate 는 무시된다(값은 보존).
  pay_type: PayType;
  share_rate: number | null;
  // 실제 스케줄 — 저장 시 이 값으로 회차를 생성·재생성한다.
  session_start: string | null;
  session_weekdays: number[]; // 0 일 ~ 6 토, 여러 개
  session_weeks: number | null; // 회차 수
  session_holidays: string[];
  // 스케줄 변경으로 계획서·작성 중 일지·출석이 있는 회차가 지워질 때, 화면에서
  //   확인을 받았는지. 없으면 서버가 저장을 멈추고 확인을 요청합니다.
  acceptDiscard?: boolean;
};
function progPayload(i: ProgramInput) {
  const num = (v: number | null) => (v == null || Number.isNaN(v) ? null : v);
  const sc = normSchedule({
    start: i.session_start,
    weekdays: i.session_weekdays,
    weeks: i.session_weeks,
    holidays: i.session_holidays,
  });
  return {
    name: (i.name ?? "").trim(),
    subject: clean(i.subject),
    instructor_id: i.instructor_id || null,
    period_no: num(i.period_no),
    time_start: clean(i.time_start),
    time_end: clean(i.time_end),
    target: clean(i.target),
    capacity: num(i.capacity),
    tuition: num(i.tuition),
    room: clean(i.room),
    hourly_rate: num(i.hourly_rate),
    deduction_rate: num(i.deduction_rate),
    pay_type: normalizePayType(i.pay_type),
    // 분배율은 0~100 으로 제한(음수·초과 입력 방어).
    share_rate:
      i.share_rate == null || Number.isNaN(i.share_rate)
        ? null
        : Math.min(100, Math.max(0, Number(i.share_rate))),
    session_start: sc.start,
    ...weekdayColumns(sc.weekdays),
    session_weeks: sc.weeks,
    session_holidays: sc.holidays,
  };
}

function scheduleOf(payload: ReturnType<typeof progPayload>): SessionSchedule {
  return {
    start: payload.session_start,
    weekdays: payload.session_weekdays ?? [],
    weeks: payload.session_weeks,
    holidays: payload.session_holidays,
  };
}

// 프로그램의 회차 현황 — 잠긴 회차(제출·확정·정산 귀속)는 지우지 않는다.
type SessionRow = {
  id: string;
  session_no: number;
  session_date: string | null;
  locked: boolean;
};
async function loadSessions(programId: string): Promise<SessionRow[]> {
  const { data } = await supabaseAdmin
    .from(SESS)
    .select(
      "id, session_no, session_date, instructor_submitted_at, staff_confirmed_at, settlement_id"
    )
    .eq("program_id", programId)
    .order("session_date", { ascending: true })
    .order("session_no", { ascending: true });
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id ?? ""),
      session_no: Number(row.session_no ?? 0),
      session_date: (row.session_date as string | null) ?? null,
      locked:
        row.instructor_submitted_at != null ||
        row.staff_confirmed_at != null ||
        row.settlement_id != null,
    };
  });
}

// 회차 일괄 생성. 실패 시 예외를 던진다(호출자가 보상 처리).
async function insertSessions(
  programId: string,
  dates: string[],
  startNo = 1
): Promise<number> {
  if (!dates.length) return 0;
  const rows = dates.map((d, i) => ({
    program_id: programId,
    session_no: startNo + i,
    session_date: d,
  }));
  const { error } = await supabaseAdmin.from(SESS).insert(rows);
  if (error) throw new Error(error.message);
  return rows.length;
}

export type SessionSyncResult = {
  created: number;
  deleted: number;
  kept: number; // 보존된 잠긴 회차
};

// 스케줄대로 회차를 맞춘다.
//   * 잠긴 회차(제출·확정·정산)가 없으면 전부 지우고 새로 만든다.
//   * 있으면 잠긴 회차는 보존하고 나머지만 지운 뒤 새 스케줄로 채우고,
//     날짜 오름차순으로 회차 번호를 재정렬한다.
// (program_id, session_no) 유니크 제약이 있어도 안전하게 번호를 재배치하기 위한
// 임시 번호 시작값 — 재정렬 중 기존 번호와 겹치지 않게 한 번 비켜 둔다.
const TEMP_NO_BASE = 10000;

async function setSessionNo(id: string, no: number): Promise<void> {
  const { error } = await supabaseAdmin
    .from(SESS)
    .update({ session_no: no })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

async function syncSessions(
  programId: string,
  sc: SessionSchedule
): Promise<SessionSyncResult> {
  const dates = scheduleDates(sc);
  const existing = await loadSessions(programId);
  const locked = existing.filter((s) => s.locked);
  const unlocked = existing.filter((s) => !s.locked);

  if (unlocked.length) {
    const { error } = await supabaseAdmin
      .from(SESS)
      .delete()
      .in(
        "id",
        unlocked.map((s) => s.id)
      );
    if (error) throw new Error(error.message);
  }

  // 보존분을 임시 번호로 비켜 둔다 → 낮은 번호대가 비어 신규 삽입·재정렬이 안전.
  for (let i = 0; i < locked.length; i++) {
    await setSessionNo(locked[i].id, TEMP_NO_BASE + i);
  }

  // 잠긴 회차가 이미 차지한 날짜는 새로 만들지 않는다.
  const lockedDates = new Set(
    locked.map((s) => s.session_date).filter(Boolean) as string[]
  );
  const toCreate = dates.filter((d) => !lockedDates.has(d));
  const created = await insertSessions(
    programId,
    toCreate,
    TEMP_NO_BASE + locked.length
  );

  // 번호 재정렬 — 보존분 + 신규분을 날짜순으로 1..n.
  const all = await loadSessions(programId);
  const ordered = [...all].sort((a, b) => {
    const ad = a.session_date ?? "9999-12-31";
    const bd = b.session_date ?? "9999-12-31";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.session_no - b.session_no;
  });
  for (let i = 0; i < ordered.length; i++) {
    const want = i + 1;
    if (ordered[i].session_no !== want) await setSessionNo(ordered[i].id, want);
  }

  return { created, deleted: unlocked.length, kept: locked.length };
}

// =====================================================================
// 스케줄 변경 전 안전 점검 (2026-10, 주 2회 도입과 함께)
//   syncSessions 는 "잠긴 회차(일지 제출·직원 확정·정산 귀속)"만 보존하고 나머지를
//   지운 뒤 새로 만듭니다. 그래서 두 가지를 먼저 봅니다.
//   ① 잠긴 회차의 날짜가 새 스케줄에 없으면 막습니다. 보존된 회차가 엉뚱한 날짜에
//      남아 회차 수가 늘고 번호가 섞입니다(예: 토요일 일지가 제출된 뒤 월·수로 변경).
//   ② 잠기지 않았어도 내용이 있는 회차(강사 계획서·작성 중 일지·출석·동아리 지출
//      연결)가 지워지면 확인을 받습니다. 출석은 CASCADE 로 함께 지워집니다.
//   반환 null = 진행해도 됨.
// =====================================================================
async function checkSyncImpact(
  programId: string,
  sc: SessionSchedule,
  acceptDiscard: boolean
): Promise<{ ok: false; message: string; needsConfirm?: boolean } | null> {
  const newDates = new Set(scheduleDates(sc));
  const { data } = await supabaseAdmin
    .from(SESS)
    .select("id, session_no, session_date, plan_content, log_content, instructor_submitted_at, staff_confirmed_at, settlement_id")
    .eq("program_id", programId);
  const rows = (data ?? []) as {
    id: string;
    session_no: number;
    session_date: string | null;
    plan_content: string | null;
    log_content: string | null;
    instructor_submitted_at: string | null;
    staff_confirmed_at: string | null;
    settlement_id: string | null;
  }[];
  const isLocked = (r: (typeof rows)[number]) =>
    r.instructor_submitted_at != null || r.staff_confirmed_at != null || r.settlement_id != null;

  const strayLocked = rows.filter((r) => isLocked(r) && (!r.session_date || !newDates.has(r.session_date)));
  if (strayLocked.length) {
    const list = strayLocked
      .slice(0, 5)
      .map((r) => `${r.session_no}회차(${r.session_date ?? "날짜 없음"})`)
      .join(", ");
    return {
      ok: false,
      message:
        `이미 제출·확정·정산된 회차 ${strayLocked.length}건(${list}${strayLocked.length > 5 ? " 등" : ""})이 새 스케줄(${weekdaysLabel(sc.weekdays.length ? sc.weekdays : [6])}) 날짜에 없어 바꿀 수 없습니다. ` +
        "제출된 일지가 있는 날짜는 새 스케줄에도 들어가야 합니다(시작일·요일·회차 수를 맞추거나, 남은 회차는 새 프로그램으로 나누세요).",
    };
  }

  const unlocked = rows.filter((r) => !isLocked(r));
  if (!unlocked.length || acceptDiscard) return null;
  const ids = unlocked.map((r) => r.id);
  const [{ data: att }, { data: exp }] = await Promise.all([
    supabaseAdmin.from("saem_attendance").select("session_id").in("session_id", ids),
    supabaseAdmin.from("saem_club_expenses").select("session_id").in("session_id", ids),
  ]);
  const attIds = new Set((att ?? []).map((a) => String((a as { session_id: string }).session_id)));
  const expIds = new Set((exp ?? []).map((a) => String((a as { session_id: string }).session_id)));
  const plan = unlocked.filter((r) => (r.plan_content ?? "").trim()).length;
  const log = unlocked.filter((r) => (r.log_content ?? "").trim()).length;
  const attendance = unlocked.filter((r) => attIds.has(r.id)).length;
  const expense = unlocked.filter((r) => expIds.has(r.id)).length;
  if (plan + log + attendance + expense === 0) return null;
  const parts = [
    plan && `강사 계획서 ${plan}회차`,
    log && `작성 중(미제출) 일지 ${log}회차`,
    attendance && `출석 기록 ${attendance}회차`,
    expense && `지출 연결 ${expense}회차`,
  ].filter(Boolean);
  return {
    ok: false,
    needsConfirm: true,
    message: `스케줄을 바꾸면 회차를 다시 만들면서 ${parts.join(", ")}의 내용이 지워집니다(제출·확정된 회차는 보존). 계속하려면 확인란에 체크한 뒤 다시 저장하세요.`,
  };
}

// 스케줄 필드가 실제로 바뀌었는지.
function scheduleChanged(before: SaemProgram, after: SessionSchedule): boolean {
  const b = normSchedule({
    start: before.session_start,
    weekdays: before.session_weekdays,
    weeks: before.session_weeks,
    holidays: before.session_holidays,
  });
  return (
    b.start !== after.start ||
    b.weekdays.join(",") !== after.weekdays.join(",") ||
    b.weeks !== after.weeks ||
    b.holidays.join(",") !== after.holidays.join(",")
  );
}

export async function addProgram(
  termId: string,
  input: ProgramInput
): Promise<
  { ok: true; id: string; sessions: number } | { ok: false; message: string }
> {
  try {
    await requireSaemAccess();
    const payload = progPayload(input);
    if (!termId || !payload.name)
      return { ok: false, message: "차시와 프로그램명을 확인하세요." };
    const sc = scheduleOf(payload);
    if (sc.weeks && !sc.start)
      return { ok: false, message: "회차 수를 넣었으면 시작일도 지정하세요." };
    const dates = scheduleDates(sc);

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

    // 회차 생성 — 실패하면 프로그램도 지운다(회차 없는 프로그램을 남기지 않음).
    let sessions = 0;
    try {
      sessions = await insertSessions(newId, dates, 1);
    } catch (e) {
      await supabaseAdmin.from(SESS).delete().eq("program_id", newId);
      await supabaseAdmin.from(PROG).delete().eq("id", newId);
      throw e;
    }

    revalidatePath("/hr/saems/programs");
    return { ok: true, id: newId, sessions };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "추가 중 오류가 발생했습니다." };
  }
}

export async function updateProgram(
  id: string,
  input: ProgramInput
): Promise<
  | { ok: true; sync: SessionSyncResult | null }
  | { ok: false; message: string; needsConfirm?: boolean }
> {
  try {
    await requireSaemAccess();
    const payload = progPayload(input);
    if (!id || !payload.name) return { ok: false, message: "프로그램명을 확인하세요." };
    const sc = scheduleOf(payload);
    if (sc.weeks && !sc.start)
      return { ok: false, message: "회차 수를 넣었으면 시작일도 지정하세요." };

    // 변경 전 스케줄과 비교 — 스케줄이 바뀐 경우에만 회차를 다시 맞춘다.
    const { data: beforeRow } = await supabaseAdmin
      .from(PROG)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!beforeRow) return { ok: false, message: "프로그램을 찾을 수 없습니다." };
    const before = toProgram(beforeRow as Record<string, unknown>);

    // 스케줄이 바뀌면 회차를 다시 맞춘다 — 그 전에 잃는 것이 없는지 먼저 본다.
    const changed = scheduleChanged(before, sc);
    if (changed) {
      const guard = await checkSyncImpact(id, sc, !!input.acceptDiscard);
      if (guard) return guard;
    }

    const { error } = await supabaseAdmin.from(PROG).update(payload).eq("id", id);
    if (error) throw new Error(error.message);

    let sync: SessionSyncResult | null = null;
    if (changed) sync = await syncSessions(id, sc);

    revalidatePath("/hr/saems/programs");
    return { ok: true, sync };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "수정 중 오류가 발생했습니다." };
  }
}

// 회차 0건 프로그램 구제 — 스케줄을 받아 회차를 생성한다(기존 회차가 있으면
// 같은 규칙으로 맞춘다: 잠긴 회차 보존 + 나머지 재생성).
export async function generateProgramSessions(
  programId: string,
  schedule: {
    start: string;
    weekdays: number[];
    weeks: number;
    holidays: string[];
    acceptDiscard?: boolean;
  }
): Promise<
  | { ok: true; sync: SessionSyncResult }
  | { ok: false; message: string; needsConfirm?: boolean }
> {
  try {
    await requireSaemAccess();
    if (!programId) return { ok: false, message: "대상 프로그램이 없습니다." };
    const sc = normSchedule(schedule);
    if (!sc.start || !sc.weeks)
      return { ok: false, message: "시작일과 회차 수를 지정하세요." };
    if (scheduleDates(sc).length === 0)
      return { ok: false, message: "생성할 회차 날짜가 없습니다. 시작일·회차 수를 확인하세요." };
    const guard = await checkSyncImpact(programId, sc, !!schedule.acceptDiscard);
    if (guard) return guard;

    // 프로그램에도 스케줄을 기록(이후 수정 기준값).
    const { error: pErr } = await supabaseAdmin
      .from(PROG)
      .update({
        session_start: sc.start,
        ...weekdayColumns(sc.weekdays),
        session_weeks: sc.weeks,
        session_holidays: sc.holidays,
      })
      .eq("id", programId);
    if (pErr) throw new Error(pErr.message);

    const sync = await syncSessions(programId, sc);
    revalidatePath("/hr/saems/programs");
    return { ok: true, sync };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "회차 생성 중 오류가 발생했습니다." };
  }
}

// =====================================================================
// SA-15. 프로그램 삭제 판정 — 정산 근거 보존을 위해 기록이 있으면 삭제 불가.
//   사유를 건수로 돌려주어 화면이 "왜 안 되는지"와 해제 절차를 보여줄 수 있게 한다.
// =====================================================================
export type ProgramDeletability = {
  deletable: boolean;
  sessionCount: number; // 회차 수(삭제 시 함께 지워짐)
  submittedLogs: number; // 강사 제출 일지
  confirmedLogs: number; // 직원 확정 일지
  settlementLinks: number; // 정산에 묶인 회차(전체)
  confirmedSettlementLinks: number; // 그중 확정된 정산
};

async function judgeProgramDeletable(id: string): Promise<ProgramDeletability> {
  const { data: sess } = await supabaseAdmin
    .from(SESS)
    .select("id, instructor_submitted_at, staff_confirmed_at, settlement_id")
    .eq("program_id", id);

  const rows = (sess ?? []).map((r) => r as Record<string, unknown>);
  const submittedLogs = rows.filter((r) => r.instructor_submitted_at != null).length;
  const confirmedLogs = rows.filter((r) => r.staff_confirmed_at != null).length;
  const settIds = [
    ...new Set(
      rows
        .map((r) => (r.settlement_id as string | null) ?? null)
        .filter(Boolean) as string[]
    ),
  ];
  const settlementLinks = rows.filter((r) => r.settlement_id != null).length;

  // 묶인 정산 중 확정된 것 개수(회차 단위로 센다).
  let confirmedSettlementLinks = 0;
  if (settIds.length) {
    const { data: setts } = await supabaseAdmin
      .from(SETT)
      .select("id, status")
      .in("id", settIds);
    const confirmedSet = new Set(
      (setts ?? [])
        .filter((s) => (s as { status: string }).status === "confirmed")
        .map((s) => String((s as { id: string }).id))
    );
    confirmedSettlementLinks = rows.filter(
      (r) =>
        r.settlement_id != null && confirmedSet.has(String(r.settlement_id))
    ).length;
  }

  return {
    deletable:
      submittedLogs === 0 && confirmedLogs === 0 && settlementLinks === 0,
    sessionCount: rows.length,
    submittedLogs,
    confirmedLogs,
    settlementLinks,
    confirmedSettlementLinks,
  };
}

export async function checkProgramDeletable(
  id: string
): Promise<ProgramDeletability> {
  await requireSaemAccess();
  return judgeProgramDeletable(id);
}

// 삭제 — 판정을 서버에서 재수행(화면 판정만 믿지 않음). 회차도 함께 삭제.
export async function deleteProgram(
  id: string
): Promise<
  | { ok: true; deletedSessions: number }
  | { ok: false; message: string; deletability?: ProgramDeletability }
> {
  try {
    await requireSaemAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };

    const d = await judgeProgramDeletable(id);
    if (!d.deletable)
      return {
        ok: false,
        message:
          "제출·확정된 근무일지 또는 정산 연결이 있어 삭제할 수 없습니다.",
        deletability: d,
      };

    // 회차 삭제 — 실패를 삼키지 않는다(조용한 실패 경로 제거).
    const { error: sErr } = await supabaseAdmin
      .from(SESS)
      .delete()
      .eq("program_id", id);
    if (sErr) throw new Error(`회차 삭제 실패: ${sErr.message}`);
    const { error } = await supabaseAdmin.from(PROG).delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/saems/programs");
    return { ok: true, deletedSessions: d.sessionCount };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다." };
  }
}
