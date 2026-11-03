// =====================================================================
// 언론 보도 수집 실행 — docs/PRESS_COLLECT_동업자씨이전.md ①~⑥
//   ① 네이버 → ② 구글(보충) → ③ 합치기·중복 제거 → ④ 규칙·Haiku 판정
//   → ⑤ 저장(lib/pressIngest.ingestPressItem 재사용) → ⑥ 슬랙
//
//   * dryRun: DB 는 읽기만(기존 기사 중복 확인), 저장·저장소·슬랙·텔레그램·실행 기록 전부 끔.
//     결과(찾은 기사, 판정, 언론사·기자, 슬랙 미리보기)만 돌려줍니다.
//   * 실제 실행(dryRun=false): 새 기사·확인 필요 기사를 ingestPressItem 으로 저장
//     (확인 필요는 기사 행만 — 실적·기자는 승인 때), 슬랙은 새로 저장된 auto 기사만,
//     실행 기록(press_collect_runs), 실패·확인 필요가 생기면 관장에게 텔레그램 한 줄.
//   * 슬랙에는 기사 외 아무것도 보내지 않습니다(오류·비용·기자 정보 금지).
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ingestPressItem, type PressIngestResult } from "@/lib/pressIngest";
import { sendSlack } from "@/lib/slack";
import { sendTelegram } from "@/lib/telegram";
import { safeFetch } from "@/lib/pressImage";
import type { PressIngestItem } from "@/lib/press";
import { PRESS_GOOGLE_DELAY_MS, PRESS_HAIKU_DAILY_MAX, PRESS_SEARCH_TERMS, type SearchTerm } from "./config";
import { searchNaverNews, naverConfigured, findNaverByTitle } from "./naver";
import { decodeGoogleNewsLink, searchGoogleNews } from "./google";
import { readArticlePage } from "./article";
import { haikuConfigured, haikuJudge, ruleFilter, type HaikuJudgement, type RuleVerdict } from "./filter";
import { bigramJaccard, hostOf, kstYmd, sleep, titleKey, urlKey } from "./text";

export type CollectOptions = {
  dryRun: boolean;
  trigger?: "cron" | "manual"; // 실행 기록용, 기본 cron
  slack?: boolean; // 실제 실행에서 슬랙 공유(기본 true). 백필은 false.
  telegram?: boolean; // 실제 실행에서 관장 알림(기본 true)
  since: Date; // 이 시각 이후 기사만
  useGoogle?: boolean; // 기본 true
  useHaiku?: boolean; // 기본: 키가 있으면 true
  googleWindow?: string; // 기본 "when:7d"
  terms?: SearchTerm[];
  // 백필용 — 이 주소들만 저장 대상으로 남깁니다(관장이 승인한 목록). 나머지는 제외로 표시.
  onlyUrls?: string[];
};

export type CandidateStatus =
  | "new" // 새 기사로 저장할 것
  | "needs_review" // 판정 못 함 — 사람이 확인(Haiku 대상 포함)
  | "exists" // 이미 press_articles 에 있음
  | "excluded" // 규칙·Haiku 로 제외
  | "duplicate"; // 이번 수집 안에서 다른 후보와 같은 기사

export type Candidate = {
  url: string;
  urlStatus: "ok" | "needs_check";
  sources: Array<"naver" | "google">;
  queries: string[];
  title: string;
  description: string;
  outlet: string;
  outletFrom: "google" | "og:site_name" | "기존 기사" | "도메인" | "";
  publishedAt: string; // YYYY-MM-DD (KST)
  rule: RuleVerdict;
  haiku: HaikuJudgement | null;
  haikuPending: boolean; // Haiku 로 갈 기사(이번엔 꺼져서 판정 안 함)
  isRoundup: boolean;
  reporter: { name: string | null; email: string | null } | null;
  pageError: string | null;
  eventGroup: string | null;
  status: CandidateStatus;
  statusReason: string;
  googleLink?: string;
  saved?: PressIngestResult["article"] | "error"; // 실제 실행에서 저장 결과
  saveError?: string;
};

