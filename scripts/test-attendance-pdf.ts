// 출석부 PDF 검증 (강사관리 B차-2 + 전자서명 3단계).
//   실행: npx tsx scripts/test-attendance-pdf.ts  (npm run test:attendance)
//
//   ① 제목 "2026년 3차시 [반] 프로그램명" 조립 + 파일명(빈양식 구분·경로문자 제거).
//   ② 유효한 PDF 바이트 + A4 가로.
//   ③ ★회차·인원이 많으면 페이지가 나뉘는지(회차 묶음 × 명단 묶음).
//   ④ blank 옵션이 출결을 실제로 비우는지.
//   ⑤ ★담당 서명(도장) — 근무일지를 확정한 회차에만, 그 회차 열의 첫째 서명줄에.
//      확정자가 도장 미등록이면 그 회차는 빈칸.
//   ⑥ ★강사 서명 — instructor_signed_at 있는 회차에만, 둘째 서명줄에.
//   ⑦ ★blank 양식은 도장·서명을 모두 빼는지(사람이 직접 서명할 종이).
//   ⑧ ★도장·서명이 없거나 깨져도 PDF 생성이 죽지 않는지.
//   DB를 타지 않는다 — 고정 데이터로만 검증(근무일지 테스트와 같은 방식).
import { PDFDocument } from "pdf-lib";
import {
  buildAttendancePdf,
  attendancePdfFilename,
  attendanceSheetTitle,
  type AttendanceSheetData,
  type AttendanceMark,
} from "../lib/attendancePdf";
import { pageOps, images, inkPngBytes, signaturePng, type Box } from "./pdfProbe";

let failures = 0;
function expect(label: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗"} ${label}${cond ? "" : ` — ${detail ?? ""}`}`);
}

// 도장은 대체로 정사각(2:1 아닌), 손서명은 가로로 길다 — 비율로 서로 구분된다.
const STAMP_PNG = inkPngBytes(120, 120);
const SIGN_PNG = signaturePng(240, 80);

// --- 양식 좌표(lib/attendancePdf 의 상수와 같아야 한다) ---
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const M = 28;
const LEFT_W = 30 + 66 + 116 + 96;
const SESSION_X0 = M + LEFT_W;
const SESSION_AREA = PAGE_W - 2 * M - LEFT_W;
const SIGN_H = 26;
const TABLE_TOP = 66;
// 서명 2줄의 세로 구간(PDF 좌표, 아래쪽 변 기준).
const STAFF_BAND = [PAGE_H - TABLE_TOP - SIGN_H, PAGE_H - TABLE_TOP];
const INSTR_BAND = [PAGE_H - TABLE_TOP - SIGN_H * 2, PAGE_H - TABLE_TOP - SIGN_H];
const midY = (b: Box) => b.y + b.h / 2;
const inBand = (b: Box, band: number[]) =>
  midY(b) > band[0] && midY(b) < band[1];

const MARKS: AttendanceMark[] = ["present", "absent", "present", "late"];

// students × sessions 격자. confirmedBy/instructorSigned 는 회차 인덱스로 정한다.
function sheet(
  students: number,
  sessions: number,
  o: {
    confirmedBy?: (i: number) => string | null;
    signed?: (i: number) => boolean;
    stamps?: Record<string, Uint8Array | null>;
    signature?: string | null;
  } = {}
): AttendanceSheetData {
  return {
    programId: "p1",
    year: "2026",
    termName: "3차시",
    programName: "[전문반] 속샥 디지털드로잉",
    sessions: Array.from({ length: sessions }, (_, i) => ({
      date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
      confirmedBy: o.confirmedBy ? o.confirmedBy(i) : null,
      instructorSigned: o.signed ? o.signed(i) : false,
    })),
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
    staffStamps: o.stamps ?? {},
    instructorSignature: o.signature ?? null,
  };
}

