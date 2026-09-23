// 디자인 시스템 공통 클래스 — globals.css 의 토큰(navy/ink/line/…)을 사용합니다.
// 각 컴포넌트가 클래스 문자열을 중복 정의하지 않도록 이 모듈에서 통합합니다.

// --- 카드 ---
export const cardCls =
  "rounded-xl border border-line bg-card p-4 shadow-sm sm:p-5";

// =====================================================================
// 구분선 스타일 (2026-09, 관장 피드백)
//
//   "흰 배경에 글자만 있어서 영역 구분이 안 된다. 촌스럽게 색을 채우지 말고
//    테두리 구분선으로, 우리 로고 색에 맞게."
//
//   그래서 두 가지를 지킵니다.
//     · 배경은 흰색 그대로. 면을 색으로 채우지 않습니다.
//     · 선 색은 로고 4색을 흰색에 30% 섞은 값(globals.css --rule-*).
//       원색 선을 그으면 그게 더 촌스러워서 채도를 낮췄습니다.
//       기본 경계는 중성(--rule), 로고색은 '한 군데' 포인트에만 씁니다.
//
//   ★ 2026-09 관장 확인 뒤 다음 화면으로 넓혔습니다.
//       /hr/clubs · /mail · /business-results · /hr(인사기록카드) ·
//       /hr/facility/*(비품·운행·장소·대관·안전점검) · /hr/partners ·
//       /profile/hr(내 의무교육·증명서)
//     넓히지 않은 화면과 이유는 커밋 메시지에 적어 두었습니다.
// =====================================================================

// 색 배정 규칙 — 화면마다 다르게 고르면 색이 뜻을 잃습니다. 이 뜻을 쓰세요.
//   blue   : 조회·현황 (검색·필터·요약처럼 '보는' 구역)
//   green  : 사람·목록·결과 (명부, 집계된 실적처럼 '쌓인' 구역)
//   yellow : 입력·등록 (내가 채워 넣는 구역)
//   red    : 조치 필요 (설정 미비 안내 등 — 아껴 쓰세요)
//   navy   : 중성. 색을 줄 이유가 없으면 이것(=panelCls).

// 색 이름 — 섹션의 '의미' 에 맞춰 고릅니다. 한 화면에 2~4색까지만 쓰세요.
//   색이 많아지면 구분이 아니라 소음이 됩니다.
export type RuleTone = "blue" | "red" | "green" | "yellow" | "navy";

// 박스 테두리색(65% 농도) — 관장 요청으로 테두리 자체에 로고색을 씁니다.
//   30/50/65% 를 실제 화면에 띄워 비교한 결과입니다(globals.css 주석 참고).
const PANEL_EDGE: Record<RuleTone, string> = {
  blue: "border-edge-blue",
  red: "border-edge-red",
  green: "border-edge-green",
  yellow: "border-edge-yellow",
  navy: "border-rule",
};

// 바깥 섹션 — 카드보다 경계가 또렷한 판. 배경은 흰색 유지(면을 칠하지 않음).
//   tone 을 주면 테두리에 그 색이 들어갑니다. 안 주면 중성 선.
export function panelToneCls(tone: RuleTone = "navy"): string {
  return `rounded-xl border ${PANEL_EDGE[tone]} bg-card p-4 sm:p-5`;
}
// 색 없는 기본 판 — 기존 호출부 호환.
export const panelCls = panelToneCls("navy");

// 안쪽 블록 — 섹션 안에서 한 덩이를 또 나눌 때(표·폼 묶음). 늘 중성입니다.
//   바깥 판에 색이 있는데 안쪽까지 색을 주면 경계가 겹쳐 지저분해집니다.
export const blockCls = "rounded-lg border border-rule bg-card p-3";

// 섹션 제목 — 왼쪽에 로고색 띠 하나(원색). 판 테두리와 같은 tone 을 주세요.
const RULE_BAR: Record<RuleTone, string> = {
  blue: "border-l-logo-blue",
  red: "border-l-logo-red",
  green: "border-l-logo-green",
  yellow: "border-l-logo-yellow",
  navy: "border-l-navy",
};
export function sectionTitleCls(tone: RuleTone = "navy"): string {
  return `border-l-[3px] ${RULE_BAR[tone]} pl-2.5 text-base font-bold text-ink`;
}

