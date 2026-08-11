"use server";

// =====================================================================
// SA-18. 수강생 명단 — 현황 조회 / ERP 엑셀 업로드(미리보기→적용) / 수동 CRUD
//   * saem_enrollments 만 다룬다. RLS 0개 → 모든 함수 첫 줄이 requireSaemAccess.
//   * 저장 필드는 7개로 고정(개인정보 최소화) — lib/saemEnrollment 참조.
//   * 연락처·비상연락처는 직원 화면 전용. 강사 앱(동래샘들)에는 내보내지 않는다.
// =====================================================================

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSaemAccess } from "@/lib/saemAccess";
import {
  parseErpWorkbook,
  matchErpGroup,
  orderByKoreanName,
  type ErpGroup,
  type ErpStudent,
  type GroupMatch,
  type MatchTarget,
} from "@/lib/saemEnrollment";

const PROG = "saem_programs";
const ENROLL = "saem_enrollments";
const ATTEND = "saem_attendance";

// 순번 재부여 중 (program_id, seq_no) 유니크 제약이 있어도 충돌하지 않도록
// 한 번 비켜 두는 임시 번호대(programActions.syncSessions 와 같은 기법).
const TEMP_SEQ_BASE = 10000;

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length ? s : null;
}

// erp_no 컬럼 미적용(마이그레이션 미실행) 상황을 사람이 읽을 수 있게 바꾼다.
//   supabase-js 의 에러는 Error 인스턴스가 아닌 { message, code } 객체다.
function describeError(e: unknown): string {
  const msg =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e !== null && "message" in e
        ? String((e as { message: unknown }).message ?? "")
        : String(e ?? "");
  // 42703 "column ... does not exist" / PGRST204 "Could not find the '...' column".
  if (
    /erp_no/.test(msg) &&
    /(does not exist|Could not find the)/i.test(msg)
  )
    return "saem_enrollments.erp_no 컬럼이 없습니다. supabase/migrations/saem_enrollment_erp.sql 을 Supabase SQL Editor에서 실행하세요.";
  return msg || "오류가 발생했습니다.";
}

// =====================================================================
// 타입
// =====================================================================
export type EnrollmentRow = {
  id: string;
  program_id: string;
  erp_no: string | null; // null = 수동 추가(엑셀 대조 대상 아님)
  seq_no: number | null;
  student_name: string;
  school: string | null;
  grade: string | null; // ERP "교급"(초등학생/영·유아) — 학년이 아니다.
  birth_date: string | null; // "YYYY-MM-DD". 학년 자동계산용(lib/schoolGrade).
  contact: string | null;
  emergency_contact: string | null;
  status: string; // active | cancelled
};

function toEnrollment(r: Record<string, unknown>): EnrollmentRow {
  const s = (v: unknown): string | null => {
    const x = v == null ? "" : String(v).trim();
    return x.length ? x : null;
  };
  return {
    id: String(r.id ?? ""),
    program_id: String(r.program_id ?? ""),
    erp_no: s(r.erp_no),
    seq_no: r.seq_no == null ? null : Number(r.seq_no),
    student_name: String(r.student_name ?? ""),
    school: s(r.school),
    grade: s(r.grade),
    // date 컬럼은 supabase-js 가 "YYYY-MM-DD" 문자열로 준다(시각·타임존 없음).
    birth_date: s(r.birth_date),
    contact: s(r.contact),
    emergency_contact: s(r.emergency_contact),
    status: String(r.status ?? "active"),
  };
}

// 프로그램별 명단 현황(목록 화면).
export type EnrollmentOverviewRow = {
  programId: string;
  programName: string;
  instructorName: string | null;
  periodNo: number | null;
  timeStart: string | null;
  timeEnd: string | null;
  capacity: number | null;
  activeCount: number;
  cancelledCount: number;
  manualCount: number; // 수동 추가(erp_no 없음) 활성 인원
};

const PROG_COLS =
  "id, name, instructor_id, period_no, time_start, time_end, capacity, sort_order";

