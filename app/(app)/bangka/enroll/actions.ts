"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireBangkaAccess, type BangkaAccess } from "@/lib/bangkaAccess";
import { inviteExpiresAt, INVITE_DAYS_DEFAULT } from "@/lib/saemInvite";
import { bkInviteMessage, isBkClassCode } from "@/lib/bangka";
import { kstTodayYmd } from "@/lib/trainings";
import {
  APP_STATUS_LABEL,
  DOC_KINDS,
  FAMILY_CHECK_TYPES,
  FIX_ITEM_LABEL,
  GRADES,
  GUARDIAN_RELATION_LABEL,
  isDocKindKey,
  normalizeData,
  normalizeSensitive,
  parseStops,
  chosenStop,
  type AllergyInfo,
  type AppStatus,
  type RecruitmentStatus,
  type ShuttleStop,
} from "@/lib/bangkaEnroll";
import {
  T_APPS,
  T_FILES,
  T_RECRUIT,
  acceptedRetentionUntil,
  actionMeta,
  bangkaBaseUrl,
  fixRequestMessage,
  logStaffAccess,
  rejectedRetentionUntil,
  sendEnrollSms,
} from "@/lib/bangkaEnrollServer";

// =====================================================================
// 신규 청소년 접수(모집) 직원 액션 — /bangka/enroll
//   * 전부 service_role. 접수 표는 RLS 정책 0개라 진입마다 requireBangkaAccess.
//   * 상태 흐름·보완요청·합격 처리는 설계 문서 2·7장 그대로.
//   * 상태 변경·보완요청·합격·민감정보 열람은 bk_application_access_logs 에 남깁니다.
// =====================================================================

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const BASE = "/bangka/enroll";

