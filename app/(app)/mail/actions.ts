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
  isClassifierConfigured,
  runMailClassification,
} from "@/lib/mailClassifier";
import {
  MAIL_BUCKET,
  MAIL_CATEGORY_ETC,
  MAIL_CATEGORY_INDEX,
  MAIL_SEND_MAX_BYTES,
  MAIL_SENT_FILTER,
  MAIL_TRASH_FILTER,
  attachmentSkipNotice,
  canAttachToOutgoing,
  formatBytes,
  isMailCategory,
  isMailFetchStale,
  isMailReplyKind,
  isMailStatus,
  sendAttachmentTotal,
  toAttachments,
  toReplyAttachments,
  type MailAttachmentMeta,
  type MailCategory,
  type MailDetail,
  type MailListItem,
  type MailListView,
  type MailReply,
  type MailReplyAttachment,
  type MailReplyKind,
  type MailSentItem,
  type MailStatus,
} from "@/lib/mail";
import {
  forwardSubject,
  isReplyConfigured,
  quoteForward,
  quoteOriginal,
  replySubject,
  sendReply,
  type OutgoingAttachment,
} from "@/lib/mailReply";
import { readAttachmentBytes } from "@/lib/mailAttachment";

const LIST_LIMIT = 300;

function tableMissing(error: { code?: string; message?: string } | null) {
  return error?.code === "42P01" || error?.message?.includes("schema cache");
}

function toStatus(v: unknown): MailStatus {
  return v === "processing" || v === "done" ? v : "unread";
}

// 목록 조회 컬럼 — 상세는 select("*") 라 따로 두지 않습니다.
//   ★ 0단계에서 attachments 를 추가했습니다. 목록 행의 📎 에서 상세를 열지 않고
//     바로 파일명을 보고 내려받기 위해서입니다. 첨부 '본체' 가 아니라 메타
//     (이름·크기·경로)만 담긴 jsonb 라 300행을 실어도 수십 KB 수준입니다.
const LIST_COLUMNS =
  "id,from_name,from_email,subject,received_at,has_attachments,attachments,assignee_name,status,ai_summary,ai_category,ai_suggested_assignee,ai_processed_at,opened_at,deleted_at";

// 일괄 처리 상한 — 실수로 전체를 날리는 사고를 막는 안전장치.
const BULK_LIMIT = 300;

