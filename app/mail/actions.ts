"use server";

// =====================================================================
// 공용 메일함 — 조회·담당지정·상태변경·메모·수동수집 액션.
//   * 접근: requireMailAccess (로그인 직원 전원 + 관리자).
//   * mail_messages 는 RLS 정책 0개 → 전부 supabaseAdmin 경유.
//   * 담당 지정 시 슬랙 DM 은 부가기능 — 실패해도 지정 자체는 성공 처리.
//   * 네이버 원본은 어떤 액션에서도 삭제하지 않습니다(1단계 규칙).
// =====================================================================

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireMailAccess } from "@/lib/mailAccess";
import { sendSlackDM, siteBaseUrl, slackLink } from "@/lib/slack";
import { runMailFetch } from "@/lib/mailCollector";
import {
  MAIL_BUCKET,
  isMailStatus,
  type MailAttachmentMeta,
  type MailDetail,
  type MailListItem,
  type MailListView,
  type MailStatus,
} from "@/lib/mail";

const LIST_LIMIT = 300;

function tableMissing(error: { code?: string; message?: string } | null) {
  return error?.code === "42P01" || error?.message?.includes("schema cache");
}

function toStatus(v: unknown): MailStatus {
  return v === "processing" || v === "done" ? v : "unread";
}

function toAttachments(raw: unknown): MailAttachmentMeta[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    return {
      name: String(o.name ?? "첨부파일"),
      size: Number(o.size ?? 0),
      storage_path: (o.storage_path as string | null) ?? null,
    };
  });
}

function toListItem(raw: Record<string, unknown>): MailListItem {
  return {
    id: String(raw.id ?? ""),
    from_name: String(raw.from_name ?? ""),
    from_email: String(raw.from_email ?? ""),
    subject: String(raw.subject ?? ""),
    received_at: (raw.received_at as string | null) ?? null,
    has_attachments: raw.has_attachments === true,
    assignee_name: String(raw.assignee_name ?? ""),
    status: toStatus(raw.status),
  };
}

// 재직자 명단 — 담당자 셀렉트용(drivers.is_active && 퇴사 아님).
async function loadActiveStaff(): Promise<string[]> {
  const [{ data: drivers }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from("drivers").select("id, name, is_active"),
    supabaseAdmin
      .from("employee_profiles")
      .select("driver_id, employment_status"),
  ]);
  const resigned = new Set(
    (profiles ?? [])
      .filter(
        (p) =>
          String((p as { employment_status?: unknown }).employment_status) ===
          "resigned",
      )
      .map((p) => String((p as { driver_id: unknown }).driver_id)),
  );
  return (drivers ?? [])
    .filter((d) => {
      const r = d as Record<string, unknown>;
      return r.is_active !== false && !resigned.has(String(r.id));
    })
    .map((d) => String((d as { name: unknown }).name ?? ""))
    .filter((n) => n.length > 0)
    .sort((a, b) => a.localeCompare(b, "ko"));
}

export async function getMailList(filters?: {
  status?: string;
  assignee?: string;
  q?: string;
}): Promise<MailListView> {
  await requireMailAccess();

  let query = supabaseAdmin
    .from("mail_messages")
    .select(
      "id,from_name,from_email,subject,received_at,has_attachments,assignee_name,status",
    )
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(LIST_LIMIT);

  const status = filters?.status ?? "";
  if (isMailStatus(status)) query = query.eq("status", status);
  const assignee = (filters?.assignee ?? "").trim();
  if (assignee === "__none__") query = query.eq("assignee_name", "");
  else if (assignee) query = query.eq("assignee_name", assignee);

  const q = (filters?.q ?? "").trim();
  if (q) {
    // 제목·보낸사람(이름/주소) 부분일치. 쉼표는 or() 문법을 깨뜨리므로 제거합니다.
    const safe = q.replace(/[,()]/g, " ").trim();
    if (safe)
      query = query.or(
        `subject.ilike.%${safe}%,from_name.ilike.%${safe}%,from_email.ilike.%${safe}%`,
      );
  }

  const [listQuery, unreadQuery, assignedQuery, staff] = await Promise.all([
    query,
    supabaseAdmin
      .from("mail_messages")
      .select("id", { count: "exact", head: true })
      .eq("status", "unread"),
    supabaseAdmin.from("mail_messages").select("assignee_name"),
    loadActiveStaff(),
  ]);

  if (tableMissing(listQuery.error)) {
    return {
      configured: false,
      items: [],
      unreadCount: 0,
      assignees: staff,
      usedAssignees: [],
    };
  }
  if (listQuery.error) throw new Error(listQuery.error.message);

  const used = new Set<string>();
  for (const r of assignedQuery.data ?? []) {
    const n = String((r as { assignee_name: unknown }).assignee_name ?? "").trim();
    if (n) used.add(n);
  }

  return {
    configured: true,
    items: ((listQuery.data ?? []) as Record<string, unknown>[]).map(toListItem),
    unreadCount: unreadQuery.count ?? 0,
    assignees: staff,
    usedAssignees: [...used].sort((a, b) => a.localeCompare(b, "ko")),
  };
}

