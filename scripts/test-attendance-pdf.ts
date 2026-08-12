// 출석부 PDF 검증 (강사관리 B차-2).
//   실행: npx tsx scripts/test-attendance-pdf.ts  (npm run test:attendance)
//
//   ① 제목 "2026년 3차시 [반] 프로그램명" 조립 + 파일명(빈양식 구분·경로문자 제거).
//   ② 유효한 PDF 바이트 + A4 가로.
//   ③ ★회차·인원이 많으면 페이지가 나뉘는지(회차 묶음 × 명단 묶음).
//   ④ blank 옵션이 출결을 실제로 비우는지.
//   DB를 타지 않는다 — 고정 데이터로만 검증(근무일지 테스트와 같은 방식).
import { PDFDocument } from "pdf-lib";
import {
  buildAttendancePdf,
  attendancePdfFilename,
  attendanceSheetTitle,
  type AttendanceSheetData,
  type AttendanceMark,
} from "../lib/attendancePdf";

let failures = 0;
function expect(label: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗"} ${label}${cond ? "" : ` — ${detail ?? ""}`}`);
}

const MARKS: AttendanceMark[] = ["present", "absent", "present", "late"];
function sheet(students: number, sessions: number): AttendanceSheetData {
  return {
    programId: "p1",
    year: "2026",
    termName: "3차시",
    programName: "[전문반] 속샥 디지털드로잉",
    sessionDates: Array.from(
      { length: sessions },
      (_, i) => `2026-07-${String((i % 28) + 1).padStart(2, "0")}`
    ),
    students: Array.from({ length: students }, (_, i) => ({
      seqNo: i + 1,
      name: `학생${i + 1}`,
      schoolGrade: "교동초 6학년",
      contact: "010-0000-0000",
      emergencyContact: "010-1111-1111",
      cancelled: false,
      marks: Array.from(
        { length: sessions },
        (_, k) => MARKS[(i + k) % MARKS.length]
      ),
    })),
  };
}

async function pages(d: AttendanceSheetData, blank = false): Promise<number> {
  const bytes = await buildAttendancePdf(d, { blank });
  const header = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  expect(`%PDF 헤더 (${d.students.length}명 × ${d.sessionDates.length}회차)`, header === "%PDF-", header);
  const pdf = await PDFDocument.load(bytes);
  const { width, height } = pdf.getPage(0).getSize();
  expect("A4 가로", width > height, `${width}x${height}`);
  return pdf.getPageCount();
}

async function main() {
  const base = sheet(13, 8);

  // ① 제목·파일명.
  expect(
    "제목 = 연도 + 차시 + [반] 프로그램명",
    attendanceSheetTitle(base) === "2026년 3차시 [전문반] 속샥 디지털드로잉",
    attendanceSheetTitle(base)
  );
  expect(
    "연도·차시가 없으면 프로그램명만",
    attendanceSheetTitle({ ...base, year: "", termName: "" }) ===
      "[전문반] 속샥 디지털드로잉"
  );
  expect(
    "파일명(출결 포함)",
    attendancePdfFilename(base) ===
      "2026년_3차시_[전문반] 속샥 디지털드로잉_출석부.pdf",
    attendancePdfFilename(base)
  );
  expect(
    "파일명(빈양식) 구분",
    attendancePdfFilename(base, true).includes("빈양식"),
    attendancePdfFilename(base, true)
  );
  const colonFn = attendancePdfFilename({
    ...base,
    programName: "[자격증반:ITQ 한글] 톡톡 컴퓨터 교실",
  });
  expect("파일명에 경로문자 없음", !/[\\/:*?"<>|]/.test(colonFn), colonFn);

  // ② · ③ 한 장 / 여러 장.
  expect("13명 × 8회차는 1페이지", (await pages(base)) === 1);
  // 회차 묶음 × 명단 묶음 = 2 × 2.
  expect("30명 × 20회차는 4페이지", (await pages(sheet(30, 20))) === 4);
  expect("수강생 0명이어도 양식은 나옴", (await pages(sheet(0, 8))) === 1);

  // ④ blank — 출결 글자가 빠지므로 채운 판보다 가볍다.
  const filled = await buildAttendancePdf(base);
  const blank = await buildAttendancePdf(base, { blank: true });
  expect(
    "blank 옵션이 출결을 비움",
    blank.length < filled.length,
    `filled=${filled.length} blank=${blank.length}`
  );

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — 검증 ${failures}건 실패`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
