// 보고서 PDF 표 — 실물 렌더 검증 (html2canvas 1.4.1)
//   실행: npm run dev  (다른 창에서)  →  npm run test:trip-pdf
//   결과물: test-output/trip-pdf/
//
//   왜 이 스크립트가 있나
//   --------------------
//   PDF 는 DOM 을 html2canvas 로 캡처한 "그림"입니다(lib/pdf.ts). 그래서 인라인
//   스타일이 브라우저 화면에서 잘 보이는 것과 PDF 에 실제로 찍히는 것은 별개입니다.
//   c06a422 에서 th/td 에 verticalAlign:"middle" 을 넣었지만 실물 PDF 는 그대로
//   였습니다 — 어긋나는 것은 "셀"이 아니라 그 안의 "글자"이기 때문입니다
//   (자세한 내용은 app/components/pdfReportStyles.ts 주석).
//
//   그래서 이 스크립트는 추측 대신 실제 캡처 결과의 픽셀을 읽어 세 가지를 봅니다.
//     ① 표 셀 세로정렬 — 글자 잉크의 중심이 셀 세로 중앙에 있는가.
//     ② 표 테두리     — 각 셀의 네 변 "전 구간"에 선이 찍혔는가.
//     ③ 글자가 테두리를 침범하지 않는가 — 글자가 아래로 밀리면 밑줄을 덮어
//        "선이 끊겨 보이는" 증상이 됩니다.
//
//   ★ 반드시 실제 앱 페이지 안에서 캡처합니다.
//     이 증상은 호스트 페이지의 CSS(globals.css 의 Tailwind preflight)와 글꼴이
//     함께 있어야 재현됩니다. 컴포넌트만 빈 페이지에 띄우면 멀쩡하게 나와서
//     재현이 안 됩니다. 그래서 dev 서버(:3000)에 로그인한 실제 화면을 열고,
//     실제와 같은 래퍼(position:fixed;left:-10000px)로 보고서를 심은 뒤
//     lib/pdf.ts 와 동일한 옵션으로 html2canvas 를 태웁니다.
//     로컬 DB 에 활동 기록이 없어도 되도록 데이터만 샘플을 씁니다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import React from "react";
import ActivityPdfReport from "../app/components/ActivityPdfReport";
import TripPdfReport from "../app/components/TripPdfReport";
import type { Activity, BusinessTrip, DrivingLog, Settings } from "../lib/supabase";

// lib/pdf.ts 의 html2canvas 옵션과 같아야 합니다.
const HTML2CANVAS_OPTS = { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false };
const SCALE = HTML2CANVAS_OPTS.scale;

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "test-output", "trip-pdf");
const BASE = process.env.PDF_PROBE_ORIGIN ?? "http://localhost:3000";

for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && process.env[m[1]] === undefined)
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

let failures = 0;
function expect(label: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗"} ${label}${cond ? "" : ` — ${detail ?? ""}`}`);
}

// 실물에서 문제가 드러나는 모양으로 — 한 줄 칸과 여러 줄 칸이 섞인 표.
//   (모든 칸이 한 줄이면 높이가 같아 정렬이 틀려도 눈에 덜 띕니다.)
const LONG_PURPOSE =
  "2027년 청소년 정책사업 공모 사전협의 및 동래구 청소년수련관 운영 개선과제 논의 (장문 — 두 줄 이상으로 접히는 칸)";

const activity: Activity = {
  id: "sample", kind: "business_trip", author: "노미현",
  companion: ["김민정", "박준우"], purpose: LONG_PURPOSE,
  content: "사업 공모 일정·배점 기준 확인.\n제출서류 목록 협의.",
  result: "공모 일정 확인. 제출서류 초안 10월 중 회신 예정.",
  photos: [], receipts: [], certificate: [],
  start_date: "2026-09-17", end_date: "2026-09-17",
  location: "부산광역시청 청소년과",
  organization: null, city: null, country: null,
  transport_type: "public", transport_cost: 24000,
  accommodation: null, accommodation_cost: null, training_cost: null,
  course_name: null, visa_info: null, education_type: null,
  instructor: null, education_hours: null, attendees_count: null,
  driving_log_id: "dl-1",
  created_at: "2026-09-17T09:00:00+09:00",
};
// 차량 운행 정보 표(두 번째 표)까지 덮습니다.
const drivingLog = {
  id: "dl-1", driven_at: "2026-09-17", driver: "노미현",
  departure: "동래구청소년센터", waypoint: "부산광역시청 청소년과",
  destination: "동래구청소년센터", distance: 24,
  confirmed_by: "허일수",
} as unknown as DrivingLog;
const settings = { vehicle_model: "아반떼", vehicle_number: "12가 3456" } as unknown as Settings;

