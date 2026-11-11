"use server";

// =====================================================================
// 강사 채용 계약서 — 동업자씨(직원) 쪽 액션.
//   * 권한: 강사·프로그램 관리 '관리' 권한 그대로(requireSaemAccess = M0 또는 saem 직무).
//     계약서에는 주민번호 앞자리·주소·강사료가 들어가므로 열람 직원(전 직원)에게는 열지 않습니다.
//     직인 날인만 관장·부장(requireSaemAccess({ onlyM0: true })) — 근로계약서 직인과 같은 기준.
//   * 세 표 모두 RLS on·정책 0 → service_role. 이 게이트가 유일 방어선입니다.
//   * 모든 동작은 instructor_contract_logs 에 남깁니다(actor_type='staff').
//   ⚠️ 주민번호 전체(rrn_enc)는 읽지도 않습니다 — 앞 7자리(rrn_mask)만.
// =====================================================================

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { HR_DOCUMENTS_BUCKET } from "@/lib/supabase";
import { requireSaemAccess, type SaemAccess } from "@/lib/saemAccess";
import { saemAppUrl } from "@/lib/saem";
import { kstTodayYmd } from "@/lib/trainings";
import { decodeDataUrl } from "@/lib/recruitmentApplicantDocData";
import { loadOrgSeal } from "@/lib/orgSeal";
import { sendLoggedSms } from "@/lib/sms/sendOne";
import { buildInstructorContractPdf } from "@/lib/instructorContractPdf";
import {
  INSTRUCTOR_CONTRACT_DIR,
  INSTRUCTOR_CONTRACT_SMS_PROGRAM,
  INSTRUCTOR_CONTRACT_SMS_SENDER,
  fillBody,
  koreanDate,
  instructorContractLink,
  instructorContractPdfPath,
  missingFields,
  normalizeContractPayType,
  normalizeInstructorMode,
  normalizeTaxType,
  rrnMaskDisplay,
  toContractStatus,
  toFields,
  emptyFields,
  FIELD_LABEL,
  type ContractFields,
  type ContractPayType,
  type InstructorContractRow,
  type InstructorContractStatus,
  type SigningMethod,
  type TaxType,
} from "@/lib/instructorContract";

const T_CON = "instructor_contracts";
const T_TPL = "instructor_contract_templates";
const T_LOG = "instructor_contract_logs";
const SIGNED_URL_SECONDS = 300; // 파일 열기 — 5분 서명 URL

// existingId — 같은 강사·같은 강좌의 유효 계약이 이미 있을 때 그 계약 id(화면이 그쪽으로 이동).
type Fail = { ok: false; message: string; existingId?: string };
const fail = (e: unknown, fb = "오류가 발생했습니다."): Fail => ({
  ok: false,
  message: e instanceof Error ? e.message : fb,
});

// =====================================================================
// 원칙: 강사 1명 × 강좌 1개 = 유효 계약 1건(무효 제외).
//   DB 유니크 인덱스 instructor_contracts_one_active_per_program
//   (instructor_id, program_id) where status <> 'void' 가 최종 방어선이고,
//   여기서는 먼저 찾아 보고(친절한 안내) 그래도 부딪히면 23505 를 같은 안내로 바꿉니다.
// =====================================================================
const DUP_MESSAGE = "이 강사의 이 강좌 계약서가 이미 있습니다. 기존 계약서를 엽니다.";

async function activeContractId(instructorId: string, programId: string | null, exceptId?: string | null): Promise<string | null> {
  if (!instructorId || !programId) return null;
  let q = supabaseAdmin
    .from("instructor_contracts")
    .select("id")
    .eq("instructor_id", instructorId)
    .eq("program_id", programId)
    .neq("status", "void")
    .limit(1);
  if (exceptId) q = q.neq("id", exceptId);
  const { data } = await q;
  return ((data ?? []) as { id: string }[])[0]?.id ?? null;
}

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

async function dupFail(instructorId: string, programId: string | null, exceptId?: string | null): Promise<Fail> {
  const existingId = (await activeContractId(instructorId, programId, exceptId)) ?? undefined;
  return { ok: false, message: DUP_MESSAGE, existingId };
}

// 동래샘들 계약서 화면 주소 — 동래샘들 쪽에 /contracts/[id] 페이지가 있어야 합니다.
function contractLink(id: string): string {
  return instructorContractLink(saemAppUrl(), id);
}

// [링크 복사] 기록 — 복사는 화면에서 하고(클릭 직후라야 클립보드가 허용됨) 기록만 서버에 남깁니다.
export async function logInstructorContractLinkCopied(id: string): Promise<{ ok: true } | Fail> {
  try {
    const access = await requireSaemAccess();
    const cur = await loadContract(id);
    if (!cur) return { ok: false, message: "계약서를 찾을 수 없습니다." };
    if (cur.status !== "sent") return { ok: false, message: "서명 대기 중인 계약서만 링크를 복사할 수 있습니다." };
    await writeLog(id, "link_copied", access);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

async function writeLog(
  contractId: string,
  action: string,
  actor: SaemAccess | null,
  detail?: Record<string, unknown>
): Promise<void> {
  const { error } = await supabaseAdmin.from(T_LOG).insert({
    contract_id: contractId,
    action,
    actor_type: actor ? "staff" : "system",
    actor_name: actor?.name ?? null,
    detail: detail ?? null,
  });
  if (error) console.error(`[instructor-contract] 기록 실패(${action}): ${error.message}`);
}

async function loadContract(id: string): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const { data, error } = await supabaseAdmin.from(T_CON).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Record<string, unknown> | null) ?? null;
}

