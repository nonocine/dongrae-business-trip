// =====================================================================
// 방카 신규 접수 — 신청서 PDF(직원 화면 [신청서 PDF 다운로드]).
//   양식과 같은 구성·순서, 서류마다 새 쪽:
//     ① 지원 신청서(사진 3x4 칸, 우선지원 유형 체크)  ② 보호자 동의서(귀가방법 체크)
//     ③ 개인정보 수집·이용 및 제공 동의서(예/아니오 체크 그대로)  ④ 출석률 유지 동의서
//     ⑤ 추천서(제출된 것이 있을 때만)  ⑥ 귀가차량 신청서(귀가차량일 때만, 기타 장소 포함)
//     ⑦ 식품알레르기 조사서(알레르기 '있다'일 때만)
//   * 서명 이미지는 (인) 자리에 겹쳐 찍고, 날짜는 제출일(추천서는 추천서 제출일).
//   * 글꼴: lib/pdfFont(나눔고딕 통임베드 + 없는 글자 대체) — 직인사용대장 증서·근무일지와 같은 방식(pdf-lib).
// =====================================================================

import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { embedServerFonts, fitToFont, type PdfFonts } from "@/lib/pdfFont";
import {
  ALLERGY_SYMPTOMS,
  CONSENTS,
  GUARDIAN_RELATION_LABEL,
  PLEDGE_INTRO,
  PLEDGE_ITEMS,
  PRIORITY_TYPES,
  RECOMMEND_REASONS,
  RETURN_METHODS,
  STOP_ETC,
  stopShowsTime,
  type AppData,
  type AppSensitive,
  type ShuttleStop,
} from "@/lib/bangkaEnroll";
import { BK_ALLERGENS } from "@/lib/bangkaMenuParse";

export type ApplicationPdfInput = {
  appNo: string | null;
  recruitmentTitle: string;
  data: AppData;
  sensitive: AppSensitive | null; // 보관기간이 지나 지워졌으면 null
  guardianPhone: string; // 표시용(하이픈 포함)
  submittedAt: string | null; // ISO
  stops: ShuttleStop[];
  photo: Uint8Array | null;
  guardianSig: Uint8Array | null;
  youthSig: Uint8Array | null;
  recommendation: {
    org: string | null;
    position: string | null;
    writer_name: string | null;
    writer_phone: string | null;
    reasons: string[];
    opinion: string | null;
    notes: string | null;
    submitted_at: string | null;
    signature: Uint8Array | null;
  } | null;
};

const W = 595.28;
const H = 841.89;
const M = 48; // 좌우 여백
const TOP = 52;
const BOTTOM = 52;
const CW = W - 2 * M;
const INK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.35, 0.35, 0.35);
const LINE = rgb(0.2, 0.2, 0.2);
const HEAD_BG = rgb(0.93, 0.93, 0.93);
const CENTER = "동래구청소년센터";

// "2026년 11월 4일" (KST)
export function kstDateLabel(iso: string | null | undefined): string {
  if (!iso) return "      년      월      일";
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  if (Number.isNaN(d.getTime())) return "      년      월      일";
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}

const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
async function embedImage(pdf: PDFDocument, b: Uint8Array | null): Promise<PDFImage | null> {
  if (!b?.length) return null;
  try {
    return isPng(b) ? await pdf.embedPng(b) : await pdf.embedJpg(b);
  } catch {
    return null;
  }
}

// --- 쪽·커서 ---------------------------------------------------------------
class Writer {
  page!: PDFPage;
  y = TOP; // 위에서부터 잰 현재 위치
  constructor(
    private pdf: PDFDocument,
    private f: PdfFonts,
  ) {}

  font = (bold?: boolean): PDFFont => (bold ? this.f.bold : this.f.font);
  fit = (s: string, bold?: boolean) => fitToFont(s ?? "", this.f.fk(!!bold));