function toListItem(raw: Record<string, unknown>): MailListItem {
  return {
    id: String(raw.id ?? ""),
    from_name: String(raw.from_name ?? ""),
    from_email: String(raw.from_email ?? ""),
    subject: String(raw.subject ?? ""),
    received_at: (raw.received_at as string | null) ?? null,
    has_attachments: raw.has_attachments === true,
    attachments: toAttachments(raw.attachments),
    assignee_name: String(raw.assignee_name ?? ""),
    status: toStatus(raw.status),
    ai_summary: String(raw.ai_summary ?? ""),
    ai_category: String(raw.ai_category ?? ""),
    ai_suggested_assignee: String(raw.ai_suggested_assignee ?? ""),
    ai_processed: !!raw.ai_processed_at,
    opened: !!raw.opened_at,
    deleted_at: (raw.deleted_at as string | null) ?? null,
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

// "기타" = 분류가 기타이거나 아직 분류되지 않은(NULL) 메일.
const ETC_OR_FILTER = `ai_category.is.null,ai_category.eq.${MAIL_CATEGORY_ETC}`;

// 분류 인덱스 배지용 — "안읽음(opened_at IS NULL)" 건수를 세는 쿼리.
//   ★ 상태·담당자·검색은 일부러 넣지 않습니다. 인덱스 숫자는 어떤 필터를
//     걸어도 같아야 "그 분류에 몇 건 남았나" 로 읽힙니다.
//   ★ 삭제된 메일은 목록과 마찬가지로 제외합니다(deleted_at IS NULL).
//   category 를 주지 않으면 분류 무관 전체("전체" 칸) 건수입니다.
function unopenedCountQuery(category: MailCategory | null) {
  const q = supabaseAdmin
    .from("mail_messages")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .is("opened_at", null);
  if (!category) return q;
  // 목록 필터와 같은 조건을 써야 배지 숫자와 실제 목록이 어긋나지 않습니다.
  return category === MAIL_CATEGORY_ETC ? q.or(ETC_OR_FILTER) : q.eq("ai_category", category);
}

// mail_replies 행 → 보낸메일함 한 줄.
//   원본 메일 정보는 조인해서 붙입니다(PostgREST 의 FK 임베드).
function toSentItem(raw: Record<string, unknown>): MailSentItem {
  const origin = (raw.mail_messages ?? null) as Record<string, unknown> | null;
  return {
    id: String(raw.id ?? ""),
    kind: isMailReplyKind(raw.kind) ? raw.kind : "reply",
    mail_id: String(raw.mail_id ?? ""),
    to_email: String(raw.to_email ?? ""),
    cc_email: String(raw.cc_email ?? ""),
    subject: String(raw.subject ?? ""),
    body: String(raw.body ?? ""),
    attachments: toReplyAttachments(raw.attachments),
    sent_by: String(raw.sent_by ?? ""),
    sent_at: String(raw.sent_at ?? ""),
    status: raw.status === "failed" ? "failed" : "sent",
    error_message: (raw.error_message as string | null) ?? null,
    origin_subject: String(origin?.subject ?? ""),
    origin_from: String(origin?.from_name ?? origin?.from_email ?? ""),
  };
}

// 보낸메일함 — mail_replies 를 최신순으로. 검색어는 받는사람·제목에 겁니다.
//   ★ 실패건(status != 'sent')도 함께 내려줍니다. 실패가 조용히 묻히면
//     아무도 재시도하지 않습니다 — 지금까지 이력이 상세 모달 안에만 있어서
//     실제로 그런 상태였습니다.
async function loadSentList(q: string): Promise<MailSentItem[]> {
  let query = supabaseAdmin
    .from("mail_replies")
    .select("*, mail_messages(subject, from_name, from_email)")
    .order("sent_at", { ascending: false })
    .limit(LIST_LIMIT);
  const safe = q.replace(/[,()]/g, " ").trim();
  if (safe)
    query = query.or(
      `subject.ilike.%${safe}%,to_email.ilike.%${safe}%,sent_by.ilike.%${safe}%`,
    );
  const { data, error } = await query;
  if (error) {
    if (tableMissing(error)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toSentItem);
}

export async function getMailList(filters?: {
  status?: string;
  assignee?: string;
  q?: string;
  unreadOnly?: boolean;
  category?: string;
}): Promise<MailListView> {
  await requireMailAccess();

  let query = supabaseAdmin
    .from("mail_messages")
    .select(LIST_COLUMNS)
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(LIST_LIMIT);

  // status 필터의 특수값 "trash" 는 삭제된 메일만 보여줍니다.
  // 그 외에는 항상 삭제된 메일을 제외합니다(기본 목록에서 숨김).
  const status = filters?.status ?? "";
  // 보낸메일함은 보는 테이블이 다릅니다(mail_replies). 받은 메일 목록 쿼리를
  //   돌릴 이유가 없으므로 여기서 갈라집니다 — 나머지(분류 배지·수집 시각
  //   ·담당자 명단)는 화면 위쪽이 계속 쓰므로 그대로 둡니다.
  const sentView = status === MAIL_SENT_FILTER;
  const trashView = status === MAIL_TRASH_FILTER;
  query = trashView
    ? query.not("deleted_at", "is", null)
    : query.is("deleted_at", null);
  if (isMailStatus(status)) query = query.eq("status", status);
  // "안읽음만" — 상세를 아직 아무도 열지 않은 메일(opened_at IS NULL).
  if (filters?.unreadOnly) query = query.is("opened_at", null);
  const assignee = (filters?.assignee ?? "").trim();
  if (assignee === "__none__") query = query.eq("assignee_name", "");
  else if (assignee) query = query.eq("assignee_name", assignee);

  // AI 분류 인덱스 — 다른 필터와 AND 로 겹칩니다(예: 회계 + 안읽음만).
  //   ※ 검색어도 or() 를 쓰지만 PostgREST 는 or 파라미터를 각각 AND 로 묶으므로
  //     "기타 + 검색어" 도 교집합으로 동작합니다.
  const category = (filters?.category ?? "").trim();
  if (isMailCategory(category))
    query =
      category === MAIL_CATEGORY_ETC
        ? query.or(ETC_OR_FILTER)
        : query.eq("ai_category", category);

  const q = (filters?.q ?? "").trim();
  if (q) {
    // 제목·보낸사람(이름/주소) 부분일치. 쉼표는 or() 문법을 깨뜨리므로 제거합니다.
    const safe = q.replace(/[,()]/g, " ").trim();
    if (safe)
      query = query.or(
        `subject.ilike.%${safe}%,from_name.ilike.%${safe}%,from_email.ilike.%${safe}%`,
      );
  }

  const [
    listQuery,
    unreadQuery,
    assignedQuery,
    lastFetchQuery,
    lastMailQuery,
    staff,
    categoryCounts,
    sentItems,
  ] = await Promise.all([
      // 보낸메일함에서는 받은 메일 쿼리를 돌리지 않습니다(빈 결과로 대체).
      sentView
        ? Promise.resolve({ data: [], error: null, count: null })
        : query,
      supabaseAdmin
        .from("mail_messages")
        .select("id", { count: "exact", head: true })
        .eq("status", "unread")
        .is("deleted_at", null),
      supabaseAdmin
        .from("mail_messages")
        .select("assignee_name")
        .is("deleted_at", null),
      // 마지막 수집 시각 = settings.mail_last_fetch_at.
      //   ★ 2026-09 이전에는 MAX(mail_messages.fetched_at) 을 썼는데, 그건
      //     "마지막으로 메일을 저장한 시각" 이라 새 메일이 없는 밤·주말에는
      //     갱신되지 않았고, Cron 이 10분마다 멀쩡히 돌아도 경고가 떴습니다.
      //     지금 값은 수집기가 네이버에 접속·인증까지 성공할 때마다 갱신됩니다
      //     (가져온 메일이 0건이어도 — lib/mailCollector.ts markLastFetch).
      supabaseAdmin
        .from("settings")
        .select("value")
        .eq("key", "mail_last_fetch_at")
        .maybeSingle(),
      // 마지막으로 새 메일이 들어온 시각 = MAX(fetched_at). 표시 전용입니다 —
      //   지연 판정에 쓰면 위의 오작동이 그대로 재발합니다. 휴지통·삭제 여부와
      //   무관하게 봅니다(목록 상태가 아니라 수집 이력이므로).
      supabaseAdmin
        .from("mail_messages")
        .select("fetched_at")
        .not("fetched_at", "is", null)
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      loadActiveStaff(),
      // 분류 인덱스 배지 — 각 분류 + 마지막 하나는 "전체"(분류 무관).
      Promise.all([
        ...MAIL_CATEGORY_INDEX.map((c) => unopenedCountQuery(c)),
        unopenedCountQuery(null),
      ]),
      // 보낸메일함일 때만 실제로 읽습니다.
      sentView ? loadSentList(filters?.q ?? "") : Promise.resolve([]),
    ]);

  if (tableMissing(listQuery.error)) {
    return {
      configured: false,
      items: [],
      sent: [],
      unreadCount: 0,
      categoryUnopened: {},
      unopenedCount: 0,
      assignees: staff,
      usedAssignees: [],
      lastFetchedAt: null,
      lastMailAt: null,
      fetchStale: false,
    };
  }
  if (listQuery.error) throw new Error(listQuery.error.message);

  const used = new Set<string>();
  for (const r of assignedQuery.data ?? []) {
    const n = String((r as { assignee_name: unknown }).assignee_name ?? "").trim();
    if (n) used.add(n);
  }

  // settings 행이 없으면 null — 신규 배포 직후 첫 Cron 전까지가 그렇습니다.
  //   isMailFetchStale 이 null 을 "경고 없음" 으로 보므로 별도 처리가 없습니다.
  const lastFetchedAt =
    ((lastFetchQuery.data as { value?: string | null } | null)?.value) ?? null;
  const lastMailAt =
    ((lastMailQuery.data as { fetched_at?: string | null } | null)
      ?.fetched_at) ?? null;

  const categoryUnopened: Record<string, number> = {};
  MAIL_CATEGORY_INDEX.forEach((c, i) => {
    categoryUnopened[c] = categoryCounts[i]?.count ?? 0;
  });

  return {
    configured: true,
    items: ((listQuery.data ?? []) as Record<string, unknown>[]).map(toListItem),
    sent: sentItems,
    unreadCount: unreadQuery.count ?? 0,
    categoryUnopened,
    unopenedCount: categoryCounts[MAIL_CATEGORY_INDEX.length]?.count ?? 0,
    assignees: staff,
    usedAssignees: [...used].sort((a, b) => a.localeCompare(b, "ko")),
    lastFetchedAt,
    lastMailAt,
    // 지연 판정은 서버에서 — 클라이언트에서 계산하면 하이드레이션이 어긋납니다.
    //   판정 입력은 반드시 lastFetchedAt(접속 시각). lastMailAt 이 아닙니다.
    fetchStale: isMailFetchStale(lastFetchedAt, Date.now()),
  };
}

// 미처리 건수만 — 대시보드 카드 배지용(테이블 없으면 0).
export async function getUnreadMailCount(): Promise<number> {
  const ctx = await resolveSafely();
  if (!ctx) return 0;
  const { count, error } = await supabaseAdmin
    .from("mail_messages")
    .select("id", { count: "exact", head: true })
    .eq("status", "unread")
    .is("deleted_at", null);
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
    fetched_at: (raw.fetched_at as string | null) ?? null,
  };
}

// 첨부 다운로드는 서버액션이 아니라 라우트가 맡습니다.
//   app/api/mail/attachment/[id]/[index]/route.ts 참고. 예전의
//   signMailAttachment(path) 는 두 가지 이유로 제거했습니다.
//     1) 화면이 await 뒤에 window.open 을 불러 팝업 차단에 걸렸습니다.
//     2) 클라이언트가 버킷 안 임의 경로를 지정할 수 있었습니다.

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

// 상세를 열었을 때 1회 기록 — 이미 열린 적이 있으면 덮어쓰지 않습니다
// (최초 열람 시각을 보존). 실패해도 열람 자체를 막지 않으므로 조용히 넘어갑니다.
export async function markMailOpened(id: string): Promise<void> {
  try {
    await requireMailAccess();
    if (!id) return;
    const { error } = await supabaseAdmin
      .from("mail_messages")
      .update({ opened_at: new Date().toISOString() })
      .eq("id", id)
      .is("opened_at", null);
    if (error) console.warn("[mail] 열람 기록 실패:", error.message);
  } catch (e) {
    console.warn(
      "[mail] 열람 기록 실패:",
      e instanceof Error ? e.message : e,
    );
  }
}

// =====================================================================
// 일괄 처리 (ML-10)
//   * 전부 요청한 id 목록에 한정합니다. "조건에 맞는 전체" 를 서버가 다시
//     계산하지 않으므로, 화면에서 본 것과 다른 대상이 처리될 일이 없습니다.
//   * 상한(BULK_LIMIT)을 둬 사고 범위를 제한합니다.
// =====================================================================

type BulkResult = { ok: true; count: number } | { ok: false; message: string };

function checkIds(ids: string[]): string[] | null {
  const clean = [...new Set(ids.filter((i) => typeof i === "string" && i))];
  if (clean.length === 0 || clean.length > BULK_LIMIT) return null;
  return clean;
}

export async function bulkTrashMail(ids: string[]): Promise<BulkResult> {
  try {
    await requireMailAccess();
    const clean = checkIds(ids);
    if (!clean)
      return { ok: false, message: `1~${BULK_LIMIT}건까지 선택해주세요.` };
    const { error } = await supabaseAdmin
      .from("mail_messages")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", clean);
    if (error) throw new Error(error.message);
    revalidatePath("/mail");
    return { ok: true, count: clean.length };
  } catch (e) {
    return actionError(e, "삭제하지 못했습니다.") as BulkResult;
  }
}

export async function bulkRestoreMail(ids: string[]): Promise<BulkResult> {
  try {
    await requireMailAccess();
    const clean = checkIds(ids);
    if (!clean)
      return { ok: false, message: `1~${BULK_LIMIT}건까지 선택해주세요.` };
    const { error } = await supabaseAdmin
      .from("mail_messages")
      .update({ deleted_at: null })
      .in("id", clean);
    if (error) throw new Error(error.message);
    revalidatePath("/mail");
    return { ok: true, count: clean.length };
  } catch (e) {
    return actionError(e, "복구하지 못했습니다.") as BulkResult;
  }
}

export async function bulkSetMailStatus(
  ids: string[],
  status: string,
): Promise<BulkResult> {
  try {
    await requireMailAccess();
    if (!isMailStatus(status))
      return { ok: false, message: "알 수 없는 상태입니다." };
    const clean = checkIds(ids);
    if (!clean)
      return { ok: false, message: `1~${BULK_LIMIT}건까지 선택해주세요.` };
    const { error } = await supabaseAdmin
      .from("mail_messages")
      .update({ status })
      .in("id", clean);
    if (error) throw new Error(error.message);
    revalidatePath("/mail");
    return { ok: true, count: clean.length };
  } catch (e) {
    return actionError(e, "상태를 변경하지 못했습니다.") as BulkResult;
  }
}

// 일괄 담당 지정 — 슬랙 DM 은 담당자당 1건으로 묶어 보냅니다.
//   (10통을 한 번에 배정했다고 DM 을 10개 보내면 알림 폭탄이 됩니다)
export async function bulkAssignMail(
  ids: string[],
  assignee: string,
): Promise<BulkResult> {
  try {
    await requireMailAccess();
    const clean = checkIds(ids);
    if (!clean)
      return { ok: false, message: `1~${BULK_LIMIT}건까지 선택해주세요.` };
    const name = assignee.trim();

    const { error } = await supabaseAdmin
      .from("mail_messages")
      .update({ assignee_name: name })
      .in("id", clean);
    if (error) throw new Error(error.message);

    if (name) {
      await notifyAssignee(
        name,
        clean.length === 1
          ? "메일 1건"
          : `메일 ${clean.length}건이 한 번에 배정되었습니다`,
      );
    }
    revalidatePath("/mail");
    return { ok: true, count: clean.length };
  } catch (e) {
    return actionError(e, "담당자를 지정하지 못했습니다.") as BulkResult;
  }
}

// 휴지통 영구 삭제 — 첨부 Storage 파일·답장 이력까지 정리합니다.
//   ★ 이미 휴지통에 있는(deleted_at NOT NULL) 메일만 지웁니다. 목록에서
//     실수로 호출돼도 살아 있는 메일은 절대 지워지지 않습니다.
//   ★ 네이버 원본은 건드리지 않습니다.
export async function bulkPurgeMail(ids: string[]): Promise<BulkResult> {
  try {
    await requireMailAccess();
    const clean = checkIds(ids);
    if (!clean)
      return { ok: false, message: `1~${BULK_LIMIT}건까지 선택해주세요.` };

    // 휴지통에 있는 것만 대상으로 좁힙니다(서버측 이중 방어).
    const { data, error } = await supabaseAdmin
      .from("mail_messages")
      .select("id, attachments")
      .in("id", clean)
      .not("deleted_at", "is", null);
    if (error) throw new Error(error.message);

    const targets = (data ?? []) as Record<string, unknown>[];
    if (targets.length === 0)
      return { ok: false, message: "휴지통에 있는 메일만 영구 삭제할 수 있습니다." };

    const targetIds = targets.map((r) => String(r.id));
    const paths = targets
      .flatMap((r) => (Array.isArray(r.attachments) ? r.attachments : []))
      .map((a) => {
        const o = (a ?? {}) as Record<string, unknown>;
        return typeof o.storage_path === "string" ? o.storage_path : null;
      })
      .filter((p): p is string => !!p);

    if (paths.length > 0) {
      const { error: removeError } = await supabaseAdmin.storage
        .from(MAIL_BUCKET)
        .remove(paths);
      if (removeError)
        console.warn("[mail] 첨부 삭제 실패:", removeError.message);
    }
    await supabaseAdmin.from("mail_replies").delete().in("mail_id", targetIds);
    const { error: deleteError } = await supabaseAdmin
      .from("mail_messages")
      .delete()
      .in("id", targetIds);
    if (deleteError) throw new Error(deleteError.message);

    revalidatePath("/mail");
    return { ok: true, count: targetIds.length };
  } catch (e) {
    return actionError(e, "영구 삭제하지 못했습니다.") as BulkResult;
  }
}

// 분류 수동 수정 — 사람이 칸을 직접 고칩니다.
//   ★ category_source='manual' 을 함께 찍는 것이 핵심입니다. 이 표시가 있으면
//     자동 분류(키워드·발신자·AI)와 재분류 스크립트가 이 메일을 건너뜁니다.
//     또 발신자 학습에서 3배 가중치를 받아, 한 통을 고치면 같은 발신자의
//     다음 메일부터 그 판단이 반영됩니다.
//   요약(ai_summary)은 건드리지 않습니다 — 분류만 바꾸는 것이므로 AI 가 쓴
//     요약은 그대로 두는 편이 사람이 판단하기에 낫습니다.
export async function setMailCategory(
  id: string,
  category: string,
): Promise<ActionResult> {
  try {
    await requireMailAccess();
    if (!id) return { ok: false, message: "대상 메일이 없습니다." };
    if (!isMailCategory(category))
      return { ok: false, message: "알 수 없는 분류입니다." };

    const { error } = await supabaseAdmin
      .from("mail_messages")
      .update({ ai_category: category, category_source: "manual" })
      .eq("id", id);
    if (error) throw new Error(error.message);

    revalidatePath("/mail");
    return { ok: true };
  } catch (e) {
    return actionError(e, "분류를 변경하지 못했습니다.");
  }
}

// [AI 분석] — 수집 당시 분석에 실패했거나 키가 없던 메일을 사람이 다시 요청.
//   * 분류기가 모든 실패를 내부에서 삼키므로, 결과가 비면 "분석하지 못함" 으로
//     안내만 하고 메일 자체에는 영향이 없습니다.
//   * force: 이미 분석된 메일도 다시 분석합니다(사람이 명시적으로 누른 경우).
export async function analyzeMailNow(
  id: string,
): Promise<
  { ok: true; assigned: string } | { ok: false; message: string }
> {
  try {
    await requireMailAccess();
    if (!id) return { ok: false, message: "대상 메일이 없습니다." };
    if (!isClassifierConfigured()) {
      return {
        ok: false,
        message: "AI 분석 설정이 없습니다. (ANTHROPIC_API_KEY 환경변수)",
      };
    }

    const result = await runMailClassification({ ids: [id], force: true });
    revalidatePath("/mail");
    if (result.processed === 0) {
      return {
        ok: false,
        message: "AI가 이 메일을 분석하지 못했습니다. 잠시 후 다시 시도해주세요.",
      };
    }
    // 자동 지정까지 됐으면 담당자 이름을 돌려줘 화면에서 안내합니다.
    return { ok: true, assigned: result.autoAssigned[0]?.assignee ?? "" };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "AI 분석에 실패했습니다.",
    };
  }
}

// 추천 담당자 적용 — 저장된 ai_suggested_assignee 를 그대로 담당자로 지정합니다.
//   실제 지정·슬랙 DM 은 assignMail 과 같은 경로를 씁니다(동작 일관성).
export async function applySuggestedAssignee(
  id: string,
): Promise<{ ok: true; assignee: string } | { ok: false; message: string }> {
  try {
    await requireMailAccess();
    if (!id) return { ok: false, message: "대상 메일이 없습니다." };

    const { data, error } = await supabaseAdmin
      .from("mail_messages")
      .select("ai_suggested_assignee")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const suggested = String(
      (data as { ai_suggested_assignee?: unknown } | null)
        ?.ai_suggested_assignee ?? "",
    ).trim();
    if (!suggested)
      return { ok: false, message: "적용할 추천 담당자가 없습니다." };

    const res = await assignMail(id, suggested);
    if (!res.ok) return res;
    return { ok: true, assignee: suggested };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "추천을 적용하지 못했습니다.",
    };
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

// =====================================================================
// ML-7 답장 — 네이버 SMTP 발신 + 이력 공유
// =====================================================================

// 답장·전달 폼 기본값 — 받는사람/제목/원문 인용을 서버에서 만들어 내려줍니다.
//   * kind="reply"   : 받는사람 = 원본 보낸사람, 제목 = RE:, "> " 인용
//   * kind="forward" : 받는사람 = 빈칸(사람이 입력), 제목 = FW:, 원문 그대로
//   첨부 목록도 함께 내려 폼에서 체크로 골라 다시 붙일 수 있게 합니다.
export type MailDraft = {
  configured: boolean;
  kind: MailReplyKind;
  to: string;
  subject: string;
  quoted: string;
  attachments: MailAttachmentMeta[];
  maxBytes: number;
};

export async function getMailDraft(
  id: string,
  kind: MailReplyKind,
): Promise<MailDraft | null> {
  await requireMailAccess();
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from("mail_messages")
    .select("from_name, from_email, subject, body_text, received_at, attachments")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const raw = data as Record<string, unknown>;

  const fromName = String(raw.from_name ?? "");
  const fromEmail = String(raw.from_email ?? "");
  const subject = String(raw.subject ?? "");
  const receivedAt = (raw.received_at as string | null) ?? null;
  const body = String(raw.body_text ?? "");
  const forward = kind === "forward";

  return {
    configured: isReplyConfigured(),
    kind,
    // 전달은 받는사람이 정해져 있지 않습니다 — 원본 보낸사람에게 되돌려
    //   보내는 사고를 막으려고 일부러 비웁니다.
    to: forward ? "" : fromEmail,
    subject: forward ? forwardSubject(subject) : replySubject(subject),
    quoted: forward
      ? quoteForward({ fromName, fromEmail, receivedAt, subject, body })
      : quoteOriginal({ fromName, fromEmail, receivedAt, body }),
    attachments: toAttachments(raw.attachments),
    maxBytes: MAIL_SEND_MAX_BYTES,
  };
}

export async function listMailReplies(id: string): Promise<MailReply[]> {
  await requireMailAccess();
  if (!id) return [];
  const { data, error } = await supabaseAdmin
    .from("mail_replies")
    .select("*")
    .eq("mail_id", id)
    .order("sent_at", { ascending: false });
  if (error) {
    if (tableMissing(error)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id ?? ""),
    kind: isMailReplyKind(r.kind) ? r.kind : "reply",
    to_email: String(r.to_email ?? ""),
    cc_email: String(r.cc_email ?? ""),
    subject: String(r.subject ?? ""),
    body: String(r.body ?? ""),
    attachments: toReplyAttachments(r.attachments),
    sent_by: String(r.sent_by ?? ""),
    sent_at: String(r.sent_at ?? ""),
    status: r.status === "failed" ? "failed" : "sent",
    error_message: (r.error_message as string | null) ?? null,
  }));
}

