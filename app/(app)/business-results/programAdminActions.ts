"use server";

// 사업실적 [프로그램 관리] 탭 서버 액션.
//   권한 — 분야·사업 설정과 같습니다: 관장·부장 등 M0 · master · business_admin 직무
//   (lib/businessProgramAccess). 오류는 throw 하지 않고 { ok:false } 로 돌려줍니다.
import { revalidatePath } from "next/cache";
import { getSession } from "@/app/actions";
import { canManageBusinessPrograms } from "@/lib/businessProgramAccess";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { kstTodayYmd } from "@/lib/trainings";
import { programNameKey } from "@/lib/businessProgramNames";
import {
  EXCLUSION_TABLE,
  insertProgramRow,
  linkUnregisteredRows,
  loadProgramAdminData,
  mergeProgramRows,
  previewProgramMerge,
  type MergePreview,
  type MergeResult,
  updateProgramRow,
  type ProgramAdminData,
} from "@/lib/businessProgramAdmin";

type Fail = { ok: false; message: string };
type Result<T = object> = ({ ok: true } & T) | Fail;

async function requireAdmin() {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  if (!(await canManageBusinessPrograms()))
    throw new Error("프로그램 관리 권한이 없습니다.");
  return session;
}

function fail(e: unknown, fallback: string): Fail {
  return { ok: false, message: e instanceof Error ? e.message : fallback };
}

export async function getProgramAdminData(): Promise<
  Result<{ data: ProgramAdminData }>
> {
  try {
    await requireAdmin();
    const year = Number(kstTodayYmd().slice(0, 4));
    return { ok: true, data: await loadProgramAdminData(year) };
  } catch (e) {
    return fail(e, "프로그램 목록을 불러오지 못했습니다.");
  }
}

export type ProgramInput = {
  category_id: string;
  name: string;
  manager_driver_id: string | null;
  aliases: string[];
  note: string;
};

export async function createProgram(input: ProgramInput): Promise<Result> {
  try {
    await requireAdmin();
    const res = await insertProgramRow(input);
    if ("error" in res) return { ok: false, message: res.error };
    revalidatePath("/business-results");
    return { ok: true };
  } catch (e) {
    return fail(e, "프로그램을 등록하지 못했습니다.");
  }
}

export async function updateProgram(
  id: string,
  input: ProgramInput,
): Promise<Result> {
  try {
    await requireAdmin();
    const message = await updateProgramRow(id, input);
    if (message) return { ok: false, message };
    revalidatePath("/business-results");
    return { ok: true };
  } catch (e) {
    return fail(e, "프로그램을 수정하지 못했습니다.");
  }
}

export async function setProgramActive(
  id: string,
  isActive: boolean,
): Promise<Result> {
  try {
    await requireAdmin();
    const message = await updateProgramRow(id, { is_active: isActive });
    if (message) return { ok: false, message };
    revalidatePath("/business-results");
    return { ok: true };
  } catch (e) {
    return fail(e, "사용 여부를 바꾸지 못했습니다.");
  }
}

// 미등록 이름 묶음 → 기존 프로그램에 연결.
export async function linkNamesToProgram(
  names: string[],
  programId: string,
): Promise<Result<{ linked: number }>> {
  try {
    await requireAdmin();
    if (!programId) return { ok: false, message: "연결할 프로그램을 고르세요." };
    const { data, error } = await supabaseAdmin
      .from("business_programs")
      .select("id")
      .eq("id", programId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, message: "프로그램을 찾을 수 없습니다." };
    const linked = await linkUnregisteredRows(names, programId);
    revalidatePath("/business-results");
    return { ok: true, linked };
  } catch (e) {
    return fail(e, "실적을 연결하지 못했습니다.");
  }
}

// 미등록 이름 묶음 → 새 프로그램으로 등록한 뒤 연결.
//   묶음 안의 다른 표기(대표 이름과 글자가 다른 것)는 다른 이름(aliases)으로 남깁니다.
export async function registerNamesAsProgram(
  names: string[],
  input: ProgramInput,
): Promise<Result<{ linked: number }>> {
  try {
    await requireAdmin();
    const res = await insertProgramRow({
      ...input,
      aliases: [...input.aliases, ...names.filter((n) => n.trim() !== input.name.trim())],
    });
    if ("error" in res) return { ok: false, message: res.error };
    const linked = await linkUnregisteredRows(names, res.id);
    revalidatePath("/business-results");
    return { ok: true, linked };
  } catch (e) {
    return fail(e, "프로그램을 등록하지 못했습니다.");
  }
}

// '프로그램 아님' 표시 / 되돌리기 — 실적 행은 건드리지 않고 목록에서만 숨깁니다.
export async function markNotProgram(name: string): Promise<Result> {
  try {
    const session = await requireAdmin();
    const key = programNameKey(name);
    if (!key) return { ok: false, message: "이름이 비어 있습니다." };
    const { error } = await supabaseAdmin
      .from(EXCLUSION_TABLE)
      .upsert({ name_key: key, sample_name: name.trim(), created_by: session.name });
    if (error) {
      if (error.code === "42P01" || error.message.includes("schema cache"))
        return {
          ok: false,
          message:
            "'프로그램 아님' 표시 테이블이 아직 DB에 없습니다(business_program_admin.sql 적용 필요).",
        };
      throw new Error(error.message);
    }
    return { ok: true };
  } catch (e) {
    return fail(e, "표시하지 못했습니다.");
  }
}

export async function unmarkNotProgram(key: string): Promise<Result> {
  try {
    await requireAdmin();
    const { error } = await supabaseAdmin
      .from(EXCLUSION_TABLE)
      .delete()
      .eq("name_key", key);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e) {
    return fail(e, "되돌리지 못했습니다.");
  }
}

// 다른 프로그램과 합치기 — 확인창용 건수 미리보기.
export async function getProgramMergePreview(
  keepId: string,
  mergeIds: string[],
): Promise<Result<{ preview: MergePreview }>> {
  try {
    await requireAdmin();
    const res = await previewProgramMerge(keepId, mergeIds);
    if ("error" in res) return { ok: false, message: res.error };
    return { ok: true, preview: res };
  } catch (e) {
    return fail(e, "합칠 건수를 확인하지 못했습니다.");
  }
}

// 다른 프로그램과 합치기 — 실행.
export async function mergePrograms(
  keepId: string,
  mergeIds: string[],
): Promise<Result<{ result: MergeResult }>> {
  try {
    await requireAdmin();
    const res = await mergeProgramRows(keepId, mergeIds);
    if ("error" in res) return { ok: false, message: res.error };
    revalidatePath("/business-results");
    return { ok: true, result: res };
  } catch (e) {
    return fail(e, "프로그램을 합치지 못했습니다.");
  }
}