  newPage() {
    this.page = this.pdf.addPage([W, H]);
    this.y = TOP;
  }
  ensure(h: number) {
    if (this.y + h > H - BOTTOM) this.newPage();
  }

  // 글자 한 줄(yTop = 글자 위쪽)
  text(s: string, x: number, yTop: number, size: number, o: { bold?: boolean; align?: "left" | "center" | "right"; color?: ReturnType<typeof rgb> } = {}) {
    const t = this.fit(s, o.bold);
    const font = this.font(o.bold);
    const tw = font.widthOfTextAtSize(t, size);
    const xx = o.align === "center" ? x - tw / 2 : o.align === "right" ? x - tw : x;
    this.page.drawText(t, { x: xx, y: H - yTop - size * 0.86, size, font, color: o.color ?? INK });
    return tw;
  }
  width(s: string, size: number, bold?: boolean) {
    return this.font(bold).widthOfTextAtSize(this.fit(s, bold), size);
  }

  // 띄어쓰기 기준 줄바꿈(한 어절이 줄보다 길면 글자 단위)
  wrap(s: string, size: number, maxW: number, bold?: boolean): string[] {
    const font = this.font(bold);
    const out: string[] = [];
    for (const para of this.fit(s, bold).split(/\r?\n/)) {
      let line = "";
      for (const w of para.split(/(\s+)/).filter(Boolean)) {
        if (/^\s+$/.test(w)) {
          if (line) line += " ";
          continue;
        }
        if (font.widthOfTextAtSize(line + w, size) <= maxW) {
          line += w;
          continue;
        }
        if (line.trim()) out.push(line.trimEnd());
        line = "";
        if (font.widthOfTextAtSize(w, size) <= maxW) {
          line = w;
          continue;
        }
        for (const ch of w) {
          if (line && font.widthOfTextAtSize(line + ch, size) > maxW) {
            out.push(line);
            line = "";
          }
          line += ch;
        }
      }
      out.push(line.trimEnd());
    }
    return out;
  }

  // 문단 — 쪽을 넘기며 그린다.
  para(s: string, size: number, o: { x?: number; w?: number; bold?: boolean; lh?: number; after?: number; color?: ReturnType<typeof rgb> } = {}) {
    const x = o.x ?? M;
    const w = o.w ?? CW - (x - M);
    const lh = size * (o.lh ?? 1.55);
    for (const ln of this.wrap(s, size, w, o.bold)) {
      this.ensure(lh);
      this.text(ln, x, this.y, size, { bold: o.bold, color: o.color });
      this.y += lh;
    }
    this.y += o.after ?? 0;
  }

  rect(x: number, yTop: number, w: number, h: number, o: { fill?: ReturnType<typeof rgb>; border?: boolean; bw?: number } = {}) {
    this.page.drawRectangle({
      x,
      y: H - yTop - h,
      width: w,
      height: h,
      color: o.fill,
      borderColor: o.border === false ? undefined : LINE,
      borderWidth: o.border === false ? 0 : (o.bw ?? 0.7),
    });
  }

  // 체크 칸 □ / ☑(선으로 그린 체크)
  check(x: number, yTop: number, size: number, on: boolean) {
    this.rect(x, yTop, size, size, { bw: 0.8 });
    if (on) {
      const p = this.page;
      const bx = x;
      const by = H - yTop - size;
      p.drawLine({ start: { x: bx + size * 0.18, y: by + size * 0.52 }, end: { x: bx + size * 0.42, y: by + size * 0.22 }, thickness: 1.5, color: INK });
      p.drawLine({ start: { x: bx + size * 0.42, y: by + size * 0.22 }, end: { x: bx + size * 0.86, y: by + size * 0.84 }, thickness: 1.5, color: INK });
    }
  }