function fail(e: unknown, fallback: string): { ok: false; message: string } {
  return { ok: false, message: e instanceof Error ? e.message : fallback };
}
function cleanStr(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}
function revalidateApp(rid: string, aid?: string) {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/${rid}`);
  if (aid) revalidatePath(`${BASE}/${rid}/${aid}`);
}

// =====================================================================
// 모집 회차
// =====================================================================

export type RecruitmentRow = {
  id: string;
  title: string;
  apply_start_at: string;
  apply_end_at: string;
  capacity: number | null;
  target_grades: string[];
  status: RecruitmentStatus;
  notice: string | null;
  shuttle_stops: ShuttleStop[];
  retention_accepted_years: number;
  retention_rejected_months: number;
  consent_version: string;
  app_seq: number;
  created_at: string;
  updated_at: string;
};

export type RecruitmentListRow = RecruitmentRow & {
  counts: Record<string, number>; // 상태별 신청서 수
};

const RECRUIT_COLS =
  "id, title, apply_start_at, apply_end_at, capacity, target_grades, status, notice, shuttle_stops, retention_accepted_years, retention_rejected_months, consent_version, app_seq, created_at, updated_at";

function toRecruitment(r: Record<string, unknown>): RecruitmentRow {
  return {
    ...(r as unknown as RecruitmentRow),
    target_grades: Array.isArray(r.target_grades) ? (r.target_grades as string[]) : [],
    shuttle_stops: parseStops(r.shuttle_stops),
  };
}

export async function listRecruitments(): Promise<RecruitmentListRow[]> {
  await requireBangkaAccess();
  const { data, error } = await supabaseAdmin
    .from(T_RECRUIT)
    .select(RECRUIT_COLS)
    .order("apply_start_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as Record<string, unknown>[]).map(toRecruitment);
  if (rows.length === 0) return [];
  const { data: apps, error: e2 } = await supabaseAdmin
    .from(T_APPS)
    .select("recruitment_id, status")
    .in(
      "recruitment_id",
      rows.map((r) => r.id),
    );
  if (e2) throw new Error(e2.message);
  const counts = new Map<string, Record<string, number>>();
  for (const a of (apps ?? []) as { recruitment_id: string; status: string }[]) {
    const c = counts.get(a.recruitment_id) ?? {};
    c[a.status] = (c[a.status] ?? 0) + 1;
    counts.set(a.recruitment_id, c);
  }
  return rows.map((r) => ({ ...r, counts: counts.get(r.id) ?? {} }));
}

export async function getRecruitment(id: string): Promise<RecruitmentRow | null> {
  await requireBangkaAccess();
  const { data, error } = await supabaseAdmin.from(T_RECRUIT).select(RECRUIT_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toRecruitment(data as Record<string, unknown>) : null;
}

export type RecruitmentInput = {
  id?: string;
  title: string;
  apply_start_at: string; // ISO
  apply_end_at: string; // ISO
  capacity: number | null;
  target_grades: string[];
  status: RecruitmentStatus;
  notice: string;
  shuttle_stops: { time: string; place: string }[]; // 순서대로 — seq 는 서버가 1부터 매김
  retention_accepted_years: number;
  retention_rejected_months: number;
  consent_version: string;
};

const RECRUIT_STATUSES: RecruitmentStatus[] = ["draft", "open", "closed", "ended"];

export async function saveRecruitment(input: RecruitmentInput): Promise<Result<{ id: string; ended: number }>> {
  try {
    const me = await requireBangkaAccess();
    const title = cleanStr(input.title);
    if (!title || title.length > 100) return { ok: false, message: "회차 이름을 1~100자로 적어 주세요." };
    const start = new Date(input.apply_start_at);
    const end = new Date(input.apply_end_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
      return { ok: false, message: "접수 시작·마감 일시를 넣어 주세요." };
    if (start >= end) return { ok: false, message: "마감 일시가 시작 일시보다 뒤여야 합니다." };
    const capacity = input.capacity == null || Number.isNaN(Number(input.capacity)) ? null : Math.floor(Number(input.capacity));
    if (capacity != null && capacity < 0) return { ok: false, message: "정원은 0 이상이어야 합니다." };
    if (!RECRUIT_STATUSES.includes(input.status)) return { ok: false, message: "상태를 골라 주세요." };
    const years = Math.floor(Number(input.retention_accepted_years));
    const months = Math.floor(Number(input.retention_rejected_months));
    if (!(years >= 0 && years <= 10)) return { ok: false, message: "합격자 보관기간은 0~10년입니다." };
    if (!(months >= 0 && months <= 60)) return { ok: false, message: "불합격·대기 보관기간은 0~60개월입니다." };
    const consentVersion = cleanStr(input.consent_version);
    if (!consentVersion) return { ok: false, message: "동의서 버전을 적어 주세요." };
    const grades = GRADES.filter((g) => (input.target_grades ?? []).includes(g));
    const stops: ShuttleStop[] = [];
    for (const s of input.shuttle_stops ?? []) {
      const place = (s.place ?? "").trim();
      const time = (s.time ?? "").trim();
      if (!place && !time) continue;
      if (!place) return { ok: false, message: "귀가차량 정류장 장소를 적어 주세요(빈 줄은 지우세요)." };
      if (time && !/^\d{1,2}:\d{2}$/.test(time)) return { ok: false, message: `정류장 시간 "${time}" 은 18:10 처럼 적어 주세요.` };
      stops.push({ seq: stops.length + 1, time, place: place.slice(0, 100) });
    }

    const row = {
      title,
      apply_start_at: start.toISOString(),
      apply_end_at: end.toISOString(),
      capacity,
      target_grades: grades,
      status: input.status,
      notice: cleanStr(input.notice),
      shuttle_stops: stops,
      retention_accepted_years: years,
      retention_rejected_months: months,
      consent_version: consentVersion.slice(0, 40),
      updated_by: me.name,
      updated_at: new Date().toISOString(),
    };

    let id = input.id ?? "";
    let prevStatus: string | null = null;
    if (id) {
      const { data: prev } = await supabaseAdmin.from(T_RECRUIT).select("status").eq("id", id).maybeSingle();
      if (!prev) return { ok: false, message: "회차를 찾을 수 없습니다." };
      prevStatus = (prev as { status: string }).status;
      const { error } = await supabaseAdmin.from(T_RECRUIT).update(row).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabaseAdmin
        .from(T_RECRUIT)
        .insert({ ...row, created_by: me.name })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      id = String((data as { id: string }).id);
    }

    // 종료로 바꾸면 아직 결정 안 된 신청서(작성중 포함)의 보관기간 계산 시작 — 설계 7장 끝.
    let ended = 0;
    if (input.status === "ended" && prevStatus !== "ended") {
      const { data: upd, error } = await supabaseAdmin
        .from(T_APPS)
        .update({ retention_until: rejectedRetentionUntil(months), updated_at: new Date().toISOString() })
        .eq("recruitment_id", id)
        .neq("status", "accepted")
        .is("retention_until", null)
        .select("id");
      if (error) throw new Error(`보관기간 설정 실패: ${error.message}`);
      ended = (upd ?? []).length;
    }
    if (prevStatus !== null && prevStatus !== input.status) {
      await logStaffAccess(me, await actionMeta(), {
        recruitmentId: id,
        action: "recruitment_status",
        target: input.status,
        detail: { from: prevStatus, to: input.status, retention_set: ended },
      });
    }
    revalidatePath(BASE);
    revalidatePath(`${BASE}/${id}`);
    return { ok: true, id, ended };
  } catch (e) {
    return fail(e, "회차를 저장하지 못했습니다.");
  }
}

// =====================================================================
// 신청서 목록
// =====================================================================

export type ApplicationListRow = {
  id: string;
  app_no: string | null;
  youth_name: string | null;
  grade: string | null;
  school: string | null;
  priority_types: string[];
  status: AppStatus;
  submitted_at: string | null;
  resubmitted_at: string | null;
  created_at: string;
};

export async function listApplications(rid: string): Promise<ApplicationListRow[]> {
  await requireBangkaAccess();
  const { data, error } = await supabaseAdmin
    .from(T_APPS)
    .select("id, app_no, youth_name, grade, school, priority_types, status, submitted_at, resubmitted_at, created_at")
    .eq("recruitment_id", rid)
    .order("app_no", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ApplicationListRow[];
}

// =====================================================================
// 신청서 상세 — 민감정보(sensitive·민감 서류)는 여기서 내려보내지 않습니다([민감정보 보기] 액션으로만).
// =====================================================================

export type FileRow = {
  id: string;
  doc_kind: string;
  name: string | null;
  mime: string;
  size: number;
  status: "uploaded" | "confirmed" | "needs_fix";
  fix_reason: string | null;
  rrn_masked_checked: boolean;
  checked_by: string | null;
  checked_at: string | null;
  uploaded_at: string;
  purged_at: string | null;
};

export type RecommendationView = {
  id: string;
  recommender_name: string;
  recommender_phone: string;
  expires_at: string;
  sms_sent_at: string | null;
  state: "submitted" | "pending" | "expired" | "revoked";
  org: string | null;
  position: string | null;
  writer_name: string | null;
  writer_phone: string | null;
  reasons: string[];
  opinion: string | null;
  notes: string | null;
  has_signature: boolean;
  submitted_at: string | null;
  created_at: string;
};

export type ConsentRecordRow = {
  id: string;
  person_name: string | null;
  person_role: string;
  consent_key: string;
  agreed: boolean;
  doc_version: string;
  agreed_at: string;
  phone_last4: string | null;
};

export type AccessLogRow = {
  id: number;
  actor_type: string;
  actor_name: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
};

export type ApplicationDetail = {
  id: string;
  recruitment_id: string;
  app_no: string | null;
  guardian_phone: string;
  status: AppStatus;
  data: ReturnType<typeof normalizeData>;
  has_allergy: boolean | null;
  has_sensitive: boolean;
  has_photo: boolean;
  has_guardian_signature: boolean;
  has_youth_signature: boolean;
  fix_items: string[];
  fix_reason: string | null;
  fix_requested_at: string | null;
  fix_requested_by: string | null;
  submitted_at: string | null;
  resubmitted_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  student_id: string | null;
  guardian_id: string | null;
  staff_memo: string | null;
  retention_until: string | null;
  purged_at: string | null;
  created_at: string;
  updated_at: string;
  files: FileRow[]; // 민감 서류 제외
  sensitiveFileCount: number;
  sensitiveKindsWithFiles: string[];
  allFilesConfirmed: boolean; // 민감 서류 포함, 삭제된 파일 제외
  anyFileNeedsFix: boolean;
  recommendations: RecommendationView[];
  consents: ConsentRecordRow[];
  logs: AccessLogRow[];
  // 가족관계증명서로 확인(FAMILY_CHECK_TYPES) — 유형 키 → 가장 최근 기록
  familyChecks: Record<string, { checked: boolean; by: string | null; at: string }>;
};

const FILE_COLS =
  "id, doc_kind, name, mime, size, status, fix_reason, rrn_masked_checked, checked_by, checked_at, uploaded_at, purged_at";

const SENSITIVE_KINDS = DOC_KINDS.filter((d) => d.sensitive).map((d) => d.key);

export async function getApplicationDetail(rid: string, aid: string): Promise<ApplicationDetail | null> {
  await requireBangkaAccess();
  const { data: a, error } = await supabaseAdmin
    .from(T_APPS)
    .select(
      "id, recruitment_id, app_no, guardian_phone, status, data, has_allergy, sensitive, photo_path, guardian_signature_path, youth_signature_path, fix_items, fix_reason, fix_requested_at, fix_requested_by, submitted_at, resubmitted_at, decided_at, decided_by, student_id, guardian_id, staff_memo, retention_until, purged_at, created_at, updated_at",
    )
    .eq("id", aid)
    .eq("recruitment_id", rid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!a) return null;
  const app = a as Record<string, unknown>;

  const [filesRes, recsRes, consentsRes, logsRes, famRes] = await Promise.all([
    supabaseAdmin.from(T_FILES).select(FILE_COLS).eq("application_id", aid).order("uploaded_at", { ascending: true }),
    supabaseAdmin
      .from("bk_application_recommendations")
      .select(
        "id, recommender_name, recommender_phone, expires_at, sms_sent_at, org, position, writer_name, writer_phone, reasons, opinion, notes, signature_path, submitted_at, revoked_at, created_at",
      )
      .eq("application_id", aid)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("consent_records")
      .select("id, person_name, person_role, consent_key, agreed, doc_version, agreed_at, phone_last4")
      .eq("subject_type", "bk_application")
      .eq("subject_id", aid)
      .order("agreed_at", { ascending: false })
      .limit(200),
    supabaseAdmin
      .from("bk_application_access_logs")
      .select("id, actor_type, actor_name, action, target, detail, ip, created_at")
      .eq("application_id", aid)
      .order("created_at", { ascending: false })
      .limit(50),
    supabaseAdmin
      .from("bk_application_access_logs")
      .select("target, detail, actor_name, created_at")
      .eq("application_id", aid)
      .eq("action", "family_check")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(200),
  ]);
  for (const r of [filesRes, recsRes, consentsRes, logsRes, famRes]) if (r.error) throw new Error(r.error.message);
  const familyChecks: ApplicationDetail["familyChecks"] = {};
  for (const l of (famRes.data ?? []) as { target: string | null; detail: { checked?: unknown } | null; actor_name: string | null; created_at: string }[]) {
    if (!l.target || familyChecks[l.target]) continue; // 최근 것이 먼저
    familyChecks[l.target] = { checked: l.detail?.checked === true, by: l.actor_name, at: l.created_at };
  }

  const allFiles = (filesRes.data ?? []) as FileRow[];
  const live = allFiles.filter((f) => !f.purged_at);
  const nowMs = Date.now();
  const recs = ((recsRes.data ?? []) as (Record<string, unknown> & { signature_path: string | null })[]).map(
    ({ signature_path, revoked_at, ...r }) => {
      const submitted = !!r.submitted_at;
      const state: RecommendationView["state"] = submitted
        ? "submitted"
        : revoked_at
          ? "revoked"
          : new Date(String(r.expires_at)).getTime() <= nowMs
            ? "expired"
            : "pending";
      return {
        ...(r as unknown as Omit<RecommendationView, "state" | "has_signature">),
        reasons: Array.isArray(r.reasons) ? (r.reasons as string[]) : [],
        state,
        has_signature: !!signature_path,
      };
    },
  );

  return {
    id: String(app.id),
    recruitment_id: String(app.recruitment_id),
    app_no: (app.app_no as string | null) ?? null,
    guardian_phone: String(app.guardian_phone ?? ""),
    status: app.status as AppStatus,
    data: normalizeData(app.data),
    has_allergy: (app.has_allergy as boolean | null) ?? null,
    has_sensitive: app.sensitive != null,
    has_photo: !!app.photo_path,
    has_guardian_signature: !!app.guardian_signature_path,
    has_youth_signature: !!app.youth_signature_path,
    fix_items: Array.isArray(app.fix_items) ? (app.fix_items as string[]) : [],
    fix_reason: (app.fix_reason as string | null) ?? null,
    fix_requested_at: (app.fix_requested_at as string | null) ?? null,
    fix_requested_by: (app.fix_requested_by as string | null) ?? null,
    submitted_at: (app.submitted_at as string | null) ?? null,
    resubmitted_at: (app.resubmitted_at as string | null) ?? null,
    decided_at: (app.decided_at as string | null) ?? null,
    decided_by: (app.decided_by as string | null) ?? null,
    student_id: (app.student_id as string | null) ?? null,
    guardian_id: (app.guardian_id as string | null) ?? null,
    staff_memo: (app.staff_memo as string | null) ?? null,
    retention_until: (app.retention_until as string | null) ?? null,
    purged_at: (app.purged_at as string | null) ?? null,
    created_at: String(app.created_at),
    updated_at: String(app.updated_at),
    files: allFiles.filter((f) => !SENSITIVE_KINDS.includes(f.doc_kind)),
    sensitiveFileCount: allFiles.filter((f) => SENSITIVE_KINDS.includes(f.doc_kind)).length,
    sensitiveKindsWithFiles: [...new Set(allFiles.filter((f) => SENSITIVE_KINDS.includes(f.doc_kind)).map((f) => f.doc_kind))],
    allFilesConfirmed: live.length > 0 && live.every((f) => f.status === "confirmed"),
    anyFileNeedsFix: live.some((f) => f.status === "needs_fix"),
    recommendations: recs,
    consents: (consentsRes.data ?? []) as ConsentRecordRow[],
    logs: (logsRes.data ?? []) as AccessLogRow[],
    familyChecks,
  };
}

// [민감정보 보기] — 누를 때마다 view_sensitive 기록 후 알레르기 상세·민감 서류 목록을 돌려줍니다.
export async function revealSensitive(aid: string): Promise<
  Result<{ allergy: AllergyInfo | null; files: FileRow[] }>
> {
  try {
    const me = await requireBangkaAccess();
    const { data: a, error } = await supabaseAdmin
      .from(T_APPS)
      .select("id, recruitment_id, sensitive")
      .eq("id", aid)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!a) return { ok: false, message: "신청서를 찾을 수 없습니다." };
    const app = a as { id: string; recruitment_id: string; sensitive: unknown };
    const { data: files, error: fe } = await supabaseAdmin
      .from(T_FILES)
      .select(FILE_COLS)
      .eq("application_id", aid)
      .in("doc_kind", SENSITIVE_KINDS)
      .order("uploaded_at", { ascending: true });
    if (fe) throw new Error(fe.message);
    await logStaffAccess(me, await actionMeta(), {
      applicationId: aid,
      recruitmentId: app.recruitment_id,
      action: "view_sensitive",
      target: "sensitive",
      detail: { files: (files ?? []).length, allergy: app.sensitive != null },
    });
    return {
      ok: true,
      allergy: app.sensitive != null ? normalizeSensitive(app.sensitive).allergy : null,
      files: (files ?? []) as FileRow[],
    };
  } catch (e) {
    return fail(e, "민감정보를 불러오지 못했습니다.");
  }
}

// [가족관계증명서로 확인] — 표를 바꾸지 않고 열람 기록에 남깁니다(action family_check, 가장 최근 행이 현재 값).
export async function setFamilyCheck(input: { aid: string; type: string; checked: boolean }): Promise<Result> {
  try {
    const me = await requireBangkaAccess();
    if (!FAMILY_CHECK_TYPES.some((t) => t.key === input.type)) return { ok: false, message: "알 수 없는 유형입니다." };
    const { data: a, error } = await supabaseAdmin
      .from(T_APPS)
      .select("id, recruitment_id")
      .eq("id", input.aid)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!a) return { ok: false, message: "신청서를 찾을 수 없습니다." };
    const app = a as { id: string; recruitment_id: string };
    const saved = await logStaffAccess(me, await actionMeta(), {
      applicationId: app.id,
      recruitmentId: app.recruitment_id,
      action: "family_check",
      target: input.type,
      detail: { checked: !!input.checked },
    });
    if (!saved) return { ok: false, message: "확인 기록을 저장하지 못했습니다. 다시 눌러 주세요." };
    revalidateApp(app.recruitment_id, app.id);
    return { ok: true };
  } catch (e) {
    return fail(e, "저장하지 못했습니다.");
  }
}

// =====================================================================
// 서류 파일 확인·보완요청
// =====================================================================

async function loadFileWithApp(fid: string) {
  const { data, error } = await supabaseAdmin
    .from(T_FILES)
    .select("id, application_id, recruitment_id, doc_kind, status, rrn_masked_checked, purged_at")
    .eq("id", fid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as {
    id: string;
    application_id: string;
    recruitment_id: string;
    doc_kind: string;
    status: string;
    rrn_masked_checked: boolean;
    purged_at: string | null;
  } | null;
}

// 주민번호 뒷자리 가림 확인 칸.
export async function setRrnChecked(input: { fid: string; checked: boolean }): Promise<Result> {
  try {
    const me = await requireBangkaAccess();
    const f = await loadFileWithApp(input.fid);
    if (!f) return { ok: false, message: "파일을 찾을 수 없습니다." };
    const { error } = await supabaseAdmin
      .from(T_FILES)
      .update({ rrn_masked_checked: !!input.checked, checked_by: me.name, checked_at: new Date().toISOString() })
      .eq("id", f.id);
    if (error) throw new Error(error.message);
    await logStaffAccess(me, await actionMeta(), {
      applicationId: f.application_id,
      recruitmentId: f.recruitment_id,
      action: "file_check",
      target: f.id,
      detail: { doc_kind: f.doc_kind, rrn_masked_checked: !!input.checked },
    });
    revalidateApp(f.recruitment_id, f.application_id);
    return { ok: true };
  } catch (e) {
    return fail(e, "저장하지 못했습니다.");
  }
}

export async function confirmFile(fid: string): Promise<Result> {
  try {
    const me = await requireBangkaAccess();
    const f = await loadFileWithApp(fid);
    if (!f) return { ok: false, message: "파일을 찾을 수 없습니다." };
    if (f.purged_at) return { ok: false, message: "보관기간이 지나 삭제된 파일입니다." };
    if (!f.rrn_masked_checked)
      return { ok: false, message: "먼저 '주민번호 뒷자리 가림 확인'에 표시해 주세요." };
    const { error } = await supabaseAdmin
      .from(T_FILES)
      .update({ status: "confirmed", fix_reason: null, checked_by: me.name, checked_at: new Date().toISOString() })
      .eq("id", fid);
    if (error) throw new Error(error.message);
    await logStaffAccess(me, await actionMeta(), {
      applicationId: f.application_id,
      recruitmentId: f.recruitment_id,
      action: "file_check",
      target: f.id,
      detail: { doc_kind: f.doc_kind, from: f.status, to: "confirmed" },
    });
    revalidateApp(f.recruitment_id, f.application_id);
    return { ok: true };
  } catch (e) {
    return fail(e, "확인 처리하지 못했습니다.");
  }
}

const FIXABLE_STATUSES: AppStatus[] = ["submitted", "needs_fix", "docs_ok"];
const SECTION_FIX_KEYS = Object.keys(FIX_ITEM_LABEL); // youth, photo, guardian, priority, consent, extra, recommend

type FixOutcome = Result<{ smsError: string | null }>;

// 보완요청 공통 — 신청서 needs_fix + fix_items 추가(중복 없이) + 기록 + 문자.
async function applyFixRequest(
  me: BangkaAccess,
  aid: string,
  items: string[],
  reason: string,
  sendText: boolean,
  fileIds: string[],
): Promise<FixOutcome> {
  const { data: a, error } = await supabaseAdmin
    .from(T_APPS)
    .select("id, recruitment_id, status, fix_items, fix_reason, youth_name, guardian_phone")
    .eq("id", aid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!a) return { ok: false, message: "신청서를 찾을 수 없습니다." };
  const app = a as {
    id: string;
    recruitment_id: string;
    status: AppStatus;
    fix_items: string[] | null;
    fix_reason: string | null;
    youth_name: string | null;
    guardian_phone: string;
  };
  if (!FIXABLE_STATUSES.includes(app.status))
    return {
      ok: false,
      message: `'${APP_STATUS_LABEL[app.status] ?? app.status}' 상태에서는 보완요청을 할 수 없습니다.`,
    };

  const nowIso = new Date().toISOString();
  if (fileIds.length > 0) {
    const { error: fe } = await supabaseAdmin
      .from(T_FILES)
      .update({ status: "needs_fix", fix_reason: reason, checked_by: me.name, checked_at: nowIso })
      .in("id", fileIds)
      .eq("application_id", aid);
    if (fe) throw new Error(fe.message);
  }

  const merged = [...new Set([...(app.fix_items ?? []), ...items])];
  const fixReason =
    app.status === "needs_fix" && app.fix_reason && !app.fix_reason.includes(reason)
      ? `${app.fix_reason} / ${reason}`.slice(0, 1000)
      : reason;
  const { data: upd, error: ue } = await supabaseAdmin
    .from(T_APPS)
    .update({
      status: "needs_fix",
      fix_items: merged,
      fix_reason: fixReason,
      fix_requested_at: nowIso,
      fix_requested_by: me.name,
      updated_at: nowIso,
    })
    .eq("id", aid)
    .in("status", FIXABLE_STATUSES)
    .select("id");
  if (ue) throw new Error(ue.message);
  if (!upd || upd.length === 0) return { ok: false, message: "방금 상태가 바뀌었습니다. 새로고침해 주세요." };

  const meta = await actionMeta();
  if (app.status !== "needs_fix")
    await logStaffAccess(me, meta, {
      applicationId: aid,
      recruitmentId: app.recruitment_id,
      action: "status_change",
      target: "needs_fix",
      detail: { from: app.status, to: "needs_fix" },
    });

  let smsError: string | null = null;
  if (sendText) {
    const base = bangkaBaseUrl();
    if (!base) smsError = "BANGKA_BASE_URL 환경변수가 없어 문자를 보내지 못했습니다(보완요청은 저장됨).";
    else {
      const r = await sendEnrollSms({
        to: app.guardian_phone,
        text: fixRequestMessage(app.youth_name ?? "자녀", reason, base),
        sentBy: me.driverId,
        purpose: "방카 신규접수 보완요청",
      });
      if (!r.ok) smsError = `문자를 보내지 못했습니다(보완요청은 저장됨): ${r.error}`;
    }
  }
  await logStaffAccess(me, meta, {
    applicationId: aid,
    recruitmentId: app.recruitment_id,
    action: "fix_request",
    target: items.join(","),
    detail: { items, reason, files: fileIds, sms: sendText ? (smsError ? "failed" : "sent") : "skipped" },
  });
  revalidateApp(app.recruitment_id, aid);
  return { ok: true, smsError };
}

// 파일 하나 [보완요청(사유)].
export async function requestFileFix(input: { fid: string; reason: string; sendSms: boolean }): Promise<FixOutcome> {
  try {
    const me = await requireBangkaAccess();
    const reason = (input.reason ?? "").trim();
    if (!reason) return { ok: false, message: "보완 사유를 적어 주세요." };
    if (reason.length > 300) return { ok: false, message: "사유는 300자 안으로 적어 주세요." };
    const f = await loadFileWithApp(input.fid);
    if (!f) return { ok: false, message: "파일을 찾을 수 없습니다." };
    return await applyFixRequest(me, f.application_id, [`doc:${f.doc_kind}`], reason, input.sendSms !== false, [f.id]);
  } catch (e) {
    return fail(e, "보완요청을 저장하지 못했습니다.");
  }
}

// 항목(단계) 단위 보완요청 — youth·photo·guardian·priority·consent·extra·recommend·doc:<kind>.
export async function requestSectionFix(input: {
  aid: string;
  items: string[];
  reason: string;
  sendSms: boolean;
}): Promise<FixOutcome> {
  try {
    const me = await requireBangkaAccess();
    const reason = (input.reason ?? "").trim();
    if (!reason) return { ok: false, message: "보완 사유를 적어 주세요." };
    if (reason.length > 300) return { ok: false, message: "사유는 300자 안으로 적어 주세요." };
    const items = [
      ...new Set(
        (input.items ?? []).filter(
          (k) => SECTION_FIX_KEYS.includes(k) || (k.startsWith("doc:") && isDocKindKey(k.slice(4))),
        ),
      ),
    ];
    if (items.length === 0) return { ok: false, message: "보완할 항목을 하나 이상 골라 주세요." };
    return await applyFixRequest(me, input.aid, items, reason, input.sendSms !== false, []);
  } catch (e) {
    return fail(e, "보완요청을 저장하지 못했습니다.");
  }
}

// =====================================================================
// 상태 결정 — 서류확인 / 대기 / 불합격
// =====================================================================

const FROM_ALLOWED: Record<"docs_ok" | "waitlisted" | "rejected", AppStatus[]> = {
  docs_ok: ["submitted"],
  waitlisted: ["submitted", "docs_ok"],
  rejected: ["submitted", "docs_ok", "waitlisted"],
};

export async function setApplicationStatus(input: {
  aid: string;
  to: "docs_ok" | "waitlisted" | "rejected";
}): Promise<Result> {
  try {
    const me = await requireBangkaAccess();
    const to = input.to;
    if (!(to in FROM_ALLOWED)) return { ok: false, message: "바꿀 수 없는 상태입니다." };
    const { data: a, error } = await supabaseAdmin
      .from(T_APPS)
      .select("id, recruitment_id, status, bk_recruitments(retention_rejected_months)")
      .eq("id", input.aid)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!a) return { ok: false, message: "신청서를 찾을 수 없습니다." };
    const app = a as unknown as {
      id: string;
      recruitment_id: string;
      status: AppStatus;
      bk_recruitments: { retention_rejected_months: number } | null;
    };
    const allowed = FROM_ALLOWED[to];
    if (!allowed.includes(app.status))
      return {
        ok: false,
        message: `'${APP_STATUS_LABEL[app.status]}' 상태에서는 '${APP_STATUS_LABEL[to]}'(으)로 바꿀 수 없습니다.`,
      };

    if (to === "docs_ok") {
      const { data: files, error: fe } = await supabaseAdmin
        .from(T_FILES)
        .select("status")
        .eq("application_id", app.id)
        .is("purged_at", null);
      if (fe) throw new Error(fe.message);
      const list = (files ?? []) as { status: string }[];
      if (list.length === 0) return { ok: false, message: "올라온 서류가 없습니다." };
      if (!list.every((f) => f.status === "confirmed"))
        return { ok: false, message: "모든 서류를 [확인]해야 '서류확인'으로 바꿀 수 있습니다." };
    }

    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = { status: to, updated_at: nowIso };
    if (to === "waitlisted" || to === "rejected") {
      patch.decided_at = nowIso;
      patch.decided_by = me.name;
      patch.retention_until = rejectedRetentionUntil(app.bk_recruitments?.retention_rejected_months ?? 6);
    }
    const { data: upd, error: ue } = await supabaseAdmin
      .from(T_APPS)
      .update(patch)
      .eq("id", app.id)
      .eq("status", app.status)
      .select("id");
    if (ue) throw new Error(ue.message);
    if (!upd || upd.length === 0) return { ok: false, message: "방금 상태가 바뀌었습니다. 새로고침해 주세요." };
    await logStaffAccess(me, await actionMeta(), {
      applicationId: app.id,
      recruitmentId: app.recruitment_id,
      action: "status_change",
      target: to,
      detail: { from: app.status, to },
    });
    revalidateApp(app.recruitment_id, app.id);
    return { ok: true };
  } catch (e) {
    return fail(e, "상태를 바꾸지 못했습니다.");
  }
}

export async function saveStaffMemo(input: { aid: string; memo: string }): Promise<Result> {
  try {
    await requireBangkaAccess();
    const memo = (input.memo ?? "").trim().slice(0, 2000) || null;
    const { data, error } = await supabaseAdmin
      .from(T_APPS)
      .update({ staff_memo: memo, updated_at: new Date().toISOString() })
      .eq("id", input.aid)
      .select("recruitment_id");
    if (error) throw new Error(error.message);
    const rid = (data?.[0] as { recruitment_id?: string } | undefined)?.recruitment_id;
    if (rid) revalidateApp(rid, input.aid);
    return { ok: true };
  } catch (e) {
    return fail(e, "메모를 저장하지 못했습니다.");
  }
}

// =====================================================================
// 합격 처리 — 설계 7장
//   ① 신청서를 먼저 조건부로 accepted 로 바꿔 '잡아 둠'(두 번 눌러도 학생이 둘 생기지 않게)
//   ② 학생 생성 ③ 보호자 찾기/만들기 ④ 연결 ⑤ 신청서에 학생·보호자·보관기한 ⑥ 기록 ⑦ 문자
//   학생 생성이 실패하면 ①을 되돌립니다. REST 라 트랜잭션이 없습니다.
// =====================================================================

const ACCEPT_FROM: AppStatus[] = ["submitted", "docs_ok", "waitlisted"];

export async function acceptApplication(input: {
  aid: string;
  classCode: string;
  enrolledOn: string;
}): Promise<
  Result<{ newGuardian: boolean; smsError: string | null; inviteUrl: string | null; studentId: string }>
> {
  try {
    const me = await requireBangkaAccess();
    const base = bangkaBaseUrl();
    if (!base)
      return {
        ok: false,
        message: "BANGKA_BASE_URL 환경변수가 없어 초대 링크를 만들 수 없습니다(Vercel 환경변수 등록 필요).",
      };
    if (!isBkClassCode(input.classCode)) return { ok: false, message: "반을 고르세요(이음반/지음반)." };
    const enrolledOn = (input.enrolledOn ?? "").trim() || kstTodayYmd();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(enrolledOn)) return { ok: false, message: "입소일 형식이 올바르지 않습니다." };

    const { data: a, error } = await supabaseAdmin
      .from(T_APPS)
      .select(
        "id, recruitment_id, status, data, sensitive, guardian_phone, guardian_name, youth_name, student_id, bk_recruitments(shuttle_stops, retention_accepted_years)",
      )
      .eq("id", input.aid)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!a) return { ok: false, message: "신청서를 찾을 수 없습니다." };
    const app = a as unknown as {
      id: string;
      recruitment_id: string;
      status: AppStatus;
      data: unknown;
      sensitive: unknown;
      guardian_phone: string;
      guardian_name: string | null;
      youth_name: string | null;
      student_id: string | null;
      bk_recruitments: { shuttle_stops: unknown; retention_accepted_years: number } | null;
    };
    if (app.student_id) return { ok: false, message: "이미 합격 처리된 신청서입니다." };
    // 지난번 합격 처리가 중간(보호자·연결 단계)에 실패한 경우 — 같은 버튼으로 이어서 마칩니다.
    const resuming = app.status === "accepted";
    if (!resuming && !ACCEPT_FROM.includes(app.status))
      return { ok: false, message: `'${APP_STATUS_LABEL[app.status]}' 상태에서는 합격 처리할 수 없습니다.` };

    const d = normalizeData(app.data);
    const youthName = (app.youth_name ?? d.youth.name).trim();
    if (!youthName) return { ok: false, message: "청소년 이름이 비어 있습니다." };
    const guardianName = (app.guardian_name ?? d.guardian.name).trim() || "보호자";

    // ① 잡아 두기
    const nowIso = new Date().toISOString();
    if (!resuming) {
      const { data: claimed, error: ce } = await supabaseAdmin
        .from(T_APPS)
        .update({ status: "accepted", decided_at: nowIso, decided_by: me.name, updated_at: nowIso })
        .eq("id", app.id)
        .eq("status", app.status)
        .is("student_id", null)
        .select("id");
      if (ce) throw new Error(ce.message);
      if (!claimed || claimed.length === 0)
        return { ok: false, message: "방금 다른 사람이 처리했습니다. 새로고침해 주세요." };
    }

    const revert = async () => {
      if (resuming) return;
      await supabaseAdmin
        .from(T_APPS)
        .update({ status: app.status, decided_at: null, decided_by: null, updated_at: new Date().toISOString() })
        .eq("id", app.id)
        .is("student_id", null);
    };

    // ② 학생 — 이어서 하는 경우 이미 만든 학생(application_id)을 씁니다.
    let prevStudentId: string | null = null;
    if (resuming) {
      const { data: prev } = await supabaseAdmin
        .from("bk_students")
        .select("id")
        .eq("application_id", app.id)
        .limit(1)
        .maybeSingle();
      prevStudentId = (prev as { id: string } | null)?.id ?? null;
    }
    const stops = parseStops(app.bk_recruitments?.shuttle_stops);
    const stop = chosenStop(stops, d.ret);
    const allergy = app.sensitive != null ? normalizeSensitive(app.sensitive).allergy : null;
    const { data: st, error: se } = prevStudentId
      ? { data: { id: prevStudentId }, error: null }
      : await supabaseAdmin
          .from("bk_students")
          .insert({
            name: youthName,
            school: cleanStr(d.youth.school),
            grade: cleanStr(d.youth.grade),
            school_class: cleanStr((d.youth.class_no ?? "").replace(/반\s*$/, "")),
            class_code: input.classCode,
            birth_date: /^\d{4}-\d{2}-\d{2}$/.test(d.youth.birth) ? d.youth.birth : null,
            gender: d.youth.gender === "M" || d.youth.gender === "F" ? d.youth.gender : null,
            enrolled_on: enrolledOn,
            return_method: d.ret.method || null,
            return_note: d.ret.method === "other" ? cleanStr(d.ret.other) : null,
            shuttle_stop: stop,
            allergy_info: allergy,
            application_id: app.id,
          })
          .select("id")
          .single();
    if (se || !st) {
      await revert();
      return { ok: false, message: `학생을 만들지 못했습니다: ${se?.message ?? "알 수 없는 오류"}` };
    }
    const studentId = String((st as { id: string }).id);

    // ③ 보호자 — 번호가 같으면 그 보호자(상태·PIN 그대로), 없으면 invited + 초대 토큰(14일).
    const phone = (app.guardian_phone ?? "").replace(/\D/g, "");
    let guardianId: string;
    let newGuardian = false;
    let inviteUrl: string | null = null;
    let inviteExpires: string | null = null;
    let guardianStatus = "invited";
    const { data: existing } = await supabaseAdmin
      .from("bk_guardians")
      .select("id, name, status")
      .eq("phone", phone)
      .maybeSingle();
    if (existing) {
      guardianId = String((existing as { id: string }).id);
      guardianStatus = String((existing as { status: string }).status);
    } else {
      const token = randomBytes(24).toString("hex");
      inviteExpires = inviteExpiresAt(INVITE_DAYS_DEFAULT);
      const { data: g, error: ge } = await supabaseAdmin
        .from("bk_guardians")
        .insert({
          name: guardianName,
          phone,
          relation: GUARDIAN_RELATION_LABEL[d.guardian.relation] ?? null,
          status: "invited",
          invite_token: token,
          invite_expires_at: inviteExpires,
          must_change_pin: true,
        })
        .select("id")
        .single();
      if (ge || !g) {
        // 동시에 같은 번호가 생겼으면 그 행에 연결만.
        const { data: again } = await supabaseAdmin
          .from("bk_guardians")
          .select("id, status")
          .eq("phone", phone)
          .maybeSingle();
        if (!again) throw new Error(`보호자를 만들지 못했습니다(학생은 만들어짐): ${ge?.message ?? ""}`);
        guardianId = String((again as { id: string }).id);
        guardianStatus = String((again as { status: string }).status);
        inviteExpires = null;
      } else {
        guardianId = String((g as { id: string }).id);
        newGuardian = true;
        inviteUrl = `${base}/invite/${token}`;
      }
    }

    // ④ 연결
    const { error: le } = await supabaseAdmin
      .from("bk_guardian_students")
      .upsert(
        { guardian_id: guardianId, student_id: studentId, is_primary: true },
        { onConflict: "guardian_id,student_id", ignoreDuplicates: true },
      );
    if (le) throw new Error(`보호자 연결 실패(학생은 만들어짐): ${le.message}`);

    // ⑤ 신청서
    const retention = acceptedRetentionUntil(app.bk_recruitments?.retention_accepted_years ?? 3);
    const { error: ue } = await supabaseAdmin
      .from(T_APPS)
      .update({ student_id: studentId, guardian_id: guardianId, retention_until: retention, updated_at: new Date().toISOString() })
      .eq("id", app.id);
    if (ue) throw new Error(`신청서 갱신 실패(학생·보호자는 만들어짐): ${ue.message}`);

    // ⑦ 문자
    let smsError: string | null = null;
    if (guardianStatus === "suspended") {
      smsError = "정지된 보호자라 문자를 보내지 않았습니다(학생 연결은 됨). 학생·보호자 관리에서 정지 해제하세요.";
    } else {
      const text = newGuardian
        ? bkInviteMessage({ guardianName, url: inviteUrl!, expiresAt: inviteExpires! })
        : `[동래구청소년센터 방과후아카데미] ${guardianName}님, 자녀(${youthName})가 동래방카에 추가되었습니다. 앱에서 확인해 주세요. ${base}`;
      const r = await sendEnrollSms({
        to: phone,
        text,
        sentBy: me.driverId,
        purpose: newGuardian ? "방카 신규접수 합격(가입 초대)" : "방카 신규접수 합격(자녀 추가)",
      });
      if (!r.ok) smsError = `문자를 보내지 못했습니다(합격 처리는 완료): ${r.error}`;
    }

    // ⑥ 기록
    const meta = await actionMeta();
    await logStaffAccess(me, meta, {
      applicationId: app.id,
      recruitmentId: app.recruitment_id,
      action: "status_change",
      target: "accepted",
      detail: { from: app.status, to: "accepted" },
    });
    await logStaffAccess(me, meta, {
      applicationId: app.id,
      recruitmentId: app.recruitment_id,
      action: "accept",
      target: studentId,
      detail: {
        student_id: studentId,
        guardian_id: guardianId,
        new_guardian: newGuardian,
        class_code: input.classCode,
        enrolled_on: enrolledOn,
        sms: smsError ? "failed" : "sent",
      },
    });

    revalidateApp(app.recruitment_id, app.id);
    revalidatePath("/bangka/members");
    revalidatePath("/bangka/members/guardians");
    return { ok: true, newGuardian, smsError, inviteUrl: smsError ? inviteUrl : null, studentId };
  } catch (e) {
    return fail(e, "합격 처리하지 못했습니다.");
  }
}
