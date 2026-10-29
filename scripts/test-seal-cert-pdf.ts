// 직인사용대장 증서 PDF — 긴 글자 자동 맞춤 검증.
//   실행: npm run test:seal-cert   (스크린샷까지: npm run test:seal-cert -- --shots)
//
//   행사명 15·30·60자(띄어쓰기 없는 것 포함), 단체명 20자, 긴 제목·외국인 이름으로 증서를 만들고
//   drawText 호출을 가로채 "무엇이 어디에 몇 pt 로" 그려졌는지 받아 봅니다.
//     ① 모든 글자가 바깥 테두리 안에 있는가(좌우·위아래).
//     ② 글자끼리 겹치지 않는가(줄이 늘어난 칸이 옆 칸을 덮지 않는가).
//     ③ 글자를 버리지 않았는가 — 넣은 값(띄어쓰기 뺀 것)이 그려진 글에 그대로 다 있는가.
//     ④ 15·30·60자 행사명·20자 단체명은 원래 크기의 70% 이상으로 그려지는가.
//     ⑤ 미리보기(직인 없음)·발급본(직인)이 같은 배치인가.
//   --shots: 쪽마다 PNG(docs/seal-cert-autofit/) — pdf.js 로 Chromium 에서 그려 캡처(CDN 접속 필요).
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PDFPage, type PDFFont } from "pdf-lib";
import { buildSealCertPdf, type SealCertPage } from "../lib/sealCertPdf";
import { SEAL_TEMPLATES, fillBody, recipientItems, spacedTitle } from "../lib/sealRegister";
import { inkPngBytes } from "./pdfProbe";

let failures = 0;
function expect(label: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗"} ${label}${cond ? "" : ` — ${detail ?? ""}`}`);
}

const W = 595.28;
const H = 841.89;
const BORDER = 30;

// --- drawText 가로채기 -------------------------------------------------
type Drawn = { page: PDFPage; text: string; x: number; y: number; size: number; w: number; rotated: boolean };
let drawn: Drawn[] = [];
const orig = PDFPage.prototype.drawText;
PDFPage.prototype.drawText = function (this: PDFPage, text: string, opts: Parameters<typeof orig>[1] = {}) {
  const size = opts.size ?? 12;
  const font = opts.font as PDFFont;
  drawn.push({ page: this, text, x: opts.x ?? 0, y: opts.y ?? 0, size, w: font.widthOfTextAtSize(text, size), rotated: !!opts.rotate });
  return orig.call(this, text, opts);
};

// --- 시험 값 ------------------------------------------------------------
const len = (s: string) => Array.from(s).length;
const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("").trimEnd();
const LONG =
  "제2회 부산광역시 동래구 청소년 어울림 한마당 및 진로체험 박람회와 함께하는 청소년 동아리 경연대회 본선 무대 겸 시상식 및 지역사회 연계 축제";
const EVENT_15 = "제1회 동래구 청소년 한마당";
const EVENT_30 = "제2회 동래구 청소년 어울림 한마당 및 진로체험 박람회";
const EVENT_60 = cut(LONG, 60);
const EVENT_60_NOSPACE = cut(LONG.replace(/\s+/g, ""), 60);
const ORG_20 = "동래구청소년문화의집 어울림 댄스동아리";
const ORG_20_NOSPACE = "동래구청소년문화의집어울림댄스동아리연합";
const FOREIGN = "Christopher Alexander Montgomery-Wellington III";
const TITLE_20 = "동래구청소년어울림한마당청소년동아리경연대회수상확인증".slice(0, 20);

type Case = { key: string; desc: string; title: string; event: string; name: string; prize: string; watch: string[] };
const CASES: Case[] = [
  { key: "01-event15", desc: "행사명 15자 · 단체명 20자", title: "수상확인증", event: EVENT_15, name: ORG_20, prize: "대상", watch: [EVENT_15, ORG_20] },
  { key: "02-event30", desc: "행사명 30자 · 단체명 20자", title: "수상확인증", event: EVENT_30, name: ORG_20, prize: "금상", watch: [EVENT_30, ORG_20] },
  { key: "03-event60", desc: "행사명 60자(띄어쓰기 있음)", title: "수상확인증", event: EVENT_60, name: ORG_20, prize: "우수상", watch: [EVENT_60, ORG_20] },
  { key: "04-event60-nospace", desc: "행사명 60자(띄어쓰기 없음) · 단체명 20자(띄어쓰기 없음)", title: "수상확인증", event: EVENT_60_NOSPACE, name: ORG_20_NOSPACE, prize: "장려상", watch: [EVENT_60_NOSPACE, ORG_20_NOSPACE] },
  { key: "05-title20-foreign", desc: "제목 20자 · 외국인 이름", title: TITLE_20, event: EVENT_30, name: FOREIGN, prize: "인기상", watch: [EVENT_30, FOREIGN] },
];

