// =====================================================================
// 동래방카 필수 운영서식 출력 — 원본 PDF(lib/forms/bangka/*.pdf)를 그대로 배경으로 쓰고
//   그 위에 글자만 찍습니다. 양식을 새로 그리지 않습니다.
//   좌표는 원본 PDF 의 표 선·글자 위치를 재서 옮긴 값입니다(pt, 왼쪽 위 기준 → 찍을 때 뒤집음).
//     · [필수 운영서식 2]  급식계획      meal-plan.pdf
//     · [필수 운영서식 15] 공결확인서    absence.pdf (+ 증빙자료를 뒤 장으로)
//   글자가 칸보다 길면 글자 크기를 줄여 칸 안에 넣습니다(칸 밖으로 넘치지 않음).
// =====================================================================

import { readFileSync } from "fs";
import path from "path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { boldFont, fitToFont, fkFont, regularFont } from "@/lib/pdfFont";
import { BK_ALLERGENS } from "@/lib/bangkaMenuParse";

const FORM_DIR = path.join(process.cwd(), "lib", "forms", "bangka");
const formBytes = (file: string) => readFileSync(path.join(FORM_DIR, file));
const INK = rgb(0, 0, 0);

type Fonts = { regular: PDFFont; bold: PDFFont };

async function loadForm(file: string): Promise<{ pdf: PDFDocument; page: PDFPage; fonts: Fonts; H: number }> {
  const pdf = await PDFDocument.load(formBytes(file));
  pdf.registerFontkit(fontkit);
  const fonts = {
    regular: await pdf.embedFont(regularFont(), { subset: false }),
    bold: await pdf.embedFont(boldFont(), { subset: false }),
  };
  const page = pdf.getPage(0);
  return { pdf, page, fonts, H: page.getHeight() };
}

const safe = (s: string, bold = false) => fitToFont(s, fkFont(bold));

// 한 줄 — 왼쪽 위 기준 좌표(top 은 글자 기준선). align 으로 x 기준점을 정함.
function text(
  page: PDFPage,
  H: number,
  s: string,
  o: { x: number; base: number; size: number; font: PDFFont; bold?: boolean; align?: "left" | "center" | "right"; maxW?: number },
) {
  const t = safe(s, o.bold);
  if (!t) return;
  let size = o.size;
  if (o.maxW) while (size > 4 && o.font.widthOfTextAtSize(t, size) > o.maxW) size -= 0.25;
  const w = o.font.widthOfTextAtSize(t, size);
  const x = o.align === "center" ? o.x - w / 2 : o.align === "right" ? o.x - w : o.x;
  page.drawText(t, { x, y: H - o.base, size, font: o.font, color: INK });
}

