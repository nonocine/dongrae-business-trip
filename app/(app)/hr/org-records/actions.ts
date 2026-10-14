"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  ORG_FILE_PARENT,
  ORG_RECORD_TABLE,
  addOrgRecordFile,
  canDeleteOrgRecord,
  orgRecordStoragePaths,
  removeStoragePaths,
  requireOrgRecordAccess,
  signOrgRecordPath,
} from "@/lib/orgRecordsServer";
import {
  AGREEMENT_STATUSES,
  ORG_FILE_KINDS,
  normalizeRecipientType,
  type AgreementStatus,
  type OrgFileKind,
  type OrgRecordFile,
  type OrgRecordKind,
} from "@/lib/orgRecords";

// =====================================================================
// 기관 대장 서버 액션 — /hr/org-records
//   * 권한: lib/orgRecordsServer 참고(조회·등록·수정 = 직원 누구나,
//     삭제 = 등록자 본인 또는 M0·hr). 모든 액션이 진입 시 재검증합니다.
//   * 거래처 연결(business_partner_id)은 읽기만 합니다 — 거래처 데이터는
//     건드리지 않습니다. 비공개 거래처는 관리자만 연결할 수 있습니다.
// =====================================================================

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const PATH = "/hr/org-records";
const trim = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymdOrNull = (v: unknown) => {
  const s = trim(v, 10);
  return YMD.test(s) ? s : null;
};
const uuidOrNull = (v: unknown) => {
  const s = trim(v, 100);
  return /^[0-9a-f-]{36}$/i.test(s) ? s : null;
};
const fail = (e: unknown, fallback: string) => ({
  ok: false as const,
  message: e instanceof Error ? e.message : fallback,
});

// 화면 보조 목록 — 거래처 이름 추천, 직원 선택.
export type PartnerOption = { id: string; name: string };
export type StaffOption = { driverId: string; name: string; resigned: boolean };

export async function listPartnerOptions(): Promise<PartnerOption[]> {
  const ctx = await requireOrgRecordAccess();
  let q = supabaseAdmin.from("business_partners").select("id, name").order("name");
  if (!ctx.isManager) q = q.eq("is_private", false);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: String(r.id), name: String(r.name) }));
}

export async function listStaffOptions(): Promise<StaffOption[]> {
  await requireOrgRecordAccess();
  const [{ data: drivers }, { data: profs }] = await Promise.all([
    supabaseAdmin.from("drivers").select("id, name").order("name"),
    supabaseAdmin.from("employee_profiles").select("driver_id, employment_status"),
  ]);
  const resigned = new Set(
    (profs ?? [])
      .filter((p) => (p as { employment_status?: string }).employment_status === "resigned")
      .map((p) => String((p as { driver_id: string }).driver_id)),
  );
  return (drivers ?? []).map((d) => ({
    driverId: String((d as { id: string }).id),
    name: String((d as { name: string }).name),
    resigned: resigned.has(String((d as { id: string }).id)),
  }));
}

async function partnerVisible(id: string, isManager: boolean): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("business_partners")
    .select("id, is_private")
    .eq("id", id)
    .maybeSingle();
  if (!data) return false;
  return isManager || (data as { is_private?: boolean }).is_private !== true;
}

async function driverName(id: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("drivers").select("name").eq("id", id).maybeSingle();
  return (data as { name?: string } | null)?.name ?? null;
}

async function upsert(
  kind: OrgRecordKind,
  id: string | null,
  row: Record<string, unknown>,
  createdBy: string,
): Promise<string> {
  const table = ORG_RECORD_TABLE[kind];
  if (id) {
    const { data: prev } = await supabaseAdmin.from(table).select("id").eq("id", id).maybeSingle();
    if (!prev) throw new Error("대상을 찾을 수 없습니다.");
    const { error } = await supabaseAdmin
      .from(table)
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return id;
  }
  const { data, error } = await supabaseAdmin
    .from(table)
    .insert({ ...row, created_by: createdBy })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
}