export type CollectReport = {
  dryRun: boolean;
  since: string;
  naverCalls: number;
  googleCalls: number;
  haikuCalls: number;
  errors: string[];
  perTerm: Array<{ query: string; naver: number; google: number; naverError: string | null; googleError: string | null }>;
  candidates: Candidate[];
  ingestItems: PressIngestItem[]; // 저장했을(할) 내용
  slackPreview: string | null;
  // 실제 실행에서만
  runId?: string | null;
  saved?: { created: number; needsReview: number; urlNeedsCheck: number; exists: number; failed: number };
  slackSent?: boolean;
  status?: "ok" | "partial" | "failed";
};

const RUN_LOCK_MINUTES = 10;

// 실제 실행 — 실행 기록·잠금·알림까지. 오류가 나도 기록을 남기고 throw 합니다.
export async function runPressCollectAndRecord(
  opts: Omit<CollectOptions, "dryRun">,
): Promise<CollectReport> {
  // 잠금: 10분 안에 시작해 아직 안 끝난 실행이 있으면 거절(크론과 [지금 수집] 겹침 방지).
  const since = new Date(Date.now() - RUN_LOCK_MINUTES * 60_000).toISOString();
  const { data: running, error: lockErr } = await supabaseAdmin
    .from("press_collect_runs")
    .select("id")
    .is("finished_at", null)
    .gte("started_at", since)
    .limit(1);
  if (lockErr) throw new Error(`실행 기록 조회 실패: ${lockErr.message}`);
  if (running && running.length > 0) throw new Error("이미 수집이 진행 중입니다. 잠시 후 다시 시도해 주세요.");

  const { data: runRow, error: runErr } = await supabaseAdmin
    .from("press_collect_runs")
    .insert({ trigger: opts.trigger ?? "cron" })
    .select("id")
    .single();
  if (runErr) throw new Error(`실행 기록 추가 실패: ${runErr.message}`);
  const runId = (runRow as { id: string }).id;

  try {
    // 네이버 키가 없으면(예: Production 환경변수 등록 전) 구글만으로 저장하지 않고 바로 실패로 기록합니다.
    //   슬랙은 보내지 않고, 텔레그램은 키가 있을 때만 갑니다(없으면 조용히 skip).
    if (!naverConfigured()) throw new Error("네이버 키 없음(NAVER_API_HUB_ID/KEY 미설정) — 수집하지 않음");
    const report = await runPressCollect({ ...opts, dryRun: false });
    report.runId = runId;
    const s = report.saved!;
    report.status = report.errors.length > 0 || s.failed > 0 ? "partial" : "ok";
    await supabaseAdmin
      .from("press_collect_runs")
      .update({
        finished_at: new Date().toISOString(),
        naver_calls: report.naverCalls,
        google_calls: report.googleCalls,
        haiku_calls: report.haikuCalls,
        found: report.candidates.length,
        new_saved: s.created,
        needs_review: s.needsReview,
        url_needs_check: s.urlNeedsCheck,
        status: report.status,
        error: report.errors.length ? report.errors.join(" / ").slice(0, 2000) : null,
      })
      .eq("id", runId);
    if (opts.telegram !== false) {
      const notes: string[] = [];
      if (s.needsReview > 0) notes.push(`확인 필요 ${s.needsReview}건`);
      if (s.urlNeedsCheck > 0) notes.push(`주소 확인 필요 ${s.urlNeedsCheck}건`);
      if (s.failed > 0) notes.push(`저장 실패 ${s.failed}건`);
      if (report.status === "partial") notes.push(`일부 오류 ${report.errors.length}건`);
      if (notes.length > 0) {
        await sendTelegram(`[언론 보도 수집] 새 기사 ${s.created}건 · ${notes.join(" · ")} — 동업자씨 /press 에서 확인`);
      }
    }
    return report;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabaseAdmin
      .from("press_collect_runs")
      .update({ finished_at: new Date().toISOString(), status: "failed", error: msg.slice(0, 2000) })
      .eq("id", runId);
    if (opts.telegram !== false) await sendTelegram(`[언론 보도 수집] 실패: ${msg.slice(0, 300)}`);
    throw e;
  }
}

type Existing = { url: string; outlet: string; title: string; event_group: string | null; published_at: string };

