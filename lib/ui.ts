// 디자인 시스템 공통 클래스 — globals.css 의 토큰(navy/ink/line/…)을 사용합니다.
// 각 컴포넌트가 클래스 문자열을 중복 정의하지 않도록 이 모듈에서 통합합니다.

// --- 카드 ---
export const cardCls =
  "rounded-xl border border-line bg-card p-4 shadow-sm sm:p-5";

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