  // 체크 항목들을 옆으로 흘려 쓰기(줄이 차면 다음 줄)
  checks(items: { label: string; on: boolean }[], o: { x?: number; w?: number; size?: number; gap?: number; colW?: number } = {}) {
    const size = o.size ?? 10;
    const x0 = o.x ?? M;
    const maxX = x0 + (o.w ?? CW - (x0 - M));
    const lh = size * 1.9;
    let x = x0;
    this.ensure(lh);
    for (const it of items) {
      const tw = this.width(it.label, size);
      const w = o.colW ? Math.max(o.colW, size * 1.5 + tw + 6) : size * 1.5 + tw + (o.gap ?? 16);
      if (x > x0 && x + Math.min(w, size * 1.5 + tw) > maxX) {
        x = x0;
        this.y += lh;
        this.ensure(lh);
      }
      this.check(x, this.y + 0.5, size, it.on);
      this.text(it.label, x + size * 1.4, this.y, size);
      x += w;
    }
    this.y += lh;
  }

  // 제목(가운데, 굵게, 글자 사이 띄움) + 밑줄 두 겹
  title(s: string, sub?: string) {
    this.ensure(70);
    this.text(s.split("").join(" ").replace(/ {3}/g, "  "), W / 2, this.y, 19, { bold: true, align: "center" });
    this.y += 30;
    if (sub) {
      this.text(sub, W / 2, this.y, 9.5, { align: "center", color: MUTED });
      this.y += 16;
    }
    this.y += 6;
  }

  heading(s: string) {
    this.ensure(28);
    this.y += 4;
    this.text(s, M, this.y, 11.5, { bold: true });
    this.y += 20;
  }

  // 표 한 줄: [이름 칸 | 값 칸] 여러 쌍. widths 합 = 전체 폭.
  row(cells: { label?: string; value?: string; w: number; head?: boolean; align?: "left" | "center" }[], o: { x?: number; size?: number; minH?: number } = {}) {
    const size = o.size ?? 10;
    const pad = 5;
    const lh = size * 1.4;
    const lines = cells.map((c) => this.wrap(c.label ?? c.value ?? "", size, c.w - 2 * pad, c.head));
    const h = Math.max(o.minH ?? 0, ...lines.map((l) => l.length * lh + 2 * pad - (lh - size)));
    this.ensure(h);
    let x = o.x ?? M;
    cells.forEach((c, i) => {
      this.rect(x, this.y, c.w, h, { fill: c.head ? HEAD_BG : undefined });
      const block = lines[i].length * lh - (lh - size);
      let ty = this.y + (h - block) / 2;
      for (const ln of lines[i]) {
        if (c.head || c.align === "center") this.text(ln, x + c.w / 2, ty, size, { bold: c.head, align: "center" });
        else this.text(ln, x + pad, ty, size);
        ty += lh;
      }
      x += c.w;
    });
    this.y += h;
    return h;
  }

  // 날짜 + 서명 줄. (인) 자리에 서명 그림.
  signLine(rows: { role: string; name: string; sig: PDFImage | null }[], date: string, to?: string) {
    this.ensure(40 + rows.length * 34 + (to ? 40 : 0));
    this.y += 14;
    this.text(date, W / 2, this.y, 12, { align: "center" });
    this.y += 34;
    for (const r of rows) {
      const size = 11.5;
      const right = W - M - 44; // 서명 그림이 (인) 가운데에 걸쳐도 여백 안에
      const inW = this.text("(인)", right, this.y, size, { align: "right" });
      const nameRight = right - inW - 14;
      const nm = r.name || "";
      const nmW = Math.max(70, this.width(nm, size, true));
      this.text(nm, nameRight - nmW / 2, this.y, size, { bold: true, align: "center" });
      this.text(`${r.role} :`, nameRight - nmW - 10, this.y, size, { align: "right" });
      if (r.sig) {
        const maxW = 78;
        const maxH = 34;
        const k = Math.min(maxW / r.sig.width, maxH / r.sig.height);
        const w = r.sig.width * k;
        const h = r.sig.height * k;
        const cx = right - inW / 2;
        const cy = this.y + size / 2;
        this.page.drawImage(r.sig, { x: cx - w / 2, y: H - cy - h / 2, width: w, height: h });
      }
      this.y += 32;
    }
    if (to) {
      this.y += 10;
      this.text(to, M, this.y, 13, { bold: true });
      this.y += 24;
    }
  }

