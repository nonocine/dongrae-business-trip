// =====================================================================
// 계약서 서버 공용 — 근로계약서·연봉계약서가 같은 흐름을 씁니다.
//   권한(관리자=M0 또는 hr / 직원=세션의 나) · 조항 고정 · 보내기 · 발송취소 · 무효 ·
//   직원 서명 · 센터장 서명 → PDF 확정 · 교부(다운로드) 기록.
//
//   * 2026-10 연봉계약서를 붙이며 근로계약서(46449f0) 의 흐름 코드를 종류(kind)를
//     받는 함수로 옮겼습니다. 종류마다 다른 건 "행 → 문서 블록" 하나뿐이라
//     KIND_BLOCKS 에만 갈래가 있습니다.
//   * 서버 전용("use server" 아님). 각 액션 파일이 권한을 확인하고 이 함수들을 부릅니다.
//   * 두 테이블 모두 RLS on·정책 0 → service_role. 직원 쪽 조회·서명·다운로드는
//     모두 .eq("driver_id", 세션의 나) 를 쿼리에 겁니다 — 화면에서 숨기는 게 아니라
//     쿼리에서 거르므로 남의 계약서는 RSC 페이로드에도 실리지 않습니다(f44f0ef 원칙).
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { HR_DOCUMENTS_BUCKET } from "@/lib/supabase";
import { isM0Grant } from "@/lib/authLevels";
import { listRolesForDriver } from "@/lib/employeeRolesServer";
import { downloadHrImage, decodeDataUrl } from "@/lib/recruitmentApplicantDocData";
import { sendSlack, sendSlackDMDetailed, siteBaseUrl, slackLink } from "@/lib/slack";
import {
  CONTRACT_KINDS,
  CONTRACT_ORG,
  checkSignature,
  clauseSnapshotKey,
  contractPdfFilename,
  contractPdfPath,
  fmtDot,
  hyphenRrn,
  isPngDataUrl,
  kstYmd,
  maskRrn,
  workflowFields,
  type ContractBlock,
  type ContractKind,
  type ContractParty,
  type ContractSummary,
  type MyContract,
} from "@/lib/contractCore";
import {
  CONTRACT_LIST_COLUMNS,
  buildContractBlocks,
  parseClauses,
  toContract,
} from "@/lib/employmentContracts";
import {
  SALARY_LIST_COLUMNS,
  buildSalaryContractBlocks,
  parseSalaryClauses,
  toSalaryContract,
  won,
} from "@/lib/salaryContracts";
import { buildContractPdf } from "@/lib/contractPdf";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export function fail(e: unknown): { ok: false; message: string } {
  return { ok: false, message: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." };
}

// --- 권한 ---------------------------------------------------------------
export type ContractAdmin = { name: string; driverId: string | null; isM0: boolean };

// 관리자 = M0(관장·부장·master) 또는 hr 직무. (증명서·의무교육과 같은 기준)
export async function resolveContractAdmin(): Promise<ContractAdmin | null> {
  const me = await getSession();
  if (!me || me.kind !== "employee" || !me.name.trim()) return null;
  const g = await getGoogleSession();
  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("id, rank")
    .eq("name", me.name.trim())
    .maybeSingle();
  const driverId =
    driver && typeof (driver as { id?: unknown }).id === "string"
      ? String((driver as { id: string }).id)
      : null;
  const rank = (driver as { rank?: string | null } | null)?.rank ?? null;
  let authLevel: string | null = null;
  if (driverId) {
    const { data: prof } = await supabaseAdmin
      .from("employee_profiles")
      .select("auth_level")
      .eq("driver_id", driverId)
      .maybeSingle();
    authLevel = (prof as { auth_level?: string | null } | null)?.auth_level ?? null;
  }
  const isM0 = isM0Grant({ rank, email: g?.email, authLevel });
  const roles = driverId ? await listRolesForDriver(driverId) : [];
  if (!isM0 && !roles.includes("hr")) return null;
  return { name: me.name.trim(), driverId, isM0 };
}

export async function requireContractAdmin(): Promise<ContractAdmin> {
  const ctx = await resolveContractAdmin();
  if (!ctx) throw new Error("계약서 관리 권한이 없습니다. (관장·부장 또는 인사 담당자)");
  return ctx;
}

// 세션 직원 → drivers(id,name). driver_id 는 언제나 여기서만 도출합니다.
export async function getMyDriver(): Promise<{ id: string; name: string } | null> {
  const session = await getSession();
  if (!session || session.kind !== "employee") return null;
  const { data } = await supabaseAdmin
    .from("drivers")
    .select("id, name")
    .eq("name", session.name)
    .maybeSingle();
  const id = String((data as { id?: unknown } | null)?.id ?? "");
  if (!id) return null;
  return { id, name: String((data as { name?: unknown }).name ?? "") };
}

export async function namesById(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data } = await supabaseAdmin.from("drivers").select("id, name").in("id", ids);
  for (const d of data ?? []) map.set(String((d as { id: string }).id), String((d as { name: string }).name));
  return map;
}

