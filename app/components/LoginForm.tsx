"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { loginEmployee } from "@/app/actions";

export default function LoginForm({ employees }: { employees: string[] }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const passwordValid = /^\d{4}$/.test(password);

  return (
    <div className="space-y-5">
      <div className="text-center">
        <p className="text-xs font-medium text-[color:var(--brand)]">
          동래구청소년센터
        </p>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900">
          출장일지 로그인
        </h2>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">
          👤 직원 로그인
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          본인 이름을 선택해 로그인하세요.
        </p>

        {employees.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-600">
            등록된 직원이 없습니다.
            <br />
            관리자에게 직원 등록을 요청해주세요.
          </div>
        ) : (
          <form
            action={(formData) => {
              setError(null);
              if (!name) {
                setError("직원을 선택해주세요.");
                return;
              }
              if (!passwordValid) {
                setError("4자리 숫자 비밀번호를 입력해주세요.");
                return;
              }
              startTransition(async () => {
                try {
                  const res = await loginEmployee(formData);
                  if (res && !res.ok) setError(res.message);
                } catch (e) {
                  const msg =
                    e instanceof Error
                      ? e.message
                      : "로그인 중 오류가 발생했습니다.";
                  if (msg.includes("NEXT_REDIRECT")) throw e;
                  setError(msg);
                }
              });
            }}
            className="mt-3 space-y-3"
          >
            <div>
              <label className="block text-xs font-medium text-slate-600">
                이름
              </label>
              <select
                name="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="" disabled>
                  직원을 선택해주세요
                </option>
                {employees.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">
                비밀번호 (4자리 숫자)
              </label>
              <input
                name="password"
                type="password"
                inputMode="numeric"
                maxLength={4}
                pattern="\d{4}"
                required
                autoComplete="current-password"
                placeholder="••••"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono tracking-[0.5em] shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-600 disabled:opacity-60"
            >
              {pending ? "로그인 중…" : "로그인"}
            </button>
          </form>
        )}
      </section>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs text-slate-400">또는</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <Link
        href="/admin/login"
        className="flex items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-700 hover:bg-violet-100"
      >
        <span aria-hidden>⚙</span>
        관리자 로그인
      </Link>
    </div>
  );
}