type ProgRow = {
  id: string;
  name: string;
  instructor_id: string | null;
  period_no: number | null;
  time_start: string | null;
  time_end: string | null;
  capacity: number | null;
  sort_order: number | null;
};

async function loadTermPrograms(termId: string): Promise<ProgRow[]> {
  const { data } = await supabaseAdmin
    .from(PROG)
    .select(PROG_COLS)
    .eq("term_id", termId)
    .order("period_no", { ascending: true })
    .order("sort_order", { ascending: true });
  return (data ?? []) as ProgRow[];
}

async function instructorNames(
  programs: ProgRow[]
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(programs.map((p) => p.instructor_id).filter(Boolean) as string[]),
  ];
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const { data } = await supabaseAdmin
    .from("saem_instructors")
    .select("id, name")
    .in("id", ids);
  for (const r of data ?? [])
    map.set((r as { id: string }).id, (r as { name: string }).name);
  return map;
}

export async function listEnrollmentOverview(
  termId: string
): Promise<EnrollmentOverviewRow[]> {
  await requireSaemAccess();
  if (!termId) return [];
  const programs = await loadTermPrograms(termId);
  if (!programs.length) return [];
  const names = await instructorNames(programs);

  const stat = new Map<
    string,
    { active: number; cancelled: number; manual: number }
  >();
  const { data: enrolls, error } = await supabaseAdmin
    .from(ENROLL)
    .select("program_id, status, erp_no")
    .in(
      "program_id",
      programs.map((p) => p.id)
    );
  // erp_no 미적용 시에도 화면은 열려야 한다(현황 0명으로 표시 + 업로드 시 안내).
  if (!error) {
    for (const r of enrolls ?? []) {
      const row = r as Record<string, unknown>;
      const pid = String(row.program_id ?? "");
      const cur = stat.get(pid) ?? { active: 0, cancelled: 0, manual: 0 };
      if (String(row.status ?? "active") === "active") {
        cur.active += 1;
        if (row.erp_no == null) cur.manual += 1;
      } else {
        cur.cancelled += 1;
      }
      stat.set(pid, cur);
    }
  }

  return programs.map((p) => {
    const st = stat.get(p.id);
    return {
      programId: p.id,
      programName: p.name,
      instructorName: p.instructor_id ? names.get(p.instructor_id) ?? null : null,
      periodNo: p.period_no,
      timeStart: p.time_start,
      timeEnd: p.time_end,
      capacity: p.capacity,
      activeCount: st?.active ?? 0,
      cancelledCount: st?.cancelled ?? 0,
      manualCount: st?.manual ?? 0,
    };
  });
}

// 프로그램 명단 상세 — 직원 화면 전용(연락처 포함).
export async function listProgramEnrollments(
  programId: string
): Promise<EnrollmentRow[]> {
  await requireSaemAccess();
  if (!programId) return [];
  const { data, error } = await supabaseAdmin
    .from(ENROLL)
    .select("*")
    .eq("program_id", programId)
    .order("seq_no", { ascending: true, nullsFirst: false });
  if (error) throw new Error(describeError(error));
  return (data ?? [])
    .map((r) => toEnrollment(r as Record<string, unknown>))
    .sort((a, b) => {
      // 활성 먼저, 그 안에서 순번(없으면 이름).
      if ((a.status === "active") !== (b.status === "active"))
        return a.status === "active" ? -1 : 1;
      if (a.seq_no != null && b.seq_no != null) return a.seq_no - b.seq_no;
      return a.student_name.localeCompare(b.student_name, "ko");
    });
}

