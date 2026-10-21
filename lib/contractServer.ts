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
import { PERSONNEL_DENIED, resolvePersonnelViewer } from "@/lib/personnelAccess";
import { decodeDataUrl } from "@/lib/recruitmentApplicantDocData";
import { sendSlack, sendSlackDMDetailed, siteBaseUrl, slackLink } from "@/lib/slack";
import {
  CONTRACT_KINDS,
  CONTRACT_ORG,
  checkSignature,
  clauseSnapshotKey,
  contractsPath,
  contractPdfFilename,
  contractPdfPath,
  fmtDot,
  hyphenRrn,
  isPngDataUrl,
  isYmd,
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
import { hideAutoContractFile, putAutoContractFile } from "@/lib/employeeDocsServer";
import { loadOrgSeal } from "@/lib/orgSeal";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export function fail(e: unknown): { ok: false; message: string } {
  return { ok: false, message: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." };
}

// --- 권한 ---------------------------------------------------------------
export type ContractAdmin = { name: string; driverId: string | null; isM0: boolean; isPersonnel: boolean };

// 계약서 화면 진입 = M0(관장·부장·master) · hr 직무 · 인사 파일 열람(personnel).
//   ★ 2026-10 관장 결정: 직원별 계약(목록·내용·작성·보내기·PDF·센터장 서명 화면)은
//     인사 파일 열람 보유자만 — requireContractPersonnel. hr 직무·M0 권한등급만으로는
//     조항 문구·명절 날짜(직원 정보가 없는 서식) 편집까지만 합니다.
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
  const isPersonnel = !!(await resolvePersonnelViewer())?.isPersonnel;
  if (!isM0 && !roles.includes("hr") && !isPersonnel) return null;
  return { name: me.name.trim(), driverId, isM0, isPersonnel };
}

// 서식(조항 문구·명절 날짜)용 — 직원 정보가 없는 동작만 이 게이트로 엽니다.
export async function requireContractAdmin(): Promise<ContractAdmin> {
  const ctx = await resolveContractAdmin();
  if (!ctx) throw new Error("계약서 관리 권한이 없습니다. (관장·부장 또는 인사 담당자)");
  return ctx;
}

// 직원별 계약(목록·내용·작성·보내기·되돌리기·PDF·센터장 서명 화면) — 인사 파일 열람 보유자만.
export async function requireContractPersonnel(): Promise<ContractAdmin> {
  const ctx = await resolveContractAdmin();
  if (!ctx?.isPersonnel) throw new Error(PERSONNEL_DENIED);
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
      signDate: row.contract_date,
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

export function toSummary(
  kind: ContractKind,
  raw: Record<string, unknown>,
  name: string,
  dateChange: ContractSummary["date_change"] = null
): ContractSummary {
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
      paper: raw.signing_method === "paper",
      start_date: c.contract_start,
      date_change: dateChange,
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
    paper: c.signing_method === "paper",
    start_date: c.period_start,
    date_change: dateChange,
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
  const [names, changes] = await Promise.all([
    namesById([...new Set(rows.map((r) => String(r.driver_id)))]),
    dateChangeSummaries(kind),
  ]);
  return rows.map((r) =>
    toSummary(kind, r, names.get(String(r.driver_id)) ?? "(알 수 없음)", changes.get(String(r.id)) ?? null)
  );
}

// --- 계약일(contract_date) ------------------------------------------------
//   2026-10 관장 요청: 시스템 서명은 그날로만 찍히지만 실제로는 계약 시작일 무렵 날짜 등이
//   필요합니다. 계약서에 보이는 날짜는 contract_date 하나이고, 실제 서명 시각
//   (sent_at·employee_signed_at·employer_signed_at)은 어떤 경로로도 바꾸지 않습니다.
//   수정은 인사 파일 열람 보유자만(액션의 requireContractPersonnel), 사유를 contract_date_changes 에.
export type ContractDateChange = {
  old_date: string | null;
  new_date: string;
  reason: string;
  changed_by: string | null;
  changed_at: string;
};

const DATE_CHANGES = "contract_date_changes";

async function dateChangeSummaries(kind: ContractKind): Promise<Map<string, NonNullable<ContractSummary["date_change"]>>> {
  const out = new Map<string, NonNullable<ContractSummary["date_change"]>>();
  const { data, error } = await supabaseAdmin
    .from(DATE_CHANGES)
    .select("contract_id, old_date, reason, changed_at")
    .eq("contract_kind", kind)
    .order("changed_at", { ascending: true });
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as { contract_id: string; old_date: string | null; reason: string }[]) {
    const prev = out.get(r.contract_id);
    out.set(r.contract_id, {
      original: prev ? prev.original : r.old_date,
      reason: r.reason,
      count: (prev?.count ?? 0) + 1,
    });
  }
  return out;
}

export async function listContractDateChangesCore(kind: ContractKind, id: string): Promise<ContractDateChange[]> {
  const { data, error } = await supabaseAdmin
    .from(DATE_CHANGES)
    .select("old_date, new_date, reason, changed_by, changed_at")
    .eq("contract_kind", kind)
    .eq("contract_id", id)
    .order("changed_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ContractDateChange[];
}

const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

export async function setContractDateCore(
  kind: ContractKind,
  id: string,
  input: { date: string; reason: string },
  me: { name: string }
): Promise<Result<{ pdf: "regenerated" | "kept" | "none"; cardFile: boolean; note: string | null }>> {
  const date = String(input.date ?? "").trim();
  const reason = String(input.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!isYmd(date)) return { ok: false, message: "계약일을 YYYY-MM-DD 형식으로 입력해주세요." };
  if (!reason) return { ok: false, message: "계약일을 바꾸는 사유를 적어주세요." };

  const raw = await loadRow(kind, id, ", employee_signature");
  const w = workflowFields(raw);
  if (w.status === "void") return { ok: false, message: "무효 처리된 계약서는 계약일을 바꿀 수 없습니다." };
  if (w.contract_date === date) return { ok: false, message: "지금 계약일과 같은 날짜입니다." };

  // 이력을 먼저 남기고 날짜만 바꿉니다(실패하면 이력을 되돌림). 서명 시각 컬럼은 update 에 넣지 않습니다.
  const { data: log, error: logErr } = await supabaseAdmin
    .from(DATE_CHANGES)
    .insert({ contract_kind: kind, contract_id: id, old_date: w.contract_date, new_date: date, reason, changed_by: me.name })
    .select("id")
    .single();
  if (logErr || !log) throw new Error(logErr?.message ?? "계약일 변경 기록을 남기지 못했습니다.");
  const { error: upErr, count } = await supabaseAdmin
    .from(CONTRACT_KINDS[kind].table)
    .update({ contract_date: date }, { count: "exact" })
    .eq("id", id)
    .neq("status", "void");
  if (upErr || !count) {
    await supabaseAdmin.from(DATE_CHANGES).delete().eq("id", (log as { id: string }).id);
    if (upErr) throw new Error(upErr.message);
    return { ok: false, message: "이미 다른 곳에서 처리되었습니다. 새로고침해주세요." };
  }

  // 확정된 전자 계약서 — 새 계약일로 PDF 를 다시 만들고, 근로계약서는 카드 첨부도 같은 행에서 교체.
  //   종이 체결분은 원본 스캔이 본문이라 다시 만들지 않습니다(목록·표시 날짜만 바뀜).
  const paper = raw.signing_method === "paper";
  if (paper || !w.employer_signed_at || !w.has_pdf) return { ok: true, pdf: "none", cardFile: false, note: null };
  const signer = await loadEmployerImage(kind, w.driver_id, w.id);
  if (!signer) {
    return {
      ok: true,
      pdf: "kept",
      cardFile: false,
      note: "센터장 서명 이미지가 보관되기 전(2026-10 이전)에 체결된 건이라 PDF 는 다시 만들지 못했습니다. 목록·표시 날짜만 바뀌었습니다.",
    };
  }
  const bytes = await renderFinalPdf(kind, { ...raw, contract_date: date }, signer);
  const { error: pdfErr } = await supabaseAdmin.storage
    .from(HR_DOCUMENTS_BUCKET)
    .upload(contractPdfPath(kind, w.driver_id, w.id), Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
  if (pdfErr) throw new Error(`PDF 저장 실패: ${pdfErr.message}`);
  const cardFile = kind === "employment" ? await syncCardAttachment(raw, bytes) : false;
  return { ok: true, pdf: "regenerated", cardFile, note: null };
}

// 센터장 서명 이미지 — 체결 때 PDF 옆에 보관해 두고, 계약일을 고칠 때 같은 서명으로 다시 그립니다.
//   (2026-10 전 체결분은 보관본이 없습니다 — 기관 직인으로 체결했다면
//    scripts/backfill-contract-attachments.mts 의 --regen-seal 로 다시 만들 수 있습니다.)
export type EmployerImage = { bytes: Uint8Array; isSeal: boolean };

function employerImagePath(kind: ContractKind, driverId: string, id: string, isSeal: boolean, png: boolean): string {
  return contractPdfPath(kind, driverId, id).replace(/\.pdf$/, `.employer-${isSeal ? "seal" : "sign"}.${png ? "png" : "jpg"}`);
}

export async function saveEmployerImage(kind: ContractKind, driverId: string, id: string, img: EmployerImage): Promise<void> {
  const png = img.bytes[0] === 0x89 && img.bytes[1] === 0x50;
  const { error } = await supabaseAdmin.storage
    .from(HR_DOCUMENTS_BUCKET)
    .upload(employerImagePath(kind, driverId, id, img.isSeal, png), Buffer.from(img.bytes), {
      contentType: png ? "image/png" : "image/jpeg",
      upsert: true,
    });
  if (error) throw new Error(error.message);
}

async function loadEmployerImage(kind: ContractKind, driverId: string, id: string): Promise<EmployerImage | null> {
  for (const isSeal of [true, false]) {
    for (const png of [true, false]) {
      const { data } = await supabaseAdmin.storage
        .from(HR_DOCUMENTS_BUCKET)
        .download(employerImagePath(kind, driverId, id, isSeal, png));
      if (data) return { bytes: new Uint8Array(await data.arrayBuffer()), isSeal };
    }
  }
  return null;
}

// 확정본 PDF — 양쪽 서명 이미지 + 지금 행의 계약일.
export async function renderFinalPdf(kind: ContractKind, raw: Record<string, unknown>, signer: EmployerImage): Promise<Uint8Array> {
  const blocks = await blocksFor(kind, raw, true);
  return buildContractPdf(blocks, {
    employee: decodeDataUrl(typeof raw.employee_signature === "string" ? raw.employee_signature : null),
    employer: signer.bytes,
    employerIsSeal: signer.isSeal,
  });
}

// 체결 근로계약서 → 인사기록카드 '근로계약서' 칸(같은 행 교체, 없으면 새로 붙이고 계약에 연결).
//   실패해도 계약 체결·계약일 변경은 되돌리지 않습니다 — false 를 돌려 화면에 알립니다.
export async function syncCardAttachment(raw: Record<string, unknown>, bytes: Uint8Array): Promise<boolean> {
  try {
    const driverId = String(raw.driver_id);
    const id = String(raw.id);
    const names = await namesById([driverId]);
    const current = typeof raw.document_file_id === "string" && raw.document_file_id ? raw.document_file_id : null;
    const fileId = await putAutoContractFile({
      driverId,
      contractId: id,
      employeeName: names.get(driverId) ?? "",
      bytes,
      fileId: current,
    });
    if (fileId !== current) {
      const { error } = await supabaseAdmin.from("employment_contracts").update({ document_file_id: fileId }).eq("id", id);
      if (error) throw new Error(error.message);
    }
    return true;
  } catch (e) {
    console.warn("[contract] 인사기록카드 첨부 실패:", e instanceof Error ? e.message : e);
    return false;
  }
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
  // 인사기록카드에 자동으로 붙은 근로계약서는 카드에서 내립니다(파일·행은 남김).
  if (kind === "employment") {
    const { data } = await supabaseAdmin
      .from("employment_contracts")
      .select("driver_id, document_file_id")
      .eq("id", id)
      .maybeSingle();
    const r = data as { driver_id?: string; document_file_id?: string | null } | null;
    if (r?.driver_id && r.document_file_id) {
      try {
        await hideAutoContractFile(r.driver_id, r.document_file_id);
      } catch (e) {
        console.warn("[contract] 무효 — 카드 첨부 내리기 실패:", e instanceof Error ? e.message : e);
      }
    }
  }
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

// 센터장 서명 방식 — 기관 직인(기본) / 서명하는 사람의 저장 서명 / 직접 그린 서명.
//   관장 개인 도장은 계약서에 쓰지 않습니다(고용자는 '동래구청소년센터장' 직위 — 2026-10 관장 지시).
export type EmployerSignInput =
  | { mode: "seal" }
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
  if (input.mode === "seal") {
    employerImage = await loadOrgSeal();
    if (!employerImage) return { ok: false, message: "기관 직인이 등록되어 있지 않습니다. 기관 직인을 먼저 등록하세요(/hr/seal)." };
  } else if (input.mode === "saved") {
    const saved = me.driverId ? await readSavedSignature(me.driverId) : null;
    if (!saved) return { ok: false, message: "저장된 서명이 없습니다. 직접 그려주세요." };
    employerImage = decodeDataUrl(saved);
  } else if (input.mode === "drawn") {
    const checked = checkSignature(input.dataUrl);
    if (!checked.ok) return { ok: false, message: checked.message };
    employerImage = decodeDataUrl(checked.dataUrl);
    if (input.save && me.driverId) {
      await supabaseAdmin
        .from("employee_profiles")
        .update({ signature_data: checked.dataUrl, signature_updated_at: new Date().toISOString() })
        .eq("driver_id", me.driverId);
    }
  } else {
    // 예전 화면에 남아 있던 '관장 도장' 등, 더 이상 받지 않는 방식.
    return { ok: false, message: "서명 방식을 다시 선택해주세요. (새로고침 후 다시 시도)" };
  }

  if (!employerImage) return { ok: false, message: "서명 이미지를 읽지 못했습니다. 다시 시도해주세요." };
  // 계약일이 비어 있으면 오늘(KST)로 — 이미 정해 두었으면 덮어쓰지 않습니다.
  const contractDate = w.contract_date ?? kstToday();
  const signer: EmployerImage = { bytes: employerImage, isSeal: input.mode === "seal" };
  const bytes = await renderFinalPdf(kind, { ...raw, contract_date: contractDate }, signer);
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
    .update(
      { employer_signed_at: now, contract_pdf_url: path, ...(w.contract_date ? {} : { contract_date: contractDate }), ...extraCols },
      { count: "exact" }
    )
    .eq("id", id)
    .eq("status", "signed")
    .is("employer_signed_at", null);
  if (error) throw new Error(error.message);
  if (!count) return { ok: false, message: "이미 다른 곳에서 처리되었습니다. 새로고침해주세요." };

  // 계약일을 나중에 고칠 때 같은 서명으로 다시 그리도록 보관. 실패해도 체결은 그대로.
  try {
    await saveEmployerImage(kind, w.driver_id, w.id, signer);
  } catch (e) {
    console.warn("[contract] 센터장 서명 이미지 보관 실패:", e instanceof Error ? e.message : e);
  }
  // 전자 근로계약서 → 인사기록카드 자동 첨부(노미현 부장 요청). 연봉계약서는 칸이 없어 붙이지 않습니다.
  if (kind === "employment") await syncCardAttachment(raw, bytes);

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

async function storedPdf(raw: Record<string, unknown>): Promise<Uint8Array> {
  const path = typeof raw.contract_pdf_url === "string" ? raw.contract_pdf_url : null;
  if (!path) throw new Error("저장된 PDF 가 없습니다.");
  const { data, error } = await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).download(path);
  if (error || !data) throw new Error("저장된 PDF 를 읽지 못했습니다.");
  return new Uint8Array(await data.arrayBuffer());
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
    // 종이 체결분은 다시 그리지 않고 원본 스캔을 그대로 넣습니다.
    const one = await PDFDocument.load(
      toSummary(kind, raw, "").paper ? await storedPdf(raw) : await renderPreviewPdf(kind, raw)
    );
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
    ((data ?? []) as unknown as Record<string, unknown>[]).map(async (r) => {
      const s = toSummary(kind, r, me.name);
      return {
        ...s,
        // 주민번호는 가린 값(full=false). 전체 번호는 PDF 에만 들어갑니다.
        //   종이 체결분은 다시 그리지 않습니다 — 화면이 원본 스캔 PDF 를 받아 보여줍니다.
        blocks: s.paper ? [] : await blocksFor(kind, r, false),
      };
    })
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
    // 링크는 서명한 직원 것만 걸러 본 계약서 화면(?driver=) — 그 직원 탭·연도로 바로.
    let year: number | null = null;
    if (kind === "salary") {
      const { data: y } = await supabaseAdmin.from(CONTRACT_KINDS[kind].table).select("year").eq("id", id).maybeSingle();
      year = (y as { year?: number } | null)?.year ?? null;
    }
    const path = contractsPath({ tab: kind, year, driverId: me.id });
    const base = siteBaseUrl();
    await sendSlack(
      "SLACK_WEBHOOK_ADMIN",
      `✍️ ${me.name} 님이 ${CONTRACT_KINDS[kind].label}에 서명했습니다. 센터장 서명 대기 ${
        base ? slackLink(`${base}${path}`, `${me.name} 님 계약서 열기`) : `(${path})`
      }`
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

