// 출처 ② 동래미래아카데미 수강생 — 차시 고르기(진행 중 차시 기본) → 프로그램 체크.
//   번호: saem_enrollments.contact. 상태 'active' 만(cancelled 등은 제외).
//   사업 찾기: 고정 id(ACADEMY_PROJECT_ID). 그 행이 없으면 이름 검색('동래미래')으로 대신하고
//   서버 로그에 경고합니다. 차시 이름에 '테스트'가 들어가면 목록에서 뺍니다.
//   사용: M0 또는 saem 직무(수강생 연락처 열람 기준과 같음, lib/saemAccess).

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { kstTodayYmd } from "@/lib/trainings";
import { normalizeWeekdays, weekdaysLabel } from "@/lib/saemSchedule";
import { isValidSmsPhone, normalizeSmsPhone } from "@/lib/sms/text";
import { idsOf, inChunks, str, type ResolvedPerson, type SmsSource } from "./types";

// saem_projects — "동래미래 아카데미"(2026-11-03 확인).
export const ACADEMY_PROJECT_ID = "7be2afdc-6f0a-4f38-bf8a-3425217a7f4c";
export const ACADEMY_PROJECT_KEYWORD = "동래미래";

async function academyProjectIds(): Promise<string[]> {
  const { data: fixed, error: fe } = await supabaseAdmin
    .from("saem_projects")
    .select("id")
    .eq("id", ACADEMY_PROJECT_ID)
    .maybeSingle();
  if (fe) throw new Error(`사업 조회 실패: ${fe.message}`);
  if (fixed) return [ACADEMY_PROJECT_ID];
  console.warn(
    `[sms] 동래미래 사업 고정 id(${ACADEMY_PROJECT_ID})를 찾지 못해 이름 검색('${ACADEMY_PROJECT_KEYWORD}')으로 대신합니다. lib/sms/sources/saem-academy.ts 를 확인하세요.`,
  );
  const { data, error } = await supabaseAdmin
    .from("saem_projects")
    .select("id")
    .ilike("name", `%${ACADEMY_PROJECT_KEYWORD}%`);
  if (error) throw new Error(`사업 조회 실패: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((p) => p.id);
}

export type AcademyTerm = {
  id: string;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
};

export async function loadAcademyTerms(): Promise<AcademyTerm[]> {
  const ids = await academyProjectIds();
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("saem_terms")
    .select("id, name, status, start_date, end_date")
    .in("project_id", ids)
    .order("start_date", { ascending: false });
  if (error) throw new Error(`차시 조회 실패: ${error.message}`);
  return ((data ?? []) as AcademyTerm[]).filter((t) => !str(t.name).includes("테스트"));
}

// 기본 차시 — 오늘이 기간 안인 진행 중 차시 → 없으면 가장 최근에 시작하는 진행 중 차시 → 최근 차시.
export function defaultAcademyTerm(terms: AcademyTerm[]): AcademyTerm | null {
  const today = kstTodayYmd();
  const active = terms.filter((t) => t.status === "active");
  return (
    active.find((t) => (t.start_date ?? "") <= today && today <= (t.end_date ?? "9999")) ??
    active[0] ??
    terms[0] ??
    null
  );
}

export function academyTermLabel(t: AcademyTerm): string {
  return `${t.name}${t.status === "active" ? "" : t.status === "closed" ? " (종료)" : ` (${t.status})`}`;
}

type Program = {
  id: string;
  term_id: string;
  name: string;
  instructor_id: string | null;
  time_start: string | null;
  time_end: string | null;
  session_weekdays: unknown;
  session_weekday: number | null;
};
type Enrollment = { id: string; program_id: string; student_name: string | null; contact: string | null };

const PROGRAM_COLS = "id, term_id, name, instructor_id, time_start, time_end, session_weekdays, session_weekday";

export async function loadTermPrograms(termIds: string[]): Promise<Program[]> {
  if (termIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("saem_programs")
    .select(PROGRAM_COLS)
    .in("term_id", termIds)
    .order("sort_order")
    .order("name");
  if (error) throw new Error(`프로그램 조회 실패: ${error.message}`);
  return (data ?? []) as Program[];
}

function schedule(p: Program): string {
  const days = normalizeWeekdays(p.session_weekdays);
  const w = weekdaysLabel(days.length ? days : p.session_weekday == null ? [] : [p.session_weekday]);
  const t = p.time_start ? `${p.time_start.slice(0, 5)}${p.time_end ? `~${p.time_end.slice(0, 5)}` : ""}` : "";
  return [w === "-" ? "" : w, t].filter(Boolean).join(" ");
}

async function loadEnrollments(programIds: string[]): Promise<Enrollment[]> {
  return inChunks(programIds, async (chunk) => {
    const { data, error } = await supabaseAdmin
      .from("saem_enrollments")
      .select("id, program_id, student_name, contact")
      .in("program_id", chunk)
      .eq("status", "active");
    if (error) throw new Error(`수강생 조회 실패: ${error.message}`);
    return (data ?? []) as Enrollment[];
  });
}

const hasPhone = (v: string | null) => isValidSmsPhone(normalizeSmsPhone(v ?? ""));

export const saemAcademySource: SmsSource = {
  key: "saem-academy",
  label: "동래미래아카데미",
  icon: "🎓",
  description: "차시·프로그램별 수강생",
  pickerType: "term-program",
  color: "green",
  canUse: (u) => u.isM0 || u.roles.includes("saem"),

  async loadOptions(_u, { filter }) {
    const terms = await loadAcademyTerms();
    const term = terms.find((t) => t.id === filter.term) ?? defaultAcademyTerm(terms);
    const programs = term ? await loadTermPrograms([term.id]) : [];
    const enrollments = await loadEnrollments(programs.map((p) => p.id));
    return {
      filters: [
        {
          key: "term",
          label: "차시",
          kind: "select",
          value: term?.id ?? "",
          options: terms.map((t) => ({ value: t.id, label: academyTermLabel(t) })),
        },
      ],
      grouped: true,
      bulkLabel: "전체 담기",
      items: programs.map((p) => {
        const mine = enrollments.filter((e) => e.program_id === p.id);
        const reachable = mine.filter((e) => hasPhone(e.contact)).length;
        return {
          id: p.id,
          name: p.name,
          sub: schedule(p) || undefined,
          count: mine.length,
          reachable,
          hasPhone: reachable > 0,
        };
      }),
      note: terms.length === 0 ? "동래미래아카데미 차시가 없습니다." : undefined,
    };
  },

  async resolvePhones(_u, sel) {
    const terms = await loadAcademyTerms();
    const programs = await loadTermPrograms(terms.map((t) => t.id));
    const wanted = new Set(idsOf(sel));
    const picked = programs.filter((p) => wanted.has(p.id));
    const enrollments = await loadEnrollments(picked.map((p) => p.id));
    const nameOf = new Map(picked.map((p) => [p.id, p.name]));
    const people: ResolvedPerson[] = enrollments.map((e) => ({
      key: `saem-academy:${e.id}`,
      name: `${str(e.student_name) || "수강생"}(${nameOf.get(e.program_id) ?? ""})`,
      phone: e.contact,
      ref: { source: "saem-academy", ref_id: e.id, phone: null },
    }));
    // 칩 문구 — 한 차시의 프로그램 전부면 "동래미래 4차시", 일부면 "동래미래 4차시 3개 프로그램".
    const termIds = [...new Set(picked.map((p) => p.term_id))];
    const termName = termIds.length === 1 ? terms.find((t) => t.id === termIds[0])?.name ?? "" : `${termIds.length}개 차시`;
    const allOfTerm =
      termIds.length === 1 && programs.filter((p) => p.term_id === termIds[0]).length === picked.length;
    const short = `동래미래 ${termName}`;
    return {
      label: allOfTerm ? short : picked.length === 1 ? `${short} ${picked[0].name}` : `${short} ${picked.length}개 프로그램`,
      short,
      people,
    };
  },

  async resolveRefs(ids) {
    const rows = await inChunks(ids, async (chunk) => {
      const { data, error } = await supabaseAdmin
        .from("saem_enrollments")
        .select("id, student_name, contact")
        .in("id", chunk)
        .eq("status", "active");
      if (error) throw new Error(`수강생 조회 실패: ${error.message}`);
      return (data ?? []) as { id: string; student_name: string | null; contact: string | null }[];
    });
    return new Map(rows.map((r) => [r.id, { name: str(r.student_name), phone: r.contact }]));
  },
};