// 답장 보내기.
//   * 성공: mail_replies(status=sent) 기록 + (옵션) 원 메일 상태를 done 으로.
//   * 실패: mail_replies(status=failed, error_message) 기록 후 사유를 반환.
//     SMTP 실패가 화면 전체를 죽이지 않도록 여기서 잡아 결과로 돌려줍니다.
//   * 네이버 원본은 어떤 경우에도 건드리지 않습니다.
// 재첨부 대상을 고르고 Storage 에서 바이트를 읽어옵니다.
//   ★ 화면이 보낸 순번만 믿고 경로를 받지 않습니다 — 경로를 받으면 버킷 안
//     아무 파일이나 붙여 보낼 수 있게 됩니다(0단계에서 닫은 것과 같은 문).
//   ★ 크기 검사는 화면에서도 하지만 여기서 다시 합니다. 화면 검사는 안내용이고
//     실제 방어선은 이쪽입니다.
async function collectOutgoingAttachments(
  mailId: string,
  indexes: number[],
): Promise<
  | { ok: true; files: OutgoingAttachment[]; meta: MailReplyAttachment[] }
  | { ok: false; message: string }
> {
  const picked = [...new Set(indexes)].filter(
    (i) => Number.isInteger(i) && i >= 0,
  );
  if (picked.length === 0) return { ok: true, files: [], meta: [] };

  const { data, error } = await supabaseAdmin
    .from("mail_messages")
    .select("attachments")
    .eq("id", mailId)
    .maybeSingle();
  if (error || !data)
    return { ok: false, message: "원본 메일의 첨부를 찾지 못했습니다." };

  const all = toAttachments((data as { attachments: unknown }).attachments);
  const chosen: MailAttachmentMeta[] = [];
  for (const i of picked) {
    const att = all[i];
    if (!att) return { ok: false, message: "첨부 목록이 바뀌었습니다. 다시 열어주세요." };
    if (!canAttachToOutgoing(att)) {
      // 사본이 없으면 붙일 것이 없습니다. 화면이 막아 두지만 여기서도 거릅니다.
      return { ok: false, message: attachmentSkipNotice(att.name, att.skip_reason) };
    }
    chosen.push(att);
  }

  const total = sendAttachmentTotal(chosen);
  if (total > MAIL_SEND_MAX_BYTES) {
    return {
      ok: false,
      message: `첨부 합계가 ${formatBytes(total)} 입니다. ${formatBytes(
        MAIL_SEND_MAX_BYTES,
      )} 이하만 보낼 수 있습니다. 파일을 덜어내고 다시 시도해주세요.`,
    };
  }

  const files: OutgoingAttachment[] = [];
  for (const att of chosen) {
    const bytes = await readAttachmentBytes(att.storage_path!);
    if (!bytes)
      return {
        ok: false,
        message: `${att.name} 을(를) 읽지 못해 보내지 않았습니다. 다시 시도해주세요.`,
      };
    // filename 은 반드시 원본 이름 — Storage 키(ASCII 안전 이름)를 쓰면
    //   받는 사람에게 "1-26105.hwp" 로 도착합니다.
    files.push({ filename: att.name, content: bytes });
  }
  return {
    ok: true,
    files,
    meta: chosen.map((a) => ({ name: a.name, size: a.size })),
  };
}

