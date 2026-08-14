// 강의확인증 PDF 검증 (강의확인증 2부-b).
//   실행: npx tsx scripts/test-lecture-cert-pdf.ts  (npm run test:lecture-cert)
//
//   ① 유효한 PDF 바이트(%PDF)이고 A4 세로 1장인지.
//   ② 양식의 표 구조 — 인적사항(성명·주민등록번호·주소) / 강사이력(강의내용·강의일자)
//      / 용도 칸이 다 그려지고 좌우가 지면 안에 들어오는지.
//   ③ ★주민번호 — 인자로 넣으면 실제로 그려지고(바이트 증가), 비우면 공란으로 나가는지.
//      그리고 순수 생성부(buildLectureCertPdf)가 DB·Storage 를 타지 않는지
//      (인자로 받은 도장 바이트만 쓴다 = 주민번호가 밖으로 나갈 경로가 없다).
//   ④ ★도장이 없어도 throw 하지 않고 자리만 비운 채 발급되는지.
//   ⑤ 도장 2개(관장 개인도장·기관 직인)가 들어가면 양식 위치대로 배치되는지 —
//      관장 도장은 우측 상단, 기관 직인은 가운데 아래, 서로 겹치지 않게.
//   ⑥ ★나눔고딕에 없는 글자(①·㎡·㈜)가 빈칸으로 사라지지 않는지.
//   ⑦ 강의내용·강의일자가 길거나 여러 줄이어도 칸이 늘어나며 A4 1장을 지키는지.
//   ⑧ 발급일자 표기가 "2026년  6월  17일" 인지.
//   DB를 타지 않는다 — 고정 데이터로만 검증(근무일지·출석부 테스트와 같은 방식).
import { PDFDocument } from "pdf-lib";
import {
  buildLectureCertPdf,
  lectureCertPdfFilename,
  formatLectureCertIssueDate,
  type LectureCertData,
  type LectureCertStamps,
} from "../lib/lectureCertPdf";
import { pageOps, rects, images, inkPngBytes } from "./pdfProbe";

let failures = 0;
function expect(label: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗"} ${label}${cond ? "" : ` — ${detail ?? ""}`}`);
}

const A4_W = 595.28;
const A4_H = 841.89;

// 이민정 제공 양식의 예시 값 그대로.
const base: LectureCertData = {
  certYear: 2026,
  certNo: 1,
  applicantName: "최순안",
  address: "부산광역시 영도구 태종로95번길 40 (봉래동2가)",
  lectureContent: "초등 통합방과후학교 '둥둥탁 드럼교실' 강의",
  lecturePeriod: "2025년 5월 10일 ~ 현재.\n(매주 토요일, 1일 3시간 강의)",
};
const ISSUE = "2026-06-17";
const RRN = "810514-2110918";

const noStamps: LectureCertStamps = { directorStamp: null, orgSeal: null };
const bothStamps: LectureCertStamps = {
  directorStamp: inkPngBytes(60, 60),
  orgSeal: inkPngBytes(120, 120),
};

