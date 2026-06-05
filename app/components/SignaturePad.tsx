"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

// =====================================================================
// 손글씨 서명 패드 — 마우스/터치로 그려 PNG dataURL 반환.
//   * 면접 채점·지원서 동의 서명에서 공용으로 사용.
//   * value 가 있으면 "서명 완료" 표시, 지우기 버튼 제공.
// =====================================================================
export default function SignaturePad({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [dirty, setDirty] = useState(false);

  // 캔버스 크기 — 컨테이너 너비에 맞춰 1회 설정.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = 200;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 2.2;
    }
  }, []);

  function pointerPos(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: ReactPointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!dirty) setDirty(true);
  }

  function end(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      // 펜이 떨어진 시점에 base64 PNG 추출.
      onChange(canvas.toDataURL("image/png"));
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2.2;
    setDirty(false);
    onChange(null);
  }

  return (
    <div className="mt-1.5">
      <div className="rounded-xl border-2 border-line bg-white">
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          className="block w-full touch-none rounded-xl"
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <p className="text-xs text-ink-hint md:text-sm">
          {value ? "✓ 서명 완료" : "서명이 필요합니다"}
        </p>
        <button
          type="button"
          onClick={clear}
          className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface md:text-sm"
        >
          서명 지우기
        </button>
      </div>
    </div>
  );
}
