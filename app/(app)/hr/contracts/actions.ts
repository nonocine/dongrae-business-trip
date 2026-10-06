"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { HR_DOCUMENTS_BUCKET } from "@/lib/supabase";
import { kstTodayYmd } from "@/lib/trainings";
import { currentAssignment } from "@/lib/appointments";
import { sendSlackDMDetailed, siteBaseUrl, slackLink } from "@/lib/slack";
import {
  CONTRACT_LIST_COLUMNS,
  checkSignature,
  contractPdfFilename,
  contractPdfPath,
  isYmd,
  parseClauses,
  toContract,
  type ContractBlock,
  type ContractClauses,
  type ContractType,
  type EmploymentContract,
} from "@/lib/employmentContracts";
import {
  requireContractAdmin,
  readCurrentClauses,
  writeCurrentClauses,
  freezeClauses,
  dropClauseSnapshot,
  blocksFor,
  loadEmployerStamp,
  bytesToDataUrl,
  readSavedSignature,
  renderContractPdf,
} from "@/lib/employmentContractServer";

// =====================================================================
// 근로계약서 관리자 액션 — /hr/contracts (M0 또는 hr 직무)
//   * 작성(draft) → [직원에게 보내기](sent, 문구 고정, 슬랙 DM) → 직원 서명(signed)
//     → 센터장 서명(employer_signed_at, M0 만) → PDF 확정(contract_pdf_url).
//   * 모든 액션 진입 시 requireContractAdmin — RLS 정책 0 이라 이것이 방어선.
//   * 슬랙 DM 은 부가기능: 실패해도 발송 자체는 성공(결과에 사유만 덧붙임).
// =====================================================================

const TABLE = "employment_contracts";
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

function fail(e: unknown): { ok: false; message: string } {
  return { ok: false, message: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." };
}

async function namesById(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data } = await supabaseAdmin.from("drivers").select("id, name").in("id", ids);
  for (const d of data ?? []) map.set(String((d as { id: string }).id), String((d as { name: string }).name));
  return map;
}