// 표 — 머리줄과 행 경계를 같은 선으로 통일.
export const tableHeadCls =
  "border-b border-rule text-left text-xs font-medium text-ink-hint";
export const tableRowCls = "border-b border-rule/70 last:border-0";

// --- 입력 ---
export const inputCls =
  "mt-1 block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink-body shadow-sm placeholder:text-ink-hint focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
export const labelCls = "block text-xs font-medium text-ink-muted";

// --- 버튼 ---
//   클릭 어포던스 통일: 배경 있는 명확한 형태 + hover 진해짐 + 클릭 시 눌림(active:scale)
//   + 키보드 포커스 링. 중복 클릭 방지가 필요한 제출 버튼은 <Button loading> 사용.
const btnBase =
  "inline-flex h-[38px] items-center justify-center gap-1.5 rounded-lg px-4 text-sm shadow-sm transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-60";
export const btnPrimary = `${btnBase} bg-navy font-semibold text-white hover:bg-navy-strong focus-visible:ring-navy`;
export const btnSecondary = `${btnBase} border border-line bg-card font-medium text-ink-body hover:bg-surface focus-visible:ring-navy`;
export const btnDanger = `${btnBase} border border-stamp bg-card font-semibold text-stamp hover:bg-stamp-soft focus-visible:ring-stamp`;

// --- 텍스트 링크 --- 색(네이비)+hover 밑줄 통일.
export const linkCls =
  "font-medium text-navy underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-1 rounded-sm";

// --- 클릭 가능한 행/카드 (목록→상세) ---
//   정보용(클릭 불가) 카드와 구분: 커서 포인터 + hover 배경 + 포커스 링.
//   우측에 옅은 → 아이콘(RowChevron)을 함께 배치해 "눌러서 이동"을 명시한다.
export const rowLinkCls =
  "group cursor-pointer transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy";

// --- 탭 --- 활성 탭 하단 굵은 인디케이터+글자 굵게, 비활성 muted+hover 배경.
export const tabBarCls = "overflow-x-auto border-b border-line";
export const tabNavCls = "flex min-w-max gap-1";
export function tabItemCls(active: boolean): string {
  return `relative -mb-px whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy ${
    active
      ? "border-navy font-bold text-navy"
      : "border-transparent font-semibold text-ink-muted hover:bg-surface hover:text-ink"
  }`;
}

// --- 배지 ---
const badgeBase =
  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold";
export const badgeSuccess = `${badgeBase} bg-success-soft text-success`;
export const badgeNeutral = `${badgeBase} bg-surface text-ink-muted`;
export const badgeWarning = `${badgeBase} bg-warning-soft text-warning`;
export const badgeNavy = `${badgeBase} bg-navy-soft text-navy`;
export const badgeDanger = `${badgeBase} bg-stamp-soft text-stamp`;

// --- 알림 메시지 ---
export const noticeError =
  "rounded-lg bg-stamp-soft px-3 py-2 text-xs text-stamp";
export const noticeSuccess =
  "rounded-lg bg-success-soft px-3 py-2 text-xs text-success";
export const noticeWarning =
  "rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning";

// --- 채용 분야 뱃지 ---
//   하나의 field 문자열에 여러 분야가 콤마(,) / 슬래시(/) / 세미콜론(;) 으로
//   구분되어 들어올 수 있습니다. 순서대로 4색(로고 색상)이 자동 배정됩니다.
export function splitRecruitmentFields(field: string | null | undefined): string[] {
  if (!field) return [];
  return field
    .split(/[,/;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const FIELD_BADGE_COLORS = [
  "bg-brand-blue-soft text-brand-blue",
  "bg-brand-green/15 text-brand-green",
  "bg-brand-yellow/25 text-amber-800",
  "bg-stamp-soft text-stamp",
] as const;

// 1번째→파랑, 2번째→초록, 3번째→노랑, 4번째 이상→빨강(클램프).
export function fieldBadgeCls(index: number): string {
  const i = Math.max(0, Math.min(index, FIELD_BADGE_COLORS.length - 1));
  return `inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold sm:text-xs ${FIELD_BADGE_COLORS[i]}`;
}
