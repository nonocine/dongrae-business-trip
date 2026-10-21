// =====================================================================
// 직원 인사기록 첨부서류 — 서버 공용(employee_document_files).
//   * 2026-10 노미현 부장 요청으로 서류당 1개(employee_profiles.documents jsonb)에서
//     한 행 = 한 파일로 바꿨습니다. jsonb 는 롤백용으로만 남고 앱은 읽지 않습니다.
//   * 서버 전용("use server" 아님). 권한은 각 액션 파일이 확인하고 driverId 를 넘깁니다
//     — 관리자(app/(app)/hr/actions.ts, records 영역) / 본인(app/(app)/profile/hr/actions.ts,
//     세션에서 도출한 내 driverId). 여기 쿼리는 모두 .eq("driver_id", driverId) 를 겁니다.
//   * 테이블은 RLS on·정책 0 → service_role.
//   * 파일: 비공개 hr-documents 버킷 employees/{driverId}/docs/{docKey}_{시각}_{난수}.{ext}
//     (이관분은 예전 경로 {docKey}.{ext} 그대로). 행을 지울 땐 Storage 파일도 지웁니다.
//   * 내려받기 이름은 lib/employeeDocs.employeeDocDownloadName — 서명 URL 에
//     &download= 를 직접 붙입니다(SDK download 옵션은 한글이 깨짐 — lib/mailAttachment.ts).
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { HR_DOCUMENTS_BUCKET } from "@/lib/supabase";
import {
  EMPLOYEE_DOC_EXT,
  EMPLOYEE_DOC_MAX_BYTES,
  employeeDocDownloadName,
  employeeDocSlot,
  type EmployeeDocFile,
  type EmployeeDocFiles,
} from "@/lib/employeeDocs";

const TABLE = "employee_document_files";
const SIGN_TTL_SEC = 3600;

export type DocResult = { ok: true } | { ok: false; message: string };

type FileRow = {
  id: string;
  doc_key: string;
  file_path: string;
  file_name: string | null;
  sort_order: number;
  created_at: string;
};

const extOf = (path: string) => {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
};

async function rowsFor(driverId: string, docKey?: string): Promise<FileRow[]> {
  let q = supabaseAdmin
    .from(TABLE)
    .select("id, doc_key, file_path, file_name, sort_order, created_at")
    .eq("driver_id", driverId);
  if (docKey) q = q.eq("doc_key", docKey);
  const { data, error } = await q
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as FileRow[];
}

export async function listEmployeeDocFiles(driverId: string): Promise<EmployeeDocFiles> {
  const out: EmployeeDocFiles = {};
  for (const r of await rowsFor(driverId)) {
    const f: EmployeeDocFile = {
      id: r.id,
      doc_key: r.doc_key,
      sort_order: r.sort_order,
      ext: extOf(r.file_path),
      file_name: r.file_name,
    };
    (out[r.doc_key] ??= []).push(f);
  }
  return out;
}

async function isLocked(driverId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("employee_profiles")
    .select("is_locked")
    .eq("driver_id", driverId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { is_locked?: unknown } | null)?.is_locked === true;
}

function newPath(driverId: string, docKey: string, ext: string): string {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `employees/${driverId}/docs/${docKey}_${stamp}_${rand}.${ext}`;
}