async function loadExisting(): Promise<Existing[]> {
  const { data, error } = await supabaseAdmin
    .from("press_articles")
    .select("url,outlet,title,event_group,published_at");
  if (error) throw new Error(`기존 기사 조회 실패: ${error.message}`);
  return (data ?? []) as Existing[];
}

const GOOGLE_HOST = /(^|\.)news\.google\.com$/;

// 구글 경유 주소 → 언론사 주소. 리다이렉트만 따라가 봅니다(구글이 방식을 바꾸면 실패 — 정상).
async function resolveGoogleLink(link: string): Promise<string | null> {
  try {
    const r = await safeFetch(link, "text/html", 512 * 1024);
    return GOOGLE_HOST.test(new URL(r.url).hostname) ? null : r.url;
  } catch {
    return null;
  }
}

function sameStory(aTitle: string, aDate: string, bTitle: string, bDate: string): boolean {
  const days = Math.abs(new Date(aDate).getTime() - new Date(bDate).getTime()) / 86_400_000;
  return days <= 3 && bigramJaccard(aTitle, bTitle) >= 0.35;
}

function groupKey(title: string, date: string): string {
  const short = title.replace(/^\s*\[[^\]]*\]\s*/, "").replace(/[^\s0-9A-Za-z가-힣]/g, " ").trim().split(/\s+/).slice(0, 4).join("_");
  return `${date.slice(0, 4)}_${short}`.slice(0, 200);
}