export async function sendMailReply(input: {
  id: string;
  kind?: MailReplyKind;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  attachIndexes?: number[];
  markDone: boolean;
}): Promise<ActionResult> {
  let ctxName = "";
  try {
    const ctx = await requireMailAccess();
    ctxName = ctx.name;

    const id = input.id;
    if (!id) return { ok: false, message: "대상 메일이 없습니다." };
    const kind: MailReplyKind = isMailReplyKind(input.kind)
      ? input.kind
      : "reply";
    const to = input.to.trim();
    if (!to) return { ok: false, message: "받는사람 주소를 입력해주세요." };
    const cc = (input.cc ?? "").trim();
    const body = input.body.trim();
    if (!body) return { ok: false, message: "본문을 입력해주세요." };
    const subject =
      input.subject.trim() ||
      (kind === "forward" ? "FW: (제목 없음)" : "RE: (제목 없음)");

    if (!isReplyConfigured()) {
      return {
        ok: false,
        message:
          "발신 설정이 필요합니다. (NAVER_POP_USER / NAVER_POP_PASSWORD 환경변수)",
      };
    }

    // 첨부를 모읍니다. 여기서 막히면 아직 아무것도 보내지 않은 상태라
    //   이력도 남기지 않습니다(보내려다 만 것은 '실패' 가 아닙니다).
    const picked = await collectOutgoingAttachments(
      id,
      input.attachIndexes ?? [],
    );
    if (!picked.ok) return { ok: false, message: picked.message };

    const record = {
      mail_id: id,
      kind,
      to_email: to,
      cc_email: cc || null,
      subject,
      body,
      attachments: picked.meta,
      sent_by: ctxName,
    };

    try {
      await sendReply({
        to,
        cc,
        subject,
        text: body,
        attachments: picked.files,
      });
    } catch (sendError) {
      const message =
        sendError instanceof Error
          ? sendError.message
          : "메일 발송에 실패했습니다.";
      // 실패도 이력으로 남깁니다(재시도 판단·공유 목적). 보낸메일함에서
      //   사유와 함께 보입니다 — 실패가 조용히 묻히지 않게 하는 지점입니다.
      await supabaseAdmin
        .from("mail_replies")
        .insert({ ...record, status: "failed", error_message: message });
      revalidatePath("/mail");
      return { ok: false, message: `발송 실패: ${message}` };
    }

    const { error } = await supabaseAdmin
      .from("mail_replies")
      .insert({ ...record, status: "sent" });
    if (error) {
      // 메일은 이미 나갔으므로 실패로 되돌리지 않고 경고만 남깁니다.
      console.warn("[mail] 발송 이력 저장 실패:", error.message);
    }

    if (input.markDone) {
      await supabaseAdmin
        .from("mail_messages")
        .update({ status: "done" })
        .eq("id", id);
    }

    revalidatePath("/mail");
    return { ok: true };
  } catch (e) {
    return actionError(e, "메일을 보내지 못했습니다.");
  }
}

