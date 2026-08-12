// 강사 근무일지 PDF 검증 (강사관리 B차-1).
//   실행: npx tsx scripts/test-worklog-pdf.ts  (npm run test:worklog)
//
//   ① 제목·파일명이 차시명을 따라가는지.
//   ② 유효한 PDF 바이트인지(%PDF 헤더) + 회차가 많으면 페이지가 넘어가는지.
//   ③ ★나눔고딕에 없는 글자(①·㎡·㈜)가 빈칸으로 사라지지 않는지.
//      — 강사 원문 그대로 찍으면 pdf-lib 가 말없이 빈칸을 남긴다. 결재 문서라
//        "안 쓴 것"과 구분이 안 되므로 대체 글자로 나와야 한다.
//   ④ 회차가 없어도(0회차) 죽지 않고 양식은 나오는지.
//   DB를 타지 않는다 — 고정 데이터로만 검증(급여명세서 테스트와 같은 방식).
import { PDFDocument } from "pdf-lib";
import {
  buildWorkLogPdf,
  workLogPdfFilename,
  workLogTitle,
  type WorkLogData,
} from "../lib/workLogPdf";

let failures = 0;
function expect(label: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗"} ${label}${cond ? "" : ` — ${detail ?? ""}`}`);
}

const base: WorkLogData = {
  programId: "p1",
  courseName: "동래미래 아카데미",
  termName: "3차시",
  programName: "띵가띵가 기타교실",
  instructorName: "박시은",
  instructorPhone: "010-6318-8084",
  sessions: [
    {
      session_no: 1,
      session_date: "2026-07-04",
      log_content: "바람이 불어오는 곳 파트별 연습",
      student_count: 3,
      work_hours: 1.5,
    },
    // 미진행·미입력 회차 — 날짜만 있고 나머지는 빈칸으로 나와야 한다.
    {
      session_no: 2,
      session_date: "2026-08-29",
      log_content: null,
      student_count: null,
      work_hours: null,
    },
  ],
};

async function pageCount(d: WorkLogData): Promise<number> {
  const bytes = await buildWorkLogPdf(d);
  const header = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  expect(`%PDF 헤더 (${d.programName})`, header === "%PDF-", header);
  return (await PDFDocument.load(bytes)).getPageCount();
}

async function main() {
  // ① 제목·파일명.
  expect("제목 = 차시명 + 강사 근무일지", workLogTitle(base) === "3차시 강사 근무일지", workLogTitle(base));
  expect(
    "차시명이 없으면 제목만",
    workLogTitle({ ...base, termName: "" }) === "강사 근무일지"
  );
  const fn = workLogPdfFilename(base);
  expect("파일명에 차시·프로그램", fn === "3차시_띵가띵가 기타교실_강사근무일지.pdf", fn);
  const slashFn = workLogPdfFilename({ ...base, programName: "기타/우쿨렐레" });
  expect("파일명에 경로문자 없음", !slashFn.includes("/"), slashFn);

  // ② 한 장짜리 / 여러 장짜리.
  expect("2회차는 1페이지", (await pageCount(base)) === 1);
  const many: WorkLogData = {
    ...base,
    programName: "회차 많은 프로그램",
    sessions: Array.from({ length: 30 }, (_, i) => ({
      session_no: i + 1,
      session_date: `2026-03-${String((i % 28) + 1).padStart(2, "0")}`,
      log_content: "긴 수업내용 ".repeat(12),
      student_count: 12,
      work_hours: 2,
    })),
  };
  expect("30회차는 여러 페이지", (await pageCount(many)) > 1);

  // ③ 폰트에 없는 글자 — 바이트가 늘어야(대체 글자가 실제로 찍혀야) 한다.
  //    나눔고딕에 ①·㎡·㈜ 글리프가 없어 원문 그대로면 아무것도 안 찍힌다.
  const plain = await buildWorkLogPdf({
    ...base,
    sessions: [{ ...base.sessions[0], log_content: "단계 실습" }],
  });
  const special = await buildWorkLogPdf({
    ...base,
    sessions: [{ ...base.sessions[0], log_content: "①단계 실습 ㎡ ㈜" }],
  });
  expect(
    "폰트에 없는 글자가 대체되어 찍힘",
    special.length > plain.length,
    `plain=${plain.length} special=${special.length}`
  );

  // ④ 0회차.
  expect("0회차도 양식은 나옴", (await pageCount({ ...base, sessions: [] })) === 1);

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — 검증 ${failures}건 실패`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
