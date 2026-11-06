"use server";

import { revalidatePath } from "next/cache";
import { isManagerAdmin } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  cleanText,
  isHttpUrl,
  isValidEmail,
  isYmd,
  PRESS_LIMITS,
  type PressArticle,
  type PressIngestReporter,
  type PressReporter,
} from "@/lib/press";
import { approvePressArticle, fixPressArticleUrl } from "@/lib/pressIngest";
import { readArticlePage } from "@/lib/pressCollect/article";
import { runPressCollectAndRecord } from "@/lib/pressCollect/run";
import { PRESS_COLLECT_DAYS } from "@/lib/pressCollect/config";

// =====================================================================
// "보도자료 기자" 화면 서버 액션 — 관장 전용.
//   * 공통 메뉴 '언론보도'(/press-news)도 restoreRejectedArticle 을 부르지만
//     가드는 똑같이 여기서 겁니다(직원 화면에는 버튼 자체가 없습니다).
//   * 가드: isManagerAdmin (구글 세션이면서 직급 관장 또는 master).
//     부장·personnel·일반 직원은 모두 거부합니다(관장 결정, 문서 2-2·4장).
//   * 테이블은 RLS on + 정책 없음 → service_role(supabaseAdmin)로만 읽고 씁니다.
//     그래서 모든 액션이 맨 앞에서 가드를 부릅니다.
//   * 관장이 고치는 칸은 수동 칸뿐입니다. 자동 칸(기사 수·최근 기사)은
//     헤르메스 입구(lib/pressIngest)만 씁니다.
// =====================================================================

export type PressActionResult = { ok: true } | { ok: false; error: string };

const DENIED = "보도자료 기자 명단은 관장만 사용할 수 있습니다.";

// 기사 상태가 바뀌면 공통 메뉴 '언론보도'(/press-news) 목록도 같이 갱신합니다.
function revalidatePress(): void {
  revalidatePath("/press");
  revalidatePath("/press-news");
}

async function requirePressAdmin(): Promise<void> {
  if (!(await isManagerAdmin())) throw new Error(DENIED);
}

// 화면 전체 데이터 — 명단·기사 모두 수백 건 규모라 한 번에 내려 화면에서 거릅니다.
export async function loadPressData(): Promise<{
  reporters: PressReporter[];
  articles: PressArticle[];
}> {
  await requirePressAdmin();
  const [rep, art] = await Promise.all([
    supabaseAdmin.from("press_reporters").select("*").order("name"),
    supabaseAdmin
      .from("press_articles")
      .select("*")
      .order("published_at", { ascending: false }),
  ]);
  if (rep.error) throw new Error(rep.error.message);
  if (art.error) throw new Error(art.error.message);
  return {
    reporters: (rep.data ?? []) as PressReporter[],
    articles: (art.data ?? []) as PressArticle[],
  };
}

export type ManualFieldsInput = {
  phone?: string;
  beat?: string;
  memo?: string;
  receive_press_release?: boolean;
  last_thanks_sent_at?: string;
};

// 수동 칸 정리·검증. 통과하면 DB 에 그대로 쓸 값을 돌려줍니다.
function manualPatch(
  input: ManualFieldsInput,
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const phone = cleanText(input.phone);
  const beat = cleanText(input.beat);
  const memo = cleanText(input.memo);
  const thanks = cleanText(input.last_thanks_sent_at);
  if (phone && phone.length > PRESS_LIMITS.phone) return { ok: false, error: "전화번호가 너무 깁니다." };
  if (beat && beat.length > PRESS_LIMITS.beat) return { ok: false, error: "담당 분야가 너무 깁니다." };
  if (memo && memo.length > PRESS_LIMITS.memo) return { ok: false, error: "메모가 너무 깁니다." };
  if (thanks && !isYmd(thanks)) return { ok: false, error: "감사 메일 날짜 형식이 올바르지 않습니다." };
  return {
    ok: true,
    patch: {
      phone,
      beat,
      memo,
      receive_press_release: input.receive_press_release !== false,
      last_thanks_sent_at: thanks,
    },
  };
}

