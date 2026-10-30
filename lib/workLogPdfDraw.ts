// =====================================================================
// 강사 근무일지 PDF — 그리기(브라우저·서버 공용). 데이터 조회는 lib/workLogPdf(서버).
//   양식 설명은 lib/workLogPdf 머리 주석 참고.
// =====================================================================

import { rgb, type PDFDocument, type PDFFont, type PDFImage } from "pdf-lib";
import { decodeDataUrl } from "@/lib/dataUrl";
import { fitToFont, spaced, type PdfFonts } from "@/lib/pdfFontText";

const NAVY = rgb(0.122, 0.227, 0.373);
const INK = rgb(0.13, 0.15, 0.18);
const LINE = rgb(0.1, 0.1, 0.1);
const LABEL_BG = rgb(0.91, 0.91, 0.91);

// --- 데이터 ---
export type WorkLogSession = {
  session_no: number;
  session_date: string | null;
  log_content: string | null;
  student_count: number | null;
  work_hours: number | null;
  // 동래샘들에서 강사가 이 회차를 서명 제출한 시각. 있으면 서명 칸을 채운다.
  instructor_signed_at: string | null;
};

export type WorkLogData = {
  programId: string;
  courseName: string; // 과정 — 프로젝트명(예: 동래미래 아카데미)
  termName: string; // 차시명(예: 3차시) — 제목에 그대로 쓴다
  programName: string;
  instructorName: string;
  instructorPhone: string;
  // 강사 손서명 PNG dataURL(강사당 1개). 어느 회차에 찍을지는 instructor_signed_at 이 정한다.
  instructorSignature: string | null;
  sessions: WorkLogSession[];
};

// --- 표기 헬퍼 ---
const WD = ["일", "월", "화", "수", "목", "금", "토"];
function ymdWithWeekday(ymd: string | null): string {
  if (!ymd) return "";
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd;
  const d = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  );
  return `${m[1]}-${m[2]}-${m[3]} (${WD[d.getUTCDay()]})`;
}
function hoursLabel(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  return `${Math.round(n * 100) / 100}시간`;
}
function countLabel(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  return `${Math.round(n)}명`;
}
export function workLogTitle(d: WorkLogData): string {
  const term = d.termName.trim();
  return term ? `${term} 강사 근무일지` : "강사 근무일지";
}