// =====================================================================
// 업무협약
// =====================================================================
export async function saveAgreement(fd: FormData): Promise<Result<{ id: string }>> {
  try {
    const ctx = await requireOrgRecordAccess();
    const partnerName = trim(fd.get("partner_name"), 200);
    if (!partnerName) return { ok: false, message: "기관명을 입력해주세요." };
    const agreedOn = ymdOrNull(fd.get("agreed_on"));
    if (!agreedOn) return { ok: false, message: "협약일을 입력해주세요." };
    const periodStart = ymdOrNull(fd.get("period_start"));
    const periodEnd = ymdOrNull(fd.get("period_end"));
    if (periodStart && periodEnd && periodStart > periodEnd) {
      return { ok: false, message: "협약 기간의 끝이 시작보다 빠릅니다." };
    }
    const statusRaw = trim(fd.get("status"), 20);
    const status: AgreementStatus = AGREEMENT_STATUSES.includes(statusRaw as AgreementStatus)
      ? (statusRaw as AgreementStatus)
      : "active";

    let partnerId = uuidOrNull(fd.get("business_partner_id"));
    if (partnerId && !(await partnerVisible(partnerId, ctx.isManager))) partnerId = null;
    const managerId = uuidOrNull(fd.get("manager_driver_id"));
    if (managerId && !(await driverName(managerId))) {
      return { ok: false, message: "담당 직원을 찾을 수 없습니다." };
    }

    const id = await upsert(
      "agreements",
      uuidOrNull(fd.get("id")),
      {
        partner_name: partnerName,
        business_partner_id: partnerId,
        agreed_on: agreedOn,
        content: trim(fd.get("content"), 2000) || null,
        period_start: periodStart,
        period_end: periodEnd,
        status,
        manager_driver_id: managerId,
        memo: trim(fd.get("memo"), 4000) || null,
      },
      ctx.name,
    );
    revalidatePath(PATH);
    return { ok: true, id };
  } catch (e) {
    return fail(e, "업무협약을 저장하지 못했습니다.");
  }
}

// =====================================================================
// 수상
// =====================================================================
export async function saveAward(fd: FormData): Promise<Result<{ id: string }>> {
  try {
    const ctx = await requireOrgRecordAccess();
    const awardName = trim(fd.get("award_name"), 300);
    if (!awardName) return { ok: false, message: "수상명을 입력해주세요." };
    const awardedBy = trim(fd.get("awarded_by"), 200);
    if (!awardedBy) return { ok: false, message: "수상기관을 입력해주세요." };
    const awardedOn = ymdOrNull(fd.get("awarded_on"));
    if (!awardedOn) return { ok: false, message: "수상일을 입력해주세요." };

    const recipientType = normalizeRecipientType(trim(fd.get("recipient_type"), 20));
    let recipientName = trim(fd.get("recipient_name"), 200) || null;
    let recipientDriverId: string | null = null;
    // 직원 수상이면 직원을 골라 이름을 함께 채웁니다(이름은 drivers 기준).
    if (recipientType === "staff") {
      recipientDriverId = uuidOrNull(fd.get("recipient_driver_id"));
      if (recipientDriverId) {
        const name = await driverName(recipientDriverId);
        if (!name) return { ok: false, message: "수상 직원을 찾을 수 없습니다." };
        recipientName = name;
      }
    }

    const id = await upsert(
      "awards",
      uuidOrNull(fd.get("id")),
      {
        award_name: awardName,
        recipient_name: recipientName,
        recipient_type: recipientType,
        recipient_driver_id: recipientDriverId,
        awarded_by: awardedBy,
        awarded_on: awardedOn,
        related_program: trim(fd.get("related_program"), 300) || null,
        memo: trim(fd.get("memo"), 4000) || null,
      },
      ctx.name,
    );
    revalidatePath(PATH);
    return { ok: true, id };
  } catch (e) {
    return fail(e, "수상 기록을 저장하지 못했습니다.");
  }
}

// =====================================================================
// 공통 — 건 삭제
//   첨부는 org_record_files FK cascade 로 행이 함께 지워지지만 Storage 파일은
//   남으므로, 먼저 경로를 모아 Storage 에서 지운 뒤 행을 지웁니다.
//   Storage 삭제가 실패하면 행도 지우지 않습니다(파일만 남는 일 방지).
// =====================================================================
function kindOf(v: string): OrgRecordKind | null {
  return v === "agreements" || v === "awards" ? v : null;
}

export async function deleteOrgRecord(kindRaw: string, id: string): Promise<Result> {
  try {
    const ctx = await requireOrgRecordAccess();
    const kind = kindOf(kindRaw);
    if (!kind || !id) return { ok: false, message: "대상이 없습니다." };
    const table = ORG_RECORD_TABLE[kind];
    const { data: prev } = await supabaseAdmin
      .from(table)
      .select("id, created_by")
      .eq("id", id)
      .maybeSingle();
    if (!prev) return { ok: false, message: "대상을 찾을 수 없습니다." };
    const row = prev as { created_by?: string | null };
    if (!canDeleteOrgRecord(row.created_by, ctx)) {
      return {
        ok: false,
        message: "본인이 등록한 기록만 삭제할 수 있습니다. (관장·부장·인사 담당자는 모두 가능)",
      };
    }
    await removeStoragePaths(await orgRecordStoragePaths(kind, id));
    const { error } = await supabaseAdmin.from(table).delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return fail(e, "삭제하지 못했습니다.");
  }
}