// 미처리 건수만 — 대시보드 카드 배지용(테이블 없으면 0).
export async function getUnreadMailCount(): Promise<number> {
  const ctx = await resolveSafely();
  if (!ctx) return 0;
  const { count, error } = await supabaseAdmin
    .from("mail_messages")
    .select("id", { count: "exact", head: true })
    .eq("status", "unread");
  if (error) return 0;
  return count ?? 0;
}

async function resolveSafely() {
  try {
    return await requireMailAccess();
  } catch {
    return null;
  }
}

export async function getMailDetail(id: string): Promise<MailDetail | null> {
  await requireMailAccess();
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from("mail_messages")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (tableMissing(error)) return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  const raw = data as Record<string, unknown>;
  return {
    ...toListItem(raw),
    body_text: String(raw.body_text ?? ""),
    body_html: (raw.body_html as string | null) ?? null,
    memo: String(raw.memo ?? ""),
    attachments: toAttachments(raw.attachments),
    fetched_at: (raw.fetched_at as string | null) ?? null,
  };
}

// 첨부 열람용 서명 URL(1시간). 경로가 없으면(용량 초과) null.
export async function signMailAttachment(
  path: string | null,
): Promise<string | null> {
  await requireMailAccess();
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage
    .from(MAIL_BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data) return null;
  return data.signedUrl;
}

type ActionResult = { ok: true } | { ok: false; message: string };

function actionError(e: unknown, fallback: string): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : fallback };
}

// 담당자 지정 — 지정된 직원에게 슬랙 DM(실패해도 지정은 유지).
export async function assignMail(
  id: string,
  assignee: string,
): Promise<ActionResult> {
  try {
    await requireMailAccess();
    if (!id) return { ok: false, message: "대상 메일이 없습니다." };
    const name = assignee.trim();

    const { data: mail, error: readError } = await supabaseAdmin
      .from("mail_messages")
      .select("subject, assignee_name")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!mail) return { ok: false, message: "메일을 찾을 수 없습니다." };

    const { error } = await supabaseAdmin
      .from("mail_messages")
      .update({ assignee_name: name })
      .eq("id", id);
    if (error) throw new Error(error.message);

    // 새로 지정된 경우에만 알립니다(같은 담당 재지정·해제는 알림 없음).
    const before = String(
      (mail as { assignee_name?: unknown }).assignee_name ?? "",
    ).trim();
    if (name && name !== before) {
      await notifyAssignee(
        name,
        String((mail as { subject?: unknown }).subject ?? "(제목 없음)"),
      );
    }
    revalidatePath("/mail");
    return { ok: true };
  } catch (e) {
    return actionError(e, "담당자를 지정하지 못했습니다.");
  }
}

// 담당 지정 슬랙 DM — 이메일로 사용자를 찾아 보냅니다. 전부 격리(throw 안 함).
async function notifyAssignee(name: string, subject: string): Promise<void> {
  try {
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("name", name)
      .maybeSingle();
    const driverId = driver
      ? String((driver as { id: unknown }).id ?? "")
      : "";
    if (!driverId) return;
    const { data: profile } = await supabaseAdmin
      .from("employee_profiles")
      .select("email")
      .eq("driver_id", driverId)
      .maybeSingle();
    const email =
      (profile as { email?: string | null } | null)?.email ?? null;
    if (!email) return;

    const base = siteBaseUrl();
    const link = base ? slackLink(`${base}/mail`, "공용 메일함 열기") : "/mail";
    await sendSlackDM(email, `📧 공용 메일 담당 지정: [${subject}] — ${link}`);
  } catch (e) {
    console.warn(
      "[mail] 담당 지정 알림 실패:",
      e instanceof Error ? e.message : e,
    );
  }
}

export async function setMailStatus(
  id: string,
  status: string,
): Promise<ActionResult> {
  try {
    await requireMailAccess();
    if (!id) return { ok: false, message: "대상 메일이 없습니다." };
    if (!isMailStatus(status))
      return { ok: false, message: "알 수 없는 상태입니다." };
    const { error } = await supabaseAdmin
      .from("mail_messages")
      .update({ status })
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/mail");
    return { ok: true };
  } catch (e) {
    return actionError(e, "상태를 변경하지 못했습니다.");
  }
}

export async function saveMailMemo(
  id: string,
  memo: string,
): Promise<ActionResult> {
  try {
    await requireMailAccess();
    if (!id) return { ok: false, message: "대상 메일이 없습니다." };
    const { error } = await supabaseAdmin
      .from("mail_messages")
      .update({ memo: memo.trim() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/mail");
    return { ok: true };
  } catch (e) {
    return actionError(e, "메모를 저장하지 못했습니다.");
  }
}

// [지금 가져오기] — Cron 과 같은 수집기를 수동 실행합니다(원본 삭제 없음).
export async function fetchMailNow(): Promise<
  { ok: true; saved: number; remaining: number; failed: number } | { ok: false; message: string }
> {
  try {
    await requireMailAccess();
    // 실행한 사람이 화면에서 결과를 바로 보므로 슬랙 알림은 보내지 않습니다.
    const summary = await runMailFetch({ notify: false });
    if (!summary.ok)
      return { ok: false, message: summary.message ?? "수집하지 못했습니다." };
    revalidatePath("/mail");
    return {
      ok: true,
      saved: summary.saved,
      remaining: summary.remaining,
      failed: summary.failed,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "수집 중 오류가 발생했습니다.",
    };
  }
}
