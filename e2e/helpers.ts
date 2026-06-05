import type { Page } from "@playwright/test";

// 콘솔 에러 / 미처리 예외를 수집 — 하이드레이션·런타임 회귀를 브라우저 레벨에서 감지.
//   dev 모드의 리소스 404 등 잡음은 제외하고 React 경고/하이드레이션만 실패로 본다.
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    if (/hydrat|Minified React|Warning:/i.test(t)) errors.push("console: " + t);
  });
  return errors;
}
