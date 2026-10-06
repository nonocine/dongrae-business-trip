// =====================================================================
// 근로계약서 서버 공용 — 권한·본인 확인·조항/당사자 로드·PDF 조립.
//   * 서버 전용("use server" 아님). 관리자 액션(/hr/contracts)과 직원 액션
//     (/profile/hr) 이 함께 씁니다.
//   * employment_contracts 는 RLS on·정책 0(anon 차단) → service_role 경유.
//     그래서 이 모듈의 게이트와 "driver_id = 세션의 나" 조건이 유일한 방어선입니다.
//     직원 쪽 조회는 화면에서 숨기는 게 아니라 쿼리에서 거릅니다(RSC 페이로드에
//     남의 계약서가 실리지 않게 — f44f0ef 와 같은 원칙).
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";
import { listRolesForDriver } from "@/lib/employeeRolesServer";
import { downloadHrImage, decodeDataUrl } from "@/lib/recruitmentApplicantDocData";
import {
  CONTRACT_CLAUSES_KEY,
  CONTRACT_ORG,
  clauseSnapshotKey,
  parseClauses,
  buildContractBlocks,
  hyphenRrn,
  maskRrn,
  kstYmd,
  isPngDataUrl,
  type ContractClauses,
  type ContractParty,
  type ContractTerms,
  type ContractBlock,
} from "@/lib/employmentContracts";
import { buildEmploymentContractPdf } from "@/lib/employmentContractPdf";

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
  if (!ctx) throw new Error("근로계약서 관리 권한이 없습니다. (관장·부장 또는 인사 담당자)");
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

// --- 조항 -------------------------------------------------------------
async function readSetting(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("settings").select("value").eq("key", key).maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  return v == null ? null : String(v);
}

export async function readCurrentClauses(): Promise<ContractClauses> {
  return parseClauses(await readSetting(CONTRACT_CLAUSES_KEY));
}

export async function writeCurrentClauses(c: ContractClauses): Promise<void> {
  const { error } = await supabaseAdmin
    .from("settings")
    .upsert({ key: CONTRACT_CLAUSES_KEY, value: JSON.stringify(c) }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

// 보낸 계약서는 보낸 시점 고정본. 작성 중이면 현행 문구.
export async function readClausesFor(contractId: string, status: string): Promise<ContractClauses> {
  if (status !== "draft") {
    const snap = await readSetting(clauseSnapshotKey(contractId));
    if (snap) return parseClauses(snap);
  }
  return readCurrentClauses();
}

export async function freezeClauses(contractId: string): Promise<void> {
  const current = await readCurrentClauses();
  const { error } = await supabaseAdmin
    .from("settings")
    .upsert({ key: clauseSnapshotKey(contractId), value: JSON.stringify(current) }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export async function dropClauseSnapshot(contractId: string): Promise<void> {
  await supabaseAdmin.from("settings").delete().eq("key", clauseSnapshotKey(contractId));
}

// --- 당사자 ------------------------------------------------------------
// full=true 는 PDF 전용(주민번호 전체). 화면에는 언제나 full=false(가림).
export async function loadParty(driverId: string, full: boolean): Promise<ContractParty> {
  const [{ data: drv }, { data: prof }] = await Promise.all([
    supabaseAdmin.from("drivers").select("name").eq("id", driverId).maybeSingle(),
    supabaseAdmin
      .from("employee_profiles")
      .select("resident_number, address")
      .eq("driver_id", driverId)
      .maybeSingle(),
  ]);
  const p = (prof ?? {}) as { resident_number?: string | null; address?: string | null };
  return {
    name: String((drv as { name?: string } | null)?.name ?? ""),
    rrn: full ? hyphenRrn(p.resident_number) : maskRrn(p.resident_number),
    address: (p.address ?? "").trim(),
  };
}

// 계약 행(+조항/당사자) → 블록. 화면·PDF 공용 진입점.
export async function blocksFor(
  row: ContractTerms & { id: string; driver_id: string; status: string; employee_signed_at: string | null },
  full: boolean
): Promise<ContractBlock[]> {
  const [party, clauses] = await Promise.all([
    loadParty(row.driver_id, full),
    readClausesFor(row.id, row.status),
  ]);
  return buildContractBlocks({
    terms: row,
    party,
    clauses,
    signDate: kstYmd(row.employee_signed_at),
  });
}

// --- 서명·도장 ---------------------------------------------------------
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

export async function renderContractPdf(
  blocks: ContractBlock[],
  employeeSignature: string | null,
  employerImage: Uint8Array | null
): Promise<Uint8Array> {
  return buildEmploymentContractPdf(blocks, {
    employee: decodeDataUrl(employeeSignature),
    employer: employerImage,
  });
}
