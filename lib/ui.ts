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
export const btnPrimary =
  "inline-flex h-[38px] items-center justify-center gap-1.5 rounded-lg bg-navy px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-strong disabled:opacity-60";
export const btnSecondary =
  "inline-flex h-[38px] items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-4 text-sm font-medium text-ink-body shadow-sm transition hover:bg-surface disabled:opacity-60";
export const btnDanger =
  "inline-flex h-[38px] items-center justify-center gap-1.5 rounded-lg border border-stamp bg-card px-4 text-sm font-semibold text-stamp transition hover:bg-stamp-soft disabled:opacity-60";

// --- 탭 ---
export const tabBarCls = "overflow-x-auto border-b border-line";
export const tabNavCls = "flex min-w-max gap-1";
export function tabItemCls(active: boolean): string {
  return `relative -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition ${
    active
      ? "border-navy text-navy"
      : "border-transparent text-ink-muted hover:text-ink"
  }`;
}

// --- 배지 ---
const badgeBase =
  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold";
export const badgeSuccess = `${badgeBase} bg-success-soft text-success`;
export const badgeNeutral = `${badgeBase} bg-surface text-ink-muted`;
export const badgeWarning = `${badgeBase} bg-warning-soft text-warning`;
export const badgeNavy = `${badgeBase} bg-navy-soft text-navy`;

// --- 알림 메시지 ---
export const noticeError =
  "rounded-lg bg-stamp-soft px-3 py-2 text-xs text-stamp";
export const noticeSuccess =
  "rounded-lg bg-success-soft px-3 py-2 text-xs text-success";
export const noticeWarning =
  "rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning";