// 올리기. replaceId 를 주면 그 파일을 교체(자리 유지). 1개 서류는 늘 교체입니다.
export async function uploadEmployeeDocFile(input: {
  driverId: string;
  docKey: string;
  file: unknown;
  uploadedBy: string;
  replaceId?: string | null;
  lockedMessage: string;
}): Promise<DocResult> {
  const { driverId, docKey, file, uploadedBy } = input;
  const slot = employeeDocSlot(docKey);
  if (!slot) return { ok: false, message: "허용되지 않은 서류 종류입니다." };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "업로드할 파일을 선택해주세요." };
  }
  if (file.size > EMPLOYEE_DOC_MAX_BYTES) {
    return { ok: false, message: "파일 용량은 16MB 이하여야 합니다." };
  }
  const ext = EMPLOYEE_DOC_EXT[file.type];
  if (!ext) return { ok: false, message: "PDF, JPG, PNG, WEBP 형식만 업로드할 수 있습니다." };
  if (await isLocked(driverId)) return { ok: false, message: input.lockedMessage };

  const existing = await rowsFor(driverId, docKey);
  let target: FileRow | null = null;
  if (input.replaceId) {
    target = existing.find((r) => r.id === input.replaceId) ?? null;
    if (!target) return { ok: false, message: "교체할 파일을 찾지 못했습니다. 새로고침해주세요." };
  } else if (!slot.multiple) {
    target = existing[0] ?? null;
  }

  const path = newPath(driverId, docKey, ext);
  const { error: upErr } = await supabaseAdmin.storage
    .from(HR_DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { ok: false, message: `업로드 실패: ${upErr.message}` };

  const meta = {
    file_path: path,
    file_name: file.name || null,
    mime_type: file.type,
    size_bytes: file.size,
    uploaded_by: uploadedBy,
  };
  const { error: dbErr } = target
    ? await supabaseAdmin.from(TABLE).update(meta).eq("id", target.id).eq("driver_id", driverId)
    : await supabaseAdmin.from(TABLE).insert({
        ...meta,
        driver_id: driverId,
        doc_key: docKey,
        sort_order: existing.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1,
      });
  if (dbErr) {
    // 행이 안 생겼으면 방금 올린 파일을 남기지 않습니다.
    await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).remove([path]);
    throw new Error(dbErr.message);
  }

  // 교체: 옛 파일 정리. 1개 서류에 예전 데이터로 여러 행이 있으면 나머지도 정리.
  const stale = target ? [target] : [];
  if (!slot.multiple && !input.replaceId) stale.push(...existing.slice(1));
  if (stale.length > 0) {
    await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).remove(stale.map((r) => r.file_path));
    const extraIds = stale.filter((r) => r !== target).map((r) => r.id);
    if (extraIds.length > 0) {
      await supabaseAdmin.from(TABLE).delete().in("id", extraIds).eq("driver_id", driverId);
    }
  }
  return { ok: true };
}

// 지우기 — Storage 파일을 먼저 지우고, 성공했을 때만 행을 지웁니다
//   (행만 지워지고 파일이 남는 일이 없게).
export async function deleteEmployeeDocFile(input: {
  driverId: string;
  fileId: string;
  lockedMessage: string;
}): Promise<DocResult> {
  const { driverId, fileId } = input;
  if (!fileId) return { ok: false, message: "파일이 지정되지 않았습니다." };
  if (await isLocked(driverId)) return { ok: false, message: input.lockedMessage };
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, file_path")
    .eq("id", fileId)
    .eq("driver_id", driverId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: true };
  const path = String((data as { file_path: string }).file_path);
  const { error: rmErr } = await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).remove([path]);
  if (rmErr) return { ok: false, message: `파일 삭제 실패: ${rmErr.message}` };
  const { error: delErr } = await supabaseAdmin.from(TABLE).delete().eq("id", fileId).eq("driver_id", driverId);
  if (delErr) throw new Error(delErr.message);
  return { ok: true };
}

// 열기(브라우저 보기) / 내려받기(이름 자동) 서명 URL — 1시간.
export async function employeeDocFileUrl(input: {
  driverId: string;
  fileId: string;
  download: boolean;
}): Promise<string | null> {
  const { driverId, fileId } = input;
  if (!driverId || !fileId) return null;
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("doc_key, file_path")
    .eq("id", fileId)
    .eq("driver_id", driverId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { doc_key: string; file_path: string };
  const { data: signed, error: sErr } = await supabaseAdmin.storage
    .from(HR_DOCUMENTS_BUCKET)
    .createSignedUrl(row.file_path, SIGN_TTL_SEC);
  if (sErr || !signed) return null;
  if (!input.download) return signed.signedUrl;

  const [siblings, { data: drv }] = await Promise.all([
    rowsFor(driverId, row.doc_key),
    supabaseAdmin.from("drivers").select("name").eq("id", driverId).maybeSingle(),
  ]);
  const index = Math.max(0, siblings.findIndex((r) => r.id === fileId));
  const name = employeeDocDownloadName(
    employeeDocSlot(row.doc_key)?.label ?? row.doc_key,
    String((drv as { name?: unknown } | null)?.name ?? ""),
    extOf(row.file_path),
    index,
    siblings.length
  );
  // 서명 URL 에 이미 ?token=… 이 있으므로 & 로 잇습니다(lib/mailAttachment.ts 와 같은 이유).
  return `${signed.signedUrl}&download=${encodeURIComponent(name)}`;
}