const trip: BusinessTrip = {
  id: "sample", trip_date: "2026-09-17",
  destination: "부산광역시청 청소년과", traveler: "노미현",
  companion: ["김민정", "박준우"], purpose: LONG_PURPOSE,
  transport_type: "public", transport_cost: 24000,
  meeting_content: activity.content, main_agenda: "2027년 공모사업 사전협의",
  result: activity.result, photos: [], receipts: [],
  created_at: activity.created_at,
};

const targets = [
  {
    name: "activity",
    label: "활동일지 출장보고서 (ActivityPdfReport)",
    markup: renderToStaticMarkup(
      React.createElement(ActivityPdfReport, { activity, drivingLog, settings })
    ),
  },
  {
    name: "trip",
    label: "출장일지 출장보고서 (TripPdfReport, 레거시)",
    markup: renderToStaticMarkup(React.createElement(TripPdfReport, { trip })),
  },
];

type Cell = { tag: string; text: string; x: number; y: number; w: number; h: number };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { signPayload } = await import("../lib/signedCookie");
  const hrName = process.env.E2E_HR_NAME;
  if (!hrName || !process.env.SESSION_SECRET) {
    console.log("⚠ .env.local 의 E2E_HR_NAME / SESSION_SECRET 이 없어 건너뜁니다.");
    return;
  }

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });
    await ctx.addCookies([
      { name: "dongrae_employee", value: signPayload({ name: hrName }), url: BASE },
    ]);
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/activities`, { waitUntil: "networkidle", timeout: 30_000 });
    } catch {
      console.log(`⚠ dev 서버(${BASE})에 붙지 못했습니다 — \`npm run dev\` 후 다시 실행하세요.`);
      failures++;
      return;
    }
    console.log(`앱 페이지: ${page.url()}`);
    console.log(`body: ${await page.evaluate(() => document.body.className)}\n`);
    await page.addScriptTag({
      path: join(ROOT, "node_modules", "html2canvas", "dist", "html2canvas.min.js"),
    });

    for (const t of targets) {
      console.log(`── ${t.label} ──`);
      const shot = await page.evaluate(
        async ({ html, opts }) => {
          document.getElementById("pdfprobe-wrap")?.remove();
          const wrap = document.createElement("div");
          wrap.id = "pdfprobe-wrap";
          // 실제 화면의 래퍼와 동일 (TripDetail / ActivityDetail).
          wrap.setAttribute(
            "style",
            "position:fixed;left:-10000px;top:0;width:794px;pointer-events:none"
          );
          wrap.innerHTML = `<div id="pdfprobe-report">${html}</div>`;
          document.body.appendChild(wrap);
          const node = document.getElementById("pdfprobe-report") as HTMLElement;
          await Promise.all(
            Array.from(node.querySelectorAll("img")).map(
              (img) =>
                new Promise<void>((r) => {
                  if (img.complete && img.naturalWidth > 0) return r();
                  img.addEventListener("load", () => r(), { once: true });
                  img.addEventListener("error", () => r(), { once: true });
                })
            )
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const canvas: HTMLCanvasElement = await (window as any).html2canvas(node, opts);
          const base = node.getBoundingClientRect();
          const cells = Array.from(node.querySelectorAll("th,td")).map((el) => {
            const r = el.getBoundingClientRect();
            return {
              tag: el.tagName.toLowerCase(),
              text: (el.textContent ?? "").trim().slice(0, 14),
              x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height,
            };
          });
          return {
            cells,
            png: canvas.toDataURL("image/png").split(",")[1],
            // PDF 에 실제로 박히는 것은 이 JPEG 입니다(lib/pdf.ts 와 같은 품질).
            jpg: canvas.toDataURL("image/jpeg", 0.92).split(",")[1],
          };
        },
        { html: t.markup, opts: HTML2CANVAS_OPTS }
      );

      const buf = Buffer.from(shot.png, "base64");
      writeFileSync(join(OUT, `${t.name}.png`), buf);
      writeFileSync(join(OUT, `${t.name}.jpg`), Buffer.from(shot.jpg, "base64"));
      const raw = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const W = raw.info.width, H = raw.info.height;
      const lum = (x: number, y: number) => {
        const i = (y * W + x) * 3;
        return (raw.data[i] * 299 + raw.data[i + 1] * 587 + raw.data[i + 2] * 114) / 1000;
      };
      const ink = (x: number, y: number, cut = 235) =>
        x >= 0 && y >= 0 && x < W && y < H && lum(x, y) < cut;

      const cells = shot.cells as Cell[];
      const missing: string[] = [];
      const skewed: string[] = [];
      const touching: string[] = [];
      const offsets: number[] = [];

      for (const c of cells) {
        const x0 = Math.round(c.x * SCALE), y0 = Math.round(c.y * SCALE);
        const x1 = Math.round((c.x + c.w) * SCALE) - 1, y1 = Math.round((c.y + c.h) * SCALE) - 1;
        if (x1 <= x0 || y1 <= y0 || x1 >= W || y1 >= H) continue;

        // ② 테두리 — 변 전체를 훑어 선이 찍힌 비율. 가운데 한 점만 보면
        //    일부만 그어진 선을 놓칩니다.
        const cov = (from: number, to: number, horiz: boolean, fixed: number) => {
          let hit = 0, n = 0;
          for (let t2 = from + 2; t2 <= to - 2; t2++) {
            n++;
            if ([-2, -1, 0, 1, 2].some((d) =>
              horiz ? ink(t2, fixed + d) : ink(fixed + d, t2)
            )) hit++;
          }
          return n ? hit / n : 1;
        };
        const sides = {
          top: cov(x0, x1, true, y0), bottom: cov(x0, x1, true, y1),
          left: cov(y0, y1, false, x0), right: cov(y0, y1, false, x1),
        };
        const gone = Object.entries(sides).filter(([, v]) => v < 0.9)
          .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`);
        if (gone.length) missing.push(`${c.tag}"${c.text}" → ${gone.join(", ")}`);

        // ① 세로정렬 — 셀 안쪽 글자 잉크의 세로 중심 vs 셀 박스 중심.
        let top = -1, bot = -1;
        for (let y = y0 + 2; y < y1 - 1; y++) {
          let hit = false;
          for (let x = x0 + 4; x < x1 - 4; x++) if (lum(x, y) < 170) { hit = true; break; }
          if (hit) { if (top < 0) top = y; bot = y; }
        }
        if (top < 0) continue;
        const off = ((top + bot) / 2 - (y0 + y1) / 2) / SCALE;
        offsets.push(off);
        if (Math.abs(off) > TOL)
          skewed.push(`"${c.text}" ${off > 0 ? "+" : ""}${off.toFixed(1)}px`);

        // ③ 글자가 위/아래 테두리에 닿지 않는지 (닿으면 선이 끊겨 보입니다).
        const gap = 2 * SCALE;
        if (top < y0 + gap || bot > y1 - gap)
          touching.push(`"${c.text}" (위 ${((top - y0) / SCALE).toFixed(1)}px / 아래 ${((y1 - bot) / SCALE).toFixed(1)}px)`);
      }

      const worst = offsets.length
        ? offsets.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0) : 0;
      console.log(
        `   셀 ${cells.length}개 · 글자 있는 칸 ${offsets.length}개 · ` +
          `최대 쏠림 ${worst >= 0 ? "+" : ""}${worst.toFixed(1)}px`
      );
      console.log(`   → test-output/trip-pdf/${t.name}.png (+ .jpg = PDF 에 박히는 실물)`);
      expect(`${t.name}: 표 세로정렬 — 글자가 셀 세로 중앙 (±${TOL}px)`,
        skewed.length === 0, skewed.join(", "));
      expect(`${t.name}: 표 테두리 — 모든 셀의 네 변이 전 구간 그어짐`,
        missing.length === 0, missing.slice(0, 6).join(" / "));
      expect(`${t.name}: 글자가 셀 테두리를 침범하지 않음`,
        touching.length === 0, touching.slice(0, 6).join(" / "));
      console.log("");
    }
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? "모두 통과" : `실패 ${failures}건`);
  process.exit(failures === 0 ? 0 : 1);
}

// 글꼴의 시각적 중심은 기하학적 중심과 1px 안팎 차이가 날 수 있으니 ±2px 까지는
//   중앙으로 봅니다. 문제가 됐던 쏠림은 6px 대였습니다.
const TOL = 2;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
