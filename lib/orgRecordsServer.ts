// =====================================================================
// 기관 대장(업무협약·수상) — 서버 전용 로더·권한·첨부.
//   * org_agreements·org_awards 는 RLS on(정책 0개) → service_role 경유만.
//     화면 액션·출력 라우트·MCP 가 모두 여기 로더를 씁니다.
//   * 권한(거래처관리와 같은 판정 — lib/directoryAccess):
//     - 조회·등록·수정: 로그인한 정식 직원 누구나.
//     - 삭제: 등록자 본인 또는 관리자(M0·hr). 거래처 거래이력과 같은 논리이며,
//       이관된 옛 데이터(created_by 없음)는 관리자만 지울 수 있습니다.
//   * 첨부: org_record_files(한 건에 여러 개). 파일은 비공개 hr-documents 버킷
//     org-records/{종류}/{행 id}/{시각}_{난수}.{ext}, 열람은 1시간 서명 URL —
//     상벌 첨부(lib/hrDisciplineServer)와 같은 방식.
//     org_agreements.file_path·org_awards.file_path 는 사용 중단(컬럼만 남김).
//   * 서버 전용 모듈("use server" 아님).
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { HR_DOCUMENTS_BUCKET } from "@/lib/supabase";
import {
  requireDirectoryAccess,
  resolveDirectoryAccess,
  type DirectoryAccess,
} from "@/lib/directoryAccess";
import {
  AGREEMENT_STATUSES,
  ORG_FILE_EXT,
  ORG_FILE_MAX_BYTES,
  normalizeOrgFileKind,
  normalizeRecipientType,
  sortOrgFiles,
  type OrgFileKind,
  type OrgRecordFile,
  type AgreementStatus,
  type OrgAgreement,
  type OrgAward,
  type OrgRecordKind,
} from "@/lib/orgRecords";

const WHAT = "기관 대장";

export type OrgRecordAccess = DirectoryAccess;

export async function resolveOrgRecordAccess(): Promise<OrgRecordAccess | null> {
  return resolveDirectoryAccess();
}
export async function requireOrgRecordAccess(): Promise<OrgRecordAccess> {
  return requireDirectoryAccess(WHAT);
}

// 삭제 가능 여부 — 관리자(M0·hr) 또는 등록자 본인.
export function canDeleteOrgRecord(
  createdBy: string | null | undefined,
  ctx: Pick<OrgRecordAccess, "isManager" | "name"> | null,
): boolean {
  if (!ctx) return false;
  if (ctx.isManager) return true;
  const owner = (createdBy ?? "").trim();
  return owner !== "" && owner === ctx.name.trim();
}

const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null || v === "" ? null : String(v));

// --- 로더 ----------------------------------------------------------------
//   ctx 가 null 이면(MCP 등) can_delete 는 모두 false 입니다.
export async function loadOrgAgreements(ctx: OrgRecordAccess | null): Promise<OrgAgreement[]> {
  const { data, error } = await supabaseAdmin
    .from("org_agreements")
    .select("*")
    .order("agreed_on", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, unknown>[];
  const [names, files] = await Promise.all([
    driverNames(rows.map((r) => str(r.manager_driver_id))),
    loadOrgRecordFiles("agreements"),
  ]);
  return rows.map((r) => {
    const status = AGREEMENT_STATUSES.includes(r.status as AgreementStatus)
      ? (r.status as AgreementStatus)
      : "active";
    const managerId = strOrNull(r.manager_driver_id);
    return {
      id: str(r.id),
      partner_name: str(r.partner_name),
      business_partner_id: strOrNull(r.business_partner_id),
      agreed_on: str(r.agreed_on).slice(0, 10),
      content: str(r.content),
      period_start: strOrNull(r.period_start),
      period_end: strOrNull(r.period_end),
      status,
      manager_driver_id: managerId,
      manager_name: managerId ? names.get(managerId) ?? null : null,
      files: files.get(str(r.id)) ?? [],
      memo: str(r.memo),
      created_by: strOrNull(r.created_by),
      can_delete: canDeleteOrgRecord(strOrNull(r.created_by), ctx),
    };
  });
}

export async function loadOrgAwards(ctx: OrgRecordAccess | null): Promise<OrgAward[]> {
  const { data, error } = await supabaseAdmin
    .from("org_awards")
    .select("*")
    .order("awarded_on", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const files = await loadOrgRecordFiles("awards");
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: str(r.id),
    award_name: str(r.award_name),
    recipient_name: strOrNull(r.recipient_name),
    recipient_type: normalizeRecipientType(r.recipient_type),
    recipient_driver_id: strOrNull(r.recipient_driver_id),
    awarded_by: str(r.awarded_by),
    awarded_on: str(r.awarded_on).slice(0, 10),
    related_program: str(r.related_program),
    files: files.get(str(r.id)) ?? [],
    memo: str(r.memo),
    created_by: strOrNull(r.created_by),
    can_delete: canDeleteOrgRecord(strOrNull(r.created_by), ctx),
  }));
}

