// 강사 근무일지 PDF 검증 (강사관리 B차-1 + 전자서명 2단계).
//   실행: npx tsx scripts/test-worklog-pdf.ts  (npm run test:worklog)
//
//   ① 제목·파일명이 차시명을 따라가는지.
//   ② 유효한 PDF 바이트인지(%PDF 헤더) + 회차가 많으면 페이지가 넘어가는지.
//   ③ ★나눔고딕에 없는 글자(①·㎡·㈜)가 빈칸으로 사라지지 않는지.
//      — 강사 원문 그대로 찍으면 pdf-lib 가 말없이 빈칸을 남긴다. 문서로 나가는 것이라
//        "안 쓴 것"과 구분이 안 되므로 대체 글자로 나와야 한다.
//   ④ 회차가 없어도(0회차) 죽지 않고 양식은 나오는지.
//   ⑤ ★결재란(담당·부장·관장)이 없는지 — 인적사항 표보다 위에 그려진 사각형이
//      하나도 없어야 한다(결재란이 있던 자리).
//   ⑥ ★실제 회차 수(8~9회)가 A4 1장에 들어가는지.
//   ⑦ ★강사 서명 — instructor_signed_at 있는 회차에만 이미지가 들어가고,
//      서명이 없거나 깨져도 PDF 생성이 죽지 않는지. 이미지가 서명 칸 안에 있는지.
//   DB를 타지 않는다 — 고정 데이터로만 검증(급여명세서 테스트와 같은 방식).
import { PDFDocument } from "pdf-lib";
import {
  buildWorkLogPdf,
  workLogPdfFilename,
  workLogTitle,
  type WorkLogData,
} from "../lib/workLogPdf";
// 콘텐츠 스트림 판독(rects·images)·서명 대역 PNG 는 출석부 테스트와 공용 — scripts/pdfProbe.
import { pageOps, rects, images, signaturePng } from "./pdfProbe";

let failures = 0;
function expect(label: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗"} ${label}${cond ? "" : ` — ${detail ?? ""}`}`);
}

// 실제 서명처럼 가로로 긴(3:1) 투명 PNG.
const SIGN_PNG = signaturePng(240, 80);

const base: WorkLogData = {
  programId: "p1",
  courseName: "동래미래 아카데미",
  termName: "3차시",
  programName: "띵가띵가 기타교실",
  instructorName: "박시은",
  instructorPhone: "010-6318-8084",
  instructorSignature: null,
  sessions: [
    {
      session_no: 1,
      session_date: "2026-07-04",
      log_content: "바람이 불어오는 곳 파트별 연습",
      student_count: 3,
      work_hours: 1.5,
      instructor_signed_at: null,
    },
    // 미진행·미입력 회차 — 날짜만 있고 나머지는 빈칸으로 나와야 한다.
    {
      session_no: 2,
      session_date: "2026-08-29",
      log_content: null,
      student_count: null,
      work_hours: null,
      instructor_signed_at: null,
    },
  ],
};

// 실제 운영 데이터와 같은 8회차 — 1~5회차 진행·서명 완료, 6~8회차는 예정.
const eight: WorkLogData = {
  ...base,
  programName: "MOVE! 비보잉 교실",
  instructorSignature: SIGN_PNG,
  sessions: Array.from({ length: 8 }, (_, i) => {
    const done = i < 5;
    return {
      session_no: i + 1,
      session_date: `2026-09-${String(i * 3 + 2).padStart(2, "0")}`,
      log_content: done
        ? "탑락 기본 스텝 반복 연습 후 개인별 피드백, 다음 시간 예고까지 진행"
        : null,
      student_count: done ? 9 : null,
      work_hours: done ? 2 : null,
      instructor_signed_at: done ? `2026-09-${String(i * 3 + 2).padStart(2, "0")}T10:00:00Z` : null,
    };
  }),
};

async function pageCount(d: WorkLogData): Promise<number> {
  const bytes = await buildWorkLogPdf(d);
  const header = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  expect(`%PDF 헤더 (${d.programName})`, header === "%PDF-", header);
  return (await PDFDocument.load(bytes)).getPageCount();
}

