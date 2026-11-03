// 언론 보도 수집 드라이런 — 저장·저장소·슬랙·텔레그램·실행 기록 전부 끔. DB 는 읽기만.
//   실행:
//     node --env-file=.env.local --env-file=.env.vercel.local --import tsx scripts/press-collect-dryrun.mts week    <출력폴더>
//     node --env-file=.env.local --env-file=.env.vercel.local --import tsx scripts/press-collect-dryrun.mts compare <출력폴더> [2026-09-01]
//   week    : 최근 7일 수집 결과
//   compare : 기준일부터 수집해 헤르메스가 저장한 기사·기자와 비교(정확도)
//   * Haiku 는 기본 끔 — 끝에 --haiku 를 붙이면 켭니다(ANTHROPIC_API_KEY_PRESS 필요).
//   * 키 값은 출력하지 않습니다.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { runPressCollect, type Candidate, type CollectReport } from "../lib/pressCollect/run";
import { readArticlePage } from "../lib/pressCollect/article";
import { titleKey, urlKey } from "../lib/pressCollect/text";

const args = process.argv.slice(2);
const useHaiku = args.includes("--haiku");
const [mode, outDir, sinceArg] = args.filter((a) => a !== "--haiku");
if (!["week", "compare"].includes(mode ?? "") || !outDir) {
  console.error("사용법: press-collect-dryrun.mts week|compare <출력폴더> [YYYY-MM-DD]");
  process.exit(2);
}
await mkdir(outDir, { recursive: true });

const since =
  mode === "week"
    ? new Date(Date.now() - 7 * 86_400_000)
    : new Date(`${sinceArg ?? "2026-09-01"}T00:00:00+09:00`);
const googleWindow = mode === "week" ? "when:7d" : `after:${(sinceArg ?? "2026-09-01")}`;

const started = Date.now();
const report = await runPressCollect({ dryRun: true, since, useHaiku, googleWindow });
const secs = ((Date.now() - started) / 1000).toFixed(1);

const by = (s: Candidate["status"]) => report.candidates.filter((c) => c.status === s);
const md: string[] = [];
md.push(`# 언론 보도 수집 드라이런 — ${mode} (${since.toISOString().slice(0, 10)} 이후)`, "");
md.push(`- 걸린 시간 ${secs}초 · 네이버 호출 ${report.naverCalls}회 · 구글 호출 ${report.googleCalls}회 · Haiku ${report.haikuCalls}회${useHaiku ? "" : "(꺼짐)"}`);
md.push(`- 후보 ${report.candidates.length}건: 새 기사 ${by("new").length} · 확인 필요 ${by("needs_review").length} · 이미 있음 ${by("exists").length} · 제외 ${by("excluded").length} · 중복 ${by("duplicate").length}`);
if (report.errors.length) md.push(`- 오류: ${report.errors.join(" / ")}`);
md.push("", "## 검색어별", "", "| 검색어 | 네이버 | 구글 |", "|---|---|---|");
for (const t of report.perTerm) md.push(`| ${t.query} | ${t.naver}${t.naverError ? ` (${t.naverError})` : ""} | ${t.google}${t.googleError ? ` (${t.googleError})` : ""} |`);

const row = (c: Candidate) =>
  `| ${c.publishedAt} | ${c.outlet} <sub>${c.outletFrom}</sub> | ${c.title.replace(/\|/g, "/")} | ${c.rule.verdict} | ${c.statusReason.replace(/\|/g, "/")} | ${c.reporter ? `${c.reporter.name ?? "-"} ${c.reporter.email ?? ""}` : c.pageError ? `열기 실패: ${c.pageError}` : "-"} | ${c.urlStatus === "needs_check" ? "⚠ 주소 확인" : ""} ${c.isRoundup ? "📌묶음" : ""} | ${c.sources.join("+")} | ${c.url} |`;
for (const [label, s] of [
  ["새 기사 (저장·슬랙 대상이었을 것)", "new"],
  ["확인 필요 — Haiku 로 갈 기사", "needs_review"],
  ["이미 저장됨", "exists"],
  ["중복", "duplicate"],
  ["제외", "excluded"],
] as const) {
  const list = by(s);
  md.push("", `## ${label} (${list.length})`, "");
  if (list.length === 0) continue;
  md.push("| 날짜 | 언론사 | 제목 | 규칙 | 사유 | 기자 | 표시 | 출처 | 주소 |", "|---|---|---|---|---|---|---|---|---|");
  for (const c of list) md.push(row(c));
}
const judged = report.candidates.filter((c) => c.haiku || c.haikuPending);
if (useHaiku) {
  md.push("", `## Haiku 판정 (${judged.length})`, "", "| 날짜 | 언론사 | 제목 | 우리 기사 | 묶음 | 판정 이유 | 결과 |", "|---|---|---|---|---|---|---|");
  for (const c of judged) {
    md.push(`| ${c.publishedAt} | ${c.outlet} | ${c.title.replace(/\|/g, "/")} | ${c.haiku ? (c.haiku.ours ? "✅ 예" : "❌ 아니오") : "판정 못 함"} | ${c.haiku ? (c.haiku.is_roundup ? "📌" : "") : ""} | ${(c.haiku?.reason ?? c.statusReason).replace(/\|/g, "/")} | ${c.status} |`);
  }
}
md.push("", "## 슬랙 미리보기 (보내지 않음)", "", "```", report.slackPreview ?? "(새 기사 없음 — 보내지 않음)", "```");

