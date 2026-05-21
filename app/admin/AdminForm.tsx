"use client";

import { useState, useTransition } from "react";
import { adminLogin } from "@/app/actions";
import { cardCls, inputCls, btnPrimary, noticeError } from "@/lib/ui";

export default function AdminForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          try {
            const res = await adminLogin(formData);
            if (res && !res.ok) setError(res.message);
          } catch (e) {
            const msg =
              e instanceof Error ? e.message : "로그인 중 오류가 발생했습니다.";
            if (msg.includes("NEXT_REDIRECT")) throw e;
            setError(msg);
          }
        });
      }}
      className={`space-y-4 ${cardCls}`}
    >
      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-ink-body"
        >
          관리자 비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          className={inputCls}
        />
      </div>

      {error && <p className={noticeError}>{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className={`${btnPrimary} w-full`}
      >
        {pending ? "확인 중…" : "로그인"}
      </button>
      <p className="text-xs text-ink-muted">
        관리자 로그인 시 출장 목록 전체 조회, 직원 등록/관리, 통계, 엑셀 다운로드, 출장일지 삭제가 가능합니다.
      </p>
    </form>
  );
}