async function pages(d: AttendanceSheetData, blank = false): Promise<number> {
  const bytes = await buildAttendancePdf(d, { blank });
  const header = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  expect(
    `%PDF 헤더 (${d.students.length}명 × ${d.sessions.length}회차)`,
    header === "%PDF-",
    header
  );
  const pdf = await PDFDocument.load(bytes);
  const { width, height } = pdf.getPage(0).getSize();
  expect("A4 가로", width > height, `${width}x${height}`);
  return pdf.getPageCount();
}

async function imgsOf(
  d: AttendanceSheetData,
  blank = false
): Promise<Box[]> {
  return images(await pageOps(await buildAttendancePdf(d, { blank })));
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

  // --- 전자서명 3단계 ---
  //   8회차 중 1~5회차는 이민정이 확정(도장), 1~4회차는 강사가 서명 제출.
  //   6~8회차는 미확정·미서명 → 두 줄 모두 빈칸이어야 한다.
  const CONFIRMED = 5;
  const SIGNED = 4;
  const live = sheet(13, 8, {
    confirmedBy: (i) => (i < CONFIRMED ? "이민정" : null),
    signed: (i) => i < SIGNED,
    stamps: { 이민정: STAMP_PNG },
    signature: SIGN_PNG,
  });
  const liveImgs = await imgsOf(live);
  const staffImgs = liveImgs.filter((b) => inBand(b, STAFF_BAND));
  const instrImgs = liveImgs.filter((b) => inBand(b, INSTR_BAND));

  // ⑤ 담당 도장 — 확정한 회차 수만큼, 첫째 서명줄에.
  expect(
    `담당 도장 ${CONFIRMED}개(확정 회차 수와 같음)`,
    staffImgs.length === CONFIRMED,
    `${staffImgs.length}개`
  );
  // ⑥ 강사 서명 — 서명 제출한 회차 수만큼, 둘째 서명줄에.
  expect(
    `강사 서명 ${SIGNED}개(서명 회차 수와 같음)`,
    instrImgs.length === SIGNED,
    `${instrImgs.length}개`
  );
  expect(
    "서명줄 밖에 그려진 이미지 없음",
    staffImgs.length + instrImgs.length === liveImgs.length,
    `전체 ${liveImgs.length} / 담당 ${staffImgs.length} + 강사 ${instrImgs.length}`
  );

  // 회차 열 안에 들어가는지 — 좌측 고정 열(명단)을 침범하면 안 된다.
  const colW = Math.min(84, SESSION_AREA / 8);
  const insideCols = liveImgs.every(
    (b) =>
      b.x >= SESSION_X0 - 0.5 &&
      b.x + b.w <= SESSION_X0 + colW * 8 + 0.5 &&
      b.w > 0 &&
      b.h > 0
  );
  expect(
    "도장·서명이 회차 열 안에 있음",
    insideCols,
    JSON.stringify(liveImgs.slice(0, 2))
  );
  // 각 이미지가 "자기 회차" 열 하나에만 걸치는지(옆 회차로 넘치면 안 된다).
  const ownColumn = liveImgs.every((b) => {
    const k = Math.floor((b.x - SESSION_X0) / colW);
    const x0 = SESSION_X0 + k * colW;
    return b.x >= x0 - 0.5 && b.x + b.w <= x0 + colW + 0.5;
  });
  expect("이미지가 옆 회차 칸을 침범하지 않음", ownColumn);
  // 서명줄 높이(26) 안에 — 세로로도 안 넘친다.
  expect(
    "이미지가 서명줄 높이를 넘지 않음",
    liveImgs.every((b) => b.h <= SIGN_H + 0.5),
    JSON.stringify(liveImgs.slice(0, 2))
  );
  // 비율 유지 — 도장 120x120(1:1), 서명 240x80(3:1).
  expect(
    "도장 비율 유지(1:1)",
    staffImgs.every((b) => Math.abs(b.w / b.h - 1) < 0.05),
    JSON.stringify(staffImgs.slice(0, 2))
  );
  expect(
    "강사 서명 비율 유지(3:1)",
    instrImgs.every((b) => Math.abs(b.w / b.h - 3) < 0.05),
    JSON.stringify(instrImgs.slice(0, 2))
  );

  // 미확정·미서명 회차는 빈칸.
  expect(
    "확정 회차가 없으면 담당 도장 0개",
    (await imgsOf({ ...live, sessions: live.sessions.map((s) => ({ ...s, confirmedBy: null })) }))
      .filter((b) => inBand(b, STAFF_BAND)).length === 0
  );
  expect(
    "서명 제출 회차가 없으면 강사 서명 0개",
    (await imgsOf({
      ...live,
      sessions: live.sessions.map((s) => ({ ...s, instructorSigned: false })),
    })).filter((b) => inBand(b, INSTR_BAND)).length === 0
  );

  // ⑦ blank 양식 — 손으로 서명할 종이이므로 도장·서명 모두 빠진다.
  expect("blank 양식은 도장·서명 0개", (await imgsOf(live, true)).length === 0);

  // ⑧ 도장·서명 없음 / 깨진 값 — 에러 없이 빈칸.
  expect(
    "도장 미등록 담당자는 빈칸(확정은 됐어도)",
    (await imgsOf({ ...live, staffStamps: { 이민정: null } })).filter((b) =>
      inBand(b, STAFF_BAND)
    ).length === 0
  );
  expect(
    "확정자가 stamps 목록에 아예 없어도 안전",
    (await imgsOf({ ...live, staffStamps: {} })).filter((b) =>
      inBand(b, STAFF_BAND)
    ).length === 0
  );
  expect(
    "강사 서명값 없으면 빈칸",
    (await imgsOf({ ...live, instructorSignature: null })).filter((b) =>
      inBand(b, INSTR_BAND)
    ).length === 0
  );

  for (const bad of [
    "not-a-data-url",
    "data:image/png;base64,!!!!",
    "data:image/png;base64,",
    "data:text/plain;base64,aGVsbG8=",
  ]) {
    let ok = true;
    let count = -1;
    try {
      count = (await imgsOf({ ...live, instructorSignature: bad })).filter((b) =>
        inBand(b, INSTR_BAND)
      ).length;
    } catch {
      ok = false;
    }
    expect(
      `깨진 서명값도 안전하게 빈칸 (${bad.slice(0, 26)})`,
      ok && count === 0,
      `throw=${!ok} imgs=${count}`
    );
  }
  // 이미지가 아닌 바이트가 도장 자리에 들어와도 죽지 않아야 한다.
  {
    let ok = true;
    let count = -1;
    try {
      count = (
        await imgsOf({
          ...live,
          staffStamps: { 이민정: new Uint8Array([1, 2, 3, 4, 5]) },
        })
      ).filter((b) => inBand(b, STAFF_BAND)).length;
    } catch {
      ok = false;
    }
    expect("깨진 도장 바이트도 안전하게 빈칸", ok && count === 0, `throw=${!ok} imgs=${count}`);
  }

  // 회차를 여러 장으로 나눠도 각 장의 서명줄이 제자리에 그려지는지.
  const wide = sheet(13, 20, {
    confirmedBy: () => "이민정",
    signed: () => true,
    stamps: { 이민정: STAMP_PNG },
    signature: SIGN_PNG,
  });
  const wideBytes = await buildAttendancePdf(wide);
  const p2 = images(await pageOps(wideBytes, 1));
  expect(
    "여러 장으로 나뉘어도 2장째 서명줄이 채워짐",
    p2.filter((b) => inBand(b, STAFF_BAND)).length > 0 &&
      p2.filter((b) => inBand(b, INSTR_BAND)).length > 0,
    `${p2.length}개`
  );

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — 검증 ${failures}건 실패`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
