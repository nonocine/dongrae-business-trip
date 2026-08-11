"use client";

import { useState, useTransition } from "react";
import { verifyPinAndSignIn } from "@/app/auth/pinActions";
import { PIN_LENGTH } from "@/lib/pin";

// =====================================================================
// PIN 간편입력 — 신뢰 등록된 기기에서만 노출되는 재진입 UI.
//   * 서버 액션 verifyPinAndSignIn 이 신뢰 기기 쿠키와 PIN 을 모두 검증해야
//     세션이 발급됩니다. 이 컴포넌트는 입력만 담당합니다.
//   * lib/pin.ts 는 순수 모듈이라 클라이언트에서 안전하게 import 됩니다.
// =====================================================================

export default function PinEntry({
  name,
  next = "/",
}: {
  name: string | null;
  next?: string;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [pending, startTransition] = useTransition();

  const googleHref = `/api/auth/google/login?next=${encodeURIComponent(next)}`;

  function submit(value: string) {
    setError(null);
    startTransition(async () => {
      const res = await verifyPinAndSignIn(value);
      if (res.ok) {
        // 세션 쿠키가 새로 발급됐으므로 전체 새로고침으로 진입합니다.
        window.location.href = next;
        return;
      }
      setPin("");
      setError(res.message);
      if (res.reason === "locked" || res.reason === "untrusted") setLocked(true);
    });
  }

  function onChange(raw: string) {
    // 숫자만, 최대 6자리.
    const digits = raw.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(digits);
    if (digits.length === PIN_LENGTH && !pending && !locked) submit(digits);
  }

  return (
    <div className="rounded-2xl bg-white/10 p-5 ring-1 ring-white/15 backdrop-blur-sm">
      <p className="text-center text-sm font-semibold text-white">
        {name ? `${name} 님, 다시 오셨네요` : "PIN 으로 빠른 로그인"}
      </p>
      <p className="mt-1 text-center text-xs text-white/60">
        {locked ? "구글 로그인으로 진행해주세요" : "PIN 6자리를 입력하세요"}
      </p>

      <label htmlFor="pin" className="sr-only">
        PIN 6자리
      </label>
      <input
        id="pin"
        name="pin"
        type="password"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d*"
        maxLength={PIN_LENGTH}
        value={pin}
        disabled={pending || locked}
        onChange={(e) => onChange(e.target.value)}
        placeholder="••••••"
        aria-invalid={!!error}
        className="mt-4 block w-full rounded-xl border-0 bg-white/95 px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] text-ink shadow-inner placeholder:text-ink-hint focus:outline-none focus:ring-2 focus:ring-white/70 disabled:opacity-60"
      />

      {/* 입력 진행 표시 — 6칸 점 */}
      <div className="mt-3 flex justify-center gap-2" aria-hidden>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 w-6 rounded-full transition ${
              i < pin.length ? "bg-white" : "bg-white/25"
            }`}
          />
        ))}
      </div>

      {pending && (
        <p className="mt-3 text-center text-xs text-white/70">확인 중…</p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-center text-xs font-medium text-[#ffb4b4]">
          {error}
        </p>
      )}

      {/* 탈출구 — PIN 을 못 쓰는 상황에서 항상 구글 로그인으로 갈 수 있어야 합니다. */}
      <a
        href={googleHref}
        className="mt-4 block text-center text-xs font-medium text-white/70 underline underline-offset-4 hover:text-white"
      >
        구글 로그인으로 전환
      </a>
    </div>
  );
}
