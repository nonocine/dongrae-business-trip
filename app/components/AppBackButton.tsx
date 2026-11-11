"use client";

// =====================================================================
// 앱(PWA) 모드 뒤로가기 버튼 — 설치형 앱(standalone·minimal-ui)에는 브라우저 뒤로가기가 없어서.
//   * 보이는 조건은 CSS 가 정합니다(app/globals.css 의 .app-back-btn):
//     @media (display-mode: standalone / minimal-ui) 이거나, iOS 홈 화면 앱(navigator.standalone)일 때
//     <html class="ios-standalone"> 을 달아 보이게 합니다. 브라우저 탭에서는 숨김.
//   * 누르면 router.back(). 이 앱 안에서 이동한 기록이 없으면(첫 화면으로 바로 들어옴) 홈(/)으로.
//   * 홈(/)에서는 그리지 않습니다. 터치 영역 44px, aria-label "뒤로".
//   ⚠️ manifest 의 display 값은 건드리지 않습니다(이미 설치한 앱이 달라지지 않게).
// =====================================================================

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

const NAV_KEY = "dongup-app-nav"; // 이 탭(세션)에서 앱 안 이동이 있었는지

export default function AppBackButton() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const first = useRef<string | null>(null);

  // iOS 홈 화면 앱 — display-mode 미디어쿼리가 없는 옛 iOS 를 위해 클래스로 표시.
  useEffect(() => {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    if (nav.standalone === true) document.documentElement.classList.add("ios-standalone");
  }, []);

  // 처음 들어온 주소와 다른 곳으로 옮겨 가면 '앱 안 이동 있음'으로 기록합니다.
  useEffect(() => {
    if (first.current == null) {
      first.current = pathname;
      return;
    }
    if (pathname !== first.current) {
      try {
        sessionStorage.setItem(NAV_KEY, "1");
      } catch {
        // 저장소를 못 쓰면 history.length 로만 판단합니다.
      }
    }
  }, [pathname]);

  if (pathname === "/") return null;

  function goBack() {
    let moved = false;
    try {
      moved = sessionStorage.getItem(NAV_KEY) === "1";
    } catch {
      moved = false;
    }
    if (moved && window.history.length > 1) router.back();
    else router.push("/");
  }

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label="뒤로"
      title="뒤로"
      className="app-back-btn -ml-1 h-11 w-11 shrink-0 items-center justify-center rounded-md text-xl leading-none text-ink-muted hover:bg-surface active:bg-navy-soft"
    >
      <span aria-hidden>←</span>
    </button>
  );
}
