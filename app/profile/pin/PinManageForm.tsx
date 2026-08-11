"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPin, clearPin } from "@/app/auth/pinActions";
import { PIN_LENGTH, isValidPinFormat } from "@/lib/pin";
import { cardCls, btnPrimary, noticeError, noticeSuccess } from "@/lib/ui";

// PIN 설정/변경/해제 폼 — 6자리 2회 입력(확인).
export default function PinManageForm({ isSet }: { isSet: boolean }) {
  const router = useRouter();
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, PIN_LENGTH);

  function save() {
    setError(null);
    setOk(null);
    if (!isValidPinFormat(pin1)) {
      setError(`PIN 은 숫자 ${PIN_LENGTH}자리여야 합니다.`);
      return;
    }
    if (pin1 !== pin2) {
      setError("두 번 입력한 PIN 이 서로 다릅니다.");
      return;
    }
    startTransition(async () => {
      const res = await setPin(pin1);
      if (res.ok) {
        setPin1("");
        setPin2("");
        setOk("PIN 이 저장되었습니다.");
        router.refresh();
      } else {
        setError(res.message);
      }
    });
  }

  function remove() {
    if (!confirm("PIN 을 해제하면 다음부터 구글 로그인으로만 진입합니다. 해제할까요?")) {
      return;
    }
    setError(null);
    setOk(null);
    startTransition(async () => {
      const res = await clearPin();
      if (res.ok) {
        setOk("PIN 이 해제되었습니다.");
        router.refresh();
      } else {
        setError(res.message);
      }
    });
  }

  const inputCls =
    "mt-1 block w-full rounded-md border border-line bg-card px-3 py-2 text-center font-mono text-xl tracking-[0.4em] text-ink-body shadow-sm placeholder:tracking-normal placeholder:text-ink-hint focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue";

  return (
    <div className={`space-y-4 ${cardCls}`}>
      {ok && <p className={noticeSuccess}>{ok}</p>}
      {error && <p className={noticeError}>{error}</p>}

      <div>
        <label htmlFor="pin1" className="block text-sm font-medium text-ink-body">
          {isSet ? "새 PIN" : "PIN"} ({PIN_LENGTH}자리 숫자)
        </label>
        <input
          id="pin1"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={PIN_LENGTH}
          value={pin1}
          onChange={(e) => setPin1(onlyDigits(e.target.value))}
          placeholder="••••••"
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor="pin2" className="block text-sm font-medium text-ink-body">
          PIN 확인
        </label>
        <input
          id="pin2"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={PIN_LENGTH}
          value={pin2}
          onChange={(e) => setPin2(onlyDigits(e.target.value))}
          placeholder="••••••"
          className={inputCls}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className={btnPrimary}
        >
          {pending ? "저장 중…" : isSet ? "PIN 변경" : "PIN 설정"}
        </button>
        {isSet && (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="rounded-lg border border-stamp bg-card px-4 py-2 text-sm font-medium text-stamp transition hover:bg-stamp-soft disabled:opacity-60"
          >
            PIN 해제
          </button>
        )}
      </div>

      <p className="text-xs text-ink-muted">
        생일·전화번호처럼 추측하기 쉬운 숫자는 피해주세요. PIN 을 5회 틀리면
        잠기며, 구글 로그인으로 다시 들어오면 자동으로 풀립니다.
      </p>
    </div>
  );
}
