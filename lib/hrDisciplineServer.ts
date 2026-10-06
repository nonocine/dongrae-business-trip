// =====================================================================
// 상벌·경위서·인사위원회 서버 공용 — 게이트·행 변환·첨부·경위서 요청 보관
//   * 네 테이블(hr_awards·hr_disciplines·hr_incident_reports·hr_committees) 모두
//     RLS on·정책 0·anon 권한 0 → service_role 경유. 이 게이트가 유일한 방어선.
//   * 관리(열람·입력·수정) = M0(관장·부장·master)만. hr 직무는 통과시키지 않습니다
//     (관장 지시 — 증명서·계약서 게이트와 다름).
//   * 직원 본인 쪽은 contractServer.getMyDriver 로 세션의 나만 도출하고, 본인
//     쿼리는 "제출함·등록함" 확인에 필요한 칸만 select 합니다(내용·검토의견 제외).
//   * 서버 전용("use server" 아님).
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { HR_DOCUMENTS_BUCKET } from "@/lib/supabase";
import { isM0Grant } from "@/lib/authLevels";
import {
  isDisciplineKind,
  toAwardSource,
  type AwardRow,
  type CommitteeRow,
  type DisciplineRow,
  type IncidentRow,
} from "@/lib/hrDiscipline";

export type DisciplineAdmin = { name: string; driverId: string | null };

export async function resolveDisciplineAdmin(): Promise<DisciplineAdmin | null> {
  const me = await getSession();
  if (!me || me.kind !== "employee" || !me.name.trim()) return null;
  const g = await getGoogleSession();
  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("id, rank")
    .eq("name", me.name.trim())
    .maybeSingle();
  const driverId =
    driver && typeof (driver as { id?: unknown }).id === "string" ? String((driver as { id: string }).id) : null;
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
  if (!isM0Grant({ rank, email: g?.email, authLevel })) return null;
  return { name: me.name.trim(), driverId };
}

export async function requireDisciplineAdmin(): Promise<DisciplineAdmin> {
  const ctx = await resolveDisciplineAdmin();
  if (!ctx) throw new Error("상벌·인사위원회는 관장·부장만 볼 수 있습니다.");
  return ctx;
}

// --- 행 변환 -----------------------------------------------------------------
const str = (v: unknown) => (v == null || v === "" ? null : String(v));

export function toAward(r: Record<string, unknown>): AwardRow {
  return {
    id: String(r.id),
    driver_id: String(r.driver_id),
    award_source: toAwardSource(r.award_source),
    awarded_on: String(r.awarded_on ?? ""),
    title: String(r.title ?? ""),
    awarding_body: str(r.awarding_body),
    award_kind: str(r.award_kind),
    merit_summary: str(r.merit_summary),
    has_attachment: !!str(r.attachment_path),
    created_by: str(r.created_by),
    created_at: String(r.created_at ?? ""),
  };
}

export function toDiscipline(r: Record<string, unknown>): DisciplineRow {
  return {
    id: String(r.id),
    driver_id: String(r.driver_id),
    kind: isDisciplineKind(r.kind) ? r.kind : "warning",
    decided_on: String(r.decided_on ?? ""),
    effective_start: str(r.effective_start),
    effective_end: str(r.effective_end),
    reason: String(r.reason ?? ""),
    rule_basis: str(r.rule_basis),
    committee_id: str(r.committee_id),
    notified_on: str(r.notified_on),
    appeal_due_on: str(r.appeal_due_on),
    appeal_filed_on: str(r.appeal_filed_on),
    appeal_result: str(r.appeal_result),
    promotion_block_until: str(r.promotion_block_until),
    has_attachment: !!str(r.attachment_path),
    created_by: str(r.created_by),
    created_at: String(r.created_at ?? ""),
  };
}

export function toIncident(r: Record<string, unknown>, name: string): IncidentRow {
  return {
    id: String(r.id),
    driver_id: String(r.driver_id),
    driver_name: name,
    occurred_on: str(r.occurred_on),
    submitted_at: String(r.submitted_at ?? ""),
    subject: String(r.subject ?? ""),
    content: String(r.content ?? ""),
    has_attachment: !!str(r.attachment_path),
    requested_by: str(r.requested_by),
    reviewed_at: str(r.reviewed_at),
    reviewed_by: str(r.reviewed_by),
    review_note: str(r.review_note),
    discipline_id: str(r.discipline_id),
  };
}