// 조각(tokens)을 쉼표로 이어 폭 W 안에서 줄바꿈합니다(자르지 않음 — 줄 수만 늘어남).
//   조각 하나가 한 줄보다 길면 — "메뉴(5.6.13)" 은 괄호 앞에서 먼저 끊고, 그래도 길면 글자 단위로
//   자르되 알레르기 번호 중간("13" → "1"/"3")은 피해 점 뒤에서 끊습니다.
function wrapTokens(items: string[], W: number, size: number, font: PDFFont, sep = ", "): string[] {
  const lines: string[] = [];
  let cur = "";
  const width = (s: string) => font.widthOfTextAtSize(s, size);
  items.forEach((it, i) => {
    const piece = it + (i < items.length - 1 ? sep.trimEnd() : "");
    const cand = cur ? `${cur} ${piece}` : piece;
    if (width(cand) <= W) {
      cur = cand;
      return;
    }
    if (cur) lines.push(cur);
    cur = "";
    let rest = piece;
    const paren = rest.indexOf("(");
    if (width(rest) > W && paren > 0 && width(rest.slice(0, paren)) <= W) {
      lines.push(rest.slice(0, paren));
      rest = rest.slice(paren);
    }
    while (width(rest) > W) {
      let n = rest.length - 1;
      while (n > 1 && width(rest.slice(0, n)) > W) n--;
      const dot = rest.slice(0, n).lastIndexOf(".");
      if (rest.startsWith("(") && dot > 1) n = dot + 1;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    cur = rest;
  });
  if (cur) lines.push(cur);
  return lines;
}

const lineH = (size: number) => size * 1.18;

// 줄들을 상자 세로 가운데에 찍습니다.
function drawLines(
  page: PDFPage,
  H: number,
  lines: string[],
  box: { x0: number; y0: number; x1: number; y1: number },
  font: PDFFont,
  size: number,
  align: "left" | "center" = "left",
) {
  const W = box.x1 - box.x0;
  let base = box.y0 + (box.y1 - box.y0 - lines.length * lineH(size)) / 2 + size * 0.95;
  for (const ln of lines) {
    const w = font.widthOfTextAtSize(ln, size);
    const x = align === "center" ? box.x0 + (W - w) / 2 : box.x0;
    page.drawText(ln, { x, y: H - base, size, font, color: INK });
    base += lineH(size);
  }
}

// 상자 안에 여러 줄 — 넘치면 글자를 줄입니다. 다 줄여도(minSize) 넘치면 남는 줄은 버리고
//   마지막 줄 끝을 "…" 로 표시합니다(칸 밖으로는 절대 나가지 않음).
//   ★ 알레르기 번호처럼 잘리면 안 되는 글은 이 함수에 넣지 말 것 — planMealCell 참고.
function fitBox(
  page: PDFPage,
  H: number,
  tokens: string[],
  box: { x0: number; y0: number; x1: number; y1: number },
  font: PDFFont,
  o: { maxSize: number; minSize: number; sep?: string; align?: "left" | "center" },
) {
  const items = tokens.map((t) => safe(t)).filter(Boolean);
  if (!items.length) return;
  const W = box.x1 - box.x0;
  const Hh = box.y1 - box.y0;
  let size = o.maxSize;
  let lines = wrapTokens(items, W, size, font, o.sep);
  while (size > o.minSize && lines.length * lineH(size) > Hh) {
    size = Math.max(o.minSize, size - 0.25);
    lines = wrapTokens(items, W, size, font, o.sep);
  }
  const maxLines = Math.max(1, Math.floor(Hh / lineH(size)));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last.length > 1 && font.widthOfTextAtSize(`${last}…`, size) > W) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  drawLines(page, H, lines, box, font, size, o.align);
}

// ---------------------------------------------------------------------
// [필수 운영서식 2] 급식계획
// ---------------------------------------------------------------------

// allergens = 메뉴마다 알레르기 번호(BK_ALLERGENS 1~19, 업체 식단표·앱 급식 화면과 같은 번호).
//   손으로 넣은 날처럼 번호를 모르면 빈 배열 — 이름만 찍습니다.
export type MealPlanMenu = { name: string; allergens: number[] };
export type MealPlanDay = { date: string; menus: MealPlanMenu[]; kcal: number | null };

const allergenText = (m: MealPlanMenu) => [...m.allergens].sort((a, b) => a - b).join(".");
// "불고기(5.6.10)" — 칸이 좁아 번호는 점으로 잇습니다.
export const menuWithAllergens = (m: MealPlanMenu) => (m.allergens.length ? `${m.name}(${allergenText(m)})` : m.name);

// 메뉴 이름만 말줄임(번호는 그대로). cap 글자 + "…" — 두 글자 이상 줄 때만("가자미조림" → "가자미조…" 는 이득 없음).
const capName = (name: string, cap: number) => ([...name].length > cap + 1 ? `${[...name].slice(0, cap).join("")}…` : name);

const MEAL_MAX_SIZE = 8;
const MEAL_MIN_SIZE = 6; // 인쇄해서 읽을 수 있는 최소(2026-10 관장 지시)
const NAME_MIN_CAP = 4; // 이름은 최소 4글자 + "…" 까지만 줄임

// 급식 칸 배치 — ★ 알레르기 번호는 어떤 경우에도 "…" 로 자르지 않습니다(아이 안전 정보).
//   칸이 부족하면 순서대로(2026-10 관장 지시):
//     ① 메뉴 이름 쪽을 먼저 말줄임(긴 이름부터, 4글자까지)
//     ② 글자 크기 축소(최소 6pt) — 크기마다 ① 을 다시 시도
//     ③ 그래도 안 되면 null → 호출부가 그 날 번호를 표 아래 각주로 뺍니다.
//   돌려준 줄은 칸 안에 전부 들어갑니다(잘린 줄 없음).
export function planMealCell(
  menus: MealPlanMenu[],
  box: { x0: number; y0: number; x1: number; y1: number },
  font: PDFFont,
): { lines: string[]; size: number } | null {
  const W = box.x1 - box.x0;
  const Hh = box.y1 - box.y0;
  const longest = Math.max(...menus.map((m) => [...m.name].length));
  for (let size = MEAL_MAX_SIZE; size >= MEAL_MIN_SIZE; size -= 0.25) {
    for (let cap = longest; cap >= Math.min(NAME_MIN_CAP, longest); cap--) {
      const tokens = menus.map((m) => safe(menuWithAllergens({ ...m, name: capName(m.name, cap) }))).filter(Boolean);
      const lines = wrapTokens(tokens, W, size, font);
      if (lines.length * lineH(size) <= Hh) return { lines, size };
    }
  }
  return null;
}

