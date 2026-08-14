// =====================================================================
// 프로그램별 출석부 PDF — A4 가로(회차가 가로로 늘어나는 표).
//   * 양식: 제목("2026년 3차시 [전문반] 속샥 디지털드로잉") /
//     좌측 고정 열(번호 · 이름 · 학교명 및 학년 · 연락처/비상연락처) /
//     우측 회차 열(날짜 헤더 + 학생별 출결), 회차 열 위에 담당·강사 서명칸.
//   * 서명칸 2줄은 회차별로 자동으로 채운다 — 2026-08 이민정 요청.
//     · "담당 서명" = 그 회차 근무일지를 확정한 담당자의 도장.
//       saem_sessions.staff_confirmed_at 이 있으면 confirmed_by(담당자 "이름")로
//       drivers → employee_profiles.stamp_path 를 찾아 Storage 이미지를 넣는다.
//       미확정 회차·도장 미등록 담당자는 빈칸.
//     · "강사 서명" = 동래샘들에서 강사가 그 회차 근무일지를 서명 제출했을 때
//       saem_sessions.instructor_signed_at 이 찍히고, 그 칸에 프로그램 강사의
//       saem_instructors.signature_data(PNG dataURL)를 넣는다. 미서명 회차는 빈칸.
//     · 도장·서명 이미지가 없거나 깨져도 PDF 생성은 계속된다(그 칸만 빈칸).
//       근무일지 PDF(lib/workLogPdf)의 서명 삽입과 같은 방식이다.
//   * blank 옵션: 출결 칸을 전부 비운 "손으로 체크할 빈 출석부".
//     이때는 담당 도장·강사 서명도 넣지 않는다(사람이 직접 서명할 양식이므로).
//   * 회차가 많으면 회차 열을, 인원이 많으면 학생 행을 나눠 여러 장으로 찍는다.
//     (회차 묶음이 바깥 루프 — 같은 회차 묶음의 명단이 이어 나오게)
//   * pdf-lib + 나눔고딕 통임베드(subset:false). 폰트·글리프 대체는 lib/pdfFont 공용.
//   * ⚠️ 미성년자 연락처·비상연락처가 실린다. 가드 없음 —
//     라우트가 requireSaemAccess 를 통과시킨 뒤에만 호출할 것.
//     saem_*·drivers·employee_profiles 모두 읽기 전용.
// =====================================================================

import { PDFDocument, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { formatPhone } from "@/lib/saemEnrollment";
import { normalizeSchoolName } from "@/lib/schoolName";
import { calcGrade } from "@/lib/schoolGrade";
import { decodeDataUrl, downloadHrImage } from "@/lib/recruitmentApplicantDocData";
import { regularFont, boldFont, fkFont, fitToFont } from "@/lib/pdfFont";

const NAVY = rgb(0.122, 0.227, 0.373);
const INK = rgb(0.13, 0.15, 0.18);
const MUTED = rgb(0.45, 0.47, 0.5);
const LINE = rgb(0.1, 0.1, 0.1);
const LABEL_BG = rgb(0.91, 0.91, 0.91);

// --- 데이터 ---
export type AttendanceMark = "present" | "absent" | "late" | "";

export type AttendanceStudent = {
  seqNo: number | null; // 취소 건은 순번이 비어 있다(명단 1..n 이 끊기지 않게)
  name: string;
  schoolGrade: string; // "교동초 6학년" — 생년월일 없으면 학교명만
  contact: string;
  emergencyContact: string;
  cancelled: boolean;
  marks: AttendanceMark[]; // 회차 순서와 1:1
};

// 회차 1개 = 표의 세로 열 1개. 서명 2줄이 이 정보로 채워진다.
export type AttendanceSession = {
  date: string | null;
  // 근무일지를 확정한 담당자 "이름"(saem_sessions.confirmed_by). 미확정이면 null.
  //   confirmed_by 는 id 가 아니라 직원명이 들어간다(logActions.confirmSessions).
  confirmedBy: string | null;
  // 강사가 동래샘들에서 이 회차 근무일지를 서명 제출했는지(instructor_signed_at).
  instructorSigned: boolean;
};

export type AttendanceSheetData = {
  programId: string;
  year: string; // 제목의 "2026년" — 차시 시작일(없으면 1회차) 기준
  termName: string;
  programName: string; // "[전문반] 속샥 디지털드로잉" (괄호 뒤 띄어쓰기 정리)
  sessions: AttendanceSession[];
  students: AttendanceStudent[];
  // 담당자 이름 → 도장 이미지 바이트. 회차마다 확정자가 다를 수 있어 이름으로 모아 둔다.
  //   도장 미등록·다운로드 실패는 null(그 회차 담당 서명칸은 빈칸).
  staffStamps: Record<string, Uint8Array | null>;
  // 프로그램 강사의 손서명 PNG dataURL(강사당 1개).
  //   어느 회차에 찍을지는 각 회차의 instructorSigned 가 정한다.
  instructorSignature: string | null;
};

function toMark(v: unknown): AttendanceMark {
  return v === "present" || v === "absent" || v === "late" ? v : "";
}

// "[전문반]속샥 디지털드로잉" → "[전문반] 속샥 디지털드로잉".
//   프로그램명에 반 이름이 대괄호로 붙어 오는데 띄어쓰기가 들쭉날쭉하다. 표시만 정리한다.
function spaceAfterBracket(name: string): string {
  return name.replace(/^(\[[^\]]*\])\s*/, "$1 ").trim();
}

