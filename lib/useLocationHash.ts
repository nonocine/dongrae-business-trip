"use client";

// =====================================================================
// 지금 주소의 해시(#...)를 구독 — 사이드바·드로어의 선택 표시용.
//   ★ Next 의 <Link> 는 같은 페이지 해시 이동을 history.pushState 로 처리해
//     브라우저가 hashchange 를 쏘지 않습니다. 그래서 같은 페이지 해시 링크는
//     goToHash() 로 직접 옮기고 hashchange 를 대신 쏩니다(MyHrTabs 도 이 이벤트를 듣습니다).
// =====================================================================

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function useLocationHash(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => "",
  );
}

export function notifyHashChange() {
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

// 같은 경로 + 해시만 다른 링크면 직접 옮기고 true. 아니면 false(그대로 <Link> 에 맡김).
export function goToHash(href: string, pathname: string): boolean {
  const i = href.indexOf("#");
  if (i < 0) return false;
  const path = href.slice(0, i) || pathname;
  if (path !== pathname || href.includes("?")) return false;
  window.history.pushState(null, "", href);
  notifyHashChange();
  return true;
}
