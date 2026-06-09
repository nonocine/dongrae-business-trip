"use client";

import { useEffect, useState } from "react";

// =====================================================================
// 메인 관문 첫 진입 인트로 — "쌓인 서류가 스마트폰으로 빨려 들어가 정리되고,
//   폰 화면에 동업자씨 로고가 뿅" → 페이드아웃 → 관문 노출.
//   * 라이브러리 없이 CSS/SVG 키프레임만 사용. 약 1.9초.
//   * 매 진입마다 표시(간단히). prefers-reduced-motion 이면 즉시 생략.
//   * 배경은 관문과 동일한 네이비 그라데이션으로 자연스럽게 이어짐.
// =====================================================================

// 서류 — 로고 4색 상단 바. 폰 위쪽에서 부채꼴로 시작해 폰으로 빨려 들어감.
const PAPERS = [
  { color: "#e84040", sx: "-54px", sy: "-60px", sr: "-16deg", delay: "0s" },
  { color: "#3ab54a", sx: "-18px", sy: "-74px", sr: "-5deg", delay: "0.12s" },
  { color: "#2f7be0", sx: "18px", sy: "-74px", sr: "5deg", delay: "0.24s" },
  { color: "#f0c030", sx: "54px", sy: "-60px", sr: "16deg", delay: "0.36s" },
] as const;

type Phase = "play" | "out" | "done";

export default function GateIntro() {
  const [phase, setPhase] = useState<Phase>("play");

  useEffect(() => {
    // 모션 최소화 설정이면 인트로 생략.
    let reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      /* matchMedia 미지원 — 그냥 재생 */
    }
    if (reduced) {
      const t = setTimeout(() => setPhase("done"), 0);
      return () => clearTimeout(t);
    }
    const t1 = setTimeout(() => setPhase("out"), 1500);
    const t2 = setTimeout(() => setPhase("done"), 1900);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (phase === "done") return null;

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-hidden transition-opacity duration-[400ms] ease-out"
      style={{
        background:
          "linear-gradient(160deg, #0f2547 0%, #16314f 50%, #1a3a5c 100%)",
        opacity: phase === "out" ? 0 : 1,
        pointerEvents: phase === "out" ? "none" : "auto",
      }}
    >
      <div className="relative h-56 w-56">
        {/* 스마트폰 — 중앙 고정(transform 미사용: 애니메이션 충돌 방지) */}
        <div className="absolute left-1/2 top-1/2 -ml-9 -mt-16 h-32 w-[72px] rounded-[16px] bg-[#0b1d36] shadow-2xl ring-2 ring-white/25">
          {/* 노치 */}
          <span className="absolute left-1/2 top-2 h-1 w-6 -translate-x-1/2 rounded-full bg-white/30" />
          {/* 화면 */}
          <div className="absolute inset-x-2 inset-y-4 flex items-center justify-center overflow-hidden rounded-[9px] bg-gradient-to-b from-[#1a3a5c] to-[#0f2547]">
            {/* 폰 화면에 뿅 뜨는 4색 로고 마크 */}
            <div className="gi-logo grid grid-cols-2 gap-1">
              <span className="h-4 w-4 rounded-[4px]" style={{ backgroundColor: "#2f7be0" }} />
              <span className="h-4 w-4 rounded-[4px]" style={{ backgroundColor: "#e84040" }} />
              <span className="h-4 w-4 rounded-[4px]" style={{ backgroundColor: "#f0c030" }} />
              <span className="h-4 w-4 rounded-[4px]" style={{ backgroundColor: "#3ab54a" }} />
            </div>
          </div>
        </div>

        {/* 서류들 — 폰으로 빨려 들어감 */}
        {PAPERS.map((p, i) => (
          <span
            key={i}
            className="gi-paper absolute left-1/2 top-1/2 -ml-[22px] -mt-7 h-14 w-11 rounded-[5px] bg-white shadow-lg"
            style={
              {
                "--sx": p.sx,
                "--sy": p.sy,
                "--sr": p.sr,
                animationDelay: p.delay,
              } as React.CSSProperties
            }
          >
            <span
              className="absolute inset-x-1.5 top-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: p.color }}
            />
            <span className="absolute inset-x-1.5 top-4 h-0.5 rounded bg-slate-300" />
            <span className="absolute inset-x-1.5 top-[22px] h-0.5 rounded bg-slate-300" />
            <span className="absolute inset-x-1.5 top-[30px] h-0.5 w-1/2 rounded bg-slate-300" />
          </span>
        ))}
      </div>

      <style>{`
        @keyframes giSuck {
          0%   { opacity: 0; transform: translate(var(--sx), var(--sy)) rotate(var(--sr)) scale(1); }
          18%  { opacity: 1; transform: translate(var(--sx), var(--sy)) rotate(var(--sr)) scale(1); }
          100% { opacity: 0; transform: translate(0px, 6px) rotate(0deg) scale(0.12); }
        }
        @keyframes giPop {
          0%   { opacity: 0; transform: scale(0.3); }
          60%  { opacity: 1; transform: scale(1.15); }
          100% { opacity: 1; transform: scale(1); }
        }
        .gi-paper { animation: giSuck 0.7s cubic-bezier(0.55, 0.06, 0.9, 0.28) both; }
        .gi-logo  { animation: giPop 0.45s ease-out both; animation-delay: 1.05s; }
        @media (prefers-reduced-motion: reduce) {
          .gi-paper, .gi-logo { animation: none; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