// 한도 끝까지 — 직접 입력 틀: 항목 8개(SEAL_MAX_ITEMS), 항목 이름 20자, 값 60자, 본문 1000자(SEAL_BODY_MAX)
const STRESS: Case = {
  key: "06-stress",
  desc: "한도 끝(항목 8개·이름 20자·값 60자·본문 1000자)",
  title: TITLE_20,
  event: EVENT_60_NOSPACE,
  name: ORG_20_NOSPACE,
  prize: "",
  watch: [EVENT_60_NOSPACE, ORG_20_NOSPACE],
};
function stressPage(issueLabel: string): SealCertPage {
  const labels = Array.from({ length: 8 }, (_, i) => cut(`${i + 1}번째직접입력항목이름이아주긴칸입니다`, 20));
  return {
    issueLabel,
    title: STRESS.title,
    items: labels.map((label, i) => ({ label, value: i === 0 ? STRESS.name : EVENT_60_NOSPACE })),
    body: cut(Array.from({ length: 20 }, () => LONG).join(" "), 1000),
    certDateText: "2026년 10월 17일",
    certifier: "동래구청소년센터장",
  };
}

CASES.push(STRESS);

function pageFor(c: Case, issueLabel: string): SealCertPage {
  if (c === STRESS) return stressPage(issueLabel);
  const tpl = SEAL_TEMPLATES.award_confirm;
  const defs = tpl.items.map((d) => ({ ...d, value: d.label === "행 사 명" ? c.event : d.date ? "2026-10-17" : d.value }));
  const person = { 수상부문: c.prize };
  return {
    issueLabel,
    title: c.title,
    items: recipientItems(defs, c.name, person),
    body: fillBody(tpl.body, defs, c.name, person, "2026-10-17"),
    certDateText: "2026년 10월 17일",
    certifier: "동래구청소년센터장",
  };
}

// --- 검사 --------------------------------------------------------------
const noSpace = (s: string) => s.replace(/\s+/g, "");
type Box = { x0: number; x1: number; y0: number; y1: number; d: Drawn };
const boxOf = (d: Drawn): Box => ({ x0: d.x, x1: d.x + d.w, y0: d.y - d.size * 0.22, y1: d.y + d.size * 0.92, d });

function checkPages(label: string, pages: SealCertPage[], cases: Case[], pdfPages: PDFPage[]) {
  pdfPages.forEach((pg, i) => {
    const c = cases[i];
    const texts = drawn.filter((d) => d.page === pg && !d.rotated);
    const boxes = texts.map(boxOf);
    const out = boxes.filter((b) => b.x0 < BORDER + 2 || b.x1 > W - BORDER - 2 || b.y0 < BORDER + 2 || b.y1 > H - BORDER - 2);
    expect(`[${label}] ${c.desc} — 모든 글자가 테두리 안`, out.length === 0, out.map((b) => `"${b.d.text}" x ${b.x0.toFixed(1)}~${b.x1.toFixed(1)} y ${b.y0.toFixed(1)}~${b.y1.toFixed(1)}`).join(" / "));

    const overlaps: string[] = [];
    for (let a = 0; a < boxes.length; a++)
      for (let b = a + 1; b < boxes.length; b++) {
        const A = boxes[a], B = boxes[b];
        const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
        if (ox > 0.5 && oy > 0.5) overlaps.push(`"${A.d.text}" ↔ "${B.d.text}"`);
      }
    expect(`[${label}] ${c.desc} — 글자끼리 겹침 없음`, overlaps.length === 0, overlaps.slice(0, 4).join(" / "));

    const all = noSpace(texts.map((d) => d.text).join(""));
    const missing = [...c.watch, pages[i].body, spacedTitle(c.title)].filter((v) => !all.includes(noSpace(v)));
    expect(`[${label}] ${c.desc} — 버린 글자 없음`, missing.length === 0, missing.join(" / "));

    // 값이 그려진 크기(그 값의 첫 줄이 시작하는 조각의 크기)
    if (label === "미리보기")
      for (const v of c.watch) {
        const first = texts.find((d) => d.text.length > 0 && noSpace(v).startsWith(noSpace(d.text)) && d.x > 150);
        const lines = texts.filter((d) => first && d.size === first.size && d.x === first.x && noSpace(v).includes(noSpace(d.text)));
        const size = first?.size ?? 0;
        const isAscii = /^[\x20-\x7e]+$/.test(v);
        console.log(`    · "${v}" (${len(v)}자) → ${size.toFixed(1)}pt × ${lines.length}줄 (원래 14pt의 ${Math.round((size / 14) * 100)}%)`);
        if (!isAscii && c !== STRESS) expect(`    ${len(v)}자 값이 원래의 70% 이상`, size >= 14 * 0.7 - 1e-6, `${size}pt`);
      }
  });
}

