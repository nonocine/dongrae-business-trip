// 언론 보도 백필 — 관장 승인 목록(2026-11-03, 9월 1일 이후 14건)만 실제 저장.
//   * 슬랙·텔레그램 보내지 않음. 실행 기록(press_collect_runs, trigger=manual)은 남김.
//   * 저장은 정규 수집과 같은 경로(runPressCollectAndRecord → ingestPressItem).
//   * 확인 필요 판정(장소로만 언급 등)은 기사 행만 저장 — 실적·기자는 화면에서 승인할 때.
//   실행:
//     node --env-file=.env.local --env-file=.env.vercel.local --import tsx scripts/press-collect-backfill.mts <출력폴더>

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runPressCollectAndRecord } from "../lib/pressCollect/run";

const APPROVED = [
  "https://www.pennmike.com/news/articleView.html?idxno=130166",
  "http://www.iminju.net/news/articleView.html?idxno=171284",
  "https://www.gukjenews.com/news/articleView.html?idxno=3730658",
  "https://www.ibabynews.com/news/articleView.html?idxno=155406",
  "https://www.dnews.co.kr/uhtml/view.jsp?idxno=202609271123547590421",
  "https://www.gukjenews.com/news/articleView.html?idxno=3705523",
  "http://www.ikld.kr/news/articleView.html?idxno=341093",
  "http://www.weeklytoday.com/news/articleView.html?idxno=795495",
  "https://www.dnews.co.kr/uhtml/view.jsp?idxno=202609141638285280991",
  "http://www.weeklytoday.com/news/articleView.html?idxno=794371",
  "https://www.kookje.co.kr/news2011/asp/newsbody.asp?code=0300&key=20260914.99099004573",
  "http://www.paxetv.com/news/articleView.html?idxno=281578",
  "https://www.dnews.co.kr/uhtml/view.jsp?idxno=202609081753452250190",
  "https://sjbnews.com/news/news.php?number=887004",
];

const outDir = process.argv[2];
if (!outDir) {
  console.error("사용법: press-collect-backfill.mts <출력폴더>");
  process.exit(2);
}
await mkdir(outDir, { recursive: true });

const report = await runPressCollectAndRecord({
  trigger: "manual",
  since: new Date("2026-09-01T00:00:00+09:00"),
  googleWindow: "after:2026-09-01",
  slack: false,
  telegram: false,
  onlyUrls: APPROVED,
});

const kept = report.candidates.filter((c) => c.saved);
const lines = [
  `상태 ${report.status} · 실행 기록 ${report.runId}`,
  `저장 ${JSON.stringify(report.saved)} · 슬랙 보냄: ${report.slackSent ? "예" : "아니오"}`,
  ...(report.errors.length ? [`오류: ${report.errors.join(" / ")}`] : []),
  "",
  ...kept.map(
    (c) =>
      `${c.saved} | ${c.status} | ${c.publishedAt} ${c.outlet} | ${c.title.slice(0, 40)}${c.isRoundup ? " 📌" : ""} | ${c.urlStatus} | ${c.url}`,
  ),
];
const missing = APPROVED.filter((u) => !kept.some((c) => c.url === u));
if (missing.length) lines.push("", `승인 목록 중 이번에 저장 대상이 아니었던 주소 ${missing.length}건:`, ...missing);
await writeFile(path.join(outDir, "press-backfill.json"), JSON.stringify(report, null, 2), "utf8");
console.log(lines.join("\n"));