// =====================================================================
// ML-7 휴지통 — deleted_at 기록/해제(행은 지우지 않음)
//   실제 삭제는 30일 뒤 mail-digest Cron 에서 수행합니다.
// =====================================================================

export async function trashMail(id: string): Promise<ActionResult> {
  try {
    await requireMailAccess();
    if (!id) return { ok: false, message: "대상 메일이 없습니다." };
    const { error } = await supabaseAdmin
      .from("mail_messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/mail");
    return { ok: true };
  } catch (e) {
    return actionError(e, "삭제하지 못했습니다.");
  }
}

export async function restoreMail(id: string): Promise<ActionResult> {
  try {
    await requireMailAccess();
    if (!id) return { ok: false, message: "대상 메일이 없습니다." };
    const { error } = await supabaseAdmin
      .from("mail_messages")
      .update({ deleted_at: null })
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/mail");
    return { ok: true };
  } catch (e) {
    return actionError(e, "복구하지 못했습니다.");
  }
}

// [지금 가져오기] — Cron 과 같은 수집기를 수동 실행합니다(원본 삭제 없음).
export async function fetchMailNow(): Promise<
  | {
      ok: true;
      saved: number;
      remaining: number;
      failed: number;
      classified: number;
      autoAssigned: number;
      dmSent: number;
      // 담당자 DM 이 실패했으면 사유를 화면에 그대로 보여줍니다.
      dmFailures: { name: string; reason: string }[];
    }
  | { ok: false; message: string }
> {
  try {
    await requireMailAccess();
    // ML-9: 담당자 DM 은 트리거와 무관하게 항상 보냅니다.
    //   (버튼을 누른 사람과 DM 을 받아야 할 담당자는 서로 다른 사람입니다)
    const summary = await runMailFetch();
    if (!summary.ok)
      return { ok: false, message: summary.message ?? "수집하지 못했습니다." };
    revalidatePath("/mail");
    return {
      ok: true,
      saved: summary.saved,
      remaining: summary.remaining,
      failed: summary.failed,
      classified: summary.classified,
      autoAssigned: summary.autoAssigned,
      dmSent: summary.dmSent,
      dmFailures: summary.dmFailures,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "수집 중 오류가 발생했습니다.",
    };
  }
}