// =====================================================================
// 순번 재부여 — 활성 수강생을 이름 가나다순 1..n.
//   유니크 제약 유무와 무관하게 안전하도록 2단계(임시번호대 → 최종번호)로 쓴다.
// =====================================================================
async function renumberProgram(programId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from(ENROLL)
    .select("id, student_name, erp_no, seq_no, status")
    .eq("program_id", programId);
  if (error) throw new Error(describeError(error));

  const rows = (data ?? []).map((r) => r as Record<string, unknown>);
  const active = orderByKoreanName(
    rows
      .filter((r) => String(r.status ?? "active") === "active")
      .map((r) => ({
        id: String(r.id),
        student_name: String(r.student_name ?? ""),
        erp_no: r.erp_no == null ? null : String(r.erp_no),
        seq_no: r.seq_no == null ? null : Number(r.seq_no),
      }))
  );
  const cancelled = rows
    .filter((r) => String(r.status ?? "active") !== "active")
    .map((r) => ({
      id: String(r.id),
      seq_no: r.seq_no == null ? null : Number(r.seq_no),
    }));

  // 취소 건은 순번을 비운다(활성 명단의 1..n 이 끊기지 않게).
  for (const c of cancelled) {
    if (c.seq_no == null) continue;
    const { error: e } = await supabaseAdmin
      .from(ENROLL)
      .update({ seq_no: null })
      .eq("id", c.id);
    if (e) throw new Error(describeError(e));
  }

  const target = new Map(active.map((a, i) => [a.id, i + 1]));
  const needsChange = active.filter((a) => a.seq_no !== target.get(a.id));
  if (!needsChange.length) return active.length;

  // 1단계 — 바꿔야 하는 행만 임시 번호대로 비켜 둔다.
  for (let i = 0; i < needsChange.length; i++) {
    const { error: e } = await supabaseAdmin
      .from(ENROLL)
      .update({ seq_no: TEMP_SEQ_BASE + i })
      .eq("id", needsChange[i].id);
    if (e) throw new Error(describeError(e));
  }
  // 2단계 — 최종 번호.
  for (const a of needsChange) {
    const { error: e } = await supabaseAdmin
      .from(ENROLL)
      .update({ seq_no: target.get(a.id) ?? null })
      .eq("id", a.id);
    if (e) throw new Error(describeError(e));
  }
  return active.length;
}

// =====================================================================
// ERP 엑셀 업로드 — 미리보기
// =====================================================================
export type GroupPreview = {
  key: string;
  rawProgramName: string;
  baseName: string;
  classTime: string | null;
  fileCapacity: number | null;
  category: string | null;
  fileCount: number; // 예약 확정 인원(반영 대상)
  excludedCount: number; // 취소 등 제외 인원
  excludedNames: string[];
  match: GroupMatch;
  programId: string | null; // 실제 배정(수동 변경 반영)
  manualOverride: boolean;
  // 배정된 프로그램 기준 대조 결과.
  addedNames: string[]; // 신규 추가
  keptNames: string[]; // 기존 유지(정보 갱신)
  restoredNames: string[]; // 취소였다가 파일에 다시 있어 활성 복원
  missing: { id: string; erp_no: string; student_name: string }[]; // 파일에서 사라진 기존
  duplicateProgram: boolean; // 다른 그룹과 같은 프로그램에 배정됨
};

export type ProgramOption = {
  id: string;
  label: string; // "1교시 10:00~11:20 · 두둠칫 댄스교실 (정원 13)"
};

export type ErpPreviewResult =
  | {
      ok: true;
      sheetName: string;
      totalRows: number;
      confirmedRows: number;
      excludedRows: number;
      warnings: string[];
      groups: GroupPreview[];
      programOptions: ProgramOption[];
    }
  | { ok: false; message: string };

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

function programLabel(p: ProgRow): string {
  const period = p.period_no != null ? `${p.period_no}교시` : "교시 미지정";
  const time = p.time_start ? ` ${hhmm(p.time_start)}~${hhmm(p.time_end)}` : "";
  const cap = p.capacity != null ? ` (정원 ${p.capacity})` : "";
  return `${period}${time} · ${p.name}${cap}`;
}

function toMatchTargets(programs: ProgRow[]): MatchTarget[] {
  return programs.map((p) => ({
    id: p.id,
    name: p.name,
    time_start: p.time_start,
    time_end: p.time_end,
    period_no: p.period_no,
  }));
}

