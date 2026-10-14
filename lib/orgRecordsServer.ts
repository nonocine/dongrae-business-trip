// =====================================================================
// 기관 대장(업무협약·수상) — 서버 전용 로더·권한·첨부.
//   * org_agreements·org_awards 는 RLS on(정책 0개) → service_role 경유만.
//     화면 액션·출력 라우트·MCP 가 모두 여기 로더를 씁니다.
//   * 권한(거래처관리와 같은 판정 — lib/directoryAccess):
//     - 조회·등록·수정: 로그인한 정식 직원 누구나.
//     - 삭제: 등록자 본인 또는 관리자(M0·hr). 거래처 거래이력과 같은 논리이며,
//       이관된 옛 데이터(created_by 없음)는 관리자만 지울 수 있습니다.
//   * 첨부: 비공개 hr-documents 버킷 org-records/{종류}/{행 id}_{시각}.{ext},
//     열람은 1시간 서명 URL — 상벌 첨부(lib/hrDisciplineServer)와 같은 방식.
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
  normalizeRecipientType,
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
  const names = await driverNames(rows.map((r) => str(r.manager_driver_id)));
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
      has_file: !!r.file_path,
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
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: str(r.id),
    award_name: str(r.award_name),
    recipient_name: strOrNull(r.recipient_name),
    recipient_type: normalizeRecipientType(r.recipient_type),
    recipient_driver_id: strOrNull(r.recipient_driver_id),
    awarded_by: str(r.awarded_by),
    awarded_on: str(r.awarded_on).slice(0, 10),
    related_program: str(r.related_program),
    has_file: !!r.file_path,
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

// --- 첨부 ----------------------------------------------------------------
export const ORG_FILE_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};
export const ORG_FILE_MAX_BYTES = 16 * 1024 * 1024;

export const ORG_RECORD_TABLE: Record<OrgRecordKind, "org_agreements" | "org_awards"> = {
  agreements: "org_agreements",
  awards: "org_awards",
};

export async function uploadOrgRecordFile(
  kind: OrgRecordKind,
  rowId: string,
  file: unknown,
): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  const ext = ORG_FILE_EXT[file.type];
  if (!ext) throw new Error("첨부는 PDF·JPG·PNG 만 올릴 수 있습니다.");
  if (file.size > ORG_FILE_MAX_BYTES) throw new Error("첨부는 16MB 이하만 올릴 수 있습니다.");
  const path = `org-records/${kind}/${rowId}_${Date.now()}.${ext}`;
  const { error } = await supabaseAdmin.storage
    .from(HR_DOCUMENTS_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) throw new Error(`첨부 업로드 실패: ${error.message}`);
  return path;
}

export async function removeOrgRecordFile(path: string | null | undefined): Promise<void> {
  if (!path) return;
  await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).remove([path]);
}

export async function signOrgRecordFile(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).createSignedUrl(path, 3600);
  return error || !data ? null : data.signedUrl;
}
