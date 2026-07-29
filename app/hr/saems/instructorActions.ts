"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  supabase,
  HR_DOCUMENTS_BUCKET,
  signHrDocument,
  removeHrDocuments,
} from "@/lib/supabase";
import { requireSaemAccess } from "@/lib/saemAccess";
import {
  normalizePhone,
  saemAppUrl,
  isSaemDocSlot,
  toInstructor,
  toProgram,
  toInstructorDoc,
  type SaemInstructor,
  type SaemInstructorDoc,
} from "@/lib/saem";

const DOC_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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

// =====================================================================
// SA-3. 초대 링크 발급 + 서류함
// =====================================================================

// 초대(비밀번호 설정) 링크 발급 — 토큰 생성 + 7일 만료. 가입자면 재설정 링크.
export async function generateInvite(
  instructorId: string
): Promise<
  | { ok: true; url: string; alreadyRegistered: boolean }
  | { ok: false; message: string }
> {
  try {
    await requireSaemAccess();
    if (!instructorId) return { ok: false, message: "대상이 없습니다." };

    const { data: ins } = await supabaseAdmin
      .from(INSTR)
      .select("id, password_set_at, status")
      .eq("id", instructorId)
      .maybeSingle();
    if (!ins) return { ok: false, message: "강사를 찾을 수 없습니다." };

    const token = randomUUID().replace(/-/g, "");
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabaseAdmin
      .from(INSTR)
      .update({ invite_token: token, invite_expires_at: expires })
      .eq("id", instructorId);
    if (error) throw new Error(error.message);

    revalidatePath(`/hr/saems/instructors/${instructorId}`);
    return {
      ok: true,
      url: `${saemAppUrl()}/invite/${token}`,
      alreadyRegistered: !!(ins as { password_set_at?: string | null }).password_set_at,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "초대 발급 중 오류가 발생했습니다.",
    };
  }
}

// 서류 업로드(슬롯당 1건 — 교체 시 기존 파일·행 정리). uploaded_by='staff'.
export async function uploadInstructorDoc(
  formData: FormData
): Promise<
  { ok: true; doc: SaemInstructorDoc } | { ok: false; message: string }
> {
  try {
    await requireSaemAccess();
    const instructorId = String(formData.get("instructor_id") ?? "").trim();
    const slot = String(formData.get("slot") ?? "").trim();
    if (!instructorId || !isSaemDocSlot(slot))
      return { ok: false, message: "잘못된 요청입니다." };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0)
      return { ok: false, message: "업로드할 파일을 선택하세요." };
    if (file.size > 16 * 1024 * 1024)
      return { ok: false, message: "파일 용량은 16MB 이하여야 합니다." };
    const ext = DOC_EXT[file.type];
    if (!ext)
      return { ok: false, message: "PDF·JPG·PNG·WEBP 만 업로드할 수 있습니다." };

    // 기존 슬롯 문서(교체) — 파일·행 정리.
    const { data: prev } = await supabaseAdmin
      .from(DOCS)
      .select("id, file_path")
      .eq("instructor_id", instructorId)
      .eq("slot", slot);
    const oldPaths = (prev ?? [])
      .map((r) => (r as { file_path?: string }).file_path)
      .filter(Boolean) as string[];

    const path = `instructors/${instructorId}/${slot}_${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(HR_DOCUMENTS_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: true });
    if (upErr) return { ok: false, message: `업로드 실패: ${upErr.message}` };

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from(DOCS)
      .insert({
        instructor_id: instructorId,
        slot,
        file_path: path,
        original_name: file.name,
        uploaded_by: "staff",
      })
      .select("*")
      .single();
    if (insErr) throw new Error(insErr.message);

    // 이전 행/파일 삭제(신규 성공 후).
    if (prev && prev.length > 0) {
      await supabaseAdmin
        .from(DOCS)
        .delete()
        .eq("instructor_id", instructorId)
        .eq("slot", slot)
        .neq("id", (inserted as { id: string }).id);
      if (oldPaths.length) await removeHrDocuments(oldPaths);
    }

    revalidatePath(`/hr/saems/instructors/${instructorId}`);
    return { ok: true, doc: toInstructorDoc(inserted as Record<string, unknown>) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "업로드 중 오류가 발생했습니다.",
    };
  }
}

// 서류 임시 열람 URL(1시간). 소속 검증 후 서명 URL.
export async function getInstructorDocUrl(docId: string): Promise<string | null> {
  await requireSaemAccess();
  if (!docId) return null;
  const { data } = await supabaseAdmin
    .from(DOCS)
    .select("file_path")
    .eq("id", docId)
    .maybeSingle();
  return signHrDocument((data as { file_path?: string | null } | null)?.file_path ?? null);
}

// 서류 삭제(행 + 파일).
export async function deleteInstructorDoc(
  docId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireSaemAccess();
    if (!docId) return { ok: false, message: "대상이 없습니다." };
    const { data } = await supabaseAdmin
      .from(DOCS)
      .select("id, instructor_id, file_path")
      .eq("id", docId)
      .maybeSingle();
    if (!data) return { ok: true };
    const row = data as { instructor_id: string; file_path: string };
    const { error } = await supabaseAdmin.from(DOCS).delete().eq("id", docId);
    if (error) throw new Error(error.message);
    if (row.file_path) await removeHrDocuments([row.file_path]);
    revalidatePath(`/hr/saems/instructors/${row.instructor_id}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.",
    };
  }
}