// 그룹 → 배정 프로그램의 대조 결과. existing 은 그 프로그램의 기존 명단 전체.
function diffGroup(
  group: ErpGroup,
  existing: EnrollmentRow[]
): Pick<
  GroupPreview,
  "addedNames" | "keptNames" | "restoredNames" | "missing"
> {
  const byErp = new Map(
    existing.filter((e) => e.erp_no).map((e) => [e.erp_no as string, e])
  );
  const fileErp = new Set(group.students.map((s) => s.erp_no));
  const addedNames: string[] = [];
  const keptNames: string[] = [];
  const restoredNames: string[] = [];
  for (const s of orderByKoreanName(group.students)) {
    const prev = byErp.get(s.erp_no);
    if (!prev) addedNames.push(s.student_name);
    else if (prev.status === "active") keptNames.push(s.student_name);
    else restoredNames.push(s.student_name);
  }
  // 사라진 대상 = ERP에서 온 활성 수강생 중 파일에 없는 사람.
  //   수동 추가(erp_no null)는 애초에 파일에 있을 수 없으므로 제외한다.
  const missing = existing
    .filter((e) => e.status === "active" && e.erp_no && !fileErp.has(e.erp_no))
    .map((e) => ({
      id: e.id,
      erp_no: e.erp_no as string,
      student_name: e.student_name,
    }))
    .sort((a, b) => a.student_name.localeCompare(b.student_name, "ko"));
  return { addedNames, keptNames, restoredNames, missing };
}

async function loadExistingByProgram(
  programIds: string[]
): Promise<Map<string, EnrollmentRow[]>> {
  const map = new Map<string, EnrollmentRow[]>();
  const ids = [...new Set(programIds.filter(Boolean))];
  if (!ids.length) return map;
  const { data, error } = await supabaseAdmin
    .from(ENROLL)
    .select("*")
    .in("program_id", ids);
  if (error) throw new Error(describeError(error));
  for (const r of data ?? []) {
    const row = toEnrollment(r as Record<string, unknown>);
    const list = map.get(row.program_id) ?? [];
    list.push(row);
    map.set(row.program_id, list);
  }
  return map;
}

export async function previewErpUpload(input: {
  termId: string;
  base64: string;
  // 화면에서 드롭다운으로 바꾼 배정(그룹 key → programId, "" = 이 그룹 건너뛰기).
  overrides?: Record<string, string>;
}): Promise<ErpPreviewResult> {
  try {
    await requireSaemAccess();
    if (!input.termId) return { ok: false, message: "차시를 선택하세요." };
    if (!input.base64) return { ok: false, message: "엑셀 파일을 선택하세요." };

    const programs = await loadTermPrograms(input.termId);
    if (!programs.length)
      return {
        ok: false,
        message: "이 차시에 프로그램이 없습니다. 먼저 프로그램을 편성하세요.",
      };

    const parsed = parseErpWorkbook(Buffer.from(input.base64, "base64"));
    if (parsed.headerRowIndex < 0 || parsed.groups.length === 0)
      return {
        ok: false,
        message:
          parsed.warnings[0] ??
          "읽을 수 있는 신청 내역이 없습니다. ERP 신청자 목록 엑셀인지 확인하세요.",
      };

    const targets = toMatchTargets(programs);
    const overrides = input.overrides ?? {};
    const progById = new Map(programs.map((p) => [p.id, p]));

    // 각 그룹의 배정 결정(자동 매칭 → 수동 변경이 덮어쓴다).
    const decided = parsed.groups.map((g) => {
      const match = matchErpGroup(g, targets);
      const raw = overrides[g.key];
      const hasOverride = raw !== undefined;
      const programId = hasOverride
        ? raw && progById.has(raw)
          ? raw
          : null
        : match.programId;
      return { g, match, programId, manualOverride: hasOverride };
    });

    // 같은 프로그램에 두 그룹이 배정되면 뒤 그룹이 앞 그룹을 지우게 되므로 경고.
    const countByProgram = new Map<string, number>();
    for (const d of decided) {
      if (!d.programId) continue;
      countByProgram.set(d.programId, (countByProgram.get(d.programId) ?? 0) + 1);
    }

    const existingByProgram = await loadExistingByProgram(
      decided.map((d) => d.programId ?? "")
    );

    const groups: GroupPreview[] = decided.map((d) => {
      const existing = d.programId
        ? existingByProgram.get(d.programId) ?? []
        : [];
      const diff = d.programId
        ? diffGroup(d.g, existing)
        : { addedNames: [], keptNames: [], restoredNames: [], missing: [] };
      return {
        key: d.g.key,
        rawProgramName: d.g.rawProgramName,
        baseName: d.g.baseName,
        classTime: d.g.classTime,
        fileCapacity: d.g.fileCapacity,
        category: d.g.category,
        fileCount: d.g.students.length,
        excludedCount: d.g.excluded.length,
        excludedNames: d.g.excluded.map((e) => `${e.student_name}(${e.status})`),
        match: d.match,
        programId: d.programId,
        manualOverride: d.manualOverride,
        ...diff,
        duplicateProgram:
          !!d.programId && (countByProgram.get(d.programId) ?? 0) > 1,
      };
    });

    return {
      ok: true,
      sheetName: parsed.sheetName,
      totalRows: parsed.totalRows,
      confirmedRows: parsed.confirmedRows,
      excludedRows: parsed.excludedRows,
      warnings: parsed.warnings,
      groups,
      programOptions: programs.map((p) => ({ id: p.id, label: programLabel(p) })),
    };
  } catch (e) {
    return { ok: false, message: describeError(e) };
  }
}

