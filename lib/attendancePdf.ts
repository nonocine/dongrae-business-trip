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

import { PDFDocument } from "pdf-lib";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { formatPhone } from "@/lib/saemEnrollment";
import { normalizeSchoolName } from "@/lib/schoolName";
import { calcGrade } from "@/lib/schoolGrade";
import { downloadHrImage } from "@/lib/recruitmentApplicantDocData";
import { embedServerFonts } from "@/lib/pdfFont";
import {
  drawAttendance,
  type AttendanceMark,
  type AttendanceSheetData,
} from "@/lib/attendancePdfDraw";

// 그리기·양식은 lib/attendancePdfDraw(일괄 출력이 브라우저에서도 쓴다).
export {
  attendanceSheetTitle,
  attendancePdfFilename,
  type AttendanceMark,
  type AttendanceStudent,
  type AttendanceSession,
  type AttendanceSheetData,
} from "@/lib/attendancePdfDraw";

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

export async function buildAttendancePdf(
  d: AttendanceSheetData,
  opts: { blank?: boolean } = {}
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  await drawAttendance(pdf, await embedServerFonts(pdf), d, opts);
  return pdf.save();
}