// 칸 좌표(meal-plan.pdf 실측). 열 = 월~토, 행 = 1~5주.
const MP = {
  colX: [123.7, 190.0, 256.3, 322.6, 389.0, 455.3, 521.7],
  weekTop: [265.6, 353.1, 440.8, 525.5, 610.3],
  kcalTop: [335.4, 423.1, 507.9, 595.5, 677.5],
  weekBottom: [353.1, 440.8, 525.5, 610.3, 694.9],
  dateStrip: 17.6, // 주 칸 맨 위 하늘색 "일" 띠 높이
  // 결재란 머리 칸(담임·팀장·빈칸) — 가운데 x, 글자 기준선. 원본 "담임" 글자 자리 실측.
  signHead: { base: 153.1, size: 9.9, centers: [387.35, 441.6, 495.75] },
  damimCover: { x: 375.6, top: 143.6, w: 23.5, h: 11.6 },
  legendBase: 762.8, // 맨 아래 ※ 안내 3줄 다음 줄
  footnote: { x0: 70.9, x1: 524, top: 780, bottom: 834 }, // ③ 칸에 못 넣은 날의 번호 각주 자리(번호표 아래)
};

// 알레르기 번호표 — 서식 맨 아래 안내 다음 두 줄(표 밖·용지 여백 안). 한 줄이면 6pt 아래로 작아져 1~10 / 11~19 로 나눔.
const LEGEND_ITEMS = Object.entries(BK_ALLERGENS).map(([n, v]) => `${n}.${v.replace(/\(.*\)/, "")}`);
const ALLERGEN_LEGEND = [`알레르기: ${LEGEND_ITEMS.slice(0, 10).join(" ")}`, LEGEND_ITEMS.slice(10).join(" ")];

const p2 = (n: number) => String(n).padStart(2, "0");
const ymdUTC = (d: Date) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;

// 그 달 월~토가 하루라도 걸치는 주의 월요일들.
export function mealPlanWeeks(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const d = new Date(first);
  d.setUTCDate(1 - ((first.getUTCDay() + 6) % 7)); // 1일이 속한 주 월요일
  const out: string[] = [];
  for (; d <= last; d.setUTCDate(d.getUTCDate() + 7)) {
    const sat = new Date(d);
    sat.setUTCDate(d.getUTCDate() + 5);
    if (sat >= first) out.push(ymdUTC(d)); // 1일이 일요일이면 그 주(월~토)는 앞 달뿐 → 뺌
  }
  return out;
}

