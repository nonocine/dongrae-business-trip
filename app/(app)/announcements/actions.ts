"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSession, getGoogleSession } from "@/app/actions";
import { isM0Grant } from "@/lib/authLevels";
import {
  signHrDocument,
  removeHrDocuments,
  HR_DOCUMENTS_BUCKET,
} from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendSlack, siteBaseUrl, slackLink } from "@/lib/slack";

// =====================================================================
// 공지사항(announcements) — 공식 공지(슬랙은 일상 소통, 동업자씨는 기록 공지).
//   * 작성·수정·삭제: M0(관장·부장·master)만. 읽기: 로그인한 전 직원.
//   * announcements 는 RLS 정책 0개(anon 차단)라 service_role(supabaseAdmin) 경유.
//   * 첨부: hr-documents 버킷 announcements/{id}/{uuid}.{ext}. attachments jsonb 저장.
// =====================================================================

export type AnnouncementAttachment = { name: string; path: string };

export type Announcement = {
  id: string;
  title: string;
  content: string;
  author_driver_id: string | null;
  author_name: string;
  is_pinned: boolean;
  target_scope: string;
  attachments: AnnouncementAttachment[];
  notified_slack: boolean;
  created_at: string;
  updated_at: string | null;
};

// 첨부 허용 형식·용량 — 기존 직원/지원자 첨부서류 기준 재사용.
const ATTACH_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
const ATTACH_MAX_BYTES = 16 * 1024 * 1024;

function normalizeAttachments(raw: unknown): AnnouncementAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (x): x is Record<string, unknown> =>
        x != null && typeof x === "object" && !Array.isArray(x)
    )
    .map((x) => ({
      name: String(x.name ?? "").trim(),
      path: String(x.path ?? "").trim(),
    }))
    .filter((a) => a.path.length > 0);
}

function normalizeAnnouncement(raw: Record<string, unknown>): Announcement {
  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    content: String(raw.content ?? ""),
    author_driver_id: (raw.author_driver_id as string | null) ?? null,
    author_name: String(raw.author_name ?? ""),
    is_pinned: raw.is_pinned === true,
    target_scope: String(raw.target_scope ?? "all"),
    attachments: normalizeAttachments(raw.attachments),
    notified_slack: raw.notified_slack === true,
    created_at: String(raw.created_at ?? ""),
    updated_at: (raw.updated_at as string | null) ?? null,
  };
}

// =====================================================================
// 현재 세션의 권한 컨텍스트 — M0 판정·작성자 식별에 사용.
//   * 구글 세션: email·rank·driverId. 비번 세션: name 으로 drivers 조회.
//   * 공유비번 admin: 최고관리자로 M0 인정.
// =====================================================================
type AuthContext = {
  rank: string | null;
  email: string | null;
  authLevel: string | null;
  driverId: string | null;
  name: string;
};

async function getAuthContext(): Promise<AuthContext | null> {
  const g = await getGoogleSession();
  if (g) {
    const driverId = g.driverId ?? null;
    let authLevel: string | null = null;
    if (driverId) {
      const { data } = await supabaseAdmin
        .from("employee_profiles")
        .select("auth_level")
        .eq("driver_id", driverId)
        .maybeSingle();
      authLevel =
        ((data as { auth_level?: unknown } | null)?.auth_level as
          | string
          | null) ?? null;
    }
    return {
      rank: g.rank ?? null,
      email: g.email,
      authLevel,
      driverId,
      name: g.driverName ?? g.name,
    };
  }

  const s = await getSession();
  if (s && s.kind === "employee") {
    const { data: drv } = await supabaseAdmin
      .from("drivers")
      .select("id, rank")
      .eq("name", s.name)
      .maybeSingle();
    const driverId =
      ((drv as { id?: unknown } | null)?.id as string | null) ?? null;
    const rank =
      ((drv as { rank?: unknown } | null)?.rank as string | null) ?? null;
    let authLevel: string | null = null;
    if (driverId) {
      const { data: prof } = await supabaseAdmin
        .from("employee_profiles")
        .select("auth_level")
        .eq("driver_id", driverId)
        .maybeSingle();
      authLevel =
        ((prof as { auth_level?: unknown } | null)?.auth_level as
          | string
          | null) ?? null;
    }
    return { rank, email: null, authLevel, driverId, name: s.name };
  }

  // SEC-3b: 공유비번 admin 분기 제거. 구글 관장·master 는 위 구글 세션 경로에서
  //   rank/authLevel 로 M0 판정되므로 별도 분기가 필요 없습니다.
  return null;
}

