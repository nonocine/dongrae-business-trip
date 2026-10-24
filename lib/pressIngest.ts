import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  PRESS_PROMOTION_AUTHOR,
  PRESS_PROMOTION_CATEGORY,
  reporterStatusOf,
  type PressIngestItem,
  type PressReporterStatus,
} from "@/lib/press";

// =====================================================================
// 헤르메스 입구 처리 — 검증을 통과한 기사 1건을 DB 에 반영합니다.
//   (docs/PRESS_AUTOMATION.md 3-3 + 관장 지시 2026-10-24)
//
//   순서
//     1) 기사 insert — url unique 가 중복 판정입니다. 이미 있으면 "exists" 로
//        끝내고 기자·실적은 건드리지 않습니다(기사 수가 늘지 않음).
//     2) 홍보 실적 — 묶음기사가 아니면 business_promotions(언론보도) 1줄.
//        같은 url 의 언론보도 행이 이미 있으면(수기 포함) 새로 만들지 않고 연결.
//     3) 기자 — 자동 칸만 갱신/생성. 수동 칸은 어떤 경우에도 쓰지 않습니다.
//     4) 기사에 reporter_id · promotion_id 연결.
//   2)~4) 중 실패하면 이번에 만든 기사·실적 행을 지워 되돌립니다. 그래야
//   헤르메스가 다시 보냈을 때 "exists" 로 건너뛰지 않고 처음부터 처리됩니다.
//   (4)가 실패하면 3)에서 올린 기사 수 1 은 되돌리지 못합니다 — 드문 경우라
//    오류 로그로만 남깁니다.)
//
//   ★ 동시성: 기자 갱신은 읽고-고쳐-쓰기입니다. 헤르메스는 하루 한 번 순서대로
//     보내므로 문제없지만, 같은 기자 기사를 병렬로 보내면 기사 수가 덜 셀 수
//     있습니다. 입구 라우트는 배열도 한 건씩 차례로 처리합니다.
//   ★ 이 모듈은 service_role 로 씁니다. 부르는 쪽(라우트)이 토큰을 확인합니다.
// =====================================================================

export type PressIngestResult = {
  url: string;
  article: "created" | "exists";
  reporter: "created" | "updated" | "skipped";
  reporter_status: PressReporterStatus;
  promotion: "created" | "linked" | "skipped";
  // 이름·언론사가 같은 기자에게 다른 이메일이 들어와 '변경 확인' 으로 보류했을 때.
  pending_email?: true;
};

type ReporterRow = {
  id: string;
  email: string | null;
  first_seen_at: string | null;
  last_article_at: string | null;
  article_count: number | null;
  pending_email: string | null;
};

const REPORTER_COLS =
  "id, email, first_seen_at, last_article_at, article_count, pending_email";

function isUniqueViolation(err: { code?: string } | null): boolean {
  return err?.code === "23505";
}

// ilike 로 '같은 문자열(대소문자 무시)' 을 찾을 때 와일드카드를 무력화합니다.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

class IngestError extends Error {}

function fail(step: string, message: string): never {
  throw new IngestError(`${step}: ${message}`);
}

// --- 기자 ------------------------------------------------------------

// 자동 칸 갱신값. 기사 날짜가 더 이르면 first_seen_at 을, 같거나 늦으면 최근 기사를 바꿉니다.
function autoPatch(cur: ReporterRow, a: PressIngestItem["article"]) {
  const patch: Record<string, unknown> = {
    article_count: (cur.article_count ?? 0) + 1,
    updated_at: new Date().toISOString(),
  };
  if (!cur.first_seen_at || a.published_at < cur.first_seen_at) {
    patch.first_seen_at = a.published_at;
  }
  if (!cur.last_article_at || a.published_at >= cur.last_article_at) {
    patch.last_article_at = a.published_at;
    patch.last_article_title = a.title;
    patch.last_article_url = a.url;
  }
  return patch;
}

async function findByEmail(email: string): Promise<ReporterRow | null> {
  const { data, error } = await supabaseAdmin
    .from("press_reporters")
    .select(REPORTER_COLS)
    .ilike("email", escapeLike(email))
    .limit(1);
  if (error) fail("기자 조회(이메일)", error.message);
  return (data?.[0] as ReporterRow | undefined) ?? null;
}

async function findByNameOutlet(name: string, outlet: string): Promise<ReporterRow[]> {
  const { data, error } = await supabaseAdmin
    .from("press_reporters")
    .select(REPORTER_COLS)
    .eq("name", name)
    .eq("outlet", outlet)
    .order("last_article_at", { ascending: false, nullsFirst: false });
  if (error) fail("기자 조회(이름·언론사)", error.message);
  return (data ?? []) as ReporterRow[];
}

async function updateReporter(id: string, patch: Record<string, unknown>) {
  const { error } = await supabaseAdmin
    .from("press_reporters")
    .update(patch)
    .eq("id", id);
  if (error) fail("기자 갱신", error.message);
}

type ReporterOutcome = {
  id: string | null;
  action: PressIngestResult["reporter"];
  pendingEmail: boolean;
};