// =====================================================================
// ERP 엑셀 업로드 — 적용
// =====================================================================
export type ApplyAssignment = {
  key: string;
  programId: string;
  cancelMissing: boolean; // 파일에서 사라진 기존 수강생을 status='cancelled' 로
};

export type ErpApplyResult =
  | {
      ok: true;
      programs: number;
      inserted: number;
      updated: number;
      cancelled: number;
      skippedGroups: string[]; // 배정 안 된 그룹
    }
  | { ok: false; message: string };

export async function applyErpUpload(input: {
  termId: string;
  base64: string;
  assignments: ApplyAssignment[];
}): Promise<ErpApplyResult> {
  try {
    await requireSaemAccess();
    if (!input.termId) return { ok: false, message: "차시를 선택하세요." };
    const assignments = (input.assignments ?? []).filter((a) => a.programId);
    if (!assignments.length)
      return { ok: false, message: "반영할 그룹이 없습니다. 프로그램을 배정하세요." };

    // 프로그램이 이 차시 소속인지 서버에서 재확인(화면 값만 믿지 않음).
    const programs = await loadTermPrograms(input.termId);
    const allowed = new Set(programs.map((p) => p.id));
    for (const a of assignments) {
      if (!allowed.has(a.programId))
        return { ok: false, message: "이 차시에 없는 프로그램이 배정되었습니다." };
    }
    const dup = assignments
      .map((a) => a.programId)
      .filter((id, i, arr) => arr.indexOf(id) !== i);
    if (dup.length)
      return {
        ok: false,
        message: "한 프로그램에 두 그룹이 배정되었습니다. 배정을 정리한 뒤 적용하세요.",
      };

    const parsed = parseErpWorkbook(Buffer.from(input.base64, "base64"));
    const groupByKey = new Map(parsed.groups.map((g) => [g.key, g]));

    let inserted = 0;
    let updated = 0;
    let cancelledCount = 0;
    const skippedGroups: string[] = [];
    const touched: string[] = [];

    for (const a of assignments) {
      const group = groupByKey.get(a.key);
      if (!group) {
        skippedGroups.push(a.key);
        continue;
      }
      const existing = (await loadExistingByProgram([a.programId])).get(
        a.programId
      ) ?? [];
      const byErp = new Map(
        existing.filter((e) => e.erp_no).map((e) => [e.erp_no as string, e])
      );
      const fileErp = new Set(group.students.map((s) => s.erp_no));

      // ① 신규 삽입 / 기존 갱신.
      const toInsert: (ErpStudent & { program_id: string; status: string })[] = [];
      for (const s of group.students) {
        const prev = byErp.get(s.erp_no);
        if (!prev) {
          toInsert.push({ ...s, program_id: a.programId, status: "active" });
          continue;
        }
        // 재업로드 = 최신 정보로 갱신 + 취소했다가 다시 신청한 경우 활성 복원.
        const { error } = await supabaseAdmin
          .from(ENROLL)
          .update({
            student_name: s.student_name,
            school: s.school,
            grade: s.grade,
            contact: s.contact,
            emergency_contact: s.emergency_contact,
            status: "active",
          })
          .eq("id", prev.id);
        if (error) throw new Error(describeError(error));
        updated++;
      }
      if (toInsert.length) {
        const { error } = await supabaseAdmin.from(ENROLL).insert(toInsert);
        if (error) throw new Error(describeError(error));
        inserted += toInsert.length;
      }

      // ② 파일에서 사라진 기존 수강생 — 기본 유지, 체크 시에만 취소 처리.
      //    수동 추가(erp_no null)는 대상에서 제외한다.
      if (a.cancelMissing) {
        const gone = existing.filter(
          (e) => e.status === "active" && e.erp_no && !fileErp.has(e.erp_no)
        );
        for (const e of gone) {
          const { error } = await supabaseAdmin
            .from(ENROLL)
            .update({ status: "cancelled" })
            .eq("id", e.id);
          if (error) throw new Error(describeError(error));
          cancelledCount++;
        }
      }

      // ③ 순번 재부여(이름 가나다순).
      await renumberProgram(a.programId);
      touched.push(a.programId);
    }

    revalidatePath("/hr/saems/enrollments");
    revalidatePath("/hr/saems/logs");
    return {
      ok: true,
      programs: touched.length,
      inserted,
      updated,
      cancelled: cancelledCount,
      skippedGroups,
    };
  } catch (e) {
    return { ok: false, message: describeError(e) };
  }
}

