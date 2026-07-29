"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSaemAccess } from "@/lib/saemAccess";
import {
  normalizePhone,
  toInstructor,
  toProgram,
  toInstructorDoc,
  type SaemInstructor,
  type SaemInstructorDoc,
} from "@/lib/saem";

const INSTR = "saem_instructors";
const DOCS = "saem_instructor_documents";
const PROG = "saem_programs";

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length ? s : null;
}

export type InstructorListRow = SaemInstructor & {
  docCount: number;
  programCount: number;
};

// --- 목록(서류·프로그램 수 집계) ---
export async function listInstructors(): Promise<InstructorListRow[]> {
  await requireSaemAccess();
  const [{ data: ins }, { data: docs }, { data: progs }] = await Promise.all([
    supabaseAdmin.from(INSTR).select("*"),
    supabaseAdmin.from(DOCS).select("instructor_id, slot"),
    supabaseAdmin.from(PROG).select("instructor_id"),
  ]);
  const slotsByInstr = new Map<string, Set<string>>();
  for (const d of docs ?? []) {
    const r = d as { instructor_id: string; slot: string };
    const set = slotsByInstr.get(r.instructor_id) ?? new Set<string>();
    set.add(r.slot);
    slotsByInstr.set(r.instructor_id, set);
  }
  const progCount = new Map<string, number>();
  for (const p of progs ?? []) {
    const id = (p as { instructor_id: string | null }).instructor_id;
    if (id) progCount.set(id, (progCount.get(id) ?? 0) + 1);
  }
  return (ins ?? [])
    .map((r) => {
      const i = toInstructor(r as Record<string, unknown>);
      return {
        ...i,
        docCount: slotsByInstr.get(i.id)?.size ?? 0,
        programCount: progCount.get(i.id) ?? 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

// --- 등록 모달용 실시간 검색(이름/전화) ---
export type InstructorHit = {
  id: string;
  name: string;
  phone: string | null;
  status: string;
};
export async function searchInstructors(q: string): Promise<InstructorHit[]> {
  await requireSaemAccess();
  const term = q.trim().replace(/[,%]/g, "");
  if (!term) return [];
  const digits = normalizePhone(term);
  const ors = [`name.ilike.%${term}%`];
  if (digits) ors.push(`phone.ilike.%${digits}%`);
  const { data } = await supabaseAdmin
    .from(INSTR)
    .select("id, name, phone, status")
    .or(ors.join(","))
    .limit(10);
  return (data ?? []) as InstructorHit[];
}

export type InstructorInput = {
  name: string;
  phone: string;
  email?: string;
  bank_name?: string;
  bank_account?: string;
  account_holder?: string;
  memo?: string;
};

// --- 신규 등록(전화 중복 차단) ---
export async function createInstructor(
  input: InstructorInput
): Promise<
  | { ok: true; id: string }
  | { ok: false; message: string; duplicate?: { id: string; name: string } }
> {
  try {
    await requireSaemAccess();
    const name = (input.name ?? "").trim();
    if (!name) return { ok: false, message: "이름을 입력하세요." };
    const phone = normalizePhone(input.phone ?? "");

    if (phone) {
      const { data: dup } = await supabaseAdmin
        .from(INSTR)
        .select("id, name")
        .eq("phone", phone)
        .maybeSingle();
      if (dup) {
        const d = dup as { id: string; name: string };
        return {
          ok: false,
          message: `이미 등록된 강사입니다: ${d.name} — 이 분이 맞으면 선택하세요.`,
          duplicate: { id: d.id, name: d.name },
        };
      }
    }

    const { data, error } = await supabaseAdmin
      .from(INSTR)
      .insert({
        name,
        phone: phone || null,
        email: clean(input.email),
        bank_name: clean(input.bank_name),
        bank_account: clean(input.bank_account),
        account_holder: clean(input.account_holder),
        memo: clean(input.memo),
        status: "active",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/hr/saems/instructors");
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "등록 중 오류가 발생했습니다.",
    };
  }
}

// --- 인적사항 수정 ---
export async function updateInstructor(
  id: string,
  input: InstructorInput & { status?: "active" | "inactive" }
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const name = (input.name ?? "").trim();
    if (!name) return { ok: false, message: "이름을 입력하세요." };
    const phone = normalizePhone(input.phone ?? "");

    if (phone) {
      const { data: dup } = await supabaseAdmin
        .from(INSTR)
        .select("id, name")
        .eq("phone", phone)
        .neq("id", id)
        .maybeSingle();
      if (dup) {
        return {
          ok: false,
          message: `다른 강사가 이미 쓰는 전화번호입니다: ${
            (dup as { name: string }).name
          }`,
        };
      }
    }

    const patch: Record<string, unknown> = {
      name,
      phone: phone || null,
      email: clean(input.email),
      bank_name: clean(input.bank_name),
      bank_account: clean(input.bank_account),
      account_holder: clean(input.account_holder),
      memo: clean(input.memo),
    };
    if (input.status === "active" || input.status === "inactive") {
      patch.status = input.status;
    }
    const { error } = await supabaseAdmin.from(INSTR).update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/saems/instructors");
    revalidatePath(`/hr/saems/instructors/${id}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "수정 중 오류가 발생했습니다.",
    };
  }
}

// --- 상세(인적사항 + 담당 프로그램 + 서류) ---
export type InstructorProgramRow = {
  id: string;
  name: string;
  period_no: number | null;
  time_start: string | null;
  time_end: string | null;
  termName: string;
  projectName: string;
  termStatus: string;
};
export type InstructorDetail = {
  instructor: SaemInstructor;
  programs: InstructorProgramRow[];
  docs: SaemInstructorDoc[];
};

export async function getInstructorDetail(
  id: string
): Promise<InstructorDetail | null> {
  await requireSaemAccess();
  if (!id) return null;
  const { data: insRow } = await supabaseAdmin
    .from(INSTR)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!insRow) return null;
  const instructor = toInstructor(insRow as Record<string, unknown>);

  const [{ data: progRows }, { data: docRows }] = await Promise.all([
    supabaseAdmin
      .from(PROG)
      .select("*")
      .eq("instructor_id", id)
      .order("sort_order", { ascending: true }),
    supabaseAdmin
      .from(DOCS)
      .select("*")
      .eq("instructor_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const programs = (progRows ?? []).map((r) =>
    toProgram(r as Record<string, unknown>)
  );
  // 차시·프로젝트명 보강.
  const termIds = [...new Set(programs.map((p) => p.term_id))];
  const termMap = new Map<string, { name: string; project_id: string; status: string }>();
  if (termIds.length) {
    const { data: terms } = await supabaseAdmin
      .from("saem_terms")
      .select("id, name, project_id, status")
      .in("id", termIds);
    for (const t of terms ?? []) {
      const r = t as { id: string; name: string; project_id: string; status: string };
      termMap.set(r.id, { name: r.name, project_id: r.project_id, status: r.status });
    }
  }
  const projIds = [...new Set([...termMap.values()].map((t) => t.project_id))];
  const projMap = new Map<string, string>();
  if (projIds.length) {
    const { data: projs } = await supabaseAdmin
      .from("saem_projects")
      .select("id, name")
      .in("id", projIds);
    for (const p of projs ?? [])
      projMap.set((p as { id: string }).id, (p as { name: string }).name);
  }

  const programRows: InstructorProgramRow[] = programs.map((p) => {
    const t = termMap.get(p.term_id);
    return {
      id: p.id,
      name: p.name,
      period_no: p.period_no,
      time_start: p.time_start,
      time_end: p.time_end,
      termName: t?.name ?? "",
      projectName: t ? projMap.get(t.project_id) ?? "" : "",
      termStatus: t?.status ?? "",
    };
  });

  const docs = (docRows ?? []).map((r) =>
    toInstructorDoc(r as Record<string, unknown>)
  );

  return { instructor, programs: programRows, docs };
}