async function shots(files: { name: string; bytes: Uint8Array }[], outDir: string) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  await page.setContent(`<html><body style="margin:0;background:#fff"><canvas id="c"></canvas>
<script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js"></script></body></html>`);
  await page.waitForFunction(() => "pdfjsLib" in window);
  await page.evaluate(() => {
    (window as unknown as { pdfjsLib: { GlobalWorkerOptions: { workerSrc: string } } }).pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  });
  for (const f of files) {
    const b64 = Buffer.from(f.bytes).toString("base64");
    const count = await page.evaluate(async (data) => {
      const lib = (window as never as { pdfjsLib: { getDocument: (o: object) => { promise: Promise<{ numPages: number }> } } }).pdfjsLib;
      const doc = await lib.getDocument({ data: Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0)) }).promise;
      (window as never as { __doc: unknown }).__doc = doc;
      return doc.numPages;
    }, b64);
    for (let n = 1; n <= count; n++) {
      await page.evaluate(async (num) => {
        type Pg = { getViewport: (o: object) => { width: number; height: number }; render: (o: object) => { promise: Promise<void> } };
        const doc = (window as never as { __doc: { getPage: (n: number) => Promise<Pg> } }).__doc;
        const pg = await doc.getPage(num);
        const vp = pg.getViewport({ scale: 1.25 });
        const cv = document.getElementById("c") as HTMLCanvasElement;
        cv.width = vp.width;
        cv.height = vp.height;
        const ctx = cv.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cv.width, cv.height);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      }, n);
      const path = join(outDir, `${f.name}-${String(n).padStart(2, "0")}.png`);
      await page.locator("#c").screenshot({ path });
      console.log(`    ↳ ${path}`);
    }
  }
  await browser.close();
}

async function main() {
  const preview = CASES.map((c) => pageFor(c, "제2026-○○호(승인 시 부여)"));
  const issued = CASES.map((c, i) => pageFor(c, `제2026-${String(i + 1).padStart(2, "0")}호`));

  drawn = [];
  const pBytes = await buildSealCertPdf(preview, { preview: true });
  const pPages = [...new Set(drawn.map((d) => d.page))];
  expect("미리보기 — 1인 1쪽", pPages.length === CASES.length, `${pPages.length}쪽`);
  checkPages("미리보기", preview, CASES, pPages);
  const previewLayout = drawn.filter((d) => !d.rotated && !d.text.startsWith("발급번호")).map((d) => `${d.text}@${d.x.toFixed(2)},${d.y.toFixed(2)},${d.size}`);

  drawn = [];
  const iBytes = await buildSealCertPdf(issued, { preview: false, sealBytes: inkPngBytes(120, 120) });
  const iPages = [...new Set(drawn.map((d) => d.page))];
  checkPages("발급본", issued, CASES, iPages);
  const issuedLayout = drawn.filter((d) => !d.rotated && !d.text.startsWith("발급번호")).map((d) => `${d.text}@${d.x.toFixed(2)},${d.y.toFixed(2)},${d.size}`);
  expect("미리보기·발급본 배치 같음(발급번호 줄 제외)", previewLayout.join("|") === issuedLayout.join("|"));

  if (process.argv.includes("--shots")) {
    const outDir = resolve(import.meta.dirname, "..", "docs", "seal-cert-autofit");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(resolve(import.meta.dirname, "..", "test-output"), "seal-cert-preview.pdf"), pBytes);
    writeFileSync(join(resolve(import.meta.dirname, "..", "test-output"), "seal-cert-issued.pdf"), iBytes);
    await shots([{ name: "preview", bytes: pBytes }, { name: "issued", bytes: iBytes }], outDir);
  }

  console.log(failures ? `\n✗ ${failures}건 실패` : "\n✓ 모두 통과");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
