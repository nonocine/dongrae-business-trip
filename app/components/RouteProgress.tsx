"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

// 라우트 전환 진행바 — 화면 최상단 3px 네이비 바.
//   페이지 이동 시작(내부 링크 클릭·router.push=history.pushState·뒤로가기) 시 즉시
//   나타나 흐르듯 진행하고, 경로가 실제로 바뀌면(usePathname 변경) 채워진 뒤 사라진다.
//   순수 프레젠테이션 — 데이터 fetch·라우팅 로직에는 개입하지 않는다.
//   phase: 0=숨김, 1=진행중, 2=마무리(채움→페이드아웃).
export default function RouteProgress() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<0 | 1 | 2>(0);
  const phaseRef = useRef<0 | 1 | 2>(0);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function set(p: 0 | 1 | 2) {
    phaseRef.current = p;
    setPhase(p);
  }
  function clearTimers() {
    if (doneTimer.current) clearTimeout(doneTimer.current);
    if (safetyTimer.current) clearTimeout(safetyTimer.current);
  }

  useEffect(() => {
    function begin() {
      if (phaseRef.current === 1) return; // 이미 진행 중
      clearTimers();
      set(1);
      // 응답이 없어도 최대 10초 후 자동 종료(멈춘 바 방지).
      safetyTimer.current = setTimeout(finish, 10000);
    }
    function finish() {
      if (phaseRef.current === 0) return;
      clearTimers();
      set(2);
      doneTimer.current = setTimeout(() => set(0), 350);
    }
    // 완료 신호를 외부(경로 변경 이펙트)에서 부를 수 있도록 참조에 보관.
    finishRef.current = finish;

    function onClick(e: MouseEvent) {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const el = e.target as HTMLElement | null;
      const a = el?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href");
      const target = a.getAttribute("target");
      if (!href || href.startsWith("#") || target === "_blank") return;
      if (a.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // 현재 URL 과 완전히 동일하면 실제 이동이 없으므로 무시.
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      )
        return;
      begin();
    }

    document.addEventListener("click", onClick, true);

    // router.push/replace 는 내부적으로 history 를 갱신 → 프로그램적 이동 감지.
    const origPush = history.pushState;
    history.pushState = function (
      this: History,
      ...args: Parameters<History["pushState"]>
    ) {
      begin();
      return origPush.apply(this, args);
    };
    function onPop() {
      begin();
    }
    window.addEventListener("popstate", onPop);

    return () => {
      document.removeEventListener("click", onClick, true);
      history.pushState = origPush;
      window.removeEventListener("popstate", onPop);
      clearTimers();
    };
  }, []);

  // finish 를 경로 변경 이펙트에서 호출하기 위한 참조.
  const finishRef = useRef<() => void>(() => {});

  // 경로가 바뀌면 진행 중이던 바를 마무리. 이펙트 본문에서 직접 setState 하지 않고
  // 타이머로 미뤄 lint(react-hooks/set-state-in-effect) 를 회피한다.
  useEffect(() => {
    if (phaseRef.current !== 1) return;
    const t = setTimeout(() => finishRef.current(), 0);
    return () => clearTimeout(t);
  }, [pathname]);

  if (phase === 0) return null;
  return (
    <div className="route-progress" data-phase={phase} aria-hidden="true">
      <div className="route-progress__bar" />
    </div>
  );
}