  footer(appNo: string | null) {
    const pages = this.pdf.getPages();
    pages.forEach((p, i) => {
      const s = this.fit(`${appNo ? `접수번호 ${appNo} · ` : ""}${i + 1} / ${pages.length}`);
      const size = 8;
      const tw = this.f.font.widthOfTextAtSize(s, size);
      p.drawText(s, { x: W / 2 - tw / 2, y: 26, size, font: this.f.font, color: MUTED });
    });
  }
}

// --- 만들기 ----------------------------------------------------------------
export async function buildApplicationPdf(a: ApplicationPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`청소년방과후아카데미 신청서 ${a.appNo ?? ""}`.trim());
  const fonts = await embedServerFonts(pdf);
  const w = new Writer(pdf, fonts);
  const [photo, gSig, ySig, rSig] = await Promise.all([
    embedImage(pdf, a.photo),
    embedImage(pdf, a.guardianSig),
    embedImage(pdf, a.youthSig),
    embedImage(pdf, a.recommendation?.signature ?? null),
  ]);
  const d = a.data;
  const y = d.youth;
  const g = d.guardian;
  const date = kstDateLabel(a.submittedAt);
  const gender = y.gender === "M" ? "남" : y.gender === "F" ? "여" : "";
  const school = [y.school, y.grade, y.class_no && `${y.class_no.replace(/반\s*$/, "")}반`].filter(Boolean).join(" ");
  const address = [y.zip && `(${y.zip})`, y.addr1, y.addr2].filter(Boolean).join(" ");
  const guardianSign = { role: "보호자", name: g.name, sig: gSig };
  const youthSign = { role: "청소년", name: y.name, sig: ySig };
  const yn = (v: boolean | null | undefined) => [
    { label: "예", on: v === true },
    { label: "아니오", on: v === false },
  ];

  // ① 지원 신청서 ------------------------------------------------------------
  w.newPage();
  w.title("청소년방과후아카데미 지원 신청서", [a.recruitmentTitle, a.appNo && `접수번호 ${a.appNo}`].filter(Boolean).join(" · "));
  w.heading("1. 청소년");
  const PHOTO_COL = 112;
  const L = 82;
  const V = CW - PHOTO_COL - L;
  const photoTop = w.y;
  const youthRows: [string, string][] = [
    ["성명", y.name],
    ["성별", gender],
    ["생년월일", y.birth],
    ["학교 · 학년 · 반", school],
    ["담임교사", y.teacher],
    ["집 전화", y.tel],
    ["청소년 휴대전화", y.mobile],
  ];
  for (const [k, v] of youthRows) w.row([{ label: k, w: L, head: true }, { value: v, w: V }], { minH: 22 });
  // 사진 칸(3x4) — 청소년 칸 오른쪽에 걸쳐서
  const photoH = w.y - photoTop;
  w.rect(M + L + V, photoTop, PHOTO_COL, photoH);
  {
    const bw = 84;
    const bh = 112;
    const bx = M + L + V + (PHOTO_COL - bw) / 2;
    const by = photoTop + (photoH - bh) / 2;
    if (photo) {
      const k = Math.min(bw / photo.width, bh / photo.height);
      const pw = photo.width * k;
      const ph = photo.height * k;
      w.page.drawImage(photo, { x: bx + (bw - pw) / 2, y: H - by - bh + (bh - ph) / 2, width: pw, height: ph });
    } else {
      w.rect(bx, by, bw, bh, { bw: 0.5 });
      w.text("사진", bx + bw / 2, by + bh / 2 - 8, 9, { align: "center", color: MUTED });
      w.text("(3x4)", bx + bw / 2, by + bh / 2 + 4, 9, { align: "center", color: MUTED });
    }
  }
  w.row([{ label: "주소", w: L, head: true }, { value: address, w: CW - L }], { minH: 22 });
  w.row([{ label: "이메일", w: L, head: true }, { value: y.email, w: CW - L }], { minH: 22 });

  w.heading("2. 보호자");
  const half = (CW - 2 * L) / 2;
  w.row([{ label: "성명", w: L, head: true }, { value: g.name, w: half }, { label: "관계", w: L, head: true }, { value: GUARDIAN_RELATION_LABEL[g.relation] ?? "", w: half }], { minH: 22 });
  w.row([{ label: "휴대전화", w: L, head: true }, { value: a.guardianPhone, w: half }, { label: "이메일", w: L, head: true }, { value: g.email, w: half }], { minH: 22 });

  w.heading("3. 우선지원 유형(해당 항목 모두 체크)");
  w.checks(
    PRIORITY_TYPES.map((p) => ({ label: p.label, on: d.priority.includes(p.key) })),
    { colW: CW / 3, x: M + 4 },
  );

  w.heading("4. 신청 동기 · 특이사항");
  {
    const top = w.y;
    const lines = w.wrap(y.motive || "", 10, CW - 12);
    const h = Math.max(70, lines.length * 15 + 12);
    if (top + h <= H - BOTTOM) {
      w.rect(M, top, CW, h);
      let ty = top + 7;
      for (const ln of lines) {
        w.text(ln, M + 6, ty, 10);
        ty += 15;
      }
      w.y = top + h;
    } else {
      w.para(y.motive || "-", 10, { x: M + 6 });
    }
  }
  w.y += 8;
  w.para("위와 같이 청소년방과후아카데미 참여를 신청합니다.", 11, { x: M, after: 0 });
  w.signLine([{ ...guardianSign, role: "신청인(보호자)" }], date, `${CENTER}장 귀하`);

  // ② 보호자 동의서 ----------------------------------------------------------
  w.newPage();
  w.title("보호자 동의서");
  w.row([{ label: "청소년 성명", w: L, head: true }, { value: y.name, w: half }, { label: "학교·학년", w: L, head: true }, { value: school, w: half }], { minH: 22 });
  w.y += 12;
  w.para(PLEDGE_INTRO, 10.5, { after: 8 });
  PLEDGE_ITEMS.forEach((t, i) => {
    const on = d.consent.pledge[i] === true;
    const lines = w.wrap(`${i + 1}. ${t}`, 10.5, CW - 70);
    w.ensure(lines.length * 16 + 6);
    const top = w.y;
    lines.forEach((ln, j) => w.text(ln, M + 6, top + j * 16, 10.5));
    w.check(W - M - 58, top + 1, 10, on);
    w.text("동의", W - M - 44, top, 10);
    w.y = top + lines.length * 16 + 6;
  });
  w.y += 4;
  w.para("6. 귀가 방법", 10.5, { x: M + 6, bold: true, after: 2 });
  w.checks(
    RETURN_METHODS.map((r) => ({
      label: r.key === "other" ? `기타(${d.ret.method === "other" ? d.ret.other || "  " : "        "})` : r.label,
      on: d.ret.method === r.key,
    })),
    { x: M + 20 },
  );
  w.signLine([guardianSign, youthSign], date, `${CENTER}장 귀하`);

  // ③ 개인정보 수집·이용 및 제공 동의서 ----------------------------------------
  w.newPage();
  w.title("개인정보 수집·이용 및 제공 동의서");
  w.para(
    `${CENTER}는 청소년방과후아카데미 운영을 위하여 아래와 같이 개인정보를 수집·이용 및 제공하고자 합니다. 내용을 자세히 읽으신 후 동의 여부를 결정하여 주십시오.`,
    10,
    { after: 6 },
  );
  for (const c of CONSENTS.filter((x) => x.key !== "attendance")) {
    w.heading(c.title);
    for (const ln of c.body.split("\n")) w.para(ln, 9.5, { x: M + 8, lh: 1.5 });
    w.y += 2;
    w.ensure(22);
    const top = w.y;
    w.text("위의 내용에 동의하십니까?", M + 8, top + 1, 10, { bold: true });
    const save = w.y;
    w.y = top;
    w.checks(yn(d.consent.answers[c.key]), { x: W - M - 120, w: 120 });
    w.y = Math.max(save, w.y) + 2;
  }
  w.signLine([guardianSign], date, `${CENTER}장 귀하`);

  // ④ 출석률 유지 동의서 ------------------------------------------------------
  const att = CONSENTS.find((x) => x.key === "attendance");
  w.newPage();
  w.title("출석률 유지 동의서");
  w.row([{ label: "청소년 성명", w: L, head: true }, { value: y.name, w: half }, { label: "학교·학년", w: L, head: true }, { value: school, w: half }], { minH: 22 });
  w.y += 12;
  w.para("청소년방과후아카데미의 출석률 유지를 위하여 다음 사항에 동의합니다.", 10.5, { after: 6 });
  for (const ln of (att?.body ?? "").split("\n")) w.para(ln, 10.5, { x: M + 8, after: 4 });
  w.y += 6;
  {
    const top = w.y;
    w.text("위의 내용에 동의하십니까?", M + 8, top + 1, 10.5, { bold: true });
    w.checks(yn(d.consent.answers.attendance), { x: W - M - 120, w: 120 });
  }
  w.signLine([guardianSign, youthSign], date, `${CENTER}장 귀하`);

  // ⑤ 추천서(있을 때만) --------------------------------------------------------
  const rec = a.recommendation;
  if (rec && rec.submitted_at) {
    w.newPage();
    w.title("청소년방과후아카데미 추천서");
    w.heading("1. 추천 대상 청소년");
    w.row([{ label: "성명", w: L, head: true }, { value: y.name, w: half }, { label: "생년월일", w: L, head: true }, { value: y.birth, w: half }], { minH: 22 });
    w.row([{ label: "학교·학년", w: L, head: true }, { value: school, w: CW - L }], { minH: 22 });
    w.heading("2. 추천 사유");
    for (const r of RECOMMEND_REASONS) {
      const label = r.key === "other" ? `기타(${rec.reasons.includes("other") ? rec.opinion ?? "" : "            "})` : r.label;
      w.checks([{ label, on: rec.reasons.includes(r.key) }], { x: M + 8 });
    }
    w.heading("3. 특이사항(추천 사유 구체적 작성)");
    {
      const lines = w.wrap(rec.notes || "", 10, CW - 12);
      const h = Math.max(90, lines.length * 15 + 12);
      w.ensure(h);
      const top = w.y;
      w.rect(M, top, CW, h);
      lines.forEach((ln, i) => w.text(ln, M + 6, top + 7 + i * 15, 10));
      w.y = top + h;
    }
    w.heading("4. 추천자");
    w.row([{ label: "기관명", w: L, head: true }, { value: rec.org ?? "", w: half }, { label: "직위", w: L, head: true }, { value: rec.position ?? "", w: half }], { minH: 22 });
    w.row([{ label: "성명", w: L, head: true }, { value: rec.writer_name ?? "", w: half }, { label: "연락처", w: L, head: true }, { value: rec.writer_phone ?? "", w: half }], { minH: 22 });
    w.y += 6;
    w.para("위 청소년을 청소년방과후아카데미 참여 대상자로 추천합니다.", 11);
    w.signLine([{ role: "추천인", name: rec.writer_name ?? "", sig: rSig }], kstDateLabel(rec.submitted_at), `${CENTER}장 귀하`);
  }

  // ⑥ 귀가차량 신청서(있을 때만) -------------------------------------------------
  if (d.ret.method === "shuttle") {
    w.newPage();
    w.title("귀가차량 신청서");
    w.row([{ label: "청소년 성명", w: L, head: true }, { value: y.name, w: half }, { label: "학교·학년", w: L, head: true }, { value: school, w: half }], { minH: 22 });
    w.row([{ label: "보호자", w: L, head: true }, { value: g.name, w: half }, { label: "연락처", w: L, head: true }, { value: a.guardianPhone, w: half }], { minH: 22 });
    w.row([{ label: "주소", w: L, head: true }, { value: address, w: CW - L }], { minH: 22 });
    w.heading("하차 장소(하나 체크)");
    w.para("※ 아래 노선은 예시이며 운영 사정에 따라 변경될 수 있습니다", 9, { color: MUTED, after: 4 });
    const CHK = 34;
    const SEQ = 40;
    const TIME = 90;
    const PLACE = CW - CHK - SEQ - TIME;
    w.row([{ label: "선택", w: CHK, head: true }, { label: "순번", w: SEQ, head: true }, { label: "하차 장소", w: PLACE, head: true }, { label: "시간", w: TIME, head: true }], { minH: 22 });
    const stopRow = (on: boolean, seq: string, place: string, time: string) => {
      const top = w.y;
      w.row([{ value: "", w: CHK }, { value: seq, w: SEQ, align: "center" }, { value: place, w: PLACE }, { value: time, w: TIME, align: "center" }], { minH: 22 });
      w.check(M + CHK / 2 - 5, top + (w.y - top) / 2 - 5, 10, on);
    };
    for (const st of a.stops) stopRow(d.ret.stop_seq === st.seq, String(st.seq), st.place, stopShowsTime(st) ? st.time : "");
    const etc = d.ret.stop_seq === STOP_ETC;
    stopRow(etc, "", `기타(직접 입력)${etc && d.ret.stop_place ? ` : ${d.ret.stop_place}` : ""}`, "");
    w.y += 6;
    w.para("위와 같이 귀가차량 이용을 신청합니다.", 11);
    w.signLine([guardianSign], date, `${CENTER}장 귀하`);
  }

  // ⑦ 식품알레르기 조사서(있을 때만) ----------------------------------------------
  const al = a.sensitive?.allergy;
  if (al?.has) {
    w.newPage();
    w.title("식품알레르기 조사서");
    w.row([{ label: "청소년 성명", w: L, head: true }, { value: y.name, w: half }, { label: "학교·학년", w: L, head: true }, { value: school, w: half }], { minH: 22 });
    w.heading("1. 식품알레르기가 있습니까?");
    w.checks([{ label: "있다", on: true }, { label: "없다", on: false }], { x: M + 8 });
    w.heading("2. 원인 식품(해당 번호 모두 체크)");
    w.checks(
      Object.entries(BK_ALLERGENS).map(([n, label]) => ({ label: `${n}. ${label}`, on: al.foods.includes(Number(n)) })),
      { x: M + 8, colW: (CW - 8) / 3, size: 9.5 },
    );
    w.para(`기타 원인 식품: ${al.other || ""}`, 10, { x: M + 8, after: 2 });
    w.heading("3. 증상이 나타나는 부위");
    for (const s of ALLERGY_SYMPTOMS) {
      const label = s.key === "other" ? `기타(${al.symptoms.includes("other") ? al.symptom_other : "            "})` : s.label;
      w.checks([{ label, on: al.symptoms.includes(s.key) }], { x: M + 8 });
    }
    w.heading("4. 알레르기로 진료를 받고 있습니까?");
    w.checks(yn(al.treated), { x: M + 8 });
    w.heading("5. 청소년 스스로 원인 식품을 구분할 수 있습니까?");
    w.checks(yn(al.self_aware), { x: M + 8 });
    w.signLine([guardianSign], date, `${CENTER}장 귀하`);
  }

  w.footer(a.appNo);
  return pdf.save();
}