function uniqueMessage(code: string | undefined, fallback: string): string {
  return code === "23505"
    ? "같은 이메일(또는 이메일 없는 같은 이름·언론사) 기자가 이미 있습니다."
    : fallback;
}

// 관장이 직접 추가하는 기자 — source='manual'. 자동 칸은 비워 둡니다(기사가 들어오면 채워짐).
export async function createManualReporter(
  input: ManualFieldsInput & { name?: string; outlet?: string; email?: string },
): Promise<PressActionResult> {
  await requirePressAdmin();
  const name = cleanText(input.name);
  const outlet = cleanText(input.outlet);
  const email = cleanText(input.email)?.toLowerCase() ?? null;
  if (!name || !outlet) return { ok: false, error: "이름과 언론사는 꼭 적어 주세요." };
  if (name.length > PRESS_LIMITS.name) return { ok: false, error: "이름이 너무 깁니다." };
  if (outlet.length > PRESS_LIMITS.outlet) return { ok: false, error: "언론사 이름이 너무 깁니다." };
  if (email && !isValidEmail(email)) return { ok: false, error: "이메일 형식이 올바르지 않습니다." };
  const m = manualPatch(input);
  if (!m.ok) return m;

  const { error } = await supabaseAdmin
    .from("press_reporters")
    .insert({ name, outlet, email, source: "manual", ...m.patch });
  if (error) return { ok: false, error: uniqueMessage(error.code, error.message) };
  revalidatePress();
  return { ok: true };
}