async function upsertReporter(
  item: PressIngestItem,
  retry = true,
): Promise<ReporterOutcome> {
  const r = item.reporter;
  const a = item.article;
  // 이름이 없으면 기자를 만들 수 없습니다(name not null) — 기사만 저장.
  if (!r || !r.name) return { id: null, action: "skipped", pendingEmail: false };

  if (r.email) {
    const byEmail = await findByEmail(r.email);
    if (byEmail) {
      await updateReporter(byEmail.id, autoPatch(byEmail, a));
      return { id: byEmail.id, action: "updated", pendingEmail: false };
    }
  }

  const same = await findByNameOutlet(r.name, r.outlet);
  if (same.length > 0) {
    if (!r.email) {
      // 이름만 온 기사 — 같은 이름·언론사 기자에게 붙입니다.
      const cur = same[0];
      await updateReporter(cur.id, autoPatch(cur, a));
      return { id: cur.id, action: "updated", pendingEmail: false };
    }
    // 이메일이 비어 있던 기자면 채워 넣습니다(다른 이메일이 아니라 '없던' 이메일).
    const blank = same.find((s) => !s.email);
    if (blank) {
      await updateReporter(blank.id, { ...autoPatch(blank, a), email: r.email });
      return { id: blank.id, action: "updated", pendingEmail: false };
    }
    // 이메일이 다른 같은 이름·언론사 기자 — 이메일은 그대로 두고 변경 확인으로 보류.
    const cur = same[0];
    await updateReporter(cur.id, {
      ...autoPatch(cur, a),
      pending_email: r.email,
      pending_email_url: a.url,
      pending_email_at: new Date().toISOString(),
    });
    return { id: cur.id, action: "updated", pendingEmail: true };
  }

  const { data, error } = await supabaseAdmin
    .from("press_reporters")
    .insert({
      name: r.name,
      email: r.email,
      outlet: r.outlet,
      first_seen_at: a.published_at,
      last_article_at: a.published_at,
      last_article_title: a.title,
      last_article_url: a.url,
      article_count: 1,
      source: "hermes",
    })
    .select("id")
    .single();
  if (error) {
    // 조회와 insert 사이에 같은 기자가 생긴 경우 — 한 번만 다시 찾아 갱신합니다.
    if (isUniqueViolation(error) && retry) return upsertReporter(item, false);
    fail("기자 추가", error.message);
  }
  return { id: (data as { id: string }).id, action: "created", pendingEmail: false };
}

// --- 홍보 실적 -------------------------------------------------------

async function linkPromotion(
  a: PressIngestItem["article"],
): Promise<{ id: string | null; action: PressIngestResult["promotion"] }> {
  if (a.is_roundup) return { id: null, action: "skipped" };

  const { data: found, error: findErr } = await supabaseAdmin
    .from("business_promotions")
    .select("id")
    .eq("category", PRESS_PROMOTION_CATEGORY)
    .eq("url", a.url)
    .order("created_at", { ascending: true })
    .limit(1);
  if (findErr) fail("실적 조회", findErr.message);
  if (found && found.length > 0) {
    return { id: (found[0] as { id: string }).id, action: "linked" };
  }

  const [y, m] = a.published_at.split("-");
  const { data, error } = await supabaseAdmin
    .from("business_promotions")
    .insert({
      report_year: Number(y),
      report_month: Number(m),
      activity_date: a.published_at,
      category: PRESS_PROMOTION_CATEGORY,
      title: a.title,
      count: 1,
      url: a.url,
      description: a.outlet,
      author_name: PRESS_PROMOTION_AUTHOR,
      source: "auto",
    })
    .select("id")
    .single();
  if (error) fail("실적 추가", error.message);
  return { id: (data as { id: string }).id, action: "created" };
}

// --- 진입점 ----------------------------------------------------------

export async function ingestPressItem(
  item: PressIngestItem,
): Promise<PressIngestResult> {
  const a = item.article;
  const reporterStatus = reporterStatusOf(item.reporter);

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("press_articles")
    .insert({
      published_at: a.published_at,
      outlet: a.outlet,
      title: a.title,
      url: a.url,
      event_group: a.event_group,
      is_roundup: a.is_roundup,
      reporter_status: reporterStatus,
      source: "hermes",
    })
    .select("id")
    .single();
  if (insErr) {
    if (isUniqueViolation(insErr)) {
      return {
        url: a.url,
        article: "exists",
        reporter: "skipped",
        reporter_status: reporterStatus,
        promotion: "skipped",
      };
    }
    fail("기사 추가", insErr.message);
  }
  const articleId = (inserted as { id: string }).id;

  let createdPromotionId: string | null = null;
  try {
    const promotion = await linkPromotion(a);
    if (promotion.action === "created") createdPromotionId = promotion.id;
    const reporter = await upsertReporter(item);

    const { error: linkErr } = await supabaseAdmin
      .from("press_articles")
      .update({ reporter_id: reporter.id, promotion_id: promotion.id })
      .eq("id", articleId);
    if (linkErr) fail("기사 연결", linkErr.message);

    return {
      url: a.url,
      article: "created",
      reporter: reporter.action,
      reporter_status: reporterStatus,
      promotion: promotion.action,
      ...(reporter.pendingEmail ? { pending_email: true as const } : {}),
    };
  } catch (e) {
    // 되돌리기 — 기사부터(실적을 참조할 수 있으므로) 지우고 실적을 지웁니다.
    await supabaseAdmin.from("press_articles").delete().eq("id", articleId);
    if (createdPromotionId) {
      await supabaseAdmin
        .from("business_promotions")
        .delete()
        .eq("id", createdPromotionId);
    }
    throw e;
  }
}