// =====================================================================
// 첨부 — 올리기·종류 바꾸기·삭제·열람
//   첨부는 '내용 수정'과 같은 급으로 봅니다: 그 건을 고칠 수 있는 직원(=누구나)이
//   올리고 지웁니다. 건 삭제 권한 규칙은 위 deleteOrgRecord 그대로입니다.
//   업로드는 한 번에 파일 하나 — 여러 장은 화면이 차례로 부릅니다
//   (Server Action 본문 한도 20MB 안에 들도록).
// =====================================================================
const fileKindOf = (v: unknown): OrgFileKind | null =>
  ORG_FILE_KINDS.includes(v as OrgFileKind) ? (v as OrgFileKind) : null;

async function recordExists(kind: OrgRecordKind, id: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from(ORG_RECORD_TABLE[kind]).select("id").eq("id", id).maybeSingle();
  return !!data;
}

async function loadFileRow(fileId: string) {
  const { data } = await supabaseAdmin
    .from("org_record_files")
    .select("id, file_path")
    .eq("id", fileId)
    .maybeSingle();
  return data as { id: string; file_path: string } | null;
}

export async function uploadOrgRecordFile(fd: FormData): Promise<Result<{ file: OrgRecordFile }>> {
  try {
    const ctx = await requireOrgRecordAccess();
    const kind = kindOf(String(fd.get("kind") ?? ""));
    const recordId = uuidOrNull(fd.get("recordId"));
    const fileKind = fileKindOf(fd.get("fileKind"));
    if (!kind || !recordId || !fileKind) return { ok: false, message: "대상이 없습니다." };
    if (!(await recordExists(kind, recordId))) return { ok: false, message: "대상을 찾을 수 없습니다." };
    const file = await addOrgRecordFile(kind, recordId, fileKind, fd.get("file"), ctx.name);
    revalidatePath(PATH);
    return { ok: true, file };
  } catch (e) {
    return fail(e, "첨부를 올리지 못했습니다.");
  }
}

export async function setOrgRecordFileKind(fileId: string, fileKind: string): Promise<Result> {
  try {
    await requireOrgRecordAccess();
    const k = fileKindOf(fileKind);
    if (!k || !(await loadFileRow(fileId))) return { ok: false, message: "첨부를 찾을 수 없습니다." };
    const { error } = await supabaseAdmin.from("org_record_files").update({ kind: k }).eq("id", fileId);
    if (error) throw new Error(error.message);
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return fail(e, "첨부 종류를 바꾸지 못했습니다.");
  }
}

export async function deleteOrgRecordFile(fileId: string): Promise<Result> {
  try {
    await requireOrgRecordAccess();
    const row = await loadFileRow(fileId);
    if (!row) return { ok: false, message: "첨부를 찾을 수 없습니다." };
    await removeStoragePaths([row.file_path]);
    const { error } = await supabaseAdmin.from("org_record_files").delete().eq("id", fileId);
    if (error) throw new Error(error.message);
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return fail(e, "첨부를 삭제하지 못했습니다.");
  }
}

// 한 건의 첨부 열람 링크(1시간) — 상세의 썸네일·열람에 씁니다.
export async function getOrgRecordFileUrls(
  kindRaw: string,
  recordId: string,
): Promise<Result<{ urls: Record<string, string> }>> {
  try {
    await requireOrgRecordAccess();
    const kind = kindOf(kindRaw);
    if (!kind || !recordId) return { ok: false, message: "대상이 없습니다." };
    const { data, error } = await supabaseAdmin
      .from("org_record_files")
      .select("id, file_path")
      .eq(ORG_FILE_PARENT[kind], recordId);
    if (error) throw new Error(error.message);
    const urls: Record<string, string> = {};
    await Promise.all(
      (data ?? []).map(async (r) => {
        const url = await signOrgRecordPath(String((r as { file_path: string }).file_path));
        if (url) urls[String((r as { id: string }).id)] = url;
      }),
    );
    return { ok: true, urls };
  } catch (e) {
    return fail(e, "첨부를 열지 못했습니다.");
  }
}