function ctxIsM0(ctx: AuthContext): boolean {
  return isM0Grant({
    rank: ctx.rank,
    email: ctx.email,
    authLevel: ctx.authLevel,
  });
}

// M0 게이트 — 통과 시 작성자 정보 반환, 아니면 throw.
async function requireM0(): Promise<{ driverId: string | null; name: string }> {
  const ctx = await getAuthContext();
  if (!ctx || !ctxIsM0(ctx)) {
    throw new Error("공지 작성 권한이 없습니다. (관장·부장·마스터만 가능)");
  }
  return { driverId: ctx.driverId, name: ctx.name };
}

// 현재 로그인 사용자가 M0 인지(읽기 게이트용 — UI 버튼 노출 판정).
export async function amIM0(): Promise<boolean> {
  const ctx = await getAuthContext();
  return ctx ? ctxIsM0(ctx) : false;
}

// =====================================================================
// 슬랙 알림 훅 — 전직원 #01_공지사항(SLACK_WEBHOOK_ANNOUNCE).
//   * 부가기능: 실패·미설정이어도 공지 등록 자체는 성공 처리(내부에서 완전 격리).
//   * 발송 성공 시 announcements.notified_slack=true 로 기록.
// =====================================================================
async function notifySlackAnnouncement(
  announcementId: string,
  title: string
): Promise<void> {
  try {
    const base = siteBaseUrl();
    const link = base
      ? `\n${slackLink(`${base}/announcements`, "동업자씨에서 공지 보기")}`
      : "";
    const sent = await sendSlack(
      "SLACK_WEBHOOK_ANNOUNCE",
      `📢 새 공지: ${title}${link}`
    );
    if (sent) {
      await supabaseAdmin
        .from("announcements")
        .update({ notified_slack: true })
        .eq("id", announcementId);
    }
  } catch (e) {
    // 알림 실패가 공지 등록을 막지 않도록 삼킴.
    console.warn(
      "[slack] 공지 알림 처리 실패:",
      e instanceof Error ? e.message : e
    );
  }
}

// =====================================================================
// 읽기 — 로그인한 전 직원. 고정(is_pinned) 우선, 최신순.
// =====================================================================
export async function listAnnouncements(limit?: number): Promise<Announcement[]> {
  const session = await getSession();
  if (!session) return [];

  let query = supabaseAdmin
    .from("announcements")
    .select("*")
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });
  if (typeof limit === "number" && limit > 0) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) =>
    normalizeAnnouncement(row as Record<string, unknown>)
  );
}

// 첨부 임시 열람 URL — 로그인 직원만. path 는 attachments 의 저장 경로.
export async function signAnnouncementAttachment(
  path: string
): Promise<string | null> {
  const session = await getSession();
  if (!session || !path) return null;
  // announcements/ 경로만 허용(다른 버킷 경로 서명 방지).
  if (!path.startsWith("announcements/")) return null;
  return signHrDocument(path);
}

// =====================================================================
// 작성 / 수정 / 삭제 — M0 만.
// =====================================================================
export async function createAnnouncement(input: {
  title: string;
  content: string;
  isPinned?: boolean;
  targetScope?: string;
}): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const author = await requireM0();
    const title = (input.title ?? "").trim();
    const content = (input.content ?? "").trim();
    if (!title) return { ok: false, message: "제목을 입력해주세요." };
    if (!content) return { ok: false, message: "내용을 입력해주세요." };

    const { data, error } = await supabaseAdmin
      .from("announcements")
      .insert({
        title,
        content,
        author_driver_id: author.driverId,
        author_name: author.name,
        is_pinned: input.isPinned === true,
        // target_scope 는 지금 'all' 고정(향후 팀별 확장 대비).
        target_scope: (input.targetScope ?? "all").trim() || "all",
        attachments: [],
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? "공지 생성에 실패했습니다.");
    }
    const id = String((data as { id: unknown }).id);

    // 슬랙 알림(부가기능) — #01_공지사항 채널. 실패해도 등록은 성공.
    await notifySlackAnnouncement(id, title);

    revalidatePath("/announcements");
    revalidatePath("/");
    return { ok: true, id };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "공지 생성 중 오류가 발생했습니다.",
    };
  }
}