// 근무일지 확정 담당자 이름 → 인사기록카드 도장 이미지.
//   confirmed_by 에는 직원 "이름"이 저장된다(saem 게이트가 drivers.name 으로 사람을
//   찾으므로 이름이 곧 키다). 이름 → drivers.id → employee_profiles.stamp_path 순으로 잇고,
//   Storage(hr-documents, 비공개)에서 내려받는다.
//   동명이인이면 먼저 찾은 한 명을 쓴다 — confirmed_by 자체가 이름뿐이라 더 좁힐 수 없다.
//   어느 단계에서 실패하든 그 담당자는 null(빈칸)로 두고 PDF 생성은 계속한다.
async function loadStaffStamps(
  names: string[]
): Promise<Record<string, Uint8Array | null>> {
  const out: Record<string, Uint8Array | null> = {};
  const list = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!list.length) return out;
  for (const n of list) out[n] = null;

  const { data: drv } = await supabaseAdmin
    .from("drivers")
    .select("id, name")
    .in("name", list);
  const driverIdByName = new Map<string, string>();
  for (const r of drv ?? []) {
    const row = r as { id: string; name: string | null };
    const nm = String(row.name ?? "").trim();
    if (nm && !driverIdByName.has(nm)) driverIdByName.set(nm, String(row.id));
  }
  if (!driverIdByName.size) return out;

  const { data: profs } = await supabaseAdmin
    .from("employee_profiles")
    .select("driver_id, stamp_path")
    .in("driver_id", [...driverIdByName.values()]);
  const pathByDriver = new Map<string, string | null>();
  for (const r of profs ?? []) {
    const row = r as { driver_id: string; stamp_path: string | null };
    pathByDriver.set(String(row.driver_id), row.stamp_path ?? null);
  }

  // 같은 담당자가 여러 회차를 확정하는 게 보통이라, 사람당 한 번만 내려받는다.
  await Promise.all(
    [...driverIdByName.entries()].map(async ([nm, did]) => {
      out[nm] = await downloadHrImage(pathByDriver.get(did) ?? null);
    })
  );
  return out;
}