// --- settings(조항·명절 날짜) --------------------------------------------
export async function readSetting(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("settings").select("value").eq("key", key).maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  return v == null ? null : String(v);
}

export async function writeSetting(key: string, value: string): Promise<void> {
  const { error } = await supabaseAdmin.from("settings").upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

// 현행 조항(원문 JSON). 파싱은 종류별 모듈이 합니다.
export async function readCurrentClausesRaw(kind: ContractKind): Promise<string | null> {
  return readSetting(CONTRACT_KINDS[kind].clausesKey);
}

// 보낸 계약서는 보낸 시점 고정본. 작성 중이면 현행 문구.
async function readClausesRawFor(kind: ContractKind, id: string, status: string): Promise<string | null> {
  if (status !== "draft") {
    const snap = await readSetting(clauseSnapshotKey(kind, id));
    if (snap) return snap;
  }
  return readCurrentClausesRaw(kind);
}

async function freezeClauses(kind: ContractKind, id: string): Promise<void> {
  const parsed =
    kind === "employment"
      ? parseClauses(await readCurrentClausesRaw(kind))
      : parseSalaryClauses(await readCurrentClausesRaw(kind));
  await writeSetting(clauseSnapshotKey(kind, id), JSON.stringify(parsed));
}

export async function dropClauseSnapshot(kind: ContractKind, id: string): Promise<void> {
  await supabaseAdmin.from("settings").delete().eq("key", clauseSnapshotKey(kind, id));
}

// --- 당사자 -------------------------------------------------------------
// full=true 는 PDF 전용(주민번호 전체). 화면에는 언제나 full=false(가림).
export async function loadParty(driverId: string, full: boolean): Promise<ContractParty> {
  const [{ data: drv }, { data: prof }] = await Promise.all([
    supabaseAdmin.from("drivers").select("name").eq("id", driverId).maybeSingle(),
    supabaseAdmin.from("employee_profiles").select("resident_number, address").eq("driver_id", driverId).maybeSingle(),
  ]);
  const p = (prof ?? {}) as { resident_number?: string | null; address?: string | null };
  return {
    name: String((drv as { name?: string } | null)?.name ?? ""),
    rrn: full ? hyphenRrn(p.resident_number) : maskRrn(p.resident_number),
    address: (p.address ?? "").trim(),
  };
}

// --- 종류별: 행 → 블록 · 요약 -----------------------------------------------
const LIST_COLUMNS: Record<ContractKind, string> = {
  employment: CONTRACT_LIST_COLUMNS,
  salary: SALARY_LIST_COLUMNS,
};

export function listColumns(kind: ContractKind): string {
  return LIST_COLUMNS[kind];
}

export async function blocksFor(
  kind: ContractKind,
  raw: Record<string, unknown>,
  full: boolean
): Promise<ContractBlock[]> {
  const w = workflowFields(raw);
  const clausesRaw = await readClausesRawFor(kind, w.id, w.status);
  if (kind === "employment") {
    const row = toContract(raw, "");
    const party = await loadParty(row.driver_id, full);
    return buildContractBlocks({
      terms: row,
      party,
      clauses: parseClauses(clausesRaw),
      signDate: kstYmd(row.employee_signed_at),
    });
  }
  const row = toSalaryContract(raw, "");
  const names = await namesById([row.driver_id]);
  return buildSalaryContractBlocks({
    contract: row,
    employeeName: names.get(row.driver_id) ?? "",
    clauses: parseSalaryClauses(clausesRaw),
  });
}

export function toSummary(kind: ContractKind, raw: Record<string, unknown>, name: string): ContractSummary {
  const w = workflowFields(raw);
  if (kind === "employment") {
    const c = toContract(raw, name);
    return {
      ...w,
      kind,
      employee_name: name,
      period: `${fmtDot(c.contract_start)} ~ ${c.contract_end ? fmtDot(c.contract_end) : "정함 없음"}`,
      year: c.contract_start.slice(0, 4),
      note: null,
    };
  }
  const c = toSalaryContract(raw, name);
  return {
    ...w,
    kind,
    employee_name: name,
    period: `${fmtDot(c.period_start)} ~ ${fmtDot(c.period_end)}`,
    year: String(c.year),
    note: `연봉 ${won(c.total_annual)}원`,
  };
}

async function loadRow(kind: ContractKind, id: string, extra = ""): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin
    .from(CONTRACT_KINDS[kind].table)
    .select(`${LIST_COLUMNS[kind]}${extra}`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("계약서를 찾을 수 없습니다.");
  return data as unknown as Record<string, unknown>;
}

// --- 슬랙 ---------------------------------------------------------------
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

// --- 관리자 흐름 ---------------------------------------------------------
export async function listSummaries(kind: ContractKind): Promise<ContractSummary[]> {
  const { data, error } = await supabaseAdmin
    .from(CONTRACT_KINDS[kind].table)
    .select(LIST_COLUMNS[kind])
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const names = await namesById([...new Set(rows.map((r) => String(r.driver_id)))]);
  return rows.map((r) => toSummary(kind, r, names.get(String(r.driver_id)) ?? "(알 수 없음)"));
}

export async function adminBlocks(kind: ContractKind, id: string): Promise<ContractBlock[]> {
  return blocksFor(kind, await loadRow(kind, id), false);
}

export async function sendContractCore(kind: ContractKind, id: string): Promise<Result<{ dmFailed: string | null }>> {
  const table = CONTRACT_KINDS[kind].table;
  const cur = await loadRow(kind, id);
  if (cur.status !== "draft") return { ok: false, message: "작성 중인 계약서만 보낼 수 있습니다." };
  // 문구를 먼저 고정한 뒤 상태를 바꿉니다(직원이 보는 순간 고정본이 있어야 함).
  await freezeClauses(kind, id);
  const { error, count } = await supabaseAdmin
    .from(table)
    .update({ status: "sent", sent_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) throw new Error(error.message);
  if (!count) return { ok: false, message: "이미 다른 곳에서 처리되었습니다. 새로고침해주세요." };
  const dmFailed = await dmEmployee(
    String(cur.driver_id),
    `📝 ${CONTRACT_KINDS[kind].label}가 도착했습니다. 마이페이지에서 내용을 끝까지 읽고 서명해주세요.${myContractsLink("내 계약서 열기")}`
  );
  return { ok: true, dmFailed };
}

// 보낸 뒤 직원이 서명하기 전이면 작성 중으로 되돌립니다.
export async function recallContractCore(kind: ContractKind, id: string): Promise<Result> {
  const { error, count } = await supabaseAdmin
    .from(CONTRACT_KINDS[kind].table)
    .update({ status: "draft", sent_at: null }, { count: "exact" })
    .eq("id", id)
    .eq("status", "sent");
  if (error) throw new Error(error.message);
  if (!count) return { ok: false, message: "서명 대기 중인 계약서만 되돌릴 수 있습니다. (이미 서명했을 수 있습니다)" };
  await dropClauseSnapshot(kind, id);
  return { ok: true };
}

// 무효 — 체결된 계약도 잘못됐으면 무효로 남깁니다(삭제하지 않음). M0 확인은 호출부.
export async function voidContractCore(kind: ContractKind, id: string): Promise<Result> {
  const { error, count } = await supabaseAdmin
    .from(CONTRACT_KINDS[kind].table)
    .update({ status: "void" }, { count: "exact" })
    .eq("id", id)
    .in("status", ["sent", "signed"]);
  if (error) throw new Error(error.message);
  if (!count) return { ok: false, message: "보낸 계약서만 무효로 할 수 있습니다. (작성 중이면 삭제하세요)" };
  return { ok: true };
}

export async function deleteDraftCore(kind: ContractKind, id: string): Promise<Result> {
  const { error, count } = await supabaseAdmin
    .from(CONTRACT_KINDS[kind].table)
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) throw new Error(error.message);
  if (!count) return { ok: false, message: "작성 중인 계약서만 삭제할 수 있습니다." };
  await dropClauseSnapshot(kind, id);
  return { ok: true };
}

// --- 센터장 서명 → PDF 확정 -------------------------------------------------
// 관장(대표자) 도장 — 이름 → drivers.id → employee_profiles.stamp_path → Storage.
export async function loadEmployerStamp(): Promise<Uint8Array | null> {
  try {
    const { data: drv } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("name", CONTRACT_ORG.representative)
      .maybeSingle();
    const id = (drv as { id?: string } | null)?.id;
    if (!id) return null;
    const { data: prof } = await supabaseAdmin
      .from("employee_profiles")
      .select("stamp_path")
      .eq("driver_id", String(id))
      .maybeSingle();
    return await downloadHrImage((prof as { stamp_path?: string | null } | null)?.stamp_path ?? null);
  } catch {
    return null;
  }
}

export function bytesToDataUrl(bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.length < 8) return null;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  return `data:image/${isPng ? "png" : "jpeg"};base64,${Buffer.from(bytes).toString("base64")}`;
}

