"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { loginDriver } from "@/app/actions";

const labelCls = "block text-sm font-medium text-slate-700";
const inputCls =
  "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[color:var(--brand)] focus:outline-none focus:ring-1 focus:ring-[color:var(--brand)]";

export default function LoginForm({ driverNames }: { driverNames: string[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (driverNames.length === 0) {
    return (
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm">
        <p className="text-sm text-slate-700">등록된 운전자가 없습니다.</p>
        <p className="text-xs text-slate-500">
          관리자에게 운전자 등록을 요청해주세요.
        </p>
        <Link
          href="/admin/login"
          className="mt-2 inline-block rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          관리자 로그인
        </Link>
      </div>
    );
  }

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const res = await loginDriver(formData);
          if (!res.ok) {
            setError(res.message);
            return;
          }
          window.location.href = "/";
        });
      }}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div>
        <label htmlFor="name" className={labelCls}>
          이름
        </label>
        <select
          id="name"
          name="name"
          required
          defaultValue=""
          autoFocus
          className={inputCls}
        >
          <option value="" disabled>
            운전자를 선택해주세요
          </option>
          {driverNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="password" className={labelCls}>
          비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={inputCls}
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
        목록에 본인 이름이 없다면 관리자에게 등록을 요청해주세요.
      </p>
    </form>
  );
}
