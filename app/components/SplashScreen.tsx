"use client";

import { useEffect, useState } from "react";

// =====================================================================
// 스플래시 — 앱 최초 로드 시 1.5초 전체화면. 세션당 1회(sessionStorage).
//   * 서버/클라 모두 기본 "show" 로 렌더해 콘텐츠 깜빡임 없이 즉시 덮습니다.
//     (sessionStorage 는 클라 전용이라 effect 에서 '본 세션'이면 즉시 제거)
//   * 라이브러리 없이 CSS keyframe 애니메이션만 사용.
// =====================================================================

const SEEN_KEY = "dongrae_splash_seen";
// 파 → 빨 → 노 → 초 (로고 색상)
const STRIP = ["#2563eb", "#e84040", "#f0c030", "#3ab54a"];

type Phase = "show" | "hide" | "done";

export default function SplashScreen() {
  const [phase, setPhase] = useState<Phase>("show");

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      // sessionStorage 접근 불가(프라이빗 모드 등) — 그냥 1회 표시.
    }
    // 이미 본 세션이면 즉시 제거(0ms 타이머로 — effect 내 동기 setState 회피).
    if (seen) {
      const t = setTimeout(() => setPhase("done"), 0);
      return () => clearTimeout(t);
    }
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* noop */
    }
    const t1 = setTimeout(() => setPhase("hide"), 1500);
    const t2 = setTimeout(() => setPhase("done"), 1950); // 1500 + 450 페이드
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (phase === "done") return null;

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden transition-opacity duration-[450ms] ease-out"
      style={{
        backgroundColor: "#0f2644",
        opacity: phase === "hide" ? 0 : 1,
        pointerEvents: phase === "hide" ? "none" : "auto",
      }}
    >
      {/* 은은한 글로우 */}
      <div
        className="pointer-events-none absolute -top-1/4 left-1/2 h-[120vmin] w-[120vmin] -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(37,99,235,0.22) 0%, rgba(15,38,68,0) 60%)",
        }}
      />

      <div className="relative flex flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icon-192.png"
          alt="동업자씨"
          className="splash-pop h-24 w-24 rounded-[22px] shadow-2xl sm:h-28 sm:w-28"
        />
        <h1
          className="splash-up mt-6 text-3xl font-extrabold tracking-tight text-white sm:text-4xl"
          style={{ animationDelay: "0.15s" }}
        >
          동업자씨
        </h1>
        <p
          className="splash-up mt-2 text-sm font-medium tracking-[0.18em] text-[#7aa8d0]"
          style={{ animationDelay: "0.3s" }}
        >
          동래구청소년센터
        </p>

        {/* 로딩 점 */}
        <div
          className="splash-up mt-7 flex items-center gap-2"
          style={{ animationDelay: "0.45s" }}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="splash-dot h-2 w-2 rounded-full bg-white/70"
              style={{ animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </div>
      </div>

      {/* 하단 4색 스트립 — 순차 fade-in */}
      <div className="absolute bottom-0 left-0 flex h-2.5 w-full">
        {STRIP.map((c, i) => (
          <span
            key={c}
            className="splash-bar h-full flex-1 origin-left"
            style={{ backgroundColor: c, animationDelay: `${0.3 + i * 0.15}s` }}
          />
        ))}
      </div>

      <style>{`
        @keyframes splashPop {
          from { opacity: 0; transform: scale(0.86); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes splashUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes splashDot {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        @keyframes splashBar {
          from { opacity: 0; transform: scaleX(0); }
          to { opacity: 1; transform: scaleX(1); }
        }
        .splash-pop { animation: splashPop 0.5s ease-out both; }
        .splash-up { animation: splashUp 0.5s ease-out both; }
        .splash-dot { animation: splashDot 1.2s ease-in-out infinite; }
        .splash-bar { animation: splashBar 0.45s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .splash-pop, .splash-up, .splash-dot, .splash-bar { animation: none; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