// =====================================================================
// 수동 CRUD — 엑셀 없이 1명 추가/수정/취소 대응
// =====================================================================
export type EnrollmentInput = {
  student_name: string;
  school: string | null;
  grade: string | null;
  birth_date: string | null;
  contact: string | null;
  emergency_contact: string | null;
};

function enrollPayload(i: EnrollmentInput) {
  return {
    student_name: (i.student_name ?? "").trim(),
    school: clean(i.school),
    grade: clean(i.grade),
    contact: clean(i.contact),
    emergency_contact: clean(i.emergency_contact),
  };
}

const BIRTH_DATE_ERROR =
  "생년월일이 올바른 날짜가 아닙니다. (YYYY-MM-DD 형식)";

// 생년월일 정규화. 빈값 = null(지우기), 형식·실재하지 않는 날짜 = undefined(오류).
//   Postgres date 컬럼에 쓰레기 값을 보내 500 이 나는 대신 사람이 읽는 메시지로
//   돌려주기 위해 "지우기"와 "잘못된 값"을 구분한다.
function cleanBirthDate(v: string | null | undefined): string | null | undefined {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  // 2026-02-31 처럼 존재하지 않는 날짜는 Date 가 조용히 넘겨 버리므로 되짚는다.
  if (d.toISOString().slice(0, 10) !== s) return undefined;
  return s;
}