export async function updateAnnouncement(
  id: string,
  input: {
    title: string;
    content: string;
    isPinned?: boolean;
    targetScope?: string;
  }
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireM0();
    if (!id) return { ok: false, message: "공지 ID가 없습니다." };
    const title = (input.title ?? "").trim();
    const content = (input.content ?? "").trim();
    if (!title) return { ok: false, message: "제목을 입력해주세요." };
    if (!content) return { ok: false, message: "내용을 입력해주세요." };

    const { error } = await supabaseAdmin
      .from("announcements")
      .update({
        title,
        content,
        is_pinned: input.isPinned === true,
        target_scope: (input.targetScope ?? "all").trim() || "all",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw new Error(error.message);

    revalidatePath("/announcements");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "공지 수정 중 오류가 발생했습니다.",
    };
  }
}

export async function deleteAnnouncement(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireM0();
    if (!id) return { ok: false, message: "공지 ID가 없습니다." };

    // 첨부 파일 경로 수집 후 row 삭제 → Storage 파일 정리.
    const { data: row } = await supabaseAdmin
      .from("announcements")
      .select("attachments")
      .eq("id", id)
      .maybeSingle();
    const paths = normalizeAttachments(
      (row as { attachments?: unknown } | null)?.attachments
    ).map((a) => a.path);

    const { error } = await supabaseAdmin
      .from("announcements")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);

    if (paths.length > 0) {
      try {
        await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).remove(paths);
      } catch {
        // 파일 정리 실패는 무시 — row 삭제는 완료됨.
      }
    }

    revalidatePath("/announcements");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "공지 삭제 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// 첨부 업로드 / 삭제 — M0 만. attachments jsonb 에 {name, path} 병합.
//   * 업로드/삭제는 service_role(supabaseAdmin.storage)로 수행(Private 버킷 안정).
// =====================================================================
export async function uploadAnnouncementAttachment(
  formData: FormData
): Promise<
  | { ok: true; attachment: AnnouncementAttachment }
  | { ok: false; message: string }
> {
  try {
    await requireM0();
    const id = String(formData.get("announcement_id") ?? "").trim();
    if (!id) return { ok: false, message: "공지 ID가 없습니다." };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, message: "업로드할 파일을 선택해주세요." };
    }
    if (file.size > ATTACH_MAX_BYTES) {
      return { ok: false, message: "파일 용량은 16MB 이하여야 합니다." };
    }
    const ext = ATTACH_EXT[file.type];
    if (!ext) {
      return {
        ok: false,
        message: "PDF, JPG, PNG, WEBP 형식만 업로드할 수 있습니다.",
      };
    }

    const path = `announcements/${id}/${randomUUID()}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from(HR_DOCUMENTS_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: true });
    if (upErr) return { ok: false, message: `업로드 실패: ${upErr.message}` };

    // 현재 attachments 읽어 병합 저장.
    const { data: row, error: rErr } = await supabaseAdmin
      .from("announcements")
      .select("attachments")
      .eq("id", id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    const current = normalizeAttachments(
      (row as { attachments?: unknown } | null)?.attachments
    );
    const attachment: AnnouncementAttachment = {
      name: file.name || `첨부.${ext}`,
      path,
    };
    const next = [...current, attachment];
    const { error: dbErr } = await supabaseAdmin
      .from("announcements")
      .update({ attachments: next, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (dbErr) throw new Error(dbErr.message);

    revalidatePath("/announcements");
    return { ok: true, attachment };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "업로드 중 오류가 발생했습니다.",
    };
  }
}

export async function deleteAnnouncementAttachment(
  id: string,
  path: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireM0();
    if (!id || !path) return { ok: false, message: "요청 정보가 누락되었습니다." };

    const { data: row, error: rErr } = await supabaseAdmin
      .from("announcements")
      .select("attachments")
      .eq("id", id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    const current = normalizeAttachments(
      (row as { attachments?: unknown } | null)?.attachments
    );
    const next = current.filter((a) => a.path !== path);

    const { error: dbErr } = await supabaseAdmin
      .from("announcements")
      .update({ attachments: next, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (dbErr) throw new Error(dbErr.message);

    await removeHrDocuments([path]);

    revalidatePath("/announcements");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "첨부 삭제 중 오류가 발생했습니다.",
    };
  }
}