// 본인 저장 서명(PNG dataURL). 본인 driver_id 로만 부릅니다.
export async function readSavedSignature(driverId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("employee_profiles")
    .select("signature_data")
    .eq("driver_id", driverId)
    .maybeSingle();
  const raw = (data as { signature_data?: string | null } | null)?.signature_data;
  return isPngDataUrl(raw) ? raw : null;
}

export type EmployerSignInput =
  | { mode: "stamp" }
  | { mode: "saved" }
  | { mode: "drawn"; dataUrl: string; save: boolean };

export async function employerSignCore(
  kind: ContractKind,
  id: string,
  input: EmployerSignInput,
  me: ContractAdmin
): Promise<Result<{ dmFailed: string | null }>> {
  const table = CONTRACT_KINDS[kind].table;
  const raw = await loadRow(kind, id, ", employee_signature");
  const w = workflowFields(raw);
  if (w.status !== "signed" || !w.employee_signed_at) {
    return { ok: false, message: "직원 서명이 끝난 계약서만 센터장 서명을 할 수 있습니다." };
  }
  if (w.employer_signed_at) return { ok: false, message: "이미 센터장 서명이 끝났습니다." };

  let employerImage: Uint8Array | null = null;
  if (input.mode === "stamp") {
    employerImage = await loadEmployerStamp();
    if (!employerImage) return { ok: false, message: "관장 도장이 등록되어 있지 않습니다. 직접 서명해주세요." };
  } else if (input.mode === "saved") {
    const saved = me.driverId ? await readSavedSignature(me.driverId) : null;
    if (!saved) return { ok: false, message: "저장된 서명이 없습니다. 직접 그려주세요." };
    employerImage = decodeDataUrl(saved);
  } else {
    const checked = checkSignature(input.dataUrl);
    if (!checked.ok) return { ok: false, message: checked.message };
    employerImage = decodeDataUrl(checked.dataUrl);
    if (input.save && me.driverId) {
      await supabaseAdmin
        .from("employee_profiles")
        .update({ signature_data: checked.dataUrl, signature_updated_at: new Date().toISOString() })
        .eq("driver_id", me.driverId);
    }
  }

  const blocks = await blocksFor(kind, raw, true);
  const bytes = await buildContractPdf(blocks, {
    employee: decodeDataUrl(typeof raw.employee_signature === "string" ? raw.employee_signature : null),
    employer: employerImage,
  });
  const path = contractPdfPath(kind, w.driver_id, w.id);
  const { error: upErr } = await supabaseAdmin.storage
    .from(HR_DOCUMENTS_BUCKET)
    .upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`PDF 저장 실패: ${upErr.message}`);

  const now = new Date().toISOString();
  // 연봉계약서는 발급 시각·발급자 컬럼이 따로 있습니다(issued_at·issued_by).
  const extraCols = kind === "salary" ? { issued_at: now, issued_by: me.name } : {};
  const { error, count } = await supabaseAdmin
    .from(table)
    .update({ employer_signed_at: now, contract_pdf_url: path, ...extraCols }, { count: "exact" })
    .eq("id", id)
    .eq("status", "signed")
    .is("employer_signed_at", null);
  if (error) throw new Error(error.message);
  if (!count) return { ok: false, message: "이미 다른 곳에서 처리되었습니다. 새로고침해주세요." };

  const dmFailed = await dmEmployee(
    w.driver_id,
    `✅ ${CONTRACT_KINDS[kind].label} 체결이 끝났습니다. 마이페이지에서 계약서를 내려받아 보관해주세요.${myContractsLink("내 계약서 열기")}`
  );
  return { ok: true, dmFailed };
}