async function driverNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return map;
  const { data } = await supabaseAdmin.from("drivers").select("id, name").in("id", uniq);
  for (const d of data ?? []) map.set(String((d as { id: string }).id), String((d as { name: string }).name));
  return map;
}

// --- 첨부(org_record_files) -------------------------------------------------
export const ORG_RECORD_TABLE: Record<OrgRecordKind, "org_agreements" | "org_awards"> = {
  agreements: "org_agreements",
  awards: "org_awards",
};
// org_record_files 의 부모 열 — 둘 중 정확히 하나만 채웁니다(DB check).
export const ORG_FILE_PARENT: Record<OrgRecordKind, "agreement_id" | "award_id"> = {
  agreements: "agreement_id",
  awards: "award_id",
};

function toOrgRecordFile(r: Record<string, unknown>): OrgRecordFile {
  return {
    id: str(r.id),
    kind: normalizeOrgFileKind(r.kind),
    file_name: str(r.file_name) || "첨부",
    mime_type: str(r.mime_type),
    size_bytes: typeof r.size_bytes === "number" ? r.size_bytes : null,
  };
}

// 종류별 전체 첨부를 부모 id 로 묶어 돌려줍니다(목록 한 번에 — N+1 회피).
async function loadOrgRecordFiles(kind: OrgRecordKind): Promise<Map<string, OrgRecordFile[]>> {
  const parent = ORG_FILE_PARENT[kind];
  const { data, error } = await supabaseAdmin
    .from("org_record_files")
    .select("id, agreement_id, award_id, kind, file_name, mime_type, size_bytes, sort_order, created_at")
    .not(parent, "is", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const map = new Map<string, OrgRecordFile[]>();
  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    const key = str(raw[parent]);
    const list = map.get(key);
    if (list) list.push(toOrgRecordFile(raw));
    else map.set(key, [toOrgRecordFile(raw)]);
  }
  for (const [k, v] of map) map.set(k, sortOrgFiles(v));
  return map;
}

// 한 파일 올리기 — Storage 업로드 후 행을 넣고, 행이 실패하면 파일을 되돌립니다.
export async function addOrgRecordFile(
  kind: OrgRecordKind,
  recordId: string,
  fileKind: OrgFileKind,
  file: unknown,
  uploadedBy: string,
): Promise<OrgRecordFile> {
  if (!(file instanceof File) || file.size === 0) throw new Error("파일이 비어 있습니다.");
  const ext = ORG_FILE_EXT[file.type];
  if (!ext) throw new Error(`'${file.name}' — 첨부는 PDF·JPG·PNG 만 올릴 수 있습니다.`);
  if (file.size > ORG_FILE_MAX_BYTES) throw new Error(`'${file.name}' — 첨부는 16MB 이하만 올릴 수 있습니다.`);

  const rand = Math.random().toString(36).slice(2, 8);
  const path = `org-records/${kind}/${recordId}/${Date.now()}_${rand}.${ext}`;
  const { error: upErr } = await supabaseAdmin.storage
    .from(HR_DOCUMENTS_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (upErr) throw new Error(`첨부 업로드 실패: ${upErr.message}`);

  const { count } = await supabaseAdmin
    .from("org_record_files")
    .select("id", { count: "exact", head: true })
    .eq(ORG_FILE_PARENT[kind], recordId);
  const { data, error } = await supabaseAdmin
    .from("org_record_files")
    .insert({
      [ORG_FILE_PARENT[kind]]: recordId,
      kind: fileKind,
      file_path: path,
      file_name: file.name.slice(0, 300),
      mime_type: file.type,
      size_bytes: file.size,
      sort_order: count ?? 0,
      uploaded_by: uploadedBy,
    })
    .select("id, kind, file_name, mime_type, size_bytes")
    .single();
  if (error) {
    await removeStoragePaths([path]);
    throw new Error(error.message);
  }
  return toOrgRecordFile(data as Record<string, unknown>);
}

// 한 건에 딸린 Storage 경로 전부 — 건 삭제 전에 모읍니다.
export async function orgRecordStoragePaths(kind: OrgRecordKind, recordId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("org_record_files")
    .select("file_path")
    .eq(ORG_FILE_PARENT[kind], recordId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((f) => str((f as { file_path?: unknown }).file_path)).filter(Boolean);
}

// Storage 삭제 — 실패하면 throw 해서 DB 만 지워지고 파일이 남는 일을 막습니다.
export async function removeStoragePaths(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).remove(paths);
  if (error) throw new Error(`첨부 파일 삭제 실패: ${error.message}`);
}

export async function signOrgRecordPath(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).createSignedUrl(path, 3600);
  return error || !data ? null : data.signedUrl;
}
