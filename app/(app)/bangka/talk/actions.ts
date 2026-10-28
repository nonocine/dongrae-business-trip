"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { canApproveAbsence, requireBangkaAccess, type BangkaAccess } from "@/lib/bangkaAccess";
import { BK_SCOPE_LABEL, type BkScope } from "@/lib/bangkaContent";
import {
  TALK_MAX_BODY,
  isTalkStatus,
  waitingLabel,
  type TalkClassFilter,
  type TalkMessageRow,
  type TalkStatus,
  type TalkThreadDetail,
  type TalkThreadRow,
  type TalkView,
} from "@/lib/bangkaTalk";
import { DEFAULT_TALK_HOURS, staleDeadlineMs, toMinutes, type TalkHours } from "@/lib/talkHours";

// =====================================================================
// 방카톡(직원) — /bangka/talk
//   · 보기·답글·가리기·닫기: 방과후아카데미 담당자 누구나(bangka 직무 + 관장·부장).
//   · 답글은 로그인 직원 이름으로, 시간 제한 없음, 닫힌 대화에도 가능(닫으면서 마지막 안내).
//   · 고치기·지우기는 자기 답글만(결정 4). 보호자 글은 지우지 않고 [가리기](사유 필수)만.
//   · 운영시간 설정: 관장·부장·방카 팀장(결정 7, 공결 결재권과 같은 기준).
//   bk_talk_* 는 service_role 전용 — 모든 액션이 진입 시 권한을 다시 봅니다.
// =====================================================================

const BASE = "/bangka/talk";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const fail = (e: unknown, fb: string) => ({ ok: false as const, message: e instanceof Error ? e.message : fb });

function cleanBody(v: unknown): string {
  const body = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "";
  if (!body) throw new Error("내용을 적어 주세요.");
  if (body.length > TALK_MAX_BODY) throw new Error(`${TALK_MAX_BODY}자까지 쓸 수 있습니다.`);
  return body;
}

// --- 운영시간 ---------------------------------------------------------------

export async function getTalkHours(): Promise<TalkHours> {
  await requireBangkaAccess();
  const { data } = await supabaseAdmin
    .from("bk_talk_settings")
    .select("weekdays, open_time, close_time, block_holidays, extra_closed_dates, closed_notice")
    .eq("id", 1)
    .maybeSingle();
  const d = data as Partial<TalkHours> | null;
  if (!d) return DEFAULT_TALK_HOURS;
  return {
    weekdays: Array.isArray(d.weekdays) ? d.weekdays.map(Number) : DEFAULT_TALK_HOURS.weekdays,
    open_time: typeof d.open_time === "string" ? d.open_time : DEFAULT_TALK_HOURS.open_time,
    close_time: typeof d.close_time === "string" ? d.close_time : DEFAULT_TALK_HOURS.close_time,
    block_holidays: typeof d.block_holidays === "boolean" ? d.block_holidays : true,
    extra_closed_dates: Array.isArray(d.extra_closed_dates) ? d.extra_closed_dates.filter((x) => YMD.test(String(x))) : [],
    closed_notice: typeof d.closed_notice === "string" && d.closed_notice.trim() ? d.closed_notice : DEFAULT_TALK_HOURS.closed_notice,
  };
}

export async function canEditTalkSettings(): Promise<boolean> {
  return canApproveAbsence(await requireBangkaAccess());
}

export type TalkSettingsInput = {
  weekdays: number[];
  openTime: string;
  closeTime: string;
  blockHolidays: boolean;
  extraClosedDates: string[];
  closedNotice: string;
};

