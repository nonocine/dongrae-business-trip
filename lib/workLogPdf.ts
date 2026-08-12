// =====================================================================
// 강사 근무일지 PDF — 프로그램 1개 = 종이 1장(양식 재현, 종이 결재용).
//   * 양식: 제목("N차시 강사 근무일지") / 우측 상단 결재란(담당·부장·관장) /
//     강사 인적사항(과정·프로그램명·성명·휴대전화) /
//     회차별 표(근무일 · 수업내용 및 특이사항 · 수강인원 · 근무시간 · 강사 담당(서명)).
//   * 결재란·서명란은 빈칸으로 둔다 — 출력 후 사람이 직접 결재·서명하는 문서다.
//     자동 날인·자동 서명 없음(증명서와 달리 관인도 쓰지 않는다).
//   * 미진행·미입력 회차는 날짜만 찍고 나머지를 비운다(빈 줄 = 앞으로 쓸 자리).
//   * pdf-lib + fontkit + 나눔고딕 통임베드(subset:false — Vercel 글리프 누락 대응).
//   * 가드 없음(라우트가 requireSaemAccess 후 호출). saem_* 읽기 전용.
// =====================================================================

import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { formatPhone } from "@/lib/saemEnrollment";
// 폰트 로딩·글리프 대체(①·㎡·㈜ …)는 출석부와 공용 — lib/pdfFont.
import { regularFont, boldFont, fkFont, fitToFont, spaced } from "@/lib/pdfFont";

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
};

export type WorkLogData = {
  programId: string;
  courseName: string; // 과정 — 프로젝트명(예: 동래미래 아카데미)
  termName: string; // 차시명(예: 3차시) — 제목에 그대로 쓴다
  programName: string;
  instructorName: string;
  instructorPhone: string;
  sessions: WorkLogSession[];
};

// 프로그램 단위 근무일지 조회 — 근무일지 화면은 "날짜(회차)" 기준이라 프로그램 단위가 없었다.
//   출력물은 프로그램 1개가 종이 1장이므로 program_id 로 묶어 session_no 순으로 읽는다.
export async function loadProgramWorkLog(
  programId: string
): Promise<WorkLogData | null> {
  if (!programId) return null;
  const { data: prog } = await supabaseAdmin
    .from("saem_programs")
    .select("id, name, term_id, instructor_id")
    .eq("id", programId)
    .maybeSingle();
  if (!prog) return null;
  const p = prog as {
    id: string;
    name: string | null;
    term_id: string | null;
    instructor_id: string | null;
  };

  const [{ data: term }, { data: instr }, { data: sess }] = await Promise.all([
    p.term_id
      ? supabaseAdmin
          .from("saem_terms")
          .select("name, project_id")
          .eq("id", p.term_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    p.instructor_id
      ? supabaseAdmin
          .from("saem_instructors")
          .select("name, phone")
          .eq("id", p.instructor_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin
      .from("saem_sessions")
      .select("session_no, session_date, log_content, student_count, work_hours")
      .eq("program_id", p.id)
      .order("session_no", { ascending: true }),
  ]);

  const t = term as { name: string | null; project_id: string | null } | null;
  let courseName = "";
  if (t?.project_id) {
    const { data: proj } = await supabaseAdmin
      .from("saem_projects")
      .select("name")
      .eq("id", t.project_id)
      .maybeSingle();
    courseName = String((proj as { name?: string | null } | null)?.name ?? "");
  }
  const ins = instr as { name: string | null; phone: string | null } | null;

  return {
    programId: p.id,
    courseName,
    termName: String(t?.name ?? ""),
    programName: String(p.name ?? ""),
    instructorName: String(ins?.name ?? ""),
    instructorPhone: formatPhone(ins?.phone) ?? "",
    sessions: (sess ?? []).map((r) => {
      const s = r as Record<string, unknown>;
      return {
        session_no: Number(s.session_no ?? 0),
        session_date: (s.session_date as string | null) ?? null,
        log_content: (s.log_content as string | null) ?? null,
        student_count:
          s.student_count == null ? null : Number(s.student_count),
        work_hours: s.work_hours == null ? null : Number(s.work_hours),
      };
    }),
  };
}

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

export async function buildWorkLogPdf(d: WorkLogData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regularFont(), { subset: false });
  const bold = await pdf.embedFont(boldFont(), { subset: false });

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

  // === 결재란(우측 상단) — 담당 / 부장 / 관장. 전부 빈칸(종이 결재용). ===
  const APPR = { labelW: 20, cellW: 48, headH: 15, signH: 42 };
  const apprW = APPR.labelW + APPR.cellW * 3;
  const apprX = W - M - apprW;
  const apprY = 38;
  const apprH = APPR.headH + APPR.signH;
  rect(apprX, apprY, APPR.labelW, apprH, { fill: LABEL_BG });
  text(apprX, apprY + apprH / 2 - 11, "결", {
    size: 9,
    bold: true,
    color: NAVY,
    align: "center",
    cellW: APPR.labelW,
  });
  text(apprX, apprY + apprH / 2 + 2, "재", {
    size: 9,
    bold: true,
    color: NAVY,
    align: "center",
    cellW: APPR.labelW,
  });
  ["담당", "부장", "관장"].forEach((label, i) => {
    const x = apprX + APPR.labelW + i * APPR.cellW;
    cell(x, apprY, APPR.cellW, APPR.headH, label, {
      size: 8.5,
      bold: true,
      color: NAVY,
      fill: LABEL_BG,
      align: "center",
    });
    rect(x, apprY + APPR.headH, APPR.cellW, APPR.signH); // 서명 자리 — 비워 둔다
  });

  // === 제목 ===
  const title = spaced(workLogTitle(d));
  text(M, 116, title, {
    size: 17,
    bold: true,
    color: NAVY,
    align: "center",
    cellW: CONTENT_W,
  });

  // === 강사 인적사항 ===
  const infoTop = 168;
  const infoH = 26;
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
  const HEAD_H = 26;
  const ROW_MIN = 34;
  const LINE_H = 12;
  const CONTENT_SIZE = 9;
  const bottom = H - M;
  let yTop = infoTop + infoH * 2 + 18;

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

  for (const s of d.sessions) {
    const lines = wrap(
      s.log_content ?? "",
      COL.content - 12,
      CONTENT_SIZE,
      font
    );
    const h = Math.max(ROW_MIN, lines.length * LINE_H + 14);
    if (yTop + h > bottom) {
      page = pdf.addPage([W, H]);
      yTop = M;
      drawTableHead();
    }

    let x = M;
    cell(x, yTop, COL.date, h, ymdWithWeekday(s.session_date), {
      size: 8.5,
      align: "center",
    });
    x += COL.date;
    // 수업내용 — 여러 줄. 셀 테두리만 먼저 그리고 줄을 세로중앙에 앉힌다.
    rect(x, yTop, COL.content, h);
    const startY = yTop + (h - lines.length * LINE_H) / 2;
    lines.forEach((ln, i) => {
      text(x + 6, startY + i * LINE_H, ln, { size: CONTENT_SIZE });
    });
    x += COL.content;
    cell(x, yTop, COL.count, h, countLabel(s.student_count), {
      size: 9,
      align: "center",
    });
    x += COL.count;
    cell(x, yTop, COL.hours, h, hoursLabel(s.work_hours), {
      size: 9,
      align: "center",
    });
    x += COL.hours;
    rect(x, yTop, COL.sign, h); // 서명 자리 — 비워 둔다(그날 강사가 직접 서명)
    yTop += h;
  }

  return pdf.save();
}