// 프로그램 단위 출석부 데이터 — 명단(seq_no) × 회차(session_no) × 출결 매트릭스.
export async function loadAttendanceSheet(
  programId: string
): Promise<AttendanceSheetData | null> {
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

  const [{ data: term }, { data: sess }, { data: enrolls }, { data: instr }] =
    await Promise.all([
      p.term_id
        ? supabaseAdmin
            .from("saem_terms")
            .select("name, start_date")
            .eq("id", p.term_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin
        .from("saem_sessions")
        .select(
          "id, session_no, session_date, staff_confirmed_at, confirmed_by, instructor_signed_at"
        )
        .eq("program_id", p.id)
        .order("session_no", { ascending: true }),
      // 연락처·생년월일은 출석부에만 쓰인다 — 필요한 열만 읽는다.
      supabaseAdmin
        .from("saem_enrollments")
        .select(
          "id, seq_no, student_name, school, birth_date, contact, emergency_contact, status"
        )
        .eq("program_id", p.id),
      p.instructor_id
        ? supabaseAdmin
            .from("saem_instructors")
            .select("signature_data")
            .eq("id", p.instructor_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const t = term as { name: string | null; start_date: string | null } | null;
  const sessions = (sess ?? []).map((r) => {
    const s = r as {
      id: string;
      session_date: string | null;
      staff_confirmed_at: string | null;
      confirmed_by: string | null;
      instructor_signed_at: string | null;
    };
    return {
      id: String(s.id),
      date: s.session_date ?? null,
      // 확정 시각이 있어야 확정으로 본다 — confirmed_by 만 남은 옛 행은 빈칸으로.
      confirmedBy:
        s.staff_confirmed_at && String(s.confirmed_by ?? "").trim()
          ? String(s.confirmed_by).trim()
          : null,
      instructorSigned: !!s.instructor_signed_at,
    };
  });

  // 서명은 문자열(dataURL)만 받는다 — 다른 형식이면 없는 것으로 본다.
  const rawSig = (instr as { signature_data?: unknown } | null)?.signature_data;
  const instructorSignature =
    typeof rawSig === "string" && rawSig.trim() ? rawSig : null;

  const staffStamps = await loadStaffStamps(
    sessions.map((s) => s.confirmedBy ?? "")
  );

  // 학년은 "지금"이 아니라 수업이 열린 학년도 기준으로 뽑는다.
  //   지난 차시 출석부를 나중에 뽑아도 그때의 학년으로 나와야 한다.
  const refYmd = t?.start_date ?? sessions.find((s) => s.date)?.date ?? null;
  const refDate = refYmd ? new Date(`${refYmd}T00:00:00Z`) : new Date();

  const students = (enrolls ?? []).map((r) => {
    const e = r as Record<string, unknown>;
    const str = (v: unknown) => {
      const x = v == null ? "" : String(v).trim();
      return x;
    };
    const cancelled = String(e.status ?? "active") !== "active";
    const school = normalizeSchoolName(str(e.school));
    const gradeLabel = calcGrade(str(e.birth_date) || null, refDate).label;
    return {
      id: String(e.id ?? ""),
      seqNo: e.seq_no == null ? null : Number(e.seq_no),
      name: str(e.student_name),
      schoolGrade: [school, gradeLabel === "-" ? "" : gradeLabel]
        .filter(Boolean)
        .join(" "),
      contact: formatPhone(e.contact) ?? "",
      emergencyContact: formatPhone(e.emergency_contact) ?? "",
      cancelled,
      marks: [] as AttendanceMark[],
    };
  });

  // 출결 — session_id × enrollment_id.
  const markBy = new Map<string, AttendanceMark>();
  if (sessions.length && students.length) {
    const { data: atts } = await supabaseAdmin
      .from("saem_attendance")
      .select("session_id, enrollment_id, status")
      .in(
        "session_id",
        sessions.map((s) => s.id)
      );
    for (const a of atts ?? []) {
      const row = a as { session_id: string; enrollment_id: string; status: string };
      markBy.set(`${row.session_id}|${row.enrollment_id}`, toMark(row.status));
    }
  }
  for (const st of students)
    st.marks = sessions.map((s) => markBy.get(`${s.id}|${st.id}`) ?? "");

  // 명단 순서 — 활성 먼저(순번), 취소는 뒤로. listProgramEnrollments 와 같은 규칙.
  students.sort((a, b) => {
    if (a.cancelled !== b.cancelled) return a.cancelled ? 1 : -1;
    if (a.seqNo != null && b.seqNo != null) return a.seqNo - b.seqNo;
    if (a.seqNo != null) return -1;
    if (b.seqNo != null) return 1;
    return a.name.localeCompare(b.name, "ko");
  });

  return {
    programId: p.id,
    year: refYmd ? refYmd.slice(0, 4) : "",
    termName: String(t?.name ?? ""),
    programName: spaceAfterBracket(String(p.name ?? "")),
    sessions: sessions.map(({ id, ...rest }) => {
      void id;
      return rest;
    }),
    students: students.map(({ id, ...rest }) => {
      void id;
      return rest;
    }),
    staffStamps,
    instructorSignature,
  };
}

// --- 표기 ---
const WD = ["일", "월", "화", "수", "목", "금", "토"];
function dateHeader(ymd: string | null): string {
  if (!ymd) return "";
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${m[2]}/${m[3]} ${WD[d.getUTCDay()]}`;
}
const MARK_TEXT: Record<AttendanceMark, string> = {
  present: "O",
  absent: "결",
  late: "지",
  "": "",
};

export function attendanceSheetTitle(d: AttendanceSheetData): string {
  return [d.year ? `${d.year}년` : "", d.termName, d.programName]
    .filter(Boolean)
    .join(" ");
}

export function attendancePdfFilename(
  d: AttendanceSheetData,
  blank = false
): string {
  const parts = [
    d.year ? `${d.year}년` : "",
    d.termName,
    d.programName,
    blank ? "출석부_빈양식" : "출석부",
  ].filter(Boolean);
  return `${parts.join("_")}.pdf`.replace(/[\\/:*?"<>|]/g, "_");
}

// --- PDF ---
const W = 841.89; // A4 가로
const H = 595.28;
const M = 28;
const CONTENT_W = W - 2 * M;

// 좌측 고정 열.
const LEFT = { no: 30, name: 66, school: 116, contact: 96 };
const LEFT_W = LEFT.no + LEFT.name + LEFT.school + LEFT.contact;
const SESSION_AREA = CONTENT_W - LEFT_W;
const MIN_COL = 44; // 이보다 좁으면 날짜가 안 들어간다 → 페이지를 나눈다
const MAX_COL = 84;
const COLS_PER_PAGE = Math.max(1, Math.floor(SESSION_AREA / MIN_COL));

// 서명 2줄(담당·강사)의 높이. 빈칸이던 시절엔 18로 충분했지만, 이제 도장·서명 이미지가
//   실제로 들어가므로 학생 행과 같은 높이를 줘서 알아볼 수 있게 한다.
//   (페이지당 학생 행이 한 줄 줄어드는 대신 도장이 읽힌다.)
const SIGN_H = 26;
const HEAD_H = 24;

// 도장·서명 이미지가 칸 밖으로 안 나가게 두는 안쪽 여백(근무일지 PDF와 같은 값).
const SIGN_PAD_X = 4;
const SIGN_PAD_Y = 3;
const ROW_H = 26;
const TABLE_TOP = 66;
const BOTTOM = H - M - 14; // 범례 자리 확보
const ROWS_PER_PAGE = Math.max(
  1,
  Math.floor((BOTTOM - TABLE_TOP - SIGN_H * 2 - HEAD_H) / ROW_H)
);

function chunk<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function buildAttendancePdf(
  d: AttendanceSheetData,
  opts: { blank?: boolean } = {}
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regularFont(), { subset: false });
  const bold = await pdf.embedFont(boldFont(), { subset: false });

  let page = pdf.addPage([W, H]);

  // top-origin 헬퍼(근무일지 PDF와 같은 패턴).
  const text = (
    x: number,
    yTop: number,
    s: string,
    opts2: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      align?: "left" | "center" | "right";
      cellW?: number;
    } = {}
  ) => {
    if (!s) return;
    const size = opts2.size ?? 9;
    const f: PDFFont = opts2.bold ? bold : font;
    const str = fitToFont(s, fkFont(!!opts2.bold));
    let dx = x;
    if (opts2.align === "center")
      dx = x + (opts2.cellW ?? 0) / 2 - f.widthOfTextAtSize(str, size) / 2;
    else if (opts2.align === "right")
      dx = x + (opts2.cellW ?? 0) - f.widthOfTextAtSize(str, size) - 6;
    page.drawText(str, {
      x: dx,
      y: H - yTop - size,
      size,
      font: f,
      color: opts2.color ?? INK,
    });
  };
  const rect = (
    x: number,
    yTop: number,
    w: number,
    h: number,
    fill?: ReturnType<typeof rgb>
  ) => {
    page.drawRectangle({
      x,
      y: H - yTop - h,
      width: w,
      height: h,
      color: fill,
      borderColor: LINE,
      borderWidth: 0.8,
    });
  };
  const cell = (
    x: number,
    yTop: number,
    w: number,
    h: number,
    s: string,
    o: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      fill?: ReturnType<typeof rgb>;
      align?: "left" | "center" | "right";
    } = {}
  ) => {
    const size = o.size ?? 9;
    rect(x, yTop, w, h, o.fill);
    if (o.align === "left")
      text(x + 6, yTop + (h - size) / 2, s, { size, bold: o.bold, color: o.color });
    else
      text(x, yTop + (h - size) / 2, s, {
        size,
        bold: o.bold,
        color: o.color,
        align: o.align ?? "center",
        cellW: w,
      });
  };
  // 한 셀에 두 줄(연락처/비상연락처, 이름/(취소)).
  const cell2 = (
    x: number,
    yTop: number,
    w: number,
    h: number,
    top: string,
    bottomLine: string,
    o: { size?: number; bottomSize?: number; bottomColor?: ReturnType<typeof rgb> } = {}
  ) => {
    rect(x, yTop, w, h);
    const size = o.size ?? 8.5;
    const bSize = o.bottomSize ?? size;
    if (bottomLine) {
      text(x, yTop + h / 2 - size - 1, top, { size, align: "center", cellW: w });
      text(x, yTop + h / 2 + 1, bottomLine, {
        size: bSize,
        align: "center",
        cellW: w,
        color: o.bottomColor,
      });
    } else {
      text(x, yTop + (h - size) / 2, top, { size, align: "center", cellW: w });
    }
  };

  // === 도장·서명 이미지 ===
  //   blank(손서명용 빈 양식)면 아예 임베드하지 않는다 — 그리지 않을 이미지다.
  //   PNG 로 먼저 읽고 안 되면 JPG 로 한 번 더. 둘 다 실패하면 null(그 칸은 빈칸).
  const embed = async (bytes: Uint8Array | null): Promise<PDFImage | null> => {
    if (opts.blank || !bytes || bytes.length === 0) return null;
    try {
      return await pdf.embedPng(bytes);
    } catch {
      try {
        return await pdf.embedJpg(bytes);
      } catch {
        return null;
      }
    }
  };

  // 담당자 이름 → 도장. 같은 사람이 여러 회차를 확정해도 임베드는 한 번뿐이다.
  const stampByName = new Map<string, PDFImage | null>();
  for (const [name, bytes] of Object.entries(d.staffStamps ?? {}))
    stampByName.set(name, await embed(bytes));
  // 강사 서명은 프로그램당 하나 — 서명한 회차마다 같은 이미지를 재사용한다.
  const instructorSign = await embed(decodeDataUrl(d.instructorSignature));

  // 칸 안에 비율 유지로 앉힌다(칸보다 크면 줄이고, 작으면 칸에 맞춰 키운다).
  const drawSign = (
    img: PDFImage | null,
    x: number,
    yTop: number,
    w: number,
    h: number
  ) => {
    if (!img || !img.width || !img.height) return;
    const availW = w - SIGN_PAD_X * 2;
    const availH = h - SIGN_PAD_Y * 2;
    if (availW <= 0 || availH <= 0) return;
    const k = Math.min(availW / img.width, availH / img.height);
    if (!Number.isFinite(k) || k <= 0) return;
    const sw = img.width * k;
    const sh = img.height * k;
    page.drawImage(img, {
      x: x + (w - sw) / 2,
      y: H - (yTop + (h - sh) / 2) - sh,
      width: sw,
      height: sh,
    });
  };

  const sessionChunks = chunk(
    d.sessions.map((s, i) => ({ ...s, i })),
    COLS_PER_PAGE
  );
  const studentChunks = chunk(d.students, ROWS_PER_PAGE);
  const title = attendanceSheetTitle(d);
  const multi = sessionChunks.length * studentChunks.length > 1;

  let first = true;
  for (const cols of sessionChunks) {
    const colW = cols.length
      ? Math.min(MAX_COL, SESSION_AREA / cols.length)
      : SESSION_AREA;

    for (let si = 0; si < studentChunks.length; si++) {
      const rows = studentChunks[si];
      if (!first) page = pdf.addPage([W, H]);
      first = false;

      // === 제목 ===
      const pageNote = multi
        ? `  (${cols.length ? `${cols[0].i + 1}~${cols[cols.length - 1].i + 1}회차` : "회차 없음"} · 명단 ${si + 1}/${studentChunks.length})`
        : "";
      text(M, 30, title, {
        size: 15,
        bold: true,
        color: NAVY,
        align: "center",
        cellW: CONTENT_W,
      });
      if (pageNote)
        text(M, 50, pageNote.trim(), {
          size: 8.5,
          color: MUTED,
          align: "center",
          cellW: CONTENT_W,
        });

      let yTop = TABLE_TOP;

      // === 담당 서명 / 강사 서명 ===
      //   담당 = 근무일지를 확정한 담당자 도장, 강사 = 강사가 제출 때 남긴 손서명.
      //   확정·서명이 없는 회차와 blank 양식은 빈칸으로 남는다.
      const signRows: {
        label: string;
        image: (c: (typeof cols)[number]) => PDFImage | null;
      }[] = [
        {
          label: "담당 서명",
          image: (c) => (c.confirmedBy ? stampByName.get(c.confirmedBy) ?? null : null),
        },
        {
          label: "강사 서명",
          image: (c) => (c.instructorSigned ? instructorSign : null),
        },
      ];
      for (const row of signRows) {
        cell(M, yTop, LEFT_W, SIGN_H, row.label, {
          size: 9,
          bold: true,
          color: NAVY,
          fill: LABEL_BG,
          align: "right",
        });
        cols.forEach((c, k) => {
          const cx = M + LEFT_W + k * colW;
          rect(cx, yTop, colW, SIGN_H);
          drawSign(row.image(c), cx, yTop, colW, SIGN_H);
        });
        yTop += SIGN_H;
      }

      // === 열 머리 ===
      let x = M;
      const head = (w: number, label: string, size = 8.5) => {
        cell(x, yTop, w, HEAD_H, label, {
          size,
          bold: true,
          color: NAVY,
          fill: LABEL_BG,
        });
        x += w;
      };
      head(LEFT.no, "번호");
      head(LEFT.name, "이름");
      head(LEFT.school, "학교명 및 학년");
      // 연락처 / 비상연락처 — 아래 학생 칸도 위·아래 두 줄로 같은 순서다.
      rect(x, yTop, LEFT.contact, HEAD_H, LABEL_BG);
      text(x, yTop + 3, "연락처", {
        size: 7.5,
        bold: true,
        color: NAVY,
        align: "center",
        cellW: LEFT.contact,
      });
      text(x, yTop + 13, "비상연락처", {
        size: 7.5,
        bold: true,
        color: NAVY,
        align: "center",
        cellW: LEFT.contact,
      });
      x += LEFT.contact;
      cols.forEach((c) => {
        cell(x, yTop, colW, HEAD_H, dateHeader(c.date), {
          size: 8,
          bold: true,
          color: NAVY,
          fill: LABEL_BG,
        });
        x += colW;
      });
      yTop += HEAD_H;

      // === 학생 행 ===
      if (rows.length === 0) {
        cell(M, yTop, LEFT_W + colW * cols.length, ROW_H, "등록된 수강생이 없습니다.", {
          size: 9,
          color: MUTED,
        });
        yTop += ROW_H;
      }
      for (const st of rows) {
        x = M;
        cell(x, yTop, LEFT.no, ROW_H, st.seqNo == null ? "" : String(st.seqNo), {
          size: 9,
        });
        x += LEFT.no;
        // 취소자는 이름 아래에 표시한다 — 회차 칸에는 손대지 않는다(기록은 기록대로).
        cell2(x, yTop, LEFT.name, ROW_H, st.name, st.cancelled ? "(취소)" : "", {
          size: 9,
          bottomSize: 7,
          bottomColor: MUTED,
        });
        x += LEFT.name;
        cell(x, yTop, LEFT.school, ROW_H, st.schoolGrade, { size: 8.5 });
        x += LEFT.school;
        cell2(x, yTop, LEFT.contact, ROW_H, st.contact, st.emergencyContact, {
          size: 7.5,
        });
        x += LEFT.contact;
        cols.forEach((c) => {
          const mark = opts.blank ? "" : MARK_TEXT[st.marks[c.i] ?? ""];
          cell(x, yTop, colW, ROW_H, mark, {
            size: 10,
            bold: mark === "O",
            color: mark === "결" ? rgb(0.6, 0.15, 0.15) : INK,
          });
          x += colW;
        });
        yTop += ROW_H;
      }

      // === 범례 ===
      text(
        M,
        yTop + 4,
        opts.blank
          ? "※ 출결 칸은 비워 두었습니다. O 출석 · 결 결석 · 지 지각"
          : "※ O 출석 · 결 결석 · 지 지각 · 빈칸 미기록",
        { size: 7.5, color: MUTED }
      );
    }
  }

  return pdf.save();
}