export async function saveTalkSettings(input: TalkSettingsInput): Promise<Result> {
  try {
    const me = await requireBangkaAccess();
    if (!canApproveAbsence(me)) throw new Error("운영시간은 관장·부장·방과후아카데미 팀장만 바꿀 수 있습니다.");
    const weekdays = [...new Set((input.weekdays ?? []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
    const open = toMinutes(input.openTime);
    const close = toMinutes(input.closeTime);
    if (open == null || close == null) throw new Error("시작·끝 시각을 확인해 주세요.");
    if (open >= close) throw new Error("끝 시각을 시작 시각보다 늦게 골라 주세요.");
    const dates = [...new Set((input.extraClosedDates ?? []).filter((d) => YMD.test(d)))].sort();
    const notice = String(input.closedNotice ?? "").trim().slice(0, 500);
    if (!notice) throw new Error("운영시간 밖 안내 문구를 적어 주세요.");
    const { error } = await supabaseAdmin
      .from("bk_talk_settings")
      .upsert({
        id: 1,
        weekdays,
        open_time: input.openTime,
        close_time: input.closeTime,
        block_holidays: !!input.blockHolidays,
        extra_closed_dates: dates,
        closed_notice: notice,
        updated_at: new Date().toISOString(),
        updated_by: me.name,
      });
    if (error) throw new Error(error.message);
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e, "운영시간을 저장하지 못했습니다.");
  }
}

// --- 목록 -------------------------------------------------------------------

// 미답변 수 — 상단 '방카톡' 탭·메뉴 배지.
export async function countOpenTalks(): Promise<number> {
  await requireBangkaAccess();
  const { count, error } = await supabaseAdmin
    .from("bk_talk_threads")
    .select("id", { count: "exact", head: true })
    .eq("status", "open")
    .is("deleted_at", null);
  if (error) return 0;
  return count ?? 0;
}

type RawThread = {
  id: string;
  status: string;
  topic_type: "general" | "post" | "session";
  post_id: string | null;
  topic_title: string | null;
  last_message_at: string;
  last_guardian_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
  bk_guardians: { name: string | null; bk_guardian_students: { bk_students: { class_code: string | null } | null }[] | null } | null;
  bk_students: { name: string | null; class_code: string | null } | null;
};

const THREAD_SELECT =
  "id, status, topic_type, post_id, topic_title, last_message_at, last_guardian_at, closed_at, closed_by, " +
  "bk_guardians(name, bk_guardian_students(bk_students(class_code))), bk_students(name, class_code)";

const classCodesOf = (t: RawThread): string[] =>
  t.bk_students?.class_code
    ? [t.bk_students.class_code]
    : [...new Set((t.bk_guardians?.bk_guardian_students ?? []).map((g) => g.bk_students?.class_code ?? "").filter(Boolean))];

function previewOf(m: { author_type: string; staff_name: string | null; body: string; deleted_at: string | null; hidden_at: string | null }): string {
  const who = m.author_type === "staff" ? `${m.staff_name ?? "직원"}: ` : "";
  if (m.hidden_at) return `${who}(가린 글)`;
  if (m.deleted_at) return `${who}(지운 글)`;
  return `${who}${String(m.body ?? "").replace(/\s+/g, " ").slice(0, 80)}`;
}

export async function listTalkThreads(view: TalkView, cls: TalkClassFilter): Promise<TalkThreadRow[]> {
  await requireBangkaAccess();
  const nowMs = Date.now();
  let q = supabaseAdmin
    .from("bk_talk_threads")
    .select(THREAD_SELECT)
    .is("deleted_at", null)
    .order("last_message_at", { ascending: view === "open" })
    .limit(300);
  if (view === "open") q = q.eq("status", "open");
  if (view === "closed") q = q.eq("status", "closed");
  const [{ data, error }, hours] = await Promise.all([q, getTalkHours()]);
  if (error) throw new Error(error.message);
  let threads = (data ?? []) as unknown as RawThread[];
  if (cls !== "all") threads = threads.filter((t) => classCodesOf(t).includes(cls));
  if (threads.length === 0) return [];

  const { data: msgs } = await supabaseAdmin
    .from("bk_talk_messages")
    .select("thread_id, author_type, staff_name, body, deleted_at, hidden_at, created_at")
    .in("thread_id", threads.map((t) => t.id))
    .order("created_at", { ascending: false })
    .limit(2000);
  const last = new Map<string, string>();
  for (const m of (msgs ?? []) as { thread_id: string; author_type: string; staff_name: string | null; body: string; deleted_at: string | null; hidden_at: string | null }[]) {
    if (!last.has(m.thread_id)) last.set(m.thread_id, previewOf(m));
  }

  return threads.map((t) => {
    const status: TalkStatus = isTalkStatus(t.status) ? t.status : "open";
    const since = t.last_guardian_at ? Date.parse(t.last_guardian_at) : NaN;
    const open = status === "open" && !Number.isNaN(since);
    const deadline = open ? staleDeadlineMs(hours, since) : null;
    return {
      id: t.id,
      status,
      topicTitle: t.topic_title ?? "일반 문의",
      guardianName: t.bk_guardians?.name ?? "(보호자)",
      studentName: t.bk_students?.name ?? null,
      classCodes: classCodesOf(t),
      lastMessageAt: t.last_message_at,
      lastGuardianAt: t.last_guardian_at,
      preview: last.get(t.id) ?? "",
      waiting: open ? waitingLabel(since, nowMs) : null,
      stale: open && deadline != null && nowMs > deadline,
    };
  });
}

// --- 대화 하나 --------------------------------------------------------------

type RawMessage = {
  id: string;
  author_type: "guardian" | "staff";
  staff_driver_id: string | null;
  staff_name: string | null;
  body: string;
  edited_at: string | null;
  deleted_at: string | null;
  hidden_at: string | null;
  hidden_by: string | null;
  hidden_reason: string | null;
  created_at: string;
};

const isMine = (me: BangkaAccess, m: Pick<RawMessage, "author_type" | "staff_driver_id" | "staff_name">) =>
  m.author_type === "staff" && (me.driverId ? m.staff_driver_id === me.driverId : m.staff_name === me.name);

export async function getTalkThread(id: string): Promise<TalkThreadDetail | null> {
  const me = await requireBangkaAccess();
  if (!UUID.test(id)) return null;
  const { data } = await supabaseAdmin.from("bk_talk_threads").select(THREAD_SELECT).eq("id", id).is("deleted_at", null).maybeSingle();
  const t = data as unknown as RawThread | null;
  if (!t) return null;
  const { data: msgs, error } = await supabaseAdmin
    .from("bk_talk_messages")
    .select("id, author_type, staff_driver_id, staff_name, body, edited_at, deleted_at, hidden_at, hidden_by, hidden_reason, created_at")
    .eq("thread_id", t.id)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  const guardianName = t.bk_guardians?.name ?? "(보호자)";
  const messages: TalkMessageRow[] = ((msgs ?? []) as RawMessage[]).map((m) => ({
    id: m.id,
    authorType: m.author_type,
    authorName: m.author_type === "staff" ? m.staff_name ?? "직원" : `${guardianName} 보호자`,
    body: m.body,
    createdAt: m.created_at,
    edited: !!m.edited_at,
    deleted: !!m.deleted_at,
    hiddenAt: m.hidden_at,
    hiddenBy: m.hidden_by,
    hiddenReason: m.hidden_reason,
    mine: isMine(me, m),
  }));
  return {
    id: t.id,
    status: isTalkStatus(t.status) ? t.status : "open",
    topicTitle: t.topic_title ?? "일반 문의",
    topicType: t.topic_type,
    postId: t.post_id,
    guardianName,
    studentName: t.bk_students?.name ?? null,
    classLabel: classCodesOf(t).map((c) => BK_SCOPE_LABEL[c as BkScope] ?? c).join("·"),
    closedAt: t.closed_at,
    closedBy: t.closed_by,
    messages,
  };
}

// --- 쓰기 -------------------------------------------------------------------

async function threadExists(id: string): Promise<void> {
  if (!UUID.test(id)) throw new Error("잘못된 요청입니다.");
  const { data } = await supabaseAdmin.from("bk_talk_threads").select("id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!data) throw new Error("대화를 찾을 수 없습니다. 보호자가 지웠을 수 있습니다.");
}

function done(threadId: string) {
  revalidatePath(BASE, "layout");
  revalidatePath(`${BASE}/${threadId}`);
}

// 답글 — 로그인 직원 이름으로. 상태(answered)·시각은 DB 트리거가 바꿈.
export async function replyTalk(threadId: string, body: string): Promise<Result> {
  try {
    const me = await requireBangkaAccess();
    const text = cleanBody(body);
    await threadExists(threadId);
    const { error } = await supabaseAdmin
      .from("bk_talk_messages")
      .insert({ thread_id: threadId, author_type: "staff", staff_driver_id: me.driverId, staff_name: me.name, body: text });
    if (error) throw new Error(error.message);
    done(threadId);
    return { ok: true };
  } catch (e) {
    return fail(e, "답글을 저장하지 못했습니다.");
  }
}

// 내 답글 하나 — 다른 직원 답글이면 거절.
async function myMessage(me: BangkaAccess, threadId: string, messageId: string): Promise<RawMessage> {
  if (!UUID.test(threadId) || !UUID.test(messageId)) throw new Error("잘못된 요청입니다.");
  const { data } = await supabaseAdmin
    .from("bk_talk_messages")
    .select("id, author_type, staff_driver_id, staff_name, body, edited_at, deleted_at, hidden_at, hidden_by, hidden_reason, created_at")
    .eq("id", messageId)
    .eq("thread_id", threadId)
    .maybeSingle();
  const m = data as RawMessage | null;
  if (!m) throw new Error("글을 찾을 수 없습니다.");
  if (!isMine(me, m)) throw new Error("내가 쓴 답글만 고치거나 지울 수 있습니다.");
  if (m.deleted_at) throw new Error("이미 지운 답글입니다.");
  return m;
}

export async function editMyReply(threadId: string, messageId: string, body: string): Promise<Result> {
  try {
    const me = await requireBangkaAccess();
    const text = cleanBody(body);
    const m = await myMessage(me, threadId, messageId);
    const { error } = await supabaseAdmin
      .from("bk_talk_messages")
      .update({ body: text, edited_at: new Date().toISOString() })
      .eq("id", m.id)
      .eq("thread_id", threadId);
    if (error) throw new Error(error.message);
    done(threadId);
    return { ok: true };
  } catch (e) {
    return fail(e, "답글을 고치지 못했습니다.");
  }
}

export async function deleteMyReply(threadId: string, messageId: string): Promise<Result> {
  try {
    const me = await requireBangkaAccess();
    const m = await myMessage(me, threadId, messageId);
    const { error } = await supabaseAdmin
      .from("bk_talk_messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", m.id)
      .eq("thread_id", threadId);
    if (error) throw new Error(error.message);
    done(threadId);
    return { ok: true };
  } catch (e) {
    return fail(e, "답글을 지우지 못했습니다.");
  }
}

// 가리기(부적절한 글·개인정보) — 사유 필수. 보호자 화면에서도 내용 대신 "선생님이 가린 글입니다(사유)".
export async function hideTalkMessage(threadId: string, messageId: string, reason: string): Promise<Result> {
  try {
    const me = await requireBangkaAccess();
    const why = String(reason ?? "").trim().slice(0, 200);
    if (!why) throw new Error("가리는 이유를 적어 주세요(보호자에게도 보입니다).");
    if (!UUID.test(threadId) || !UUID.test(messageId)) throw new Error("잘못된 요청입니다.");
    const { data, error } = await supabaseAdmin
      .from("bk_talk_messages")
      .update({ hidden_at: new Date().toISOString(), hidden_by: me.name, hidden_reason: why })
      .eq("id", messageId)
      .eq("thread_id", threadId)
      .is("hidden_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("이미 가렸거나 글을 찾을 수 없습니다. 새로고침 해 주세요.");
    done(threadId);
    return { ok: true };
  } catch (e) {
    return fail(e, "글을 가리지 못했습니다.");
  }
}

export async function unhideTalkMessage(threadId: string, messageId: string): Promise<Result> {
  try {
    await requireBangkaAccess();
    if (!UUID.test(threadId) || !UUID.test(messageId)) throw new Error("잘못된 요청입니다.");
    const { error } = await supabaseAdmin
      .from("bk_talk_messages")
      .update({ hidden_at: null, hidden_by: null, hidden_reason: null })
      .eq("id", messageId)
      .eq("thread_id", threadId);
    if (error) throw new Error(error.message);
    done(threadId);
    return { ok: true };
  } catch (e) {
    return fail(e, "가림을 풀지 못했습니다.");
  }
}

// 닫기 — 보호자가 더 쓰지 못함(새 문의는 가능). 다시 열면 마지막 말이 보호자 것이면 미답변, 아니면 답변함.
export async function setTalkClosed(threadId: string, closed: boolean): Promise<Result> {
  try {
    const me = await requireBangkaAccess();
    if (!UUID.test(threadId)) throw new Error("잘못된 요청입니다.");
    const { data: t } = await supabaseAdmin
      .from("bk_talk_threads")
      .select("id, status, last_guardian_at, last_staff_at")
      .eq("id", threadId)
      .is("deleted_at", null)
      .maybeSingle();
    const row = t as { status: string; last_guardian_at: string | null; last_staff_at: string | null } | null;
    if (!row) throw new Error("대화를 찾을 수 없습니다.");
    const now = new Date().toISOString();
    const reopenTo: TalkStatus =
      row.last_guardian_at && (!row.last_staff_at || row.last_guardian_at > row.last_staff_at) ? "open" : "answered";
    const patch = closed
      ? { status: "closed", closed_at: now, closed_by: me.name, updated_at: now }
      : { status: reopenTo, closed_at: null, closed_by: null, updated_at: now };
    const { error } = await supabaseAdmin
      .from("bk_talk_threads")
      .update(patch)
      .eq("id", threadId)
      .eq("status", row.status);
    if (error) throw new Error(error.message);
    done(threadId);
    return { ok: true };
  } catch (e) {
    return fail(e, closed ? "대화를 닫지 못했습니다." : "대화를 다시 열지 못했습니다.");
  }
}