// --- 헤르메스 저장분과 비교 -------------------------------------------------
if (mode === "compare") {
  const { data, error } = await supabaseAdmin
    .from("press_articles")
    .select("published_at,outlet,title,url,is_roundup,source,press_reporters(name,email)")
    .eq("source", "hermes")
    .order("published_at");
  if (error) throw new Error(error.message);
  type H = { published_at: string; outlet: string; title: string; url: string; is_roundup: boolean; press_reporters: { name: string; email: string | null } | null };
  const hermes = (data ?? []) as unknown as H[];

  let found = 0, ruleKept = 0, outletOk = 0, nameOk = 0, mailOk = 0, reporterCases = 0, noneOk = 0, noneCases = 0;
  md.push("", "## 헤르메스 저장분 비교", "", "| 날짜 | 헤르메스 언론사 | 제목 | 수집기가 찾음 | 규칙 판정 | 언론사(원문 읽기) | 헤르메스 기자 | 수집기 기자 | 일치 |", "|---|---|---|---|---|---|---|---|---|");
  for (const h of hermes) {
    const c =
      report.candidates.find((x) => urlKey(x.url) === urlKey(h.url)) ??
      report.candidates.find((x) => titleKey(x.title) === titleKey(h.title));
    if (c) found++;
    const kept = c && c.status !== "excluded";
    if (kept) ruleKept++;

    let page: Awaited<ReturnType<typeof readArticlePage>> | null = null;
    let pageErr = "";
    try {
      page = await readArticlePage(h.url);
    } catch (e) {
      pageErr = e instanceof Error ? e.message : "실패";
    }
    // 수집기 규칙: 묶음기사는 기자를 비웁니다(run.ts 와 같음)
    if (page && h.is_roundup) page = { ...page, reporterName: null, reporterEmail: null };
    const outlet = c?.outletFrom === "google" ? c.outlet : page?.siteName ?? "";
    const oOk = outlet === h.outlet;
    if (oOk) outletOk++;

    const hr = h.press_reporters;
    let match = "";
    if (hr) {
      reporterCases++;
      const n = page?.reporterName === hr.name;
      const m = (page?.reporterEmail ?? null) === (hr.email?.toLowerCase() ?? null);
      if (n) nameOk++;
      if (m) mailOk++;
      match = n && m ? "✅" : n ? "이름만" : "❌";
    } else {
      noneCases++;
      const ok = !page?.reporterName && !page?.reporterEmail;
      if (ok) noneOk++;
      match = ok ? "✅(둘 다 없음)" : "❌(헤르메스는 없음)";
    }
    md.push(
      `| ${h.published_at} | ${h.outlet} | ${h.title.slice(0, 40)} | ${c ? `${c.sources.join("+")} · ${c.status}` : "❌ 못 찾음"} | ${c ? `${c.rule.verdict} (${c.rule.reason})` : "-"} | ${outlet || pageErr || "-"} ${oOk ? "✅" : "❌"} | ${hr ? `${hr.name} ${hr.email ?? ""}` : "없음"} | ${page ? `${page.reporterName ?? "-"} ${page.reporterEmail ?? ""}` : pageErr} | ${match} |`,
    );
  }
  const pct = (a: number, b: number) => (b === 0 ? "-" : `${a}/${b} (${Math.round((a / b) * 100)}%)`);
  md.push(
    "",
    `- 찾음(재현율): ${pct(found, hermes.length)} · 규칙 통과(제외 안 됨): ${pct(ruleKept, hermes.length)}`,
    `- 언론사 이름 일치: ${pct(outletOk, hermes.length)}`,
    `- 기자 이름 일치: ${pct(nameOk, reporterCases)} · 기자 메일 일치: ${pct(mailOk, reporterCases)} · 기자 없음 일치: ${pct(noneOk, noneCases)}`,
  );
}

const base = path.join(outDir, `press-collect-${mode}${useHaiku ? "-haiku" : ""}`);
await writeFile(`${base}.md`, md.join("\n"), "utf8");
await writeFile(`${base}.json`, JSON.stringify(report satisfies CollectReport, null, 2), "utf8");
console.log(md.join("\n"));
console.log(`\n저장: ${base}.md / .json`);