const A4_H = 841.89;
const INFO_TOP_Y = A4_H - 92; // 인적사항 표 윗변 — 이보다 위엔 아무 칸도 없어야 한다.
// 서명 칸(강사 담당) 좌우 경계 — 마지막 열.
const SIGN_X0 = 40 + 86 + 217.28 + 52 + 52;
const SIGN_X1 = SIGN_X0 + 108;

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
      instructor_signed_at: null,
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

  // ⑤ 결재란 삭제 — 인적사항 표 윗변보다 위에 그려진 칸이 없어야 한다.
  //    결재란(담당·부장·관장)이 있던 시절엔 y 803 까지 칸이 올라가 있었다.
  const eightOps = await pageOps(await buildWorkLogPdf(eight));
  const boxes = rects(eightOps);
  const above = boxes.filter((r) => r.y + r.h > INFO_TOP_Y + 1);
  expect(
    "결재란 없음(인적사항 위에 칸 0개)",
    above.length === 0,
    `위쪽 칸 ${above.length}개 — ${JSON.stringify(above.slice(0, 3))}`
  );

  // ⑥ 실제 회차 수(8·9회)가 A4 1장에.
  expect("8회차는 1페이지", (await pageCount(eight)) === 1);
  const nine: WorkLogData = {
    ...eight,
    programName: "9회차 프로그램",
    sessions: [
      ...eight.sessions,
      {
        session_no: 9,
        session_date: "2026-10-26",
        log_content: "발표회 준비 — 팀별 루틴 합 맞추기, 음악 편집 확인",
        student_count: 9,
        work_hours: 2,
        instructor_signed_at: "2026-10-26T10:00:00Z",
      },
    ],
  };
  expect("9회차도 1페이지", (await pageCount(nine)) === 1);
  // 표가 아래 여백을 넘지 않는지(마지막 칸 아랫변 >= 여백 40).
  const lowest = Math.min(...boxes.map((r) => r.y));
  expect("표가 아래 여백을 넘지 않음", lowest >= 40 - 1, `최하단 y=${lowest}`);

  // ⑦ 강사 서명 — 서명한 회차 수만큼, 서명 칸 안에.
  const signed = eight.sessions.filter((s) => s.instructor_signed_at).length;
  const imgs = images(eightOps);
  expect(
    `서명 이미지 ${signed}개(서명한 회차 수와 같음)`,
    imgs.length === signed,
    `${imgs.length}개`
  );
  const inside = imgs.every(
    (im) =>
      im.x >= SIGN_X0 - 0.5 &&
      im.x + im.w <= SIGN_X1 + 0.5 &&
      im.w > 0 &&
      im.h > 0
  );
  expect("서명이 서명 칸 밖으로 안 나감", inside, JSON.stringify(imgs.slice(0, 2)));
  // 비율 유지 — 원본 240x80(3:1).
  const ratioOk = imgs.every((im) => Math.abs(im.w / im.h - 3) < 0.05);
  expect("서명 비율 유지(3:1)", ratioOk, JSON.stringify(imgs.slice(0, 2)));

  // 서명 없는 강사 / 서명 안 한 회차 — 이미지가 0개.
  const noSigOps = await pageOps(
    await buildWorkLogPdf({ ...eight, instructorSignature: null })
  );
  expect("signature_data 없으면 전부 빈칸", images(noSigOps).length === 0);
  const noneSignedOps = await pageOps(
    await buildWorkLogPdf({
      ...eight,
      sessions: eight.sessions.map((s) => ({ ...s, instructor_signed_at: null })),
    })
  );
  expect("서명 제출한 회차가 없으면 빈칸", images(noneSignedOps).length === 0);

  // 깨진 dataURL / 이미지가 아닌 값 — 에러 없이 빈칸.
  for (const bad of [
    "not-a-data-url",
    "data:image/png;base64,!!!!",
    "data:image/png;base64,",
    "data:text/plain;base64,aGVsbG8=",
  ]) {
    let ok = true;
    let count = -1;
    try {
      count = images(
        await pageOps(await buildWorkLogPdf({ ...eight, instructorSignature: bad }))
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

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — 검증 ${failures}건 실패`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