// 확정본(저장된 PDF) 또는, 확정 전이면 현재 내용의 미리보기.
export async function adminPdfCore(
  kind: ContractKind,
  id: string
): Promise<Result<{ base64: string; filename: string; preview: boolean }>> {
  const raw = await loadRow(kind, id, ", employee_signature");
  const s = toSummary(kind, raw, "");
  const names = await namesById([s.driver_id]);
  const filename = contractPdfFilename(kind, names.get(s.driver_id) ?? "", s.year);
  const path = typeof raw.contract_pdf_url === "string" ? raw.contract_pdf_url : null;
  if (path) {
    const { data, error } = await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).download(path);
    if (error || !data) throw new Error("저장된 PDF 를 읽지 못했습니다.");
    return { ok: true, base64: Buffer.from(await data.arrayBuffer()).toString("base64"), filename, preview: false };
  }
  const bytes = await renderPreviewPdf(kind, raw);
  return { ok: true, base64: Buffer.from(bytes).toString("base64"), filename: filename.replace(".pdf", "_미리보기.pdf"), preview: true };
}

async function renderPreviewPdf(kind: ContractKind, raw: Record<string, unknown>): Promise<Uint8Array> {
  const blocks = await blocksFor(kind, raw, true);
  return buildContractPdf(blocks, {
    employee: decodeDataUrl(typeof raw.employee_signature === "string" ? raw.employee_signature : null),
    employer: null,
  });
}