// 월 → PDF. 6주에 걸치는 달은 둘째 장에 이어서 찍습니다(양식 한 장이 5주).
export async function buildMealPlanPdf(input: {
  ym: string;
  writtenOn: string; // YYYY-MM-DD
  writer: string;
  days: MealPlanDay[];
}): Promise<Uint8Array> {
  const [y, m] = input.ym.split("-").map(Number);
  const byDate = new Map(input.days.map((d) => [d.date, d]));
  const weeks = mealPlanWeeks(input.ym);
  const { pdf, fonts, H } = await loadForm("meal-plan.pdf");
  for (let p = 0; p * 5 < weeks.length; p++) {
    if (p > 0) {
      // 둘째 장 — 빈 양식 한 장을 더 붙입니다(폰트는 한 번만 넣음).
      const [blank] = await pdf.copyPages(await PDFDocument.load(formBytes("meal-plan.pdf")), [0]);
      pdf.addPage(blank);
    }
    const page = pdf.getPage(p);
    // [ ]월
    text(page, H, String(m), { x: 134.9, base: 172.2, size: 19, font: fonts.bold, bold: true, align: "center" });
    const [wy, wm, wd] = input.writtenOn.split("-").map(Number);
    text(page, H, `${wy}. ${wm}. ${wd}.`, { x: 136, base: 220.4, size: 10, font: fonts.regular });
    text(page, H, input.writer, { x: 378, base: 220.4, size: 10, font: fonts.regular, maxW: 140 });
    // 결재란: 원본 "담임·팀장·(빈칸)" → "담당·팀장·관장"(2026-10 조유경 팀장 요청). 담임 글자는 흰 칸으로 덮고 다시 씀.
    const sh = MP.signHead;
    const dc = MP.damimCover;
    page.drawRectangle({ x: dc.x, y: H - dc.top - dc.h, width: dc.w, height: dc.h, color: rgb(1, 1, 1) });
    text(page, H, "담당", { x: sh.centers[0], base: sh.base, size: sh.size, font: fonts.bold, bold: true, align: "center" });
    text(page, H, "관장", { x: sh.centers[2], base: sh.base, size: sh.size, font: fonts.bold, bold: true, align: "center" });
    ALLERGEN_LEGEND.forEach((ln, i) => {
      // 둘째 줄은 "알레르기: " 폭만큼 들여 번호가 줄 맞춰 보이게.
      const indent = i ? fonts.regular.widthOfTextAtSize("알레르기: ", 7.5) : 0;
      text(page, H, ln, { x: 70.9 + indent, base: MP.legendBase + i * 9, size: 7.5, font: fonts.regular, maxW: 453 - indent });
    });

    const footnotes: string[] = [];
    weeks.slice(p * 5, p * 5 + 5).forEach((mon, wi) => {
      for (let di = 0; di < 6; di++) {
        const d = new Date(`${mon}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + di);
        if (d.getUTCFullYear() !== y || d.getUTCMonth() !== m - 1) continue; // 그 달이 아닌 날은 빈칸
        const x0 = MP.colX[di];
        const x1 = MP.colX[di + 1];
        const top = MP.weekTop[wi];
        text(page, H, String(d.getUTCDate()), { x: x0 + 48.3, base: top + 12.4, size: 10, font: fonts.bold, bold: true, align: "right" });
        const meal = byDate.get(ymdUTC(d));
        if (!meal || !meal.menus.length) continue; // 급식 없는 날은 날짜만
        const cell = { x0: x0 + 2.5, y0: top + MP.dateStrip + 1.8, x1: x1 - 2.5, y1: MP.kcalTop[wi] - 1.8 };
        const plan = planMealCell(meal.menus, cell, fonts.regular);
        if (plan) {
          drawLines(page, H, plan.lines, cell, fonts.regular, plan.size, "center");
        } else {
          // ③ 칸에는 표시 + 이름만(이름은 말줄임될 수 있음), 번호는 표 아래 각주에 빠짐없이.
          //   표시는 맨 앞 — 끝에 두면 말줄임에 밀려 사라짐.
          fitBox(page, H, ["※알레르기 아래", ...meal.menus.map((x) => x.name)], cell, fonts.regular, {
            maxSize: MEAL_MAX_SIZE,
            minSize: MEAL_MIN_SIZE,
            align: "center",
          });
          const withNo = meal.menus.filter((x) => x.allergens.length);
          if (withNo.length) footnotes.push(`※ ${d.getUTCDate()}일 알레르기: ${withNo.map((x) => `${x.name} ${allergenText(x)}`).join(" · ")}`);
        }
        if (meal.kcal != null) {
          text(page, H, String(meal.kcal), { x: x0 + 29.3, base: MP.kcalTop[wi] + 12.6, size: 10, font: fonts.regular, align: "center", maxW: 25 });
        }
      }
    });
    if (footnotes.length) drawFootnotes(page, H, footnotes, fonts.regular);
  }
  pdf.setTitle(`${y}년 ${m}월 급식계획`);
  return pdf.save();
}

// ③ 각주 — 번호표 아래 여백. 글자를 6pt 까지 줄이고, 그래도 넘치면 용지 아래 여백까지 이어 찍습니다
//   (번호를 버리지 않음).
function drawFootnotes(page: PDFPage, H: number, notes: string[], font: PDFFont) {
  const f = MP.footnote;
  const W = f.x1 - f.x0;
  const wrapAll = (size: number) => notes.flatMap((n) => wrapTokens(safe(n).split(" · "), W, size, font, " · "));
  let size = 7.5;
  let lines = wrapAll(size);
  while (size > MEAL_MIN_SIZE && lines.length * lineH(size) > f.bottom - f.top) {
    size -= 0.25;
    lines = wrapAll(size);
  }
  let base = f.top + size;
  for (const ln of lines) {
    page.drawText(ln, { x: f.x0, y: H - base, size, font, color: INK });
    base += lineH(size);
  }
}

// ---------------------------------------------------------------------
// [필수 운영서식 15] 공결확인서
// ---------------------------------------------------------------------

export type AbsencePdfInput = {
  name: string;
  school: string | null;
  grade: string | null; // "4" · "초4" · "중1" 등 — 숫자만 찍음
  // "___반" 칸 = 방과후 반(이음반·지음반). 서식에 "반" 글자가 이미 있어 "이음"만 찍습니다.
  //   학교 반(bk_students.school_class)은 이 칸에 쓰지 않습니다(데이터는 그대로 둠, 2026-10 조유경 팀장 요청).
  afterClass: string | null;
  startDate: string;
  endDate: string;
  confirmerType: "guardian" | "teacher" | "other";
  confirmerOther: string | null;
  confirmerName: string;
  reasonLabel: string;
  reason: string | null;
  confirmedOn: string; // YYYY-MM-DD
  signature: { bytes: Uint8Array; mime: string } | null;
  evidence: { name: string; mime: string; bytes: Uint8Array }[];
};

const AB = {
  nameCell: { x0: 157.6, x1: 238.7 },
  schoolCell: { x0: 294.7, x1: 375.8 },
  row1Base: 213.6, // 성명·학교·학년/반 기준선
  gradeCenter: 443.2,
  classCenter: 483.6,
  periodCell: { x0: 157.6, y0: 237.9, x1: 238.7, y1: 293.2 },
  // □ 글자 위치(10pt 굴림체): 보호자 · 선생님 · 기타
  boxes: { guardian: [344.8, 252.8], teacher: [429.7, 252.8], other: [344.8, 268.9] } as Record<string, [number, number]>,
  otherText: { x0: 385.5, x1: 469.0, base: 277.0 },
  reasonBox: { x0: 162, y0: 330, x1: 516, y1: 494 },
  dateBase: 573.4,
  yy: 267.6, // "20" 뒤 두 자리 가운데
  mm: 292.6,
  dd: 322.6,
  confirmerX: 462.0, // "확인자 :" 와 "(인)" 사이
  confirmerBase: 621.4,
  sealCenter: [499.0, 617.5] as [number, number], // "(인)" 위 — 표 오른쪽 선(521.4) 안쪽
};

const digits = (s: string | null) => (s ?? "").match(/\d+/)?.[0] ?? "";
const dotDate = (ymd: string) => ymd.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, a, b, c) => `${a}.${Number(b)}.${Number(c)}.`);

export async function buildAbsencePdf(a: AbsencePdfInput): Promise<Uint8Array> {
  const { pdf, page, fonts, H } = await loadForm("absence.pdf");
  const R = fonts.regular;
  const mid = (c: { x0: number; x1: number }) => (c.x0 + c.x1) / 2;

  text(page, H, a.name, { x: mid(AB.nameCell), base: AB.row1Base, size: 11, font: R, align: "center", maxW: 76 });
  text(page, H, a.school ?? "", { x: mid(AB.schoolCell), base: AB.row1Base, size: 10, font: R, align: "center", maxW: 76 });
  text(page, H, digits(a.grade), { x: AB.gradeCenter, base: AB.row1Base - 0.6, size: 10, font: R, align: "center", maxW: 16 });
  text(page, H, (a.afterClass ?? "").replace(/반\s*$/, ""), { x: AB.classCenter, base: AB.row1Base - 0.6, size: 10, font: R, align: "center", maxW: 15 });

  const period = a.startDate === a.endDate ? [dotDate(a.startDate)] : [`${dotDate(a.startDate)} ~`, dotDate(a.endDate)];
  fitBox(page, H, period, AB.periodCell, R, { maxSize: 10, minSize: 6, sep: " ", align: "center" });

  // □ → ■ : 원래 □ 위에 같은 크기 검은 칸을 덮습니다.
  const [bx, btop] = AB.boxes[a.confirmerType];
  page.drawRectangle({ x: bx + 1.0, y: H - (btop + 9.1), width: 8.1, height: 8.1, color: INK });
  if (a.confirmerType === "other" && a.confirmerOther) {
    text(page, H, a.confirmerOther, { x: mid(AB.otherText), base: AB.otherText.base, size: 9.5, font: R, align: "center", maxW: AB.otherText.x1 - AB.otherText.x0 });
  }

  const reasonLines = [`[${a.reasonLabel}]`, ...(a.reason ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)];
  fitReason(page, H, reasonLines, R);

  const [cy, cm, cd] = a.confirmedOn.split("-").map(Number);
  text(page, H, String(cy % 100).padStart(2, "0"), { x: AB.yy, base: AB.dateBase, size: 10, font: R, align: "center" });
  text(page, H, String(cm), { x: AB.mm, base: AB.dateBase, size: 10, font: R, align: "center" });
  text(page, H, String(cd), { x: AB.dd, base: AB.dateBase, size: 10, font: R, align: "center" });
  text(page, H, a.confirmerName, { x: AB.confirmerX, base: AB.confirmerBase, size: 10.5, font: R, align: "center", maxW: 56 });

  if (a.signature) {
    const img = a.signature.mime === "image/png" ? await pdf.embedPng(a.signature.bytes) : await pdf.embedJpg(a.signature.bytes);
    const s = Math.min(40 / img.width, 28 / img.height);
    const w = img.width * s;
    const h = img.height * s;
    page.drawImage(img, { x: AB.sealCenter[0] - w / 2, y: H - AB.sealCenter[1] - h / 2, width: w, height: h });
  }

  // 증빙자료 — 사진은 A4 한 장에 맞춰, PDF 는 장을 그대로 이어 붙입니다.
  for (const f of a.evidence) {
    try {
      if (f.mime === "application/pdf") {
        const src = await PDFDocument.load(f.bytes, { ignoreEncryption: true });
        for (const pg of await pdf.copyPages(src, src.getPageIndices())) pdf.addPage(pg);
        continue;
      }
      const img = f.mime === "image/png" ? await pdf.embedPng(f.bytes) : await pdf.embedJpg(f.bytes);
      const pg = pdf.addPage([595, 841]);
      const margin = 36;
      const labelH = 18;
      const s = Math.min((595 - margin * 2) / img.width, (841 - margin * 2 - labelH) / img.height, 1.5);
      const w = img.width * s;
      const h = img.height * s;
      pg.drawText(safe(`증빙자료 — ${f.name}`), { x: margin, y: 841 - margin - 10, size: 9, font: R, color: rgb(0.3, 0.3, 0.3) });
      pg.drawImage(img, { x: (595 - w) / 2, y: 841 - margin - labelH - h, width: w, height: h });
    } catch {
      const pg = pdf.addPage([595, 841]);
      pg.drawText(safe(`증빙자료 '${f.name}' 을(를) PDF 에 넣지 못했습니다 — 원본 파일을 따로 확인하세요.`), {
        x: 36,
        y: 841 - 50,
        size: 10,
        font: R,
        color: rgb(0.6, 0, 0),
      });
    }
  }
  pdf.setTitle(`공결확인서 ${a.name} ${a.startDate}`);
  return pdf.save();
}

// 사유 칸 — 줄 단위(첫 줄은 [사유 구분]), 긴 줄은 줄바꿈, 넘치면 글자를 줄임.
function fitReason(page: PDFPage, H: number, lines: string[], font: PDFFont) {
  const box = AB.reasonBox;
  const W = box.x1 - box.x0;
  const wrapAll = (size: number) =>
    lines.flatMap((ln) => {
      const t = safe(ln);
      const out: string[] = [];
      let rest = t;
      while (font.widthOfTextAtSize(rest, size) > W) {
        let n = rest.length - 1;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > W) n--;
        const sp = rest.slice(0, n).lastIndexOf(" ");
        if (sp > n * 0.6) n = sp + 1;
        out.push(rest.slice(0, n).trimEnd());
        rest = rest.slice(n).trimStart();
      }
      out.push(rest);
      return out;
    });
  let size = 11;
  let wrapped = wrapAll(size);
  while (size > 6 && wrapped.length * size * 1.5 > box.y1 - box.y0) {
    size -= 0.25;
    wrapped = wrapAll(size);
  }
  const maxLines = Math.floor((box.y1 - box.y0) / (size * 1.5));
  wrapped.slice(0, maxLines).forEach((ln, i) => {
    page.drawText(ln, { x: box.x0, y: H - (box.y0 + size + i * size * 1.5), size, font, color: INK });
  });
}