export function toCommittee(r: Record<string, unknown>, targetName: string | null): CommitteeRow {
  const members = Array.isArray(r.members) ? (r.members as unknown[]).map((m) => String(m ?? "")).filter(Boolean) : [];
  return {
    id: String(r.id),
    held_on: String(r.held_on ?? ""),
    agenda_type: str(r.agenda_type),
    subject: String(r.subject ?? ""),
    members,
    target_driver_id: str(r.target_driver_id),
    target_name: targetName,
    resolution: str(r.resolution),
    note: str(r.note),
    has_attachment: !!str(r.attachment_path),
    created_by: str(r.created_by),
  };
}

export async function namesById(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return map;
  const { data } = await supabaseAdmin.from("drivers").select("id, name").in("id", uniq);
  for (const d of data ?? []) map.set(String((d as { id: string }).id), String((d as { name: string }).name));
  return map;
}

// --- 첨부 ---------------------------------------------------------------------
export const ATTACH_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};
export const ATTACH_MAX_BYTES = 16 * 1024 * 1024;

export type HrTable = "hr_awards" | "hr_disciplines" | "hr_incident_reports" | "hr_committees";
const DIR: Record<HrTable, string> = {
  hr_awards: "awards",
  hr_disciplines: "disciplines",
  hr_incident_reports: "incident-reports",
  hr_committees: "committees",
};

// 비공개 hr-documents/hr-discipline/{종류}/{행 id}_{시각}.{ext}. 파일 없으면 null.
export async function uploadAttachment(table: HrTable, rowId: string, file: unknown): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  const ext = ATTACH_EXT[file.type];
  if (!ext) throw new Error("첨부는 PDF·JPG·PNG 만 올릴 수 있습니다.");
  if (file.size > ATTACH_MAX_BYTES) throw new Error("첨부는 16MB 이하만 올릴 수 있습니다.");
  const path = `hr-discipline/${DIR[table]}/${rowId}_${Date.now()}.${ext}`;
  const { error } = await supabaseAdmin.storage
    .from(HR_DOCUMENTS_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) throw new Error(`첨부 업로드 실패: ${error.message}`);
  return path;
}

export async function removeAttachment(path: string | null | undefined): Promise<void> {
  if (!path) return;
  await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).remove([path]);
}

// 1시간 임시 열람 URL(관리자 액션에서만 부름).
export async function signAttachment(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).createSignedUrl(path, 3600);
  return error || !data ? null : data.signedUrl;
}

// --- 경위서 제출 요청(테이블 변경 없이 settings 에 보관) -----------------------------
//   요청은 아직 경위서 행이 없을 때 생깁니다(행은 직원이 제출할 때 만들어짐).
//   그래서 대기 중인 요청을 settings 키 하나에 {driverId: {by, at, note}} 로 두고,
//   직원이 제출하면 그 요청자를 requested_by 에 옮기고 대기 목록에서 지웁니다.
export const INCIDENT_REQUESTS_KEY = "hr_incident_requests";
export type PendingRequest = { by: string; at: string; note: string | null };

export async function readPendingRequests(): Promise<Record<string, PendingRequest>> {
  const { data } = await supabaseAdmin.from("settings").select("value").eq("key", INCIDENT_REQUESTS_KEY).maybeSingle();
  try {
    const raw = (data as { value?: string } | null)?.value;
    const o = raw ? (JSON.parse(raw) as Record<string, PendingRequest>) : {};
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

export async function writePendingRequests(map: Record<string, PendingRequest>): Promise<void> {
  if (Object.keys(map).length === 0) {
    await supabaseAdmin.from("settings").delete().eq("key", INCIDENT_REQUESTS_KEY);
    return;
  }
  const { error } = await supabaseAdmin
    .from("settings")
    .upsert({ key: INCIDENT_REQUESTS_KEY, value: JSON.stringify(map) }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}