export async function runPressCollect(opts: CollectOptions): Promise<CollectReport> {
  const terms = opts.terms ?? PRESS_SEARCH_TERMS;
  const useGoogle = opts.useGoogle ?? true;
  const useHaiku = (opts.useHaiku ?? true) && haikuConfigured();
  const report: CollectReport = {
    dryRun: opts.dryRun,
    since: opts.since.toISOString(),
    naverCalls: 0,
    googleCalls: 0,
    haikuCalls: 0,
    errors: [],
    perTerm: [],
    candidates: [],
    ingestItems: [],
    slackPreview: null,
  };
  if (!naverConfigured()) report.errors.push("네이버 키 없음 — 네이버 검색 건너뜀");

  const existing = await loadExisting();
  const existingKeys = new Set(existing.map((e) => urlKey(e.url)));
  const existingTitle = new Set(existing.map((e) => `${e.outlet}|${titleKey(e.title)}`));
  const outletByHost = new Map<string, string>();
  for (const e of existing) outletByHost.set(hostOf(e.url), e.outlet);

  // ①② 검색
  const byKey = new Map<string, Candidate & { _terms: SearchTerm[] }>();
  const googleOnly: Array<{ item: Awaited<ReturnType<typeof searchGoogleNews>>["items"][number]; term: SearchTerm }> = [];

  for (const term of terms) {
    const row = { query: term.query, naver: 0, google: 0, naverError: null as string | null, googleError: null as string | null };
    if (naverConfigured()) {
      const n = await searchNaverNews(term.query, opts.since);
      report.naverCalls += n.calls;
      row.naver = n.items.length;
      row.naverError = n.error;
      if (n.error) report.errors.push(`네이버 "${term.query}": ${n.error}`);
      for (const it of n.items) {
        const url = it.originallink || it.link;
        if (!url) continue;
        const k = urlKey(url);
        const cur = byKey.get(k);
        if (cur) {
          if (!cur.queries.includes(term.query)) cur.queries.push(term.query);
          cur._terms.push(term);
          if (it.description.length > cur.description.length) cur.description = it.description;
          continue;
        }
        byKey.set(k, {
          url,
          urlStatus: "ok",
          sources: ["naver"],
          queries: [term.query],
          _terms: [term],
          title: it.title,
          description: it.description,
          outlet: "",
          outletFrom: "",
          publishedAt: it.publishedAt ? kstYmd(it.publishedAt) : kstYmd(new Date()),
          rule: { verdict: "unclear", reason: "", roundupHint: false },
          haiku: null,
          haikuPending: false,
          isRoundup: false,
          reporter: null,
          pageError: null,
          eventGroup: null,
          status: "new",
          statusReason: "",
        });
      }
    }
    if (useGoogle) {
      report.googleCalls++;
      const g = await searchGoogleNews(term.query, opts.googleWindow ?? "when:7d");
      row.google = g.items.length;
      row.googleError = g.error;
      if (g.error) report.errors.push(`구글 "${term.query}": ${g.error} — 구글만 건너뜀`);
      for (const it of g.items) {
        if (it.publishedAt && it.publishedAt < opts.since) continue;
        googleOnly.push({ item: it, term });
      }
      await sleep(PRESS_GOOGLE_DELAY_MS);
    }
    report.perTerm.push(row);
  }

  // 구글 결과 합치기 — 네이버와 같은 기사면 언론사 이름만 보태고, 아니면 주소를 찾아 새 후보로
  for (const { item, term } of googleOnly) {
    const date = item.publishedAt ? kstYmd(item.publishedAt) : kstYmd(new Date());
    const naverHit = [...byKey.values()].find(
      (c) =>
        (titleKey(c.title) === titleKey(item.title) || bigramJaccard(c.title, item.title) >= 0.8) &&
        Math.abs(new Date(c.publishedAt).getTime() - new Date(date).getTime()) <= 2 * 86_400_000 &&
        (!item.outletUrl || hostOf(item.outletUrl) === "" || hostOf(c.url).endsWith(hostOf(item.outletUrl)) || hostOf(item.outletUrl).endsWith(hostOf(c.url))),
    );
    if (naverHit) {
      if (!naverHit.sources.includes("google")) naverHit.sources.push("google");
      if (item.outlet && naverHit.outletFrom !== "google") {
        naverHit.outlet = item.outlet;
        naverHit.outletFrom = "google";
      }
      if (!naverHit.queries.includes(term.query)) naverHit.queries.push(term.query);
      naverHit._terms.push(term);
      continue;
    }
    // 실제 주소 찾기: ① 네이버에서 제목 그대로 검색 ② 구글 주소 리다이렉트 ③ 구글 batchexecute 변환
    //   ④ 모두 실패 → 구글 주소로 두고 needs_check
    let real: string | null = null;
    let naverDesc = "";
    if (naverConfigured()) {
      const t = await findNaverByTitle(item.title);
      report.naverCalls += t.calls;
      if (t.item && (titleKey(t.item.title) === titleKey(item.title) || bigramJaccard(t.item.title, item.title) >= 0.8)) {
        real = t.item.originallink || t.item.link || null;
        naverDesc = t.item.description;
      }
    }
    if (!real) real = await resolveGoogleLink(item.link);
    if (!real) real = await decodeGoogleNewsLink(item.link);
    const url = real ?? item.link;
    const k = urlKey(url);
    const cur = byKey.get(k);
    if (cur) {
      if (!cur.sources.includes("google")) cur.sources.push("google");
      cur._terms.push(term);
      continue;
    }
    byKey.set(k, {
      url,
      urlStatus: real ? "ok" : "needs_check",
      sources: ["google"],
      queries: [term.query],
      _terms: [term],
      title: item.title,
      description: naverDesc,
      outlet: item.outlet,
      outletFrom: item.outlet ? "google" : "",
      publishedAt: date,
      rule: { verdict: "unclear", reason: "", roundupHint: false },
      haiku: null,
      haikuPending: false,
      isRoundup: false,
      reporter: null,
      pageError: null,
      eventGroup: null,
      status: "new",
      statusReason: "",
      googleLink: item.link,
    });
  }

  // ③④ 판정 · 기사 읽기
  let haikuLeft = PRESS_HAIKU_DAILY_MAX;
  for (const c of byKey.values()) {
    c.rule = ruleFilter(c, c._terms);
    const needBody = c.rule.verdict === "exclude" && (c.rule as { noTermInSnippet?: boolean }).noTermInSnippet === true;
    if (c.rule.verdict === "exclude" && !needBody) {
      c.status = "excluded";
      c.statusReason = c.rule.reason;
      continue;
    }
    if (existingKeys.has(urlKey(c.url))) {
      c.status = "exists";
      c.statusReason = "이미 저장된 주소";
      continue;
    }

    let page: Awaited<ReturnType<typeof readArticlePage>> | null = null;
    if (c.urlStatus === "ok") {
      try {
        page = await readArticlePage(c.url);
      } catch (e) {
        c.pageError = e instanceof Error ? e.message : "원문을 열지 못함";
      }
    }
    if (needBody) {
      if (!page) {
        c.status = "excluded";
        c.statusReason = "검색어가 요약에 없고 원문도 열지 못함";
        continue;
      }
      c.rule = ruleFilter(c, c._terms, page.bodyText);
      if (c.rule.verdict === "exclude") {
        c.status = "excluded";
        c.statusReason = c.rule.reason;
        continue;
      }
      c.rule.reason = `본문에서 확인 · ${c.rule.reason}`;
    }
    if (page) {
      c.reporter = { name: page.reporterName, email: page.reporterEmail };
      if (!c.outlet && page.siteName) {
        c.outlet = page.siteName;
        c.outletFrom = "og:site_name";
      }
      if (c.rule.verdict === "unclear" && useHaiku && haikuLeft > 0) {
        haikuLeft--;
        report.haikuCalls++;
        c.haiku = await haikuJudge({ title: c.title, outlet: c.outlet, description: c.description, bodyHead: page.bodyHead });
      }
    }
    if (!c.outlet) {
      const known = outletByHost.get(hostOf(c.url));
      if (known) {
        c.outlet = known;
        c.outletFrom = "기존 기사";
      } else {
        c.outlet = hostOf(c.url) || "언론사 미상";
        c.outletFrom = "도메인";
      }
    }
    if (existingTitle.has(`${c.outlet}|${titleKey(c.title)}`)) {
      c.status = "exists";
      c.statusReason = "같은 언론사·같은 제목 기사가 이미 저장됨";
      continue;
    }

    c.isRoundup = c.haiku?.is_roundup ?? c.rule.roundupHint;
    // 묶음기사의 기자는 우리 기사를 쓴 기자로 보지 않습니다(헤르메스와 같음).
    if (c.isRoundup) c.reporter = null;
    if (c.rule.verdict === "pass") {
      c.status = "new";
      c.statusReason = c.rule.reason;
    } else if (c.haiku && c.haiku.ours && c.haiku.venue_only) {
      // 관장 결정: 장소로만 언급된 기사는 저장하되 사람이 판단
      c.status = "needs_review";
      c.statusReason = `장소로만 언급 · Haiku: ${c.haiku.reason}`;
    } else if (c.haiku) {
      c.status = c.haiku.ours ? "new" : "excluded";
      c.statusReason = `Haiku: ${c.haiku.reason}`;
    } else {
      c.status = "needs_review";
      c.haikuPending = true;
      c.statusReason = useHaiku ? "Haiku 판정 실패·상한 초과 → 사람 확인" : "Haiku 로 갈 기사(이번 드라이런은 Haiku 꺼짐)";
    }
  }

  if (opts.onlyUrls) {
    const allow = new Set(opts.onlyUrls.map(urlKey));
    for (const c of byKey.values()) {
      if ((c.status === "new" || c.status === "needs_review") && !allow.has(urlKey(c.url))) {
        const was = c.status === "new" ? "새 기사" : "확인 필요";
        c.status = "excluded";
        c.statusReason = `승인 목록 밖(${was} 판정) · ${c.statusReason}`;
      }
    }
  }

  // 이번 수집 안의 같은 기사(언론사+제목)
  const seen = new Map<string, Candidate>();
  for (const c of byKey.values()) {
    if (c.status !== "new" && c.status !== "needs_review") continue;
    const k = `${c.outlet}|${titleKey(c.title)}`;
    const first = seen.get(k);
    if (first) {
      c.status = "duplicate";
      c.statusReason = `같은 기사: ${first.url}`;
    } else seen.set(k, c);
  }

  // 같은 행사 묶기 — 기존 기사(최근 묶음)를 먼저, 없으면 이번 후보끼리
  const kept = [...byKey.values()].filter((c) => c.status === "new" || c.status === "needs_review");
  for (const c of kept) {
    const ex = existing.find((e) => e.event_group && sameStory(c.title, c.publishedAt, e.title, e.published_at));
    if (ex) c.eventGroup = ex.event_group;
  }
  for (const c of kept) {
    if (c.eventGroup) continue;
    const mate = kept.find((o) => o !== c && o.eventGroup && sameStory(c.title, c.publishedAt, o.title, o.publishedAt));
    c.eventGroup = mate?.eventGroup ?? groupKey(c.title, c.publishedAt);
  }

  report.candidates = [...byKey.values()].map(({ _terms, ...c }) => {
    void _terms;
    return c;
  });
  report.candidates.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));

  // ⑤ 저장했을 내용 (기존 입구와 같은 모양)
  report.ingestItems = kept.map((c) => ({
    article: {
      published_at: c.publishedAt,
      outlet: c.outlet,
      title: c.title,
      url: c.url,
      event_group: c.eventGroup,
      is_roundup: c.isRoundup,
    },
    reporter:
      c.reporter && (c.reporter.name || c.reporter.email)
        ? { name: c.reporter.name, email: c.reporter.email, outlet: c.outlet }
        : null,
  }));

  // ⑥ 슬랙 미리보기 — 확인 필요 기사는 넣지 않습니다
  report.slackPreview = slackMessage(kept.filter((c) => c.status === "new"));
  if (opts.dryRun) return report;

  // ⑤ 실제 저장 — 한 건씩 차례로(기자 갱신이 읽고-고쳐-쓰기라서).
  const saved = { created: 0, needsReview: 0, urlNeedsCheck: 0, exists: 0, failed: 0 };
  for (let i = 0; i < kept.length; i++) {
    const c = kept[i];
    try {
      const r = await ingestPressItem(report.ingestItems[i], {
        source: c.sources.includes("naver") ? "collector:naver" : "collector:google",
        reviewStatus: c.status === "needs_review" ? "needs_review" : "auto",
        reviewReason: c.status === "needs_review" ? c.statusReason.slice(0, 500) : null,
        urlStatus: c.urlStatus,
      });
      c.saved = r.article;
      if (r.article === "exists") {
        saved.exists++;
        continue;
      }
      if (c.status === "needs_review") saved.needsReview++;
      else saved.created++;
      if (c.urlStatus === "needs_check") saved.urlNeedsCheck++;
    } catch (e) {
      c.saved = "error";
      c.saveError = e instanceof Error ? e.message : String(e);
      saved.failed++;
      report.errors.push(`저장 실패 "${c.title.slice(0, 30)}": ${c.saveError}`);
    }
  }
  report.saved = saved;
  // 저장 결과를 보고서 후보에도 반영
  const savedByUrl = new Map(kept.map((c) => [c.url, c]));
  report.candidates = report.candidates.map((c) => {
    const k = savedByUrl.get(c.url);
    return k ? { ...c, saved: k.saved, saveError: k.saveError } : c;
  });

  // ⑥ 슬랙 — 이번에 새로 저장된 auto 기사만. 없으면 보내지 않음.
  const fresh = kept.filter((c) => c.status === "new" && c.saved === "created");
  const text = slackMessage(fresh);
  report.slackPreview = text;
  report.slackSent = false;
  if (text && opts.slack !== false) report.slackSent = await sendSlack("SLACK_WEBHOOK_14_PRESS", text);
  return report;
}

// 헤르메스와 같은 형식: 행사별 묶음, 언론사 링크 전부, 묶음기사는 따로.
export function slackMessage(items: Candidate[]): string | null {
  if (items.length === 0) return null;
  const normal = items.filter((c) => !c.isRoundup);
  const roundup = items.filter((c) => c.isRoundup);
  const lines: string[] = ["📰 동래구청소년센터 언론 보도 (신규)", ""];
  const groups = new Map<string, Candidate[]>();
  for (const c of normal) {
    const k = c.eventGroup ?? c.url;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  for (const g of groups.values()) {
    g.sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : 1));
    lines.push(`${g[0].publishedAt} | ${g[0].title}${g.length > 1 ? ` (언론사 ${g.length}곳)` : ""}`);
    for (const c of g) lines.push(`- ${c.outlet}: ${c.url}`);
    lines.push("");
  }
  if (roundup.length > 0) {
    lines.push("📌 지역 소식 묶음 기사");
    for (const c of roundup) lines.push(`- ${c.publishedAt} ${c.outlet} | ${c.title}: ${c.url}`);
  }
  return lines.join("\n").trim();
}