export async function addEnrollment(
  programId: string,
  input: EnrollmentInput
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    const payload = enrollPayload(input);
    if (!programId || !payload.student_name)
      return { ok: false, message: "프로그램과 이름을 확인하세요." };
    const birth = cleanBirthDate(input.birth_date);
    if (birth === undefined) return { ok: false, message: BIRTH_DATE_ERROR };
    const { data, error } = await supabaseAdmin
      .from(ENROLL)
      .insert({
        ...payload,
        birth_date: birth,
        program_id: programId,
        status: "active",
      })
      .select("id")
      .single();
    if (error) throw new Error(describeError(error));
    await renumberProgram(programId);
    revalidatePath("/hr/saems/enrollments");
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (e) {
    return { ok: false, message: describeError(e) };
  }
}

export async function updateEnrollment(
  id: string,
  input: EnrollmentInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    const payload = enrollPayload(input);
    if (!id || !payload.student_name)
      return { ok: false, message: "이름을 확인하세요." };
    const birth = cleanBirthDate(input.birth_date);
    if (birth === undefined) return { ok: false, message: BIRTH_DATE_ERROR };
    const { data, error } = await supabaseAdmin
      .from(ENROLL)
      .update({ ...payload, birth_date: birth })
      .eq("id", id)
      .select("program_id")
      .maybeSingle();
    if (error) throw new Error(describeError(error));
    if (!data) return { ok: false, message: "수강생을 찾을 수 없습니다." };
    // 이름이 바뀌면 가나다순이 흐트러진다.
    await renumberProgram(String((data as { program_id: string }).program_id));
    revalidatePath("/hr/saems/enrollments");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: describeError(e) };
  }
}

// 생년월일만 갱신 — 명단에서 행마다 바로 입력하는 대량 입력용.
//   이름이 바뀌지 않으므로 renumberProgram(순번 재부여)을 돌리지 않는다.
//   158명을 연속으로 채우는 동선이라 한 건당 쿼리 1회로 끝내는 게 목적.
export async function updateEnrollmentBirthDate(
  id: string,
  birthDate: string | null
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const birth = cleanBirthDate(birthDate);
    if (birth === undefined) return { ok: false, message: BIRTH_DATE_ERROR };

    const { data, error } = await supabaseAdmin
      .from(ENROLL)
      .update({ birth_date: birth })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(describeError(error));
    if (!data) return { ok: false, message: "수강생을 찾을 수 없습니다." };

    revalidatePath("/hr/saems/enrollments");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: describeError(e) };
  }
}

// 취소/복원 — 출석 기록은 건드리지 않는다(정산·근거 보존).
export async function setEnrollmentStatus(
  id: string,
  status: "active" | "cancelled"
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    if (!id || (status !== "active" && status !== "cancelled"))
      return { ok: false, message: "잘못된 요청입니다." };
    const { data, error } = await supabaseAdmin
      .from(ENROLL)
      .update({ status })
      .eq("id", id)
      .select("program_id")
      .maybeSingle();
    if (error) throw new Error(describeError(error));
    if (!data) return { ok: false, message: "수강생을 찾을 수 없습니다." };
    await renumberProgram(String((data as { program_id: string }).program_id));
    revalidatePath("/hr/saems/enrollments");
    revalidatePath("/hr/saems/logs");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: describeError(e) };
  }
}

// 완전 삭제 — 출석 기록이 있으면 막는다(취소 처리로 유도).
export async function deleteEnrollment(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const { data: row } = await supabaseAdmin
      .from(ENROLL)
      .select("id, program_id")
      .eq("id", id)
      .maybeSingle();
    if (!row) return { ok: false, message: "수강생을 찾을 수 없습니다." };

    const { count } = await supabaseAdmin
      .from(ATTEND)
      .select("id", { count: "exact", head: true })
      .eq("enrollment_id", id);
    if ((count ?? 0) > 0)
      return {
        ok: false,
        message: `출석 기록 ${count}건이 있어 삭제할 수 없습니다. '취소'로 처리하세요.`,
      };

    const { error } = await supabaseAdmin.from(ENROLL).delete().eq("id", id);
    if (error) throw new Error(describeError(error));
    await renumberProgram(String((row as { program_id: string }).program_id));
    revalidatePath("/hr/saems/enrollments");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: describeError(e) };
  }
}