// 여러 건 미리보기 PDF 를 한 파일로(연말 일괄 확인용).
export async function bulkPreviewPdfCore(kind: ContractKind, ids: string[]): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();
  for (const id of ids) {
    const raw = await loadRow(kind, id, ", employee_signature");
    const one = await PDFDocument.load(await renderPreviewPdf(kind, raw));
    const pages = await merged.copyPages(one, one.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return merged.save();
}

// --- 직원 흐름(본인 것만) ---------------------------------------------------
const VISIBLE = ["sent", "signed"];


export async function listMineCore(kind: ContractKind, me: { id: string; name: string }): Promise<MyContract[]> {
  const { data, error } = await supabaseAdmin
    .from(CONTRACT_KINDS[kind].table)
    .select(LIST_COLUMNS[kind])
    .eq("driver_id", me.id) // ← 서버 쿼리 단계에서 본인 것만
    .in("status", VISIBLE)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return Promise.all(
    ((data ?? []) as unknown as Record<string, unknown>[]).map(async (r) => ({
      ...toSummary(kind, r, me.name),
      // 주민번호는 가린 값(full=false). 전체 번호는 PDF 에만 들어갑니다.
      blocks: await blocksFor(kind, r, false),
    }))
  );
}

export type SignInput = {
  readConfirmed: boolean;
  mode: "saved" | "drawn";
  dataUrl?: string | null;
  saveForLater?: boolean;
};

export async function signMineCore(
  kind: ContractKind,
  id: string,
  input: SignInput,
  me: { id: string; name: string }
): Promise<Result> {
  if (!input.readConfirmed) return { ok: false, message: "계약서 내용을 끝까지 읽고 확인란에 체크해주세요." };
  let signature: string;
  if (input.mode === "saved") {
    const saved = await readSavedSignature(me.id);
    if (!saved) return { ok: false, message: "저장된 서명이 없습니다. 직접 그려주세요." };
    signature = saved;
  } else {
    const checked = checkSignature(input.dataUrl);
    if (!checked.ok) return { ok: false, message: checked.message };
    signature = checked.dataUrl;
  }
  const now = new Date().toISOString();
  const { error, count } = await supabaseAdmin
    .from(CONTRACT_KINDS[kind].table)
    .update({ status: "signed", employee_signature: signature, employee_signed_at: now }, { count: "exact" })
    .eq("id", id)
    .eq("driver_id", me.id) // ← 남의 계약서는 서명할 수 없습니다
    .eq("status", "sent");
  if (error) throw new Error(error.message);
  if (!count) return { ok: false, message: "서명할 수 있는 계약서가 아닙니다. 새로고침해주세요." };
  if (input.mode === "drawn" && input.saveForLater) {
    await supabaseAdmin
      .from("employee_profiles")
      .update({ signature_data: signature, signature_updated_at: now })
      .eq("driver_id", me.id);
  }
  try {
    await sendSlack(
      "SLACK_WEBHOOK_ADMIN",
      `✍️ ${me.name} 님이 ${CONTRACT_KINDS[kind].label}에 서명했습니다. 센터장 서명 대기 (/hr/contracts)`
    );
  } catch {
    /* 알림 격리 */
  }
  return { ok: true };
}

export async function downloadMineCore(
  kind: ContractKind,
  id: string,
  me: { id: string; name: string }
): Promise<Result<{ base64: string; filename: string }>> {
  const table = CONTRACT_KINDS[kind].table;
  const { data: row, error } = await supabaseAdmin
    .from(table)
    .select(`${LIST_COLUMNS[kind]}`)
    .eq("id", id)
    .eq("driver_id", me.id) // ← 본인 것만
    .eq("status", "signed")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const r = row as unknown as Record<string, unknown> | null;
  const path = r && typeof r.contract_pdf_url === "string" ? r.contract_pdf_url : null;
  if (!r || !path) return { ok: false, message: "내려받을 수 있는 계약서가 없습니다. (체결 전이면 센터장 서명 대기 중입니다)" };
  const { data, error: dlErr } = await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).download(path);
  if (dlErr || !data) throw new Error("계약서 PDF 를 읽지 못했습니다.");
  const base64 = Buffer.from(await data.arrayBuffer()).toString("base64");
  // 교부 기록(취업규칙 6조②) — 처음 내려받은 시각만 남깁니다.
  if (!r.delivered_at) {
    await supabaseAdmin
      .from(table)
      .update({ delivered_at: new Date().toISOString() })
      .eq("id", id)
      .eq("driver_id", me.id)
      .is("delivered_at", null);
  }
  return { ok: true, base64, filename: contractPdfFilename(kind, me.name, toSummary(kind, r, me.name).year) };
}