export async function updateReporterManual(
  id: string,
  input: ManualFieldsInput,
): Promise<PressActionResult> {
  await requirePressAdmin();
  const m = manualPatch(input);
  if (!m.ok) return m;
  const { error } = await supabaseAdmin
    .from("press_reporters")
    .update({ ...m.patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePress();
  return { ok: true };
}

// 기자 요청 시 즉시 삭제. 기사는 남고 reporter_id 만 비워집니다(FK on delete set null).
export async function deleteReporter(id: string): Promise<PressActionResult> {
  await requirePressAdmin();
  const { error } = await supabaseAdmin.from("press_reporters").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePress();
  return { ok: true };
}

// "이메일 변경 확인" — 헤르메스가 보류해 둔 새 이메일로 바꿉니다.
export async function applyPendingEmail(id: string): Promise<PressActionResult> {
  await requirePressAdmin();
  const { data, error } = await supabaseAdmin
    .from("press_reporters")
    .select("pending_email")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const next = (data as { pending_email: string | null } | null)?.pending_email;
  if (!next) return { ok: false, error: "바꿀 새 이메일이 없습니다." };
  const { error: upErr } = await supabaseAdmin
    .from("press_reporters")
    .update({
      email: next.toLowerCase(),
      pending_email: null,
      pending_email_url: null,
      pending_email_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (upErr) return { ok: false, error: uniqueMessage(upErr.code, upErr.message) };
  revalidatePress();
  return { ok: true };
}

export async function dismissPendingEmail(id: string): Promise<PressActionResult> {
  await requirePressAdmin();
  const { error } = await supabaseAdmin
    .from("press_reporters")
    .update({
      pending_email: null,
      pending_email_url: null,
      pending_email_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePress();
  return { ok: true };
}

// =====================================================================
// 자동 수집(docs/PRESS_COLLECT_동업자씨이전.md) — 확인 필요·주소 확인·지금 수집
// =====================================================================

export type PressCollectRun = {
  id: string;
  trigger: "cron" | "manual";
  started_at: string;
  finished_at: string | null;
  found: number;
  new_saved: number;
  needs_review: number;
  url_needs_check: number;
  status: "ok" | "partial" | "failed" | null;
};

export async function loadLastCollectRun(): Promise<PressCollectRun | null> {
  await requirePressAdmin();
  const { data, error } = await supabaseAdmin
    .from("press_collect_runs")
    .select("id,trigger,started_at,finished_at,found,new_saved,needs_review,url_needs_check,status")
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as PressCollectRun | undefined) ?? null;
}

// 원문에서 기자 다시 읽기 — 못 읽으면 null(기자 없이 진행).
async function reporterFromPage(url: string, outlet: string): Promise<PressIngestReporter> {
  try {
    const page = await readArticlePage(url);
    const email = page.reporterEmail && isValidEmail(page.reporterEmail) ? page.reporterEmail.toLowerCase() : null;
    const name = page.reporterName?.slice(0, PRESS_LIMITS.name) ?? null;
    return name || email ? { name, email, outlet } : null;
  } catch {
    return null;
  }
}

async function articleUrlOutlet(id: string): Promise<{ url: string; outlet: string; url_status: string }> {
  const { data, error } = await supabaseAdmin
    .from("press_articles")
    .select("url,outlet,url_status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("기사를 찾을 수 없습니다.");
  return data as { url: string; outlet: string; url_status: string };
}

// 확인 필요 → 승인: 그때 홍보 실적·기자 연결(묶음기사는 실적에 "[묶음기사]"로, 기자 없음).
export async function approveArticle(id: string): Promise<PressActionResult> {
  await requirePressAdmin();
  try {
    const a = await articleUrlOutlet(id);
    const reporter = a.url_status === "ok" ? await reporterFromPage(a.url, a.outlet) : null;
    await approvePressArticle(id, reporter);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "승인하지 못했습니다." };
  }
  revalidatePress();
  return { ok: true };
}

// 확인 필요 → 제외: 지우지 않고 숨깁니다(다음 수집 때 같은 기사가 다시 들어오지 않게).
export async function rejectArticle(id: string): Promise<PressActionResult> {
  await requirePressAdmin();
  const { data, error } = await supabaseAdmin
    .from("press_articles")
    .update({ review_status: "rejected" })
    .eq("id", id)
    .eq("review_status", "needs_review")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "확인 필요 상태의 기사만 제외할 수 있습니다." };
  revalidatePress();
  return { ok: true };
}

// 제외를 되돌리기 → 다시 확인 필요로.
export async function restoreRejectedArticle(id: string): Promise<PressActionResult> {
  await requirePressAdmin();
  const { data, error } = await supabaseAdmin
    .from("press_articles")
    .update({ review_status: "needs_review" })
    .eq("id", id)
    .eq("review_status", "rejected")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "제외된 기사만 되돌릴 수 있습니다." };
  revalidatePress();
  return { ok: true };
}

// "주소 확인 필요" → 실제 언론사 주소로 고치기.
export async function fixArticleUrl(id: string, rawUrl: string): Promise<PressActionResult> {
  await requirePressAdmin();
  const url = cleanText(rawUrl);
  if (!url || !isHttpUrl(url)) return { ok: false, error: "http(s) 로 시작하는 기사 주소를 넣어 주세요." };
  if (/(^|\.)google\.com$/i.test(new URL(url).hostname)) {
    return { ok: false, error: "구글 주소가 아니라 언론사 기사 주소를 넣어 주세요." };
  }
  try {
    const a = await articleUrlOutlet(id);
    await fixPressArticleUrl(id, url, await reporterFromPage(url, a.outlet));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "주소를 고치지 못했습니다." };
  }
  revalidatePress();
  return { ok: true };
}

// [지금 수집] — 크론과 같은 함수(최근 7일, 슬랙·텔레그램 정상 동작). 겹치면 거절.
export async function collectPressNow(): Promise<PressActionResult & { summary?: string }> {
  await requirePressAdmin();
  try {
    const r = await runPressCollectAndRecord({
      trigger: "manual",
      since: new Date(Date.now() - PRESS_COLLECT_DAYS * 86_400_000),
    });
    const s = r.saved!;
    revalidatePress();
    return {
      ok: true,
      summary:
        `수집 완료 — 후보 ${r.candidates.length}건 · 새 기사 ${s.created}건 · 확인 필요 ${s.needsReview}건` +
        (s.urlNeedsCheck ? ` · 주소 확인 필요 ${s.urlNeedsCheck}건` : "") +
        (r.status === "partial" ? ` · 일부 오류 ${r.errors.length}건(관장 텔레그램 참고)` : "") +
        (r.slackSent ? " · 슬랙 공유함" : ""),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "수집하지 못했습니다." };
  }
}
