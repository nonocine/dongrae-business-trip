// =====================================================================
// 강사 근무일지 PDF — 프로그램 1개 = 종이 1장(양식 재현).
//   * 양식: 제목("N차시 강사 근무일지") / 강사 인적사항(과정·프로그램명·성명·휴대전화) /
//     회차별 표(근무일 · 수업내용 및 특이사항 · 수강인원 · 근무시간 · 강사 담당(서명)).
//   * 결재란(담당·부장·관장)은 없다 — 2026-08 이민정 요청으로 삭제했다. 그 자리 여백을
//     본문이 회수해 A4 세로 1장에 제목·인적사항·회차표가 함께 들어간다.
//   * "강사 담당(서명)" 칸은 자동으로 채운다 — 동래샘들에서 강사가 회차를 제출할 때
//     손서명(canvas)을 하면 saem_sessions.instructor_signed_at 이 찍히고, 그 회차 칸에
//     saem_instructors.signature_data(PNG dataURL)를 넣는다. 서명 안 한 회차는 빈칸.
//     서명 이미지가 없거나 깨져도 PDF 생성은 계속된다(그 칸만 빈칸).
//   * 미진행·미입력 회차는 날짜만 찍고 나머지를 비운다(빈 줄 = 앞으로 쓸 자리).
//   * 회차가 많아 1장을 넘길 것 같으면 행 높이·본문 글자를 단계적으로 줄여 맞춘다
//     (DENSITY). 최소 단계로도 안 되면 그때만 다음 장으로 넘긴다.
//   * pdf-lib + fontkit + 나눔고딕 통임베드(subset:false — Vercel 글리프 누락 대응).
//   * 가드 없음(라우트가 requireSaemAccess 후 호출). saem_* 읽기 전용.
// =====================================================================

import { PDFDocument } from "pdf-lib";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { formatPhone } from "@/lib/saemEnrollment";
import { embedServerFonts } from "@/lib/pdfFont";
import { drawWorkLog, type WorkLogData } from "@/lib/workLogPdfDraw";

// 그리기·양식은 lib/workLogPdfDraw(일괄 출력이 브라우저에서도 쓴다).
export {
  workLogTitle,
  workLogPdfFilename,
  type WorkLogData,
  type WorkLogSession,
} from "@/lib/workLogPdfDraw";

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
          .select("name, phone, signature_data")
          .eq("id", p.instructor_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin
      .from("saem_sessions")
      .select(
        "session_no, session_date, log_content, student_count, work_hours, instructor_signed_at"
      )
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
  const ins = instr as {
    name: string | null;
    phone: string | null;
    signature_data: string | null;
  } | null;
  // 서명은 문자열(dataURL)만 받는다 — 다른 형식이면 없는 것으로 본다.
  const sig =
    typeof ins?.signature_data === "string" && ins.signature_data.trim()
      ? ins.signature_data
      : null;

  return {
    programId: p.id,
    courseName,
    termName: String(t?.name ?? ""),
    programName: String(p.name ?? ""),
    instructorName: String(ins?.name ?? ""),
    instructorPhone: formatPhone(ins?.phone) ?? "",
    instructorSignature: sig,
    sessions: (sess ?? []).map((r) => {
      const s = r as Record<string, unknown>;
      return {
        session_no: Number(s.session_no ?? 0),
        session_date: (s.session_date as string | null) ?? null,
        log_content: (s.log_content as string | null) ?? null,
        student_count:
          s.student_count == null ? null : Number(s.student_count),
        work_hours: s.work_hours == null ? null : Number(s.work_hours),
        instructor_signed_at:
          (s.instructor_signed_at as string | null) ?? null,
      };
    }),
  };
}

export async function buildWorkLogPdf(d: WorkLogData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  await drawWorkLog(pdf, await embedServerFonts(pdf), d);
  return pdf.save();
}