export function workLogPdfFilename(d: WorkLogData): string {
  const parts = [d.termName, d.programName, "강사근무일지"].filter(Boolean);
  // 파일명에 못 쓰는 문자(윈도 기준)는 밑줄로.
  return `${parts.join("_")}.pdf`.replace(/[\\/:*?"<>|]/g, "_");
}

// --- PDF ---
const W = 595.28;
const H = 841.89;
const M = 40;
const CONTENT_W = W - 2 * M;

// 본문 표 열 폭(합 = CONTENT_W).
const COL = {
  date: 86,
  content: 217.28,
  count: 52,
  hours: 52,
  sign: 108,
};

// 세로 배치(top-origin). 결재란을 없앤 만큼 전부 위로 당겨 놓았다.
const TITLE_TOP = 46;
const TITLE_SIZE = 17;
const INFO_TOP = 92;
const INFO_H = 26;
const TABLE_TOP = INFO_TOP + INFO_H * 2 + 16; // 160
const HEAD_H = 26;

// A4 1장에 맞추기 위한 단계별 밀도. 위에서부터 시도하고, 처음으로 들어가는 걸 쓴다.
//   회차 8~9개는 첫 단계(size 9)로 넉넉히 들어간다. 수업내용이 길어 줄이 늘어나면
//   글자·행 높이를 조금씩 줄인다. 마지막 단계로도 안 되면 다음 장으로 넘긴다.
const DENSITY = [
  { size: 9, lineH: 12, rowMin: 34 },
  { size: 8.5, lineH: 11.5, rowMin: 31 },
  { size: 8, lineH: 11, rowMin: 28 },
  { size: 7.5, lineH: 10.5, rowMin: 26 },
  { size: 7, lineH: 10, rowMin: 24 },
];

// 서명 이미지가 칸 밖으로 안 나가게 두는 안쪽 여백.
const SIGN_PAD_X = 6;
const SIGN_PAD_Y = 4;

// 문서 끝에 근무일지 1건을 새 쪽부터 그린다. 개별 출력(buildWorkLogPdf)과 일괄 출력이
//   같은 함수를 쓰므로 양식이 같다. fonts 는 그 문서에 임베드된 것(embedPdfFonts).
export async function drawWorkLog(
  pdf: PDFDocument,
  fonts: PdfFonts,
  d: WorkLogData
): Promise<void> {
  const { font, bold, fk: fkFont } = fonts;

  let page = pdf.addPage([W, H]);

  // top-origin 헬퍼(다른 양식 PDF와 동일 패턴).
  const text = (
    x: number,
    yTop: number,
    s: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      align?: "left" | "center";
      cellW?: number; // center 정렬 시 셀 폭
    } = {}
  ) => {
    if (!s) return;
    const size = opts.size ?? 9;
    const f: PDFFont = opts.bold ? bold : font;
    s = fitToFont(s, fkFont(!!opts.bold));
    let dx = x;
    if (opts.align === "center")
      dx = x + (opts.cellW ?? 0) / 2 - f.widthOfTextAtSize(s, size) / 2;
    page.drawText(s, {
      x: dx,
      y: H - yTop - size,
      size,
      font: f,
      color: opts.color ?? INK,
    });
  };
  const rect = (
    x: number,
    yTop: number,
    w: number,
    h: number,
    opts: { fill?: ReturnType<typeof rgb>; border?: boolean } = {}
  ) => {
    page.drawRectangle({
      x,
      y: H - yTop - h,
      width: w,
      height: h,
      color: opts.fill,
      borderColor: opts.border === false ? undefined : LINE,
      borderWidth: opts.border === false ? 0 : 0.8,
    });
  };
  // 셀 = 테두리 + 세로중앙 텍스트.
  const cell = (
    x: number,
    yTop: number,
    w: number,
    h: number,
    s: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      fill?: ReturnType<typeof rgb>;
      align?: "left" | "center";
      padX?: number;
    } = {}
  ) => {
    const size = opts.size ?? 9;
    rect(x, yTop, w, h, { fill: opts.fill });
    const padX = opts.padX ?? 7;
    if (opts.align === "center")
      text(x, yTop + (h - size) / 2, s, {
        size,
        bold: opts.bold,
        color: opts.color,
        align: "center",
        cellW: w,
      });
    else
      text(x + padX, yTop + (h - size) / 2, s, {
        size,
        bold: opts.bold,
        color: opts.color,
      });
  };

  // 폭 기준 줄바꿈(공백 단위 우선, 긴 낱말은 글자 단위로 쪼갠다).
  //   대체 글자로 폭이 달라지므로 줄바꿈 전에 먼저 치환한다(그리기 순서와 동일한 폭).
  const wrap = (s: string, maxW: number, size: number, f: PDFFont): string[] => {
    const src = fitToFont((s ?? "").replace(/\r/g, ""), fkFont(false));
    if (!src.trim()) return [];
    const out: string[] = [];
    for (const para of src.split("\n")) {
      let cur = "";
      for (const ch of para) {
        const test = cur + ch;
        if (f.widthOfTextAtSize(test, size) > maxW && cur) {
          // 공백 뒤에서 끊을 수 있으면 그쪽을 택해 낱말을 살린다.
          const sp = cur.lastIndexOf(" ");
          if (sp > 0 && cur.length - sp <= 12) {
            out.push(cur.slice(0, sp));
            cur = cur.slice(sp + 1) + ch;
          } else {
            out.push(cur);
            cur = ch;
          }
        } else cur = test;
      }
      out.push(cur);
    }
    return out;
  };

  // === 강사 서명 이미지 ===
  //   강사당 1개. 서명한 회차 수만큼 같은 이미지를 재사용하므로 임베드는 한 번만.
  //   dataURL 이 깨졌거나 PNG 가 아니면 null — 그 경우 서명 칸은 전부 빈칸으로 남는다.
  let signImg: PDFImage | null = null;
  const signBytes = decodeDataUrl(d.instructorSignature);
  if (signBytes && signBytes.length > 0) {
    try {
      signImg = await pdf.embedPng(signBytes);
    } catch {
      try {
        signImg = await pdf.embedJpg(signBytes);
      } catch {
        signImg = null;
      }
    }
  }
  // 서명 칸 안에 비율 유지로 앉힌다(칸보다 크면 줄이고, 작아도 칸에 맞춰 키운다).
  const drawSign = (x: number, yTop: number, w: number, h: number) => {
    if (!signImg) return;
    const availW = w - SIGN_PAD_X * 2;
    const availH = h - SIGN_PAD_Y * 2;
    if (availW <= 0 || availH <= 0) return;
    if (!signImg.width || !signImg.height) return;
    const k = Math.min(availW / signImg.width, availH / signImg.height);
    if (!Number.isFinite(k) || k <= 0) return;
    const sw = signImg.width * k;
    const sh = signImg.height * k;
    page.drawImage(signImg, {
      x: x + (w - sw) / 2,
      y: H - (yTop + (h - sh) / 2) - sh,
      width: sw,
      height: sh,
    });
  };

  // === 제목 ===
  const title = spaced(workLogTitle(d));
  text(M, TITLE_TOP, title, {
    size: TITLE_SIZE,
    bold: true,
    color: NAVY,
    align: "center",
    cellW: CONTENT_W,
  });

  // === 강사 인적사항 ===
  const infoTop = INFO_TOP;
  const infoH = INFO_H;
  const IL = 72; // 라벨 열
  const IV1 = 186; // 값 열 1
  const IV2 = CONTENT_W - IL * 2 - IV1; // 값 열 2
  const infoRow = (
    yTop: number,
    l1: string,
    v1: string,
    l2: string,
    v2: string
  ) => {
    let x = M;
    cell(x, yTop, IL, infoH, spaced(l1), {
      size: 9.5,
      bold: true,
      color: NAVY,
      fill: LABEL_BG,
      align: "center",
    });
    x += IL;
    cell(x, yTop, IV1, infoH, v1, { size: 10 });
    x += IV1;
    cell(x, yTop, IL, infoH, spaced(l2), {
      size: 9.5,
      bold: true,
      color: NAVY,
      fill: LABEL_BG,
      align: "center",
    });
    x += IL;
    cell(x, yTop, IV2, infoH, v2, { size: 10 });
  };
  infoRow(infoTop, "과정", d.courseName, "프로그램명", d.programName);
  infoRow(
    infoTop + infoH,
    "성명",
    d.instructorName,
    "휴대전화",
    d.instructorPhone
  );

  // === 회차별 표 ===
  const bottom = H - M;

  // 밀도 결정 — 표 전체(머리 + 모든 행)가 첫 장 안에 들어가는 첫 단계를 쓴다.
  //   행 높이는 수업내용 줄 수에 따라 달라지므로 단계마다 다시 잰다.
  const measure = (dz: (typeof DENSITY)[number]) => {
    const rows = d.sessions.map((s) => {
      const lines = wrap(s.log_content ?? "", COL.content - 12, dz.size, font);
      return { lines, h: Math.max(dz.rowMin, lines.length * dz.lineH + dz.lineH + 2) };
    });
    const total = rows.reduce((a, r) => a + r.h, 0);
    return { rows, total };
  };
  const avail = bottom - TABLE_TOP - HEAD_H;
  let dz = DENSITY[DENSITY.length - 1];
  let rows = measure(dz).rows;
  for (const cand of DENSITY) {
    const m = measure(cand);
    if (m.total <= avail) {
      dz = cand;
      rows = m.rows;
      break;
    }
  }
  const CONTENT_SIZE = dz.size;
  const LINE_H = dz.lineH;
  const ROW_MIN = dz.rowMin;
  // 날짜·수강인원·근무시간은 본문보다 크지 않게(좁은 칸이라 넘치면 안 된다).
  const CELL_SIZE = Math.min(9, CONTENT_SIZE);
  const DATE_SIZE = Math.min(8.5, CONTENT_SIZE);

  let yTop = TABLE_TOP;

  const drawTableHead = () => {
    let x = M;
    const head = (w: number, label: string) => {
      cell(x, yTop, w, HEAD_H, label, {
        size: 9,
        bold: true,
        color: NAVY,
        fill: LABEL_BG,
        align: "center",
      });
      x += w;
    };
    head(COL.date, "근 무 일");
    head(COL.content, "수업내용 및 특이사항");
    head(COL.count, "수강인원");
    head(COL.hours, "근무시간");
    head(COL.sign, "강사 담당(서명)");
    yTop += HEAD_H;
  };

  drawTableHead();

  if (d.sessions.length === 0) {
    cell(M, yTop, CONTENT_W, ROW_MIN, "등록된 회차가 없습니다.", {
      size: 9,
      color: INK,
      align: "center",
    });
    yTop += ROW_MIN;
  }

  d.sessions.forEach((s, i) => {
    const { lines, h } = rows[i];
    if (yTop + h > bottom) {
      page = pdf.addPage([W, H]);
      yTop = M;
      drawTableHead();
    }

    let x = M;
    cell(x, yTop, COL.date, h, ymdWithWeekday(s.session_date), {
      size: DATE_SIZE,
      align: "center",
    });
    x += COL.date;
    // 수업내용 — 여러 줄. 셀 테두리만 먼저 그리고 줄을 세로중앙에 앉힌다.
    rect(x, yTop, COL.content, h);
    const startY = yTop + (h - lines.length * LINE_H) / 2;
    lines.forEach((ln, li) => {
      text(x + 6, startY + li * LINE_H, ln, { size: CONTENT_SIZE });
    });
    x += COL.content;
    cell(x, yTop, COL.count, h, countLabel(s.student_count), {
      size: CELL_SIZE,
      align: "center",
    });
    x += COL.count;
    cell(x, yTop, COL.hours, h, hoursLabel(s.work_hours), {
      size: CELL_SIZE,
      align: "center",
    });
    x += COL.hours;
    // 강사 담당(서명) — 동래샘들에서 서명 제출한 회차만 채운다. 나머지는 빈칸.
    rect(x, yTop, COL.sign, h);
    if (s.instructor_signed_at) drawSign(x, yTop, COL.sign, h);
    yTop += h;
  });

}