async function loadRow(id: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(`${CONTRACT_LIST_COLUMNS}, employee_signature`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("계약서를 찾을 수 없습니다.");
  return data as Record<string, unknown>;
}

// --- 조회 --------------------------------------------------------------

export async function listContracts(): Promise<EmploymentContract[]> {
  await requireContractAdmin();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(CONTRACT_LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, unknown>[];
  const names = await namesById([...new Set(rows.map((r) => String(r.driver_id)))]);
  return rows.map((r) => toContract(r, names.get(String(r.driver_id)) ?? "(알 수 없음)"));
}

export type ContractEmployee = {
  driverId: string;
  name: string;
  joinDate: string | null;
  department: string | null;
  position: string | null;
  hasAssignment: boolean;
  hasRrn: boolean;
  hasAddress: boolean;
};

// 재직자만. 직위·부서는 lib/appointments.currentAssignment(단일 출처) —
//   drivers.rank 로 메꾸지 않습니다(직급과 직위는 다른 축).
export async function listContractEmployees(): Promise<ContractEmployee[]> {
  await requireContractAdmin();
  const [{ data: drivers }, { data: profs }] = await Promise.all([
    supabaseAdmin.from("drivers").select("id, name").order("name"),
    supabaseAdmin
      .from("employee_profiles")
      .select("driver_id, join_date, employment_status, appointments, resident_number, address"),
  ]);
  const pByD = new Map<string, Record<string, unknown>>();
  for (const p of profs ?? []) pByD.set(String((p as Record<string, unknown>).driver_id), p as Record<string, unknown>);
  const today = kstTodayYmd();
  const out: ContractEmployee[] = [];
  for (const d of drivers ?? []) {
    const id = String((d as { id: string }).id);
    const p = pByD.get(id);
    if (!p || p.employment_status === "resigned") continue;
    const { current } = currentAssignment(p.appointments, today);
    out.push({
      driverId: id,
      name: String((d as { name: string }).name),
      joinDate: (p.join_date as string | null) ?? null,
      department: current?.department ?? null,
      position: current?.title ?? null,
      hasAssignment: current !== null,
      // 주민번호·주소 값은 내려보내지 않습니다 — 있는지 여부만.
      hasRrn: String(p.resident_number ?? "").replace(/\D/g, "").length === 13,
      hasAddress: !!String(p.address ?? "").trim(),
    });
  }
  return out;
}

// 화면 미리보기용 블록(주민번호 가림).
export async function getContractBlocks(id: string): Promise<Result<{ blocks: ContractBlock[] }>> {
  try {
    await requireContractAdmin();
    const row = toContract(await loadRow(id), "");
    const blocks = await blocksFor(row, false);
    return { ok: true, blocks };
  } catch (e) {
    return fail(e);
  }
}

// --- 작성·수정 ----------------------------------------------------------

export type ContractInput = {
  id?: string | null;
  driverId: string;
  contractType: ContractType;
  contractStart: string;
  contractEnd: string | null;
  probation: boolean;
  probationStart: string | null;
  probationEnd: string | null;
  department: string;
  position: string;
  dutyContent: string;
  workHours: string;
  workDays: string;
  weeklyHours: number | null;
  workplace: string;
  breakTime: string;
  paymentDay: string;
};

function validate(input: ContractInput): string | null {
  if (!input.driverId) return "직원을 선택해주세요.";
  if (!isYmd(input.contractStart)) return "계약 시작일을 확인해주세요.";
  if (input.contractType === "fixed_term") {
    if (!isYmd(input.contractEnd)) return "기간제는 계약 종료일이 필요합니다.";
    if (input.contractEnd < input.contractStart) return "종료일이 시작일보다 빠릅니다.";
  }
  if (input.probation) {
    if (!isYmd(input.probationStart) || !isYmd(input.probationEnd)) return "시용기간 날짜를 확인해주세요.";
    if (input.probationEnd < input.probationStart) return "시용 종료일이 시작일보다 빠릅니다.";
  }
  if (input.weeklyHours != null && (!Number.isFinite(input.weeklyHours) || input.weeklyHours < 0 || input.weeklyHours > 52)) {
    return "주 근로시간을 확인해주세요.";
  }
  return null;
}

export async function saveContract(input: ContractInput): Promise<Result<{ id: string }>> {
  try {
    const me = await requireContractAdmin();
    const msg = validate(input);
    if (msg) return { ok: false, message: msg };
    const t = (v: string | null | undefined) => (v ?? "").trim() || null;
    const row = {
      driver_id: input.driverId,
      contract_type: input.contractType,
      contract_start: input.contractStart,
      contract_end: input.contractType === "fixed_term" ? input.contractEnd : null,
      probation_start: input.probation ? input.probationStart : null,
      probation_end: input.probation ? input.probationEnd : null,
      department: t(input.department),
      position: t(input.position),
      duty_content: t(input.dutyContent),
      work_hours: t(input.workHours),
      work_days: t(input.workDays),
      weekly_hours: input.weeklyHours,
      workplace: t(input.workplace),
      break_time: t(input.breakTime),
      payment_day: t(input.paymentDay),
    };
    if (input.id) {
      const cur = await loadRow(input.id);
      if (cur.status !== "draft") return { ok: false, message: "작성 중인 계약서만 고칠 수 있습니다. (보낸 뒤라면 먼저 발송을 취소하세요)" };
      const { error } = await supabaseAdmin.from(TABLE).update(row).eq("id", input.id).eq("status", "draft");
      if (error) throw new Error(error.message);
      revalidatePath("/hr/contracts");
      return { ok: true, id: input.id };
    }
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert({ ...row, status: "draft", created_by: me.name })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/hr/contracts");
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteDraftContract(id: string): Promise<Result> {
  try {
    await requireContractAdmin();
    const { error, count } = await supabaseAdmin
      .from(TABLE)
      .delete({ count: "exact" })
      .eq("id", id)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    if (!count) return { ok: false, message: "작성 중인 계약서만 삭제할 수 있습니다." };
    await dropClauseSnapshot(id);
    revalidatePath("/hr/contracts");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// --- 발송 --------------------------------------------------------------

async function emailOf(driverId: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin.from("employee_profiles").select("email").eq("driver_id", driverId).maybeSingle();
    const e = (data as { email?: string | null } | null)?.email ?? null;
    return e && e.trim() ? e.trim() : null;
  } catch {
    return null;
  }
}

// 직원 DM — 실패 사유를 돌려줍니다(없으면 null). 개인정보는 넣지 않습니다.
async function dmEmployee(driverId: string, text: string): Promise<string | null> {
  try {
    const { ok, reason } = await sendSlackDMDetailed(await emailOf(driverId), text);
    return ok ? null : reason ?? "사유 미상";
  } catch (e) {
    return e instanceof Error ? e.message : "알 수 없는 오류";
  }
}

function myContractsLink(label: string): string {
  const base = siteBaseUrl();
  return base ? ` ${slackLink(`${base}/profile/hr#contracts`, label)}` : "";
}

export async function sendContract(id: string): Promise<Result<{ dmFailed: string | null }>> {
  try {
    await requireContractAdmin();
    const cur = await loadRow(id);
    if (cur.status !== "draft") return { ok: false, message: "작성 중인 계약서만 보낼 수 있습니다." };
    // 문구를 먼저 고정한 뒤 상태를 바꿉니다(직원이 보는 순간 고정본이 있어야 함).
    await freezeClauses(id);
    const { error, count } = await supabaseAdmin
      .from(TABLE)
      .update({ status: "sent", sent_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", id)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    if (!count) return { ok: false, message: "이미 다른 곳에서 처리되었습니다. 새로고침해주세요." };
    const dmFailed = await dmEmployee(
      String(cur.driver_id),
      `📝 근로계약서가 도착했습니다. 마이페이지에서 내용을 끝까지 읽고 서명해주세요.${myContractsLink("내 계약서 열기")}`
    );
    revalidatePath("/hr/contracts");
    revalidatePath("/profile/hr");
    return { ok: true, dmFailed };
  } catch (e) {
    return fail(e);
  }
}

// 보낸 뒤 직원이 서명하기 전이면 작성 중으로 되돌립니다(고칠 곳이 생겼을 때).
export async function recallContract(id: string): Promise<Result> {
  try {
    await requireContractAdmin();
    const { error, count } = await supabaseAdmin
      .from(TABLE)
      .update({ status: "draft", sent_at: null }, { count: "exact" })
      .eq("id", id)
      .eq("status", "sent");
    if (error) throw new Error(error.message);
    if (!count) return { ok: false, message: "서명 대기 중인 계약서만 되돌릴 수 있습니다. (이미 서명했을 수 있습니다)" };
    await dropClauseSnapshot(id);
    revalidatePath("/hr/contracts");
    revalidatePath("/profile/hr");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// 무효 — 서명이 끝난 계약도 잘못 체결됐으면 무효로 남깁니다(삭제하지 않음). M0 만.
export async function voidContract(id: string): Promise<Result> {
  try {
    const me = await requireContractAdmin();
    if (!me.isM0) return { ok: false, message: "무효 처리는 관장·부장만 할 수 있습니다." };
    const { error, count } = await supabaseAdmin
      .from(TABLE)
      .update({ status: "void" }, { count: "exact" })
      .eq("id", id)
      .in("status", ["sent", "signed"]);
    if (error) throw new Error(error.message);
    if (!count) return { ok: false, message: "보낸 계약서만 무효로 할 수 있습니다. (작성 중이면 삭제하세요)" };
    revalidatePath("/hr/contracts");
    revalidatePath("/profile/hr");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// --- 센터장 서명 → PDF 확정 ----------------------------------------------

export async function getEmployerSignOptions(): Promise<
  Result<{ stamp: string | null; mySignature: string | null; canSign: boolean }>
> {
  try {
    const me = await requireContractAdmin();
    const [stamp, mySignature] = await Promise.all([
      loadEmployerStamp(),
      me.driverId ? readSavedSignature(me.driverId) : Promise.resolve(null),
    ]);
    return { ok: true, stamp: bytesToDataUrl(stamp), mySignature, canSign: me.isM0 };
  } catch (e) {
    return fail(e);
  }
}

export type EmployerSignInput =
  | { mode: "stamp" }
  | { mode: "saved" }
  | { mode: "drawn"; dataUrl: string; save: boolean };

export async function employerSignContract(
  id: string,
  input: EmployerSignInput
): Promise<Result<{ dmFailed: string | null }>> {
  try {
    const me = await requireContractAdmin();
    if (!me.isM0) return { ok: false, message: "센터장 서명은 관장·부장만 할 수 있습니다." };
    const raw = await loadRow(id);
    const row = toContract(raw, "");
    if (row.status !== "signed" || !row.employee_signed_at) {
      return { ok: false, message: "직원 서명이 끝난 계약서만 센터장 서명을 할 수 있습니다." };
    }
    if (row.employer_signed_at) return { ok: false, message: "이미 센터장 서명이 끝났습니다." };

    let employerImage: Uint8Array | null = null;
    if (input.mode === "stamp") {
      employerImage = await loadEmployerStamp();
      if (!employerImage) return { ok: false, message: "관장 도장이 등록되어 있지 않습니다. 직접 서명해주세요." };
    } else if (input.mode === "saved") {
      const saved = me.driverId ? await readSavedSignature(me.driverId) : null;
      if (!saved) return { ok: false, message: "저장된 서명이 없습니다. 직접 그려주세요." };
      employerImage = new Uint8Array(Buffer.from(saved.split(",")[1], "base64"));
    } else {
      const checked = checkSignature(input.dataUrl);
      if (!checked.ok) return { ok: false, message: checked.message };
      employerImage = new Uint8Array(Buffer.from(checked.dataUrl.split(",")[1], "base64"));
      if (input.save && me.driverId) {
        await supabaseAdmin
          .from("employee_profiles")
          .update({ signature_data: checked.dataUrl, signature_updated_at: new Date().toISOString() })
          .eq("driver_id", me.driverId);
      }
    }

    const blocks = await blocksFor(row, true);
    const bytes = await renderContractPdf(
      blocks,
      typeof raw.employee_signature === "string" ? raw.employee_signature : null,
      employerImage
    );
    const path = contractPdfPath(row.driver_id, row.id);
    const { error: upErr } = await supabaseAdmin.storage
      .from(HR_DOCUMENTS_BUCKET)
      .upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(`PDF 저장 실패: ${upErr.message}`);

    const { error, count } = await supabaseAdmin
      .from(TABLE)
      .update({ employer_signed_at: new Date().toISOString(), contract_pdf_url: path }, { count: "exact" })
      .eq("id", id)
      .eq("status", "signed")
      .is("employer_signed_at", null);
    if (error) throw new Error(error.message);
    if (!count) return { ok: false, message: "이미 다른 곳에서 처리되었습니다. 새로고침해주세요." };

    const dmFailed = await dmEmployee(
      row.driver_id,
      `✅ 근로계약서 체결이 끝났습니다. 마이페이지에서 계약서를 내려받아 보관해주세요.${myContractsLink("내 계약서 열기")}`
    );
    revalidatePath("/hr/contracts");
    revalidatePath("/profile/hr");
    return { ok: true, dmFailed };
  } catch (e) {
    return fail(e);
  }
}

// --- PDF ---------------------------------------------------------------

// 확정본(저장된 PDF) 또는, 확정 전이면 현재 내용의 미리보기(서명 칸은 있는 만큼만).
export async function downloadContractPdf(id: string): Promise<Result<{ base64: string; filename: string; preview: boolean }>> {
  try {
    await requireContractAdmin();
    const raw = await loadRow(id);
    const row = toContract(raw, "");
    const names = await namesById([row.driver_id]);
    const filename = contractPdfFilename(names.get(row.driver_id) ?? "", row.contract_start);
    const path = typeof raw.contract_pdf_url === "string" ? raw.contract_pdf_url : null;
    if (path) {
      const { data, error } = await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).download(path);
      if (error || !data) throw new Error("저장된 PDF 를 읽지 못했습니다.");
      return { ok: true, base64: Buffer.from(await data.arrayBuffer()).toString("base64"), filename, preview: false };
    }
    const blocks = await blocksFor(row, true);
    const bytes = await renderContractPdf(
      blocks,
      typeof raw.employee_signature === "string" ? raw.employee_signature : null,
      null
    );
    return {
      ok: true,
      base64: Buffer.from(bytes).toString("base64"),
      filename: filename.replace(".pdf", "_미리보기.pdf"),
      preview: true,
    };
  } catch (e) {
    return fail(e);
  }
}

// --- 조항 문구 ----------------------------------------------------------

export async function getContractClauses(): Promise<ContractClauses> {
  await requireContractAdmin();
  return readCurrentClauses();
}

export async function saveContractClauses(input: ContractClauses): Promise<Result<{ clauses: ContractClauses }>> {
  try {
    await requireContractAdmin();
    // parseClauses 로 한 번 거르면 빈 칸·이상한 값은 기본 문구로 돌아갑니다.
    const clean = parseClauses(JSON.stringify(input));
    await writeCurrentClauses(clean);
    revalidatePath("/hr/contracts");
    return { ok: true, clauses: clean };
  } catch (e) {
    return fail(e);
  }
}
