// =====================================================================
// 신규 청소년 온라인 접수(모집) — 서버 전용 도우미(동업자씨 직원 쪽)
//   설계: docs/설계_방카신규접수.md · DB: supabase/migrations/bk_enroll_apply.sql
//   * bk_* 접수 표는 RLS on·정책 0개 → service_role(supabaseAdmin)로만 읽고 씁니다.
//     접근 게이트는 lib/bangkaAccess 하나뿐이라 부르는 쪽(액션·라우트)이 매번 확인합니다.
//   * "use server" 아님 — 서버 액션/라우트/Cron 이 import 합니다.
//   ⚠️ 전화번호는 로그·콘솔에 남기지 않습니다(문자 이력에도 인원 수만).
// =====================================================================

import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendSms } from "@/lib/sms/relay";
import { SMS_LOG_TABLE } from "@/lib/sms/logs";
import { smsMsgType } from "@/lib/sms/text";
import { ENROLL_BUCKET } from "@/lib/bangkaEnroll";
import type { BangkaAccess } from "@/lib/bangkaAccess";

export const T_RECRUIT = "bk_recruitments";
export const T_APPS = "bk_applications";
export const T_FILES = "bk_application_files";
export const T_RECS = "bk_application_recommendations";
export const T_LOGS = "bk_application_access_logs";
export const T_CONSENTS = "consent_records";
export const T_OTPS = "bk_application_otps";

export const ENROLL_SENDER = "0519880924";
export const SIGNED_URL_SECONDS = 300; // 직원 열람 — 5분 서명 URL

