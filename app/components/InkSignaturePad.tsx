"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

// =====================================================================
// 손글씨 서명 패드(투명 배경·여백 잘라냄) — 동래샘들 components/SignaturePad
//   (근무일지 서명 245건으로 검증된 패턴)를 그대로 옮겼습니다.
//   * 논리 400x150 고정 좌표 → 작은 폰에서 CSS 로 줄어도 획이 안 어긋남.
//   * Pointer Events 하나로 손가락·마우스·펜. touch-none 필수(그리는 중 스크롤 방지).
//   * 배경 투명 — PDF 의 '(인)' 위에 겹칠 때 흰 사각형이 글자를 덮지 않게.
//   * 내보낼 때 획의 바운딩 박스로 잘라 base64 크기도 줄입니다.
//   ※ 기존 app/components/SignaturePad(흰 배경, 면접·지원서용)는 그대로 둡니다.
// =====================================================================

const PAD_W = 400;
const PAD_H = 150;
const TRIM_PAD = 6;
const STROKE = "#1a1a1a";
const LINE_W = 2.4;

function applyStrokeStyle(ctx: CanvasRenderingContext2D) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = LINE_W;
}

export default function InkSignaturePad({
  onChange,
}: {
  onChange: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const dprRef = useRef(1);
  const boxRef = useRef({ minX: PAD_W, minY: PAD_H, maxX: 0, maxY: 0 });
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    canvas.width = Math.round(PAD_W * dpr);
    canvas.height = Math.round(PAD_H * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    applyStrokeStyle(ctx);
  }, []);

  function pointerPos(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - rect.left) * PAD_W) / rect.width,
      y: ((e.clientY - rect.top) * PAD_H) / rect.height,
    };
  }

  function grow(x: number, y: number) {
    const b = boxRef.current;
    if (x < b.minX) b.minX = x;
    if (y < b.minY) b.minY = y;
    if (x > b.maxX) b.maxX = x;
    if (y > b.maxY) b.maxY = y;
  }

  const exportTrimmed = useCallback((): string | null => {
    const canvas = canvasRef.current;
    const b = boxRef.current;
    if (!canvas || b.minX > b.maxX) return null;
    const dpr = dprRef.current;
    const left = Math.max(0, b.minX - TRIM_PAD);
    const top = Math.max(0, b.minY - TRIM_PAD);
    const right = Math.min(PAD_W, b.maxX + TRIM_PAD);
    const bottom = Math.min(PAD_H, b.maxY + TRIM_PAD);
    const sx = Math.floor(left * dpr);
    const sy = Math.floor(top * dpr);
    const sw = Math.max(1, Math.ceil((right - left) * dpr));
    const sh = Math.max(1, Math.ceil((bottom - top) * dpr));
    const out = document.createElement("canvas");
    out.width = sw;
    out.height = sh;
    const octx = out.getContext("2d");
    if (!octx) return canvas.toDataURL("image/png");
    octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return out.toDataURL("image/png");
  }, []);

  function start(e: ReactPointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const { x, y } = pointerPos(e);
    grow(x, y);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInk) setHasInk(true);
  }

  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    grow(x, y);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* 이미 해제됨 */
    }
    onChange(exportTrimmed());
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = dprRef.current;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    applyStrokeStyle(ctx);
    boxRef.current = { minX: PAD_W, minY: PAD_H, maxX: 0, maxY: 0 };
    setHasInk(false);
    onChange(null);
  }

  return (
    <div>
      <div className="overflow-hidden rounded-lg border-2 border-dashed border-rule bg-white">
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          aria-label="서명 입력 영역"
          data-testid="signature-canvas"
          className="block w-full touch-none"
          style={{ aspectRatio: `${PAD_W} / ${PAD_H}` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          {hasInk ? "✓ 서명이 그려졌습니다" : "위 칸에 손가락이나 마우스로 서명해주세요"}
        </p>
        <button
          type="button"
          onClick={clear}
          disabled={!hasInk}
          className="rounded-md border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink-body hover:bg-surface disabled:opacity-50"
        >
          지우기
        </button>
      </div>
    </div>
  );
}

// 서명 미리보기 — 투명 PNG 라 흰 바탕을 깔아줍니다.
export function SignaturePreview({ src, alt = "서명" }: { src: string; alt?: string }) {
  return (
    <div className="flex justify-center rounded-lg border border-rule bg-white p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="h-16 w-auto max-w-full" />
    </div>
  );
}
