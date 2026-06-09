"use client";

import { useState, useTransition } from "react";
import { loginEmployee } from "@/app/actions";
import {
  cardCls,
  inputCls,
  labelCls,
  btnPrimary,
  noticeError,
} from "@/lib/ui";

export default function LoginForm({ employees }: { employees: string[] }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // 로그인 시점엔 직급(rank)을 모르므로 길이만 확인합니다.
  // 일반 직원은 4자리 숫자, 관장·부장은 영문 포함 6자 이상 — 둘 다 허용.
  const passwordValid = password.length >= 4;

  return (
    <div className="space-y-5">
      <div className="text-center">
        <p className="text-xs font-semibold tracking-wide text-navy">
          동래구청소년센터
        </p>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-ink">
          동업자씨 로그인
        </h2>
      </div>

      <section className={cardCls}>
        <h3 className="text-sm font-semibold text-ink">👤 직원 로그인</h3>
        <p className="mt-1 text-xs text-ink-muted">
          본인 이름을 선택해 로그인하세요.
        </p>

        {employees.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-line bg-surface p-4 text-center text-sm text-ink-body">
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
                setError("비밀번호를 입력해주세요.");
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
              <label className={labelCls}>이름</label>
              <select
                name="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className={inputCls}
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
              <label className={labelCls}>비밀번호</label>
              <input
                name="password"
                type="password"
                maxLength={64}
                required
                autoComplete="current-password"
                placeholder="비밀번호를 입력하세요"
                value={password}
                onChange={(e) => setPassword(e.target.value.slice(0, 64))}
                className={`${inputCls} font-mono`}
              />
            </div>
            {error && <p className={noticeError}>{error}</p>}
            <button
              type="submit"
              disabled={pending}
              className={`${btnPrimary} w-full`}
            >
              {pending ? "로그인 중…" : "로그인"}
            </button>
          </form>
        )}
      </section>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-line" />
        <span className="text-xs text-ink-hint">또는</span>
        <div className="h-px flex-1 bg-line" />
      </div>

      {/* 구글 워크스페이스 로그인 — onnainna.kr 계정 전용(서버에서 도메인 검증) */}
      <a
        href="/api/auth/google/login?next=/hr"
        className="flex items-center justify-center gap-2 rounded-xl border border-line bg-card px-4 py-3 text-sm font-semibold text-ink shadow-sm transition hover:bg-surface"
      >
        <span
          aria-hidden
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-navy text-xs font-bold text-white"
        >
          G
        </span>
        구글 워크스페이스로 로그인
      </a>
      <p className="-mt-3 text-center text-[11px] text-ink-hint">
        @onnainna.kr 계정만 가능합니다.
      </p>
    </div>
  );
}