// 동래방카 주소 — 없으면 null(틀린 링크를 보내지 않도록 기본값 없음). members/actions 와 같은 규칙.
export function bangkaBaseUrl(): string | null {
  const v = (process.env.BANGKA_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return v || null;
}

// --- 요청 정보(ip·user-agent) -------------------------------------------
export type ReqMeta = { ip: string | null; userAgent: string | null };

export function metaFromHeaders(h: Headers): ReqMeta {
  const xff = h.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const ua = h.get("user-agent");
  return { ip, userAgent: ua ? ua.slice(0, 400) : null };
}

// 서버 액션 안에서 — next/headers 는 비동기입니다.
export async function actionMeta(): Promise<ReqMeta> {
  return metaFromHeaders(await headers());
}

// --- 열람·변경 기록 -------------------------------------------------------
export type AccessLogInput = {
  applicationId?: string | null;
  recruitmentId?: string | null;
  action: string;
  target?: string | null;
  detail?: Record<string, unknown> | null;
};

// 직원 기록 — 기록 실패는 화면 동작을 막지 않되 콘솔에 남깁니다.
export async function logStaffAccess(
  who: Pick<BangkaAccess, "driverId" | "name">,
  meta: ReqMeta,
  input: AccessLogInput,
): Promise<boolean> {
  return insertLogs([
    {
      application_id: input.applicationId ?? null,
      recruitment_id: input.recruitmentId ?? null,
      actor_type: "staff",
      actor_id: who.driverId,
      actor_name: who.name,
      action: input.action,
      target: input.target ?? null,
      detail: input.detail ?? null,
      ip: meta.ip,
      user_agent: meta.userAgent,
    },
  ]);
}

// 성공 여부를 돌려줍니다(기록 자체가 값인 family_check 는 실패를 화면에 알림).
export async function insertLogs(rows: Record<string, unknown>[]): Promise<boolean> {
  if (rows.length === 0) return true;
  const { error } = await supabaseAdmin.from(T_LOGS).insert(rows);
  if (error) console.error(`[bk-enroll] 열람 기록 실패: ${error.message}`);
  return !error;
}

// --- 서명 URL(비공개 버킷) -------------------------------------------------
//   download 는 createSignedUrl 옵션 대신 직접 붙입니다(한글 이름 이중 인코딩 — lib/mailAttachment 참고).
export async function signedFileUrl(
  path: string,
  opts: { download?: boolean; name?: string | null } = {},
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(ENROLL_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) return null;
  if (!opts.download) return data.signedUrl;
  const name = (opts.name ?? "").trim() || path.split("/").pop() || "file";
  return `${data.signedUrl}${data.signedUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`;
}

// --- 보관기간 --------------------------------------------------------------
// 합격: 결정한 해(KST) 12/31 23:59:59 KST + N년.
export function acceptedRetentionUntil(years: number, nowMs = Date.now()): string {
  const kstYear = new Date(nowMs + 9 * 3600 * 1000).getUTCFullYear();
  // 12/31 23:59:59 KST = 12/31 14:59:59 UTC
  return new Date(Date.UTC(kstYear + Math.max(0, years), 11, 31, 14, 59, 59)).toISOString();
}

// 대기·불합격·미결정: 지금 + N개월(월말 넘침은 그 달 말일로).
export function rejectedRetentionUntil(months: number, nowMs = Date.now()): string {
  const d = new Date(nowMs);
  const day = d.getUTCDate();
  const t = new Date(d);
  t.setUTCDate(1);
  t.setUTCMonth(t.getUTCMonth() + Math.max(0, months));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString();
}

// --- 문자 -----------------------------------------------------------------
//   sms-relay 로 1명에게. 성공·실패 모두 sms_send_logs 에 기록(번호는 남기지 않음 — 문자 발송 화면과 같은 규칙).
export async function sendEnrollSms(input: {
  to: string;
  text: string;
  sentBy: string | null;
  purpose: string; // audience_desc — "방카 신규접수 보완요청" 등
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const to = (input.to ?? "").replace(/\D/g, "");
  if (!/^01[0-9]{8,9}$/.test(to)) return { ok: false, error: "보호자 휴대전화 번호가 올바르지 않습니다." };
  const r = await sendSms({ to: [to], text: input.text, test: false, sender: ENROLL_SENDER });
  const log: Record<string, unknown> = {
    sent_by: input.sentBy,
    channel: "sms",
    program: "bk_enroll",
    audience_desc: input.purpose.slice(0, 500),
    recipient_count: 1,
    text_body: input.text,
    msg_type: r.ok ? r.msg_type ?? smsMsgType(input.text) : smsMsgType(input.text),
    sender: r.ok ? r.sender ?? ENROLL_SENDER : ENROLL_SENDER,
    is_test: false,
    ok: r.ok,
    sent_count: r.ok ? r.sent : 0,
    failed_count: r.ok ? r.failed : 1,
    provider_msg_id: r.ok ? r.provider_msg_id : null,
    error: r.ok ? null : r.error,
  };
  let { error } = await supabaseAdmin.from(SMS_LOG_TABLE).insert(log);
  if (error && /channel/.test(error.message ?? "") && (error.code === "PGRST204" || error.code === "42703")) {
    const { channel: _omit, ...rest } = log;
    void _omit;
    ({ error } = await supabaseAdmin.from(SMS_LOG_TABLE).insert(rest));
  }
  if (error) console.error(`[bk-enroll] 문자 이력 기록 실패: ${error.message}`);
  if (!r.ok) {
    console.error(`[bk-enroll] 문자 발송 실패(${input.purpose}): ${r.error}`);
    return { ok: false, error: r.error };
  }
  if (r.failed > 0 && r.sent === 0) return { ok: false, error: "문자 발송이 실패로 집계되었습니다." };
  return { ok: true };
}

export function fixRequestMessage(youthName: string, reason: string, base: string): string {
  return `[동래구청소년센터] ${youthName}의 방과후아카데미 신청서에 보완이 필요합니다. 사유: ${reason} 고쳐 주세요: ${base}/apply`;
}

// =====================================================================
// 보관기간 삭제(Cron) — 설계 8장
//   retention_until < now() and purged_at is null 인 신청서:
//     · 증빙 파일(bk_application_files) Storage 삭제 + purged_at
//     · sensitive = null, 추천서 서명 삭제(signature_path = null)
//     · 합격이 아니면 사진·서명도 삭제(photo_path·guardian_signature_path·youth_signature_path = null)
//     · purged_at, access_logs purge(actor_type=system)
//   한 건이 실패해도 다음 건을 계속합니다(실패 건은 purged_at 을 찍지 않아 다음 날 다시).
// =====================================================================

export type PurgeSummary = {
  dryRun: boolean;
  candidates: number;
  purged: number;
  failed: number;
  files: number;
  media: number;
  errors: string[];
};

const PURGE_BATCH = 50;
const PURGE_MAX = 500; // 한 번 실행에 최대(시간 제한 대비) — 남으면 다음 날 이어서

type PurgeApp = {
  id: string;
  recruitment_id: string;
  status: string;
  photo_path: string | null;
  guardian_signature_path: string | null;
  youth_signature_path: string | null;
};

export async function runEnrollPurge(opts: { dryRun: boolean }): Promise<PurgeSummary> {
  const sum: PurgeSummary = {
    dryRun: opts.dryRun,
    candidates: 0,
    purged: 0,
    failed: 0,
    files: 0,
    media: 0,
    errors: [],
  };
  const nowIso = new Date().toISOString();
  const seen = new Set<string>();
  let offset = 0; // dry 모드는 아무것도 안 바뀌므로 쪽을 넘겨 가며 셉니다.

  while (sum.candidates < PURGE_MAX) {
    // 실제 삭제: 성공 건은 purged_at 이 찍혀 빠지고 실패 건만 앞에 남으므로 실패 수만큼 건너뜀.
    const from = opts.dryRun ? offset : sum.failed;
    const { data, error } = await supabaseAdmin
      .from(T_APPS)
      .select("id, recruitment_id, status, photo_path, guardian_signature_path, youth_signature_path")
      .lt("retention_until", nowIso)
      .is("purged_at", null)
      .order("retention_until", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PURGE_BATCH - 1);
    if (opts.dryRun) offset += PURGE_BATCH;
    if (error) throw new Error(`대상 조회 실패: ${error.message}`);
    // 실패해서 남은 건·dry 모드에서 다시 나온 건은 건너뜀(무한 반복 방지).
    const batch = ((data ?? []) as PurgeApp[]).filter((a) => !seen.has(a.id));
    if (batch.length === 0) break;
    for (const app of batch) {
      seen.add(app.id);
      sum.candidates++;
      try {
        const r = await purgeOne(app, opts.dryRun, nowIso);
        sum.files += r.files;
        sum.media += r.media;
        if (!opts.dryRun) sum.purged++;
      } catch (e) {
        sum.failed++;
        sum.errors.push(`${app.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (sum.candidates >= PURGE_MAX) break;
    }
    if (opts.dryRun && (data ?? []).length < PURGE_BATCH) break;
  }
  return sum;
}

async function removePaths(paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { error } = await supabaseAdmin.storage.from(ENROLL_BUCKET).remove(chunk);
    if (error) throw new Error(`Storage 삭제 실패: ${error.message}`);
  }
}

async function purgeOne(
  app: PurgeApp,
  dryRun: boolean,
  nowIso: string,
): Promise<{ files: number; media: number }> {
  const accepted = app.status === "accepted";

  const { data: files, error: fe } = await supabaseAdmin
    .from(T_FILES)
    .select("id, path")
    .eq("application_id", app.id)
    .is("purged_at", null);
  if (fe) throw new Error(`파일 조회 실패: ${fe.message}`);
  const fileRows = (files ?? []) as { id: string; path: string }[];

  const { data: recs, error: re } = await supabaseAdmin
    .from(T_RECS)
    .select("id, signature_path")
    .eq("application_id", app.id)
    .not("signature_path", "is", null);
  if (re) throw new Error(`추천서 조회 실패: ${re.message}`);
  const recRows = (recs ?? []) as { id: string; signature_path: string }[];

  const media = accepted
    ? []
    : [app.photo_path, app.guardian_signature_path, app.youth_signature_path].filter(
        (p): p is string => !!p,
      );
  const mediaCount = media.length + recRows.length;
  if (dryRun) return { files: fileRows.length, media: mediaCount };

  // 1) Storage 먼저 — 지운 뒤 DB 가 실패해도 다음 실행이 같은 경로를 다시 지우려 할 뿐(이미 없음 = 성공).
  await removePaths([...fileRows.map((f) => f.path), ...recRows.map((r) => r.signature_path), ...media]);

  if (fileRows.length > 0) {
    const { error } = await supabaseAdmin
      .from(T_FILES)
      .update({ purged_at: nowIso })
      .in(
        "id",
        fileRows.map((f) => f.id),
      );
    if (error) throw new Error(`파일 기록 갱신 실패: ${error.message}`);
  }
  if (recRows.length > 0) {
    const { error } = await supabaseAdmin
      .from(T_RECS)
      .update({ signature_path: null })
      .in(
        "id",
        recRows.map((r) => r.id),
      );
    if (error) throw new Error(`추천서 갱신 실패: ${error.message}`);
  }
  const patch: Record<string, unknown> = { sensitive: null, purged_at: nowIso, updated_at: nowIso };
  if (!accepted) {
    patch.photo_path = null;
    patch.guardian_signature_path = null;
    patch.youth_signature_path = null;
  }
  const { error: ue } = await supabaseAdmin.from(T_APPS).update(patch).eq("id", app.id);
  if (ue) throw new Error(`신청서 갱신 실패: ${ue.message}`);

  await insertLogs([
    {
      application_id: app.id,
      recruitment_id: app.recruitment_id,
      actor_type: "system",
      actor_id: "cron",
      actor_name: "보관기간 삭제",
      action: "purge",
      target: app.status,
      detail: {
        files: fileRows.length,
        recommendation_signatures: recRows.length,
        media: media.length,
        accepted,
      },
    },
  ]);
  return { files: fileRows.length, media: mediaCount };
}

// =====================================================================
// 버려진 업로드 정리(Cron) — 보호자 앱은 2시간짜리 서명 업로드 URL 을 주지만 완료 확인은
//   5분 안에만 받으므로, 올리다 만 파일이 버킷에 남을 수 있습니다.
//   {recruitment_id}/{application_id}/ 아래 24시간 넘은 객체 중 어디에도 연결되지 않은 것 삭제:
//     bk_applications.photo_path·guardian_signature_path·youth_signature_path,
//     bk_application_files.path(purged 아님), bk_application_recommendations.signature_path.
//   신청서 행이 없는 폴더는 통째로(24시간 넘은 것만) 지웁니다. 폴더 이름이 uuid 가 아니면 손대지 않습니다.
// =====================================================================

export type OrphanSummary = {
  dryRun: boolean;
  recruitments: number;
  folders: number;
  missingApplications: number;
  scanned: number;
  orphans: number;
  deleted: number;
  errors: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORPHAN_MIN_AGE_MS = 24 * 3600 * 1000;
const ORPHAN_MAX_DELETE = 2000;

type StorageEntry = { name: string; id: string | null; created_at?: string | null; updated_at?: string | null };

async function listAll(prefix: string): Promise<StorageEntry[]> {
  const out: StorageEntry[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseAdmin.storage
      .from(ENROLL_BUCKET)
      .list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`목록 조회 실패(${prefix || "/"}): ${error.message}`);
    const rows = (data ?? []) as StorageEntry[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

// 폴더 안 객체 전부(하위 폴더 포함, 깊이 3까지) — 경로·생성 시각.
async function listObjectsDeep(prefix: string, depth = 0): Promise<{ path: string; createdAt: string | null }[]> {
  const out: { path: string; createdAt: string | null }[] = [];
  for (const e of await listAll(prefix)) {
    const p = `${prefix}/${e.name}`;
    if (e.id == null) {
      if (depth < 3) out.push(...(await listObjectsDeep(p, depth + 1)));
    } else if (e.name !== ".emptyFolderPlaceholder") {
      out.push({ path: p, createdAt: e.created_at ?? e.updated_at ?? null });
    }
  }
  return out;
}

async function referencedPaths(aid: string): Promise<Set<string> | null> {
  const { data: app, error } = await supabaseAdmin
    .from(T_APPS)
    .select("id, photo_path, guardian_signature_path, youth_signature_path")
    .eq("id", aid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) return null; // 신청서 없음
  const set = new Set<string>();
  const a = app as Record<string, string | null>;
  for (const k of ["photo_path", "guardian_signature_path", "youth_signature_path"]) if (a[k]) set.add(a[k]!);
  const [{ data: files, error: fe }, { data: recs, error: re }] = await Promise.all([
    supabaseAdmin.from(T_FILES).select("path").eq("application_id", aid).is("purged_at", null),
    supabaseAdmin.from(T_RECS).select("signature_path").eq("application_id", aid).not("signature_path", "is", null),
  ]);
  if (fe) throw new Error(fe.message);
  if (re) throw new Error(re.message);
  for (const f of (files ?? []) as { path: string }[]) set.add(f.path);
  for (const r of (recs ?? []) as { signature_path: string }[]) set.add(r.signature_path);
  return set;
}

// 회차 삭제용 — {recruitment_id}/ 아래 객체를 전부 지웁니다(작성중 신청서뿐인 회차만 부름). 지운 개수.
export async function removeRecruitmentFolder(recruitmentId: string): Promise<number> {
  if (!UUID_RE.test(recruitmentId)) throw new Error("회차 id 가 올바르지 않습니다.");
  const paths = (await listObjectsDeep(recruitmentId)).map((o) => o.path);
  if (paths.length > 0) await removePaths(paths);
  return paths.length;
}

export async function runEnrollOrphanCleanup(opts: { dryRun: boolean }): Promise<OrphanSummary> {
  const sum: OrphanSummary = {
    dryRun: opts.dryRun,
    recruitments: 0,
    folders: 0,
    missingApplications: 0,
    scanned: 0,
    orphans: 0,
    deleted: 0,
    errors: [],
  };
  const cutoff = Date.now() - ORPHAN_MIN_AGE_MS;
  const top = (await listAll("")).filter((e) => e.id == null && UUID_RE.test(e.name));
  outer: for (const rf of top) {
    sum.recruitments++;
    let appFolders: StorageEntry[];
    try {
      appFolders = (await listAll(rf.name)).filter((e) => e.id == null && UUID_RE.test(e.name));
    } catch (e) {
      sum.errors.push(e instanceof Error ? e.message : String(e));
      continue;
    }
    for (const af of appFolders) {
      sum.folders++;
      const prefix = `${rf.name}/${af.name}`;
      try {
        const objects = await listObjectsDeep(prefix);
        sum.scanned += objects.length;
        const refs = await referencedPaths(af.name);
        if (!refs) sum.missingApplications++;
        const orphans = objects
          .filter((o) => !(refs?.has(o.path)))
          .filter((o) => {
            const t = o.createdAt ? new Date(o.createdAt).getTime() : NaN;
            return Number.isFinite(t) && t < cutoff; // 시각을 모르면 지우지 않음
          })
          .map((o) => o.path);
        sum.orphans += orphans.length;
        if (!opts.dryRun && orphans.length > 0) {
          await removePaths(orphans);
          sum.deleted += orphans.length;
        }
      } catch (e) {
        sum.errors.push(`${prefix}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (sum.orphans >= ORPHAN_MAX_DELETE) break outer; // 남은 것은 다음 날
    }
  }
  if (!opts.dryRun && (sum.deleted > 0 || sum.errors.length > 0)) {
    await insertLogs([
      {
        application_id: null,
        recruitment_id: null,
        actor_type: "system",
        actor_id: "cron",
        actor_name: "보관기간 삭제",
        action: "purge",
        target: "orphans",
        detail: {
          folders: sum.folders,
          missing_applications: sum.missingApplications,
          scanned: sum.scanned,
          deleted: sum.deleted,
          errors: sum.errors.length,
        },
      },
    ]);
  }
  return sum;
}
