// PDF 보고서(출장·외근·연수·교육) 표 셀의 공통 서식.
//
// ★ 왜 평범한 vertical-align 이 아닌가 — html2canvas 의 글자 위치 버그
// ---------------------------------------------------------------------
// 이 보고서들은 화면에 보이지 않습니다. 화면 밖(left:-10000px)에 그려 두고
// html2canvas 로 캡처해 그 그림을 PDF 에 넣습니다(lib/pdf.ts). 그래서 표가
// 브라우저에서 어떻게 보이느냐가 아니라 html2canvas 가 어떻게 그리느냐가
// 결과물을 결정합니다.
//
// html2canvas 1.4.1 은 글자를 그릴 때 baseline 을 FontMetrics 로 잽니다
// (html2canvas.js 의 parseMetrics — 숨긴 span+img 를 document.body 에 붙여
// 재는 방식). 이 서식(13px, Pretendard 계열)에서 그 값은 20px 인데, 글꼴의
// 실제 ascent 는 14px 입니다. 결국 모든 글자가 제자리보다 약 6px 아래에
// 찍힙니다. 칸 높이가 빠듯한 표에서는 이게 "글자가 아래에 붙었다"로 보입니다.
//
// 중요한 것은 이게 vertical-align 으로 고쳐지지 않는다는 점입니다. 셀의
// vertical-align:middle 은 브라우저에서 정상 적용되고(계산값도 middle),
// html2canvas 도 셀 자체는 제자리에 그립니다 — 어긋나는 건 그 안의 "글자"라서
// c06a422 에서 넣은 verticalAlign:"middle" 은 실물 PDF 를 바꾸지 못했습니다.
//
// 그래서 두 가지를 합니다.
//   ① line-height 를 고정 — 안 그러면 호스트 페이지(globals.css 의 Tailwind
//      preflight)에서 line-height:24px 이 상속돼 칸 높이가 들쭉날쭉해집니다.
//   ② 위/아래 패딩을 그 6px 만큼 비대칭으로 — 글자를 칸 중앙으로 끌어올립니다.
//      칸 전체 높이는 그대로 두고 글자만 올리는 것이라 서식(열 구성·폭·글꼴
//      크기)은 바뀌지 않습니다.
//
// 이 값들은 scripts/test-trip-pdf-render.ts 가 실제 캡처 픽셀로 검증합니다.
// 서식이나 글꼴을 건드리면 그 스크립트를 돌려 다시 맞추세요.

/** html2canvas 1.4.1 이 13px 본문 글자를 제자리보다 아래에 그리는 양(px). */
const BASELINE_DROP = 6;
/** 표 셀의 줄 높이 — 호스트 페이지 상속을 끊기 위해 명시합니다. */
const CELL_LINE_HEIGHT = 18;
/** 위아래 여백의 기준값(보정 전). 칸 높이는 이 값으로 정해집니다. */
const CELL_PAD_V = 7;

const padTop = Math.max(0, CELL_PAD_V - BASELINE_DROP);
const padBottom = CELL_PAD_V + BASELINE_DROP;

const cellBase: React.CSSProperties = {
  paddingTop: `${padTop}px`,
  paddingBottom: `${padBottom}px`,
  lineHeight: `${CELL_LINE_HEIGHT}px`,
  border: "1px solid #cbd5e1",
};

/** 표의 머리칸(좌측 라벨). */
export const pdfThStyle: React.CSSProperties = {
  ...cellBase,
  width: "100px",
  paddingLeft: "10px",
  paddingRight: "10px",
  background: "#f1f5f9",
  textAlign: "center",
  fontWeight: 600,
};

/** 표의 값칸. */
export const pdfTdStyle: React.CSSProperties = {
  ...cellBase,
  paddingLeft: "12px",
  paddingRight: "12px",
};

/** 표 자체 — 열 구성·폭·글꼴 크기는 기존 그대로입니다. */
export const pdfTableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
};