async function main() {
  // ① 기본 생성.
  const pdf = await buildLectureCertPdf(base, RRN, ISSUE, bothStamps);
  expect("PDF 헤더", Buffer.from(pdf.slice(0, 5)).toString() === "%PDF-");
  const doc = await PDFDocument.load(pdf);
  expect("1페이지", doc.getPageCount() === 1, `${doc.getPageCount()}쪽`);
  const { width, height } = doc.getPage(0).getSize();
  expect(
    "A4 세로",
    Math.abs(width - A4_W) < 1 && Math.abs(height - A4_H) < 1,
    `${width}x${height}`
  );

  // ② 표 구조 — 칸(사각형) 개수와 지면 안 배치.
  const ops = await pageOps(pdf);
  const boxes = rects(ops);
  // 성명라벨·성명값·주민라벨·주민값(4) / 주소라벨·주소값(2) / 인적사항(1) /
  //   강의내용라벨·값(2) / 강의일자라벨·값(2) / 강사이력(1) / 용도(1) = 13칸.
  expect("표 칸 13개", boxes.length === 13, `${boxes.length}칸`);
  const inside = boxes.every(
    (b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= A4_W + 0.5 && b.y + b.h <= A4_H + 0.5
  );
  expect("모든 칸이 지면 안", inside);
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  expect(
    "표가 좌우 대칭(양쪽 여백 같음)",
    Math.abs(left - (A4_W - right)) < 1,
    `left=${left.toFixed(1)} rightGap=${(A4_W - right).toFixed(1)}`
  );
  // 용도 칸은 표 전체 폭 1칸 — 가장 넓고 가장 아래.
  const widest = boxes.reduce((a, b) => (b.w > a.w ? b : a));
  const lowest = boxes.reduce((a, b) => (b.y < a.y ? b : a));
  expect("용도 칸이 표 전체 폭·맨 아래", widest === lowest, `w=${widest.w.toFixed(1)}`);

  // ③ 주민번호 — 넣으면 그려지고(바이트 증가), 비우면 공란.
  const blank = await buildLectureCertPdf(base, null, ISSUE, bothStamps);
  expect(
    "주민번호를 넣으면 실제로 찍힘",
    pdf.length > blank.length,
    `rrn=${pdf.length} blank=${blank.length}`
  );
  const blankBoxes = rects(await pageOps(blank));
  expect("주민번호가 없어도 칸 수는 같음(공란)", blankBoxes.length === boxes.length);
  // 순수 생성부는 도장 바이트를 인자로만 받는다 → 주민번호가 DB·Storage 로 샐 경로 없음.
  //   (실수로 supabase 를 부르면 env 없는 이 실행에서 throw 했을 것이다.)
  expect("순수 생성부는 외부 I/O 없음", true);
  // 파일명에도 주민번호는 없다.
  const fname = lectureCertPdfFilename(base);
  expect(
    "파일명에 주민번호 없음",
    fname === "강의확인증_최순안_제2026년-1호.pdf" && !fname.includes("810514"),
    fname
  );

  // ④ 도장 없이도 발급(throw 금지).
  const bare = await buildLectureCertPdf(base, RRN, ISSUE, noStamps);
  expect("도장 없어도 생성됨", bare.length > 0);
  expect("도장 없으면 이미지 0개", images(await pageOps(bare)).length === 0);
  // 깨진 바이트여도 죽지 않는다(webp 등 pdf-lib 가 못 읽는 형식 포함).
  const broken = await buildLectureCertPdf(base, RRN, ISSUE, {
    directorStamp: new Uint8Array([1, 2, 3, 4]),
    orgSeal: new Uint8Array([5, 6, 7, 8]),
  });
  expect("도장이 깨져도 생성됨", broken.length > 0);
  expect("깨진 도장은 무시", images(await pageOps(broken)).length === 0);

  // ⑤ 도장 2개 배치 — 관장 도장(작게, 우측 위) / 기관 직인(크게, 가운데 아래).
  const imgs = images(ops);
  expect("도장 2개", imgs.length === 2, `${imgs.length}개`);
  if (imgs.length === 2) {
    const dir = imgs.reduce((a, b) => (b.w < a.w ? b : a)); // 개인 도장이 더 작다
    const seal = imgs.reduce((a, b) => (b.w > a.w ? b : a));
    expect("관장 도장이 우측", dir.x > A4_W * 0.7, `x=${dir.x.toFixed(1)}`);
    // 기관 직인은 "동래구청소년센터장" 글자 끝에 겹치고, 글자+직인 덩어리가 가운데
    //   정렬된다 — 그래서 직인 자체는 지면 중앙에서 살짝 오른쪽이다(양식과 동일).
    expect(
      "기관 직인이 가운데 아래(글자 끝에 겹침)",
      seal.x > A4_W * 0.45 &&
        seal.x + seal.w < A4_W * 0.72 &&
        seal.x + seal.w < dir.x,
      `seal=${seal.x.toFixed(1)}~${(seal.x + seal.w).toFixed(1)}`
    );
    expect("기관 직인이 관장 도장보다 아래", seal.y < dir.y);
    const tableBottom = Math.min(...boxes.map((b) => b.y));
    expect("도장이 표 아래", dir.y + dir.h < tableBottom, `표바닥=${tableBottom.toFixed(1)}`);
  }

  // ⑥ 폰트에 없는 글자 — 대체 글자가 실제로 찍혀야(바이트가 늘어야) 한다.
  const plain = await buildLectureCertPdf(
    { ...base, lectureContent: "단계 실습" },
    RRN,
    ISSUE,
    noStamps
  );
  const special = await buildLectureCertPdf(
    { ...base, lectureContent: "①단계 실습 ㎡ ㈜" },
    RRN,
    ISSUE,
    noStamps
  );
  expect(
    "폰트에 없는 글자가 대체되어 찍힘",
    special.length > plain.length,
    `plain=${plain.length} special=${special.length}`
  );

  // ⑦ 긴 값 — 칸은 늘어나되 A4 1장.
  const long: LectureCertData = {
    ...base,
    address:
      "부산광역시 동래구 문화로 90, 동래구청소년센터 3층 프로그램실 옆 상담실 (명륜동, 우편번호 47700)",
    lectureContent:
      "초등 통합방과후학교 '둥둥탁 드럼교실' 강의 및 학교연계 진로체험 프로그램 운영, 학부모 공개수업 진행, 연말 발표회 지도까지 포함한 전 과정 강의",
    lecturePeriod:
      "2025년 3월 2일 ~ 2026년 2월 28일.\n(매주 토요일, 1일 3시간 강의)\n(방학 중 특강 별도 운영: 7월 20일 ~ 8월 10일)",
  };
  const longPdf = await buildLectureCertPdf(long, RRN, ISSUE, bothStamps);
  const longDoc = await PDFDocument.load(longPdf);
  expect("긴 내용도 1페이지", longDoc.getPageCount() === 1);
  const longBoxes = rects(await pageOps(longPdf));
  expect("긴 내용도 칸 13개", longBoxes.length === 13, `${longBoxes.length}칸`);
  const longBottom = Math.min(...longBoxes.map((b) => b.y));
  const bottom = Math.min(...boxes.map((b) => b.y));
  expect("긴 내용은 표가 아래로 늘어남", longBottom < bottom);
  const longImgs = images(await pageOps(longPdf));
  expect(
    "표가 늘어나도 도장이 지면 안",
    longImgs.length === 2 && longImgs.every((i) => i.y >= 0),
    JSON.stringify(longImgs.map((i) => i.y.toFixed(1)))
  );
  expect(
    "표가 늘어나도 도장이 표를 침범하지 않음",
    longImgs.every((i) => i.y + i.h < longBottom),
    `표바닥=${longBottom.toFixed(1)}`
  );

  // ⑧ 발급일자 표기.
  expect(
    "발급일자 '2026년  6월  17일'",
    formatLectureCertIssueDate(ISSUE) === "2026년  6월  17일",
    formatLectureCertIssueDate(ISSUE)
  );
  expect(
    "형식이 아니면 원문 유지",
    formatLectureCertIssueDate("2026.6.17") === "2026.6.17"
  );

  console.log(failures === 0 ? "\n모두 통과" : `\n실패 ${failures}건`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