function revalidateAll(instructorId?: string | null) {
  revalidatePath("/hr/saems/contracts");
  revalidatePath("/hr/saems/programs");
  if (instructorId) revalidatePath(`/hr/saems/instructors/${instructorId}`);
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

// =====================================================================
// 목록
// =====================================================================
export type ContractListFilter = {
  projectId?: string;
  termId?: string;
  status?: InstructorContractStatus | "unsigned" | "";
  instructorId?: string;
  programId?: string;
};

export async function listInstructorContracts(filter: ContractListFilter = {}): Promise<InstructorContractRow[]> {
  await requireSaemAccess();
  let q = supabaseAdmin
    .from(T_CON)
    .select(
      "id, contract_no, instructor_id, project_id, term_id, program_id, signing_method, status, sent_at, first_viewed_at, instructor_signed_at, employer_signed_at, pdf_path, paper_file_path, void_reason, created_at, created_by, instructor_name_snapshot, fields"
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (filter.projectId) q = q.eq("project_id", filter.projectId);
  if (filter.termId) q = q.eq("term_id", filter.termId);
  if (filter.instructorId) q = q.eq("instructor_id", filter.instructorId);
  if (filter.programId) q = q.eq("program_id", filter.programId);
  // '미서명' = 보냈는데 강사가 아직 서명하지 않은 것.
  if (filter.status === "unsigned") q = q.eq("status", "sent");
  else if (filter.status) q = q.eq("status", filter.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, unknown>[];

  const ids = (k: string) => [...new Set(rows.map((r) => r[k]).filter(Boolean) as string[])];
  const nameMap = async (table: string, list: string[]) => {
    const m = new Map<string, string>();
    if (!list.length) return m;
    const { data: d } = await supabaseAdmin.from(table).select("id, name").in("id", list);
    for (const r of (d ?? []) as { id: string; name: string }[]) m.set(r.id, r.name);
    return m;
  };
  const termInfo = async (list: string[]) => {
    const m = new Map<string, { name: string; start_date: string | null; end_date: string | null }>();
    if (!list.length) return m;
    const { data: d } = await supabaseAdmin.from("saem_terms").select("id, name, start_date, end_date").in("id", list);
    for (const r of (d ?? []) as { id: string; name: string; start_date: string | null; end_date: string | null }[]) m.set(r.id, r);
    return m;
  };
  const [ins, proj, terms, prog] = await Promise.all([
    nameMap("saem_instructors", ids("instructor_id")),
    nameMap("saem_projects", ids("project_id")),
    termInfo(ids("term_id")),
    nameMap("saem_programs", ids("program_id")),
  ]);
  const term = new Map([...terms].map(([k, v]) => [k, v.name]));
  // 계약기간 — 계약서 칸(시작·종료일)이 있으면 그것, 없으면(종이 등) 학기 기간.
  const periodOf = (r: Record<string, unknown>): string => {
    const f = toFields(r.fields);
    if (f.start_date || f.end_date) return `${f.start_date || "?"} ~ ${f.end_date || "?"}`;
    const t = terms.get(str(r.term_id));
    if (t?.start_date || t?.end_date) return `${koreanDate(t?.start_date) || "?"} ~ ${koreanDate(t?.end_date) || "?"}`;
    return "";
  };

  return rows.map((r) => ({
    period: periodOf(r),
    id: str(r.id),
    contract_no: str(r.contract_no),
    instructor_id: str(r.instructor_id),
    instructor_name: strOrNull(r.instructor_name_snapshot) ?? ins.get(str(r.instructor_id)) ?? "-",
    project_id: strOrNull(r.project_id),
    project_name: proj.get(str(r.project_id)) ?? null,
    term_id: strOrNull(r.term_id),
    term_name: term.get(str(r.term_id)) ?? null,
    program_id: strOrNull(r.program_id),
    program_name: prog.get(str(r.program_id)) ?? null,
    signing_method: (r.signing_method === "paper" ? "paper" : "electronic") as SigningMethod,
    status: toContractStatus(r.status),
    sent_at: strOrNull(r.sent_at),
    first_viewed_at: strOrNull(r.first_viewed_at),
    instructor_signed_at: strOrNull(r.instructor_signed_at),
    employer_signed_at: strOrNull(r.employer_signed_at),
    has_pdf: !!strOrNull(r.pdf_path),
    has_paper: !!strOrNull(r.paper_file_path),
    void_reason: strOrNull(r.void_reason),
    created_at: str(r.created_at),
    created_by: strOrNull(r.created_by),
  }));
}

// =====================================================================
// 강좌 단위 보기 — 계약이 없는 강좌, 강사별 강좌·계약 묶음, [강좌 연결] 후보
// =====================================================================
export type ProgramRef = {
  programId: string;
  programName: string;
  projectName: string | null;
  termName: string | null;
  termPeriod: string; // 학기 기간(한국어 날짜)
  // 지난 학기(종료일 < 오늘, 서울 기준) — '계약서 없음' 집계·[계약서 만들기]에서 뺍니다.
  termEnded: boolean;
  instructorId: string;
  instructorName: string;
};

// 채용함(hire)·강사 지정 강좌를 사업·학기 이름과 함께. 필터는 사업/학기/강사.
async function hirePrograms(filter: { projectId?: string; termId?: string; instructorId?: string }): Promise<ProgramRef[]> {
  let termIds: string[] | null = null;
  if (filter.termId) termIds = [filter.termId];
  else if (filter.projectId) {
    const { data } = await supabaseAdmin.from("saem_terms").select("id").eq("project_id", filter.projectId);
    termIds = ((data ?? []) as { id: string }[]).map((t) => t.id);
    if (!termIds.length) return [];
  }
  let q = supabaseAdmin
    .from("saem_programs")
    .select("id, name, term_id, instructor_id, instructor_mode")
    .not("instructor_id", "is", null)
    .eq("instructor_mode", "hire");
  if (termIds) q = q.in("term_id", termIds);
  if (filter.instructorId) q = q.eq("instructor_id", filter.instructorId);
  const { data: progs } = await q;
  const rows = (progs ?? []) as { id: string; name: string; term_id: string; instructor_id: string }[];
  if (!rows.length) return [];
  const tIds = [...new Set(rows.map((p) => p.term_id))];
  const { data: terms } = await supabaseAdmin.from("saem_terms").select("id, name, project_id, start_date, end_date").in("id", tIds);
  const tMap = new Map(((terms ?? []) as { id: string; name: string; project_id: string; start_date: string | null; end_date: string | null }[]).map((t) => [t.id, t]));
  const pIds = [...new Set([...tMap.values()].map((t) => t.project_id))];
  const { data: projs } = pIds.length ? await supabaseAdmin.from("saem_projects").select("id, name").in("id", pIds) : { data: [] };
  const pMap = new Map(((projs ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const iIds = [...new Set(rows.map((p) => p.instructor_id))];
  const { data: ins } = await supabaseAdmin.from("saem_instructors").select("id, name").in("id", iIds);
  const iMap = new Map(((ins ?? []) as { id: string; name: string }[]).map((i) => [i.id, i.name]));
  const today = kstTodayYmd();
  return rows
    .map((p) => {
      const t = tMap.get(p.term_id);
      return {
        programId: p.id,
        programName: p.name,
        projectName: t ? pMap.get(t.project_id) ?? null : null,
        termName: t?.name ?? null,
        termPeriod:
          t && (t.start_date || t.end_date) ? `${koreanDate(t.start_date) || "?"} ~ ${koreanDate(t.end_date) || "?"}` : "",
        instructorId: p.instructor_id,
        instructorName: iMap.get(p.instructor_id) ?? "",
        termEnded: !!t?.end_date && t.end_date < today,
        _start: t?.start_date ?? "",
      };
    })
    .sort((a, b) => b._start.localeCompare(a._start) || a.programName.localeCompare(b.programName, "ko"))
    .map(({ _start, ...rest }) => {
      void _start;
      return rest;
    });
}

// 유효 계약(무효 제외)이 있는 (강사, 강좌) 쌍.
async function activePairs(programIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!programIds.length) return out;
  const { data } = await supabaseAdmin
    .from(T_CON)
    .select("instructor_id, program_id")
    .in("program_id", programIds)
    .neq("status", "void");
  for (const r of (data ?? []) as { instructor_id: string; program_id: string }[]) out.add(`${r.instructor_id}:${r.program_id}`);
  return out;
}

// 계약서 탭 집계 — 강좌 단위. 미서명 = 서명 대기(sent) 계약이 걸린 강좌 수,
//   계약 없음 = 채용함·강사 지정인데 그 강사의 유효 계약이 없는 강좌.
export async function getContractSummary(filter: { projectId?: string; termId?: string }): Promise<{
  unsignedPrograms: number;
  noContract: ProgramRef[];
}> {
  await requireSaemAccess();
  const progs = await hirePrograms(filter);
  const pairs = await activePairs(progs.map((p) => p.programId));
  // 지난 학기 강좌는 이제 계약할 일이 없으므로 '계약서 없음'에서 뺍니다.
  const noContract = progs.filter((p) => !p.termEnded && !pairs.has(`${p.instructorId}:${p.programId}`));

  let q = supabaseAdmin.from(T_CON).select("id, program_id").eq("status", "sent");
  if (filter.projectId) q = q.eq("project_id", filter.projectId);
  if (filter.termId) q = q.eq("term_id", filter.termId);
  const { data } = await q;
  // 강좌가 연결된 건은 강좌 단위로, 강좌 미지정 건은 한 건씩 셉니다.
  const keys = new Set(((data ?? []) as { id: string; program_id: string | null }[]).map((r) => r.program_id ?? `c:${r.id}`));
  return { unsignedPrograms: keys.size, noContract };
}

// 강사 상세 — 그 강사의 강좌별 계약 묶음 + 강좌 미지정 계약.
export type InstructorProgramContracts = {
  program: ProgramRef;
  contracts: InstructorContractRow[]; // 최신 먼저(무효 포함)
  hasActive: boolean;
};
export async function getInstructorContractOverview(instructorId: string): Promise<{
  programs: InstructorProgramContracts[];
  unlinked: InstructorContractRow[];
  saemBase: string; // [링크 복사]용
}> {
  await requireSaemAccess();
  const [progs, rows] = await Promise.all([
    hirePrograms({ instructorId }),
    listInstructorContracts({ instructorId }),
  ]);
  const byProgram = new Map<string, InstructorContractRow[]>();
  for (const r of rows) {
    if (!r.program_id) continue;
    const list = byProgram.get(r.program_id) ?? [];
    list.push(r);
    byProgram.set(r.program_id, list);
  }
  const listed = new Set(progs.map((p) => p.programId));
  const programs: InstructorProgramContracts[] = progs.map((p) => {
    const contracts = byProgram.get(p.programId) ?? [];
    return { program: p, contracts, hasActive: contracts.some((c) => c.status !== "void") };
  });
  // 지금은 다른 강사·다른 방식이 된 강좌라도 이 강사의 계약이 있으면 함께 보여 줍니다.
  for (const [pid, contracts] of byProgram) {
    if (listed.has(pid)) continue;
    const c = contracts[0];
    programs.push({
      program: {
        programId: pid,
        programName: c.program_name ?? "(삭제된 강좌)",
        projectName: c.project_name,
        termName: c.term_name,
        termPeriod: "",
        termEnded: false,
        instructorId,
        instructorName: c.instructor_name,
      },
      contracts,
      hasActive: contracts.some((x) => x.status !== "void"),
    });
  }
  return { programs, unlinked: rows.filter((r) => !r.program_id), saemBase: saemAppUrl() };
}

// [강좌 연결] 후보 — 그 강사가 맡은 강좌(채용함) + 이미 유효 계약이 있는지.
export async function listInstructorProgramOptions(
  instructorId: string
): Promise<(ProgramRef & { hasActive: boolean })[]> {
  await requireSaemAccess();
  const progs = await hirePrograms({ instructorId });
  const pairs = await activePairs(progs.map((p) => p.programId));
  return progs.map((p) => ({ ...p, hasActive: pairs.has(`${instructorId}:${p.programId}`) }));
}

// 강좌 미지정 계약(옛 종이 계약 등)에 강좌를 연결합니다. program_id·term_id·project_id 를 채웁니다.
export async function linkInstructorContractProgram(id: string, programId: string): Promise<{ ok: true } | Fail> {
  try {
    const access = await requireSaemAccess();
    if (!programId) return { ok: false, message: "강좌를 고르세요." };
    const cur = await loadContract(id);
    if (!cur) return { ok: false, message: "계약서를 찾을 수 없습니다." };
    if (cur.program_id) return { ok: false, message: "이미 강좌가 연결된 계약서입니다." };
    if (cur.status === "void") return { ok: false, message: "무효 처리된 계약서는 연결하지 않습니다." };
    const instructorId = str(cur.instructor_id);
    const { data: p } = await supabaseAdmin.from("saem_programs").select("id, instructor_id").eq("id", programId).maybeSingle();
    if (!p || (p as { instructor_id: string | null }).instructor_id !== instructorId)
      return { ok: false, message: "이 강사가 맡은 강좌만 연결할 수 있습니다." };
    if (await activeContractId(instructorId, programId, id)) return dupFail(instructorId, programId, id);

    const scope = await programScope(programId);
    const { error, count } = await supabaseAdmin
      .from(T_CON)
      .update({ program_id: programId, ...scope, updated_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", id)
      .is("program_id", null);
    if (isUniqueViolation(error)) return dupFail(instructorId, programId, id);
    if (error) throw new Error(error.message);
    if (!count) return { ok: false, message: "이미 다른 곳에서 처리되었습니다. 새로고침해 주세요." };
    await writeLog(id, "program_linked", access, { program_id: programId, term_id: scope.term_id });
    revalidateAll(instructorId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// 필터용 학기 목록(사업별).
export async function listContractTerms(projectId: string): Promise<{ id: string; name: string }[]> {
  await requireSaemAccess();
  if (!projectId) return [];
  const { data } = await supabaseAdmin
    .from("saem_terms")
    .select("id, name, start_date")
    .eq("project_id", projectId)
    .order("start_date", { ascending: false });
  return ((data ?? []) as { id: string; name: string }[]).map((t) => ({ id: t.id, name: t.name }));
}

// =====================================================================
// 작성 화면 재료 — 강사·강좌·양식·(있으면) 기존 계약
// =====================================================================
export type ContractProgramOption = {
  id: string;
  name: string;
  subject: string | null;
  projectId: string | null;
  termId: string;
  termName: string;
  termStart: string | null;
  termEnd: string | null;
  weekdays: number[];
  timeStart: string | null;
  timeEnd: string | null;
  sessionMinutes: number | null;
  payType: ContractPayType;
  hourlyRate: number | null;
  sessionFee: number | null;
  deductionRate: number | null;
  projectName: string | null;
  // 이 강사의 이 강좌 유효 계약(무효 제외) — 있으면 새로 만들지 않고 그것을 엽니다.
  activeContractId: string | null;
  activeStatus: InstructorContractStatus | null;
};
export type ContractTemplateOption = {
  id: string;
  name: string;
  projectId: string | null;
  title: string;
  body: string;
  defaultTaxType: TaxType;
};
export type ContractContext = {
  today: string;
  saemBase: string; // 동래샘들 주소 — [링크 복사]용
  isM0: boolean;
  instructor: {
    id: string;
    name: string;
    hasPhone: boolean;
    rrnMasked: string; // "000722-3******" 또는 ""
    address: string;
  };
  programs: ContractProgramOption[];
  templates: ContractTemplateOption[];
  existing: null | {
    id: string;
    contractNo: string;
    status: InstructorContractStatus;
    signingMethod: SigningMethod;
    programId: string | null;
    templateId: string | null;
    fields: ContractFields;
    titleSnapshot: string | null;
    bodySnapshot: string | null;
    nameSnapshot: string | null;
    rrnSnapshot: string | null;
    addressSnapshot: string | null;
    openedExisting: boolean; // 강좌에서 [계약서]를 눌렀는데 이미 있어서 연 것
  };
};

export async function getContractContext(input: {
  instructorId?: string | null;
  programId?: string | null;
  contractId?: string | null;
}): Promise<({ ok: true } & ContractContext) | Fail> {
  try {
    const access = await requireSaemAccess();
    let existing: ContractContext["existing"] = null;
    let instructorId = input.instructorId ?? null;
    if (!instructorId && input.programId && !input.contractId) {
      const { data: p } = await supabaseAdmin
        .from("saem_programs")
        .select("instructor_id")
        .eq("id", input.programId)
        .maybeSingle();
      instructorId = strOrNull((p as { instructor_id?: string } | null)?.instructor_id);
    }
    // 강좌의 [계약서] — 그 강좌·그 강사의 유효 계약이 있으면 새로 만들지 않고 그것을 엽니다.
    let contractId = input.contractId ?? null;
    let openedExisting = false;
    if (!contractId && instructorId && input.programId) {
      contractId = await activeContractId(instructorId, input.programId);
      openedExisting = !!contractId;
    }
    if (contractId) {
      const c = await loadContract(contractId);
      if (!c) return { ok: false, message: "계약서를 찾을 수 없습니다." };
      instructorId = str(c.instructor_id);
      existing = {
        id: str(c.id),
        contractNo: str(c.contract_no),
        status: toContractStatus(c.status),
        signingMethod: c.signing_method === "paper" ? "paper" : "electronic",
        programId: strOrNull(c.program_id),
        templateId: strOrNull(c.template_id),
        fields: toFields(c.fields),
        titleSnapshot: strOrNull(c.title_snapshot),
        bodySnapshot: strOrNull(c.body_snapshot),
        nameSnapshot: strOrNull(c.instructor_name_snapshot),
        rrnSnapshot: strOrNull(c.rrn_mask_snapshot),
        addressSnapshot: strOrNull(c.address_snapshot),
        openedExisting,
      };
    }
    if (!instructorId) return { ok: false, message: "강좌에 강사를 먼저 지정하세요." };

    const { data: ins } = await supabaseAdmin
      .from("saem_instructors")
      .select("id, name, phone, rrn_mask, address")
      .eq("id", instructorId)
      .maybeSingle();
    if (!ins) return { ok: false, message: "강사를 찾을 수 없습니다." };
    const i = ins as { id: string; name: string; phone: string | null; rrn_mask: string | null; address: string | null };

    // 이 강사가 맡은 강좌(채용함) — 최신 학기 먼저.
    const { data: progs } = await supabaseAdmin
      .from("saem_programs")
      .select(
        "id, name, subject, term_id, session_weekdays, session_weekday, time_start, time_end, session_minutes, pay_type, hourly_rate, session_fee, deduction_rate, instructor_mode"
      )
      .eq("instructor_id", instructorId);
    const progRows = ((progs ?? []) as Record<string, unknown>[]).filter(
      (p) => normalizeInstructorMode(p.instructor_mode) === "hire" || p.id === input.programId
    );
    const termIds = [...new Set(progRows.map((p) => str(p.term_id)))];
    const termMap = new Map<string, { name: string; project_id: string; start_date: string | null; end_date: string | null }>();
    if (termIds.length) {
      const { data: terms } = await supabaseAdmin
        .from("saem_terms")
        .select("id, name, project_id, start_date, end_date")
        .in("id", termIds);
      for (const t of (terms ?? []) as { id: string; name: string; project_id: string; start_date: string | null; end_date: string | null }[])
        termMap.set(t.id, t);
    }
    const projIds = [...new Set([...termMap.values()].map((t) => t.project_id))];
    const projMap = new Map<string, string>();
    if (projIds.length) {
      const { data: pj } = await supabaseAdmin.from("saem_projects").select("id, name").in("id", projIds);
      for (const p of (pj ?? []) as { id: string; name: string }[]) projMap.set(p.id, p.name);
    }
    const activeMap = new Map<string, { id: string; status: InstructorContractStatus }>();
    if (progRows.length) {
      const { data: act } = await supabaseAdmin
        .from(T_CON)
        .select("id, program_id, status")
        .eq("instructor_id", instructorId)
        .in("program_id", progRows.map((p) => str(p.id)))
        .neq("status", "void");
      for (const a of (act ?? []) as { id: string; program_id: string; status: string }[])
        activeMap.set(a.program_id, { id: a.id, status: toContractStatus(a.status) });
    }
    const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
    const programs: ContractProgramOption[] = progRows
      .map((p) => {
        const t = termMap.get(str(p.term_id));
        const many = Array.isArray(p.session_weekdays) ? (p.session_weekdays as number[]) : [];
        return {
          id: str(p.id),
          name: str(p.name),
          subject: strOrNull(p.subject),
          projectId: t?.project_id ?? null,
          termId: str(p.term_id),
          termName: t?.name ?? "",
          termStart: t?.start_date ?? null,
          termEnd: t?.end_date ?? null,
          weekdays: many.length ? many : p.session_weekday == null ? [] : [Number(p.session_weekday)],
          timeStart: strOrNull(p.time_start),
          timeEnd: strOrNull(p.time_end),
          sessionMinutes: num(p.session_minutes),
          payType: normalizeContractPayType(p.pay_type),
          hourlyRate: num(p.hourly_rate),
          sessionFee: num(p.session_fee),
          deductionRate: num(p.deduction_rate),
          projectName: t ? projMap.get(t.project_id) ?? null : null,
          activeContractId: activeMap.get(str(p.id))?.id ?? null,
          activeStatus: activeMap.get(str(p.id))?.status ?? null,
        };
      })
      .sort((a, b) => (b.termStart ?? "").localeCompare(a.termStart ?? "") || a.name.localeCompare(b.name, "ko"));

    const { data: tpls } = await supabaseAdmin
      .from(T_TPL)
      .select("id, name, project_id, title, body, default_tax_type, status, version")
      .eq("status", "active")
      .order("version", { ascending: false });
    const templates: ContractTemplateOption[] = ((tpls ?? []) as Record<string, unknown>[]).map((t) => ({
      id: str(t.id),
      name: str(t.name),
      projectId: strOrNull(t.project_id),
      title: str(t.title),
      body: str(t.body),
      defaultTaxType: normalizeTaxType(t.default_tax_type),
    }));

    return {
      ok: true,
      today: kstTodayYmd(),
      saemBase: saemAppUrl(),
      isM0: access.isM0,
      instructor: {
        id: i.id,
        name: i.name,
        hasPhone: (i.phone ?? "").replace(/\D/g, "").length >= 10,
        rrnMasked: rrnMaskDisplay(i.rrn_mask),
        address: (i.address ?? "").trim(),
      },
      programs,
      templates,
      existing,
    };
  } catch (e) {
    return fail(e);
  }
}

// =====================================================================
// 작성 중 저장(전자서명)
// =====================================================================
// 화면에서 온 값은 알려진 칸만 문자열로 정리해 저장합니다.
const cleanFields = (f: ContractFields): ContractFields => toFields(f);

async function programScope(programId: string | null): Promise<{ project_id: string | null; term_id: string | null }> {
  if (!programId) return { project_id: null, term_id: null };
  const { data: p } = await supabaseAdmin.from("saem_programs").select("term_id").eq("id", programId).maybeSingle();
  const termId = strOrNull((p as { term_id?: string } | null)?.term_id);
  if (!termId) return { project_id: null, term_id: null };
  const { data: t } = await supabaseAdmin.from("saem_terms").select("project_id").eq("id", termId).maybeSingle();
  return { project_id: strOrNull((t as { project_id?: string } | null)?.project_id), term_id: termId };
}

export async function saveInstructorContractDraft(input: {
  id?: string | null;
  instructorId: string;
  programId: string | null;
  templateId: string;
  fields: ContractFields;
}): Promise<{ ok: true; id: string } | Fail> {
  try {
    const access = await requireSaemAccess();
    if (!input.instructorId) return { ok: false, message: "강사를 확인하세요." };
    if (!input.templateId) return { ok: false, message: "양식을 고르세요." };
    // 계약서는 강좌마다 1건 — 강좌 없이 새로 만들지 않습니다(옛 강좌 미지정 초안은 고칠 때 강좌를 고르게 함).
    if (!input.programId) return { ok: false, message: "강좌를 고르세요. 계약서는 강좌마다 1건입니다." };
    if (await activeContractId(input.instructorId, input.programId, input.id))
      return dupFail(input.instructorId, input.programId, input.id);
    const fields = cleanFields(input.fields);
    const scope = await programScope(input.programId || null);
    const payload = {
      instructor_id: input.instructorId,
      program_id: input.programId || null,
      template_id: input.templateId,
      fields,
      ...scope,
    };
    if (input.id) {
      const cur = await loadContract(input.id);
      if (!cur) return { ok: false, message: "계약서를 찾을 수 없습니다." };
      if (cur.status !== "draft") return { ok: false, message: "작성 중인 계약서만 고칠 수 있습니다." };
      const { error, count } = await supabaseAdmin
        .from(T_CON)
        .update({ ...payload, updated_at: new Date().toISOString() }, { count: "exact" })
        .eq("id", input.id)
        .eq("status", "draft");
      if (isUniqueViolation(error)) return dupFail(input.instructorId, input.programId, input.id);
      if (error) throw new Error(error.message);
      if (!count) return { ok: false, message: "이미 다른 곳에서 처리되었습니다. 새로고침해 주세요." };
      await writeLog(input.id, "updated", access);
      revalidateAll(input.instructorId);
      return { ok: true, id: input.id };
    }
    const { data, error } = await supabaseAdmin
      .from(T_CON)
      .insert({ ...payload, signing_method: "electronic", status: "draft", created_by: access.name })
      .select("id")
      .single();
    if (isUniqueViolation(error)) return dupFail(input.instructorId, input.programId);
    if (error) throw new Error(error.message);
    const id = str((data as { id: string }).id);
    await writeLog(id, "created", access, { signing_method: "electronic" });
    revalidateAll(input.instructorId);
    return { ok: true, id };
  } catch (e) {
    return fail(e, "저장하지 못했습니다.");
  }
}

// =====================================================================
// 발송 — 본문·인적사항 확정 + 서명 요청 문자
// =====================================================================
async function smsToInstructor(
  contract: Record<string, unknown>,
  access: SaemAccess,
  kind: "send" | "resend"
): Promise<string | null> {
  const id = str(contract.id);
  const { data: ins } = await supabaseAdmin
    .from("saem_instructors")
    .select("name, phone")
    .eq("id", str(contract.instructor_id))
    .maybeSingle();
  const i = ins as { name?: string; phone?: string | null } | null;
  const fields = toFields(contract.fields);
  const program = fields.program_name || "강좌";
  const text =
    `[동래구청소년센터] ${i?.name ?? ""} 강사님, ${program} 강사 채용 계약서가 도착했습니다. ` +
    `동래샘들에서 내용을 확인하고 서명해 주세요.\n${contractLink(id)}`;
  const r = await sendLoggedSms({
    to: i?.phone ?? "",
    text,
    sender: INSTRUCTOR_CONTRACT_SMS_SENDER,
    sentBy: access.driverId,
    program: INSTRUCTOR_CONTRACT_SMS_PROGRAM,
    purpose: `강사 계약서 ${kind === "send" ? "서명 요청" : "서명 요청 재발송"} — ${str(contract.contract_no)}`,
    invalidPhoneMessage: "강사 휴대전화 번호가 없거나 올바르지 않습니다.",
    logTag: "instructor-contract",
  });
  await writeLog(id, r.ok ? (kind === "send" ? "sms_sent" : "sms_resent") : "sms_failed", access, r.ok ? undefined : { error: r.error });
  return r.ok ? null : r.error;
}

export async function sendInstructorContract(
  id: string
): Promise<{ ok: true; smsError: string | null; link: string } | Fail> {
  try {
    const access = await requireSaemAccess();
    const cur = await loadContract(id);
    if (!cur) return { ok: false, message: "계약서를 찾을 수 없습니다." };
    if (cur.status !== "draft") return { ok: false, message: "작성 중인 계약서만 보낼 수 있습니다." };
    if (cur.signing_method !== "electronic") return { ok: false, message: "종이 계약서는 보낼 수 없습니다." };

    const { data: tpl } = await supabaseAdmin
      .from(T_TPL)
      .select("title, body")
      .eq("id", str(cur.template_id))
      .maybeSingle();
    if (!tpl) return { ok: false, message: "양식을 찾을 수 없습니다. 양식을 다시 고르세요." };
    const t = tpl as { title: string; body: string };
    const fields = toFields(cur.fields);
    const missing = missingFields(fields, t.body);
    if (missing.length)
      return { ok: false, message: `빈 칸이 있습니다: ${missing.map((k) => FIELD_LABEL[k]).join(", ")}` };

    const { data: ins } = await supabaseAdmin
      .from("saem_instructors")
      .select("name, rrn_mask, address")
      .eq("id", str(cur.instructor_id))
      .maybeSingle();
    const i = ins as { name?: string; rrn_mask?: string | null; address?: string | null } | null;
    if (!i) return { ok: false, message: "강사를 찾을 수 없습니다." };

    const now = new Date().toISOString();
    const { error, count } = await supabaseAdmin
      .from(T_CON)
      .update(
        {
          status: "sent",
          sent_at: now,
          title_snapshot: t.title,
          body_snapshot: fillBody(t.body, fields),
          instructor_name_snapshot: i.name ?? "",
          rrn_mask_snapshot: rrnMaskDisplay(i.rrn_mask) || null,
          address_snapshot: (i.address ?? "").trim() || null,
          updated_at: now,
        },
        { count: "exact" }
      )
      .eq("id", id)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    if (!count) return { ok: false, message: "이미 다른 곳에서 처리되었습니다. 새로고침해 주세요." };
    await writeLog(id, "sent", access);

    const smsError = await smsToInstructor({ ...cur, status: "sent" }, access, "send");
    revalidateAll(str(cur.instructor_id));
    return { ok: true, smsError, link: contractLink(id) };
  } catch (e) {
    return fail(e, "발송하지 못했습니다.");
  }
}

export async function resendInstructorContractSms(id: string): Promise<{ ok: true; link: string } | Fail> {
  try {
    const access = await requireSaemAccess();
    const cur = await loadContract(id);
    if (!cur) return { ok: false, message: "계약서를 찾을 수 없습니다." };
    if (cur.status !== "sent") return { ok: false, message: "서명 대기 중인 계약서만 다시 보낼 수 있습니다." };
    const err = await smsToInstructor(cur, access, "resend");
    if (err) return { ok: false, message: `문자를 보내지 못했습니다: ${err}` };
    return { ok: true, link: contractLink(id) };
  } catch (e) {
    return fail(e);
  }
}

// =====================================================================
// 무효 — 사유 필수. 행·파일은 지우지 않습니다.
// =====================================================================
export async function voidInstructorContract(id: string, reason: string): Promise<{ ok: true } | Fail> {
  try {
    const access = await requireSaemAccess();
    const why = (reason ?? "").trim();
    if (!why) return { ok: false, message: "무효 사유를 입력하세요." };
    const cur = await loadContract(id);
    if (!cur) return { ok: false, message: "계약서를 찾을 수 없습니다." };
    const now = new Date().toISOString();
    const { error, count } = await supabaseAdmin
      .from(T_CON)
      .update({ status: "void", void_reason: why.slice(0, 500), voided_at: now, voided_by: access.name, updated_at: now }, { count: "exact" })
      .eq("id", id)
      .neq("status", "void");
    if (error) throw new Error(error.message);
    if (!count) return { ok: false, message: "이미 무효 처리된 계약서입니다." };
    await writeLog(id, "voided", access, { reason: why, from: str(cur.status) });
    revalidateAll(str(cur.instructor_id));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// =====================================================================
// 종이 계약서 업로드 — 바로 체결 완료(signing_method='paper')
// =====================================================================
const PAPER_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function uploadPaperInstructorContract(formData: FormData): Promise<{ ok: true; id: string } | Fail> {
  try {
    const access = await requireSaemAccess();
    const instructorId = String(formData.get("instructor_id") ?? "").trim();
    const programId = String(formData.get("program_id") ?? "").trim() || null;
    const file = formData.get("file");
    if (!instructorId) return { ok: false, message: "강사를 확인하세요." };
    // 새 종이 계약도 강좌마다 1건 — 강좌 선택 필수.
    if (!programId) return { ok: false, message: "강좌를 고르세요. 계약서는 강좌마다 1건입니다." };
    if (await activeContractId(instructorId, programId)) return dupFail(instructorId, programId);
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "업로드할 파일을 선택하세요." };
    if (file.size > 16 * 1024 * 1024) return { ok: false, message: "파일 용량은 16MB 이하여야 합니다." };
    const ext = PAPER_EXT[file.type];
    if (!ext) return { ok: false, message: "PDF·JPG·PNG·WEBP 만 올릴 수 있습니다." };

    const { data: ins } = await supabaseAdmin.from("saem_instructors").select("name").eq("id", instructorId).maybeSingle();
    if (!ins) return { ok: false, message: "강사를 찾을 수 없습니다." };
    const scope = await programScope(programId);
    let programName = "";
    if (programId) {
      const { data: p } = await supabaseAdmin.from("saem_programs").select("name").eq("id", programId).maybeSingle();
      programName = str((p as { name?: string } | null)?.name);
    }
    const fields = { ...emptyFields(), program_name: programName, instructor_name: str((ins as { name: string }).name), contract_date: kstTodayYmd() };

    const { data: row, error } = await supabaseAdmin
      .from(T_CON)
      .insert({
        instructor_id: instructorId,
        program_id: programId,
        ...scope,
        signing_method: "paper",
        status: "draft", // 파일을 올린 뒤 completed 로 — 업로드 실패 시 지웁니다.
        fields,
        instructor_name_snapshot: str((ins as { name: string }).name),
        created_by: access.name,
      })
      .select("id, contract_no")
      .single();
    if (isUniqueViolation(error)) return dupFail(instructorId, programId);
    if (error) throw new Error(error.message);
    const r = row as { id: string; contract_no: string };
    const path = `${INSTRUCTOR_CONTRACT_DIR}/${instructorId}/${r.contract_no}_paper.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from(HR_DOCUMENTS_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: true });
    if (upErr) {
      await supabaseAdmin.from(T_CON).delete().eq("id", r.id);
      return { ok: false, message: `업로드 실패: ${upErr.message}` };
    }
    const now = new Date().toISOString();
    const { error: updErr } = await supabaseAdmin
      .from(T_CON)
      .update({ status: "completed", paper_file_path: path, updated_at: now })
      .eq("id", r.id);
    if (updErr) throw new Error(updErr.message);
    await writeLog(r.id, "paper_uploaded", access, { original_name: file.name, size: file.size });
    revalidateAll(instructorId);
    return { ok: true, id: r.id };
  } catch (e) {
    return fail(e, "업로드하지 못했습니다.");
  }
}

// =====================================================================
// 관장 직인 날인 → PDF 확정
//   직인사용대장(seal_requests)과는 연결하지 않습니다 — 그 대장은 증서(수상확인증·수료증 등)
//   발급 전용 구조(doc_type 고정 목록·결재(approvals)·발급번호·snapshot 으로 증서 PDF 재출력)라
//   계약서를 넣으면 증서 번호가 하나 소비되고 재출력 시 엉뚱한 증서 양식이 나옵니다.
// =====================================================================
export async function sealInstructorContract(id: string): Promise<{ ok: true } | Fail> {
  try {
    const access = await requireSaemAccess({ onlyM0: true });
    const cur = await loadContract(id);
    if (!cur) return { ok: false, message: "계약서를 찾을 수 없습니다." };
    if (cur.status !== "instructor_signed" || !cur.instructor_signed_at)
      return { ok: false, message: "강사 서명이 끝난 계약서만 날인할 수 있습니다." };
    if (cur.employer_signed_at) return { ok: false, message: "이미 날인했습니다." };
    const body = strOrNull(cur.body_snapshot);
    if (!body) return { ok: false, message: "확정된 본문이 없습니다(발송 기록 확인 필요)." };
    const signature = decodeDataUrl(strOrNull(cur.instructor_signature));
    if (!signature) return { ok: false, message: "강사 서명 이미지를 읽지 못했습니다." };
    const seal = await loadOrgSeal();
    if (!seal) return { ok: false, message: "기관 직인이 등록되어 있지 않습니다. 기관 직인을 먼저 등록하세요(/hr/seal)." };

    const fields = toFields(cur.fields);
    const bytes = await buildInstructorContractPdf({
      title: str(cur.title_snapshot),
      body,
      contractDate: fields.contract_date || null,
      instructorName: str(cur.instructor_name_snapshot),
      rrnMasked: str(cur.rrn_mask_snapshot),
      address: str(cur.address_snapshot),
      instructorSignature: signature,
      seal,
    });
    const path = instructorContractPdfPath(str(cur.instructor_id), str(cur.contract_no));
    const { error: upErr } = await supabaseAdmin.storage
      .from(HR_DOCUMENTS_BUCKET)
      .upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(`PDF 저장 실패: ${upErr.message}`);

    const now = new Date().toISOString();
    const { error, count } = await supabaseAdmin
      .from(T_CON)
      .update(
        { status: "completed", employer_signed_at: now, employer_signed_by: access.name, pdf_path: path, updated_at: now },
        { count: "exact" }
      )
      .eq("id", id)
      .eq("status", "instructor_signed")
      .is("employer_signed_at", null);
    if (error) throw new Error(error.message);
    if (!count) return { ok: false, message: "이미 다른 곳에서 처리되었습니다. 새로고침해 주세요." };
    await writeLog(id, "employer_sealed", access, { pdf_path: path });
    revalidateAll(str(cur.instructor_id));
    return { ok: true };
  } catch (e) {
    return fail(e, "날인하지 못했습니다.");
  }
}

// =====================================================================
// 파일 열기 — 5분 서명 URL + 열람·다운로드 기록
// =====================================================================
export async function openInstructorContractFile(
  id: string,
  opts: { download?: boolean } = {}
): Promise<{ ok: true; url: string } | Fail> {
  try {
    const access = await requireSaemAccess();
    const cur = await loadContract(id);
    if (!cur) return { ok: false, message: "계약서를 찾을 수 없습니다." };
    const path = strOrNull(cur.pdf_path) ?? strOrNull(cur.paper_file_path);
    if (!path) return { ok: false, message: "저장된 파일이 없습니다." };
    const { data, error } = await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) return { ok: false, message: "파일 주소를 만들지 못했습니다." };
    let url = data.signedUrl;
    if (opts.download) {
      const ext = path.split(".").pop() ?? "pdf";
      const name = `강사계약서_${str(cur.instructor_name_snapshot) || "강사"}_${str(cur.contract_no)}.${ext}`;
      url = `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`;
    }
    await writeLog(id, opts.download ? "file_downloaded" : "file_viewed", access, { path });
    return { ok: true, url };
  } catch (e) {
    return fail(e);
  }
}

// 이력 보기.
export async function listInstructorContractLogs(
  id: string
): Promise<{ action: string; actor_type: string; actor_name: string | null; created_at: string; detail: unknown }[]> {
  await requireSaemAccess();
  const { data } = await supabaseAdmin
    .from(T_LOG)
    .select("action, actor_type, actor_name, created_at, detail")
    .eq("contract_id", id)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []) as { action: string; actor_type: string; actor_name: string | null; created_at: string; detail: unknown }[];
}
