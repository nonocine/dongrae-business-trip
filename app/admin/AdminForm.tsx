"use client";

import { useState, useTransition } from "react";
import { adminLogin } from "@/app/actions";

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
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-slate-700"
        >
          관리자 비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[color:var(--brand)] focus:outline-none focus:ring-1 focus:ring-[color:var(--brand)]"
        />
      </div>

      {error && (
        <p className="rounded-md bg-[color:var(--accent-soft)] px-3 py-2 text-sm text-[color:var(--accent)]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-[color:var(--brand)] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[color:var(--brand-strong)] disabled:opacity-60"
      >
        {pending ? "확인 중…" : "로그인"}
      </button>
      <p className="text-xs text-slate-500">
        관리자 로그인 시 출장 목록 전체 조회, 직원 등록/관리, 통계, 엑셀 다운로드, 출장일지 삭제가 가능합니다.
      </p>
    </form>
  );
}
