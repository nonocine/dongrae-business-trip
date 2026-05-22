"use client";

import { useMemo, useState, useTransition } from "react";
import { changePassword } from "@/app/actions";
import {
  validatePasswordStrength,
  HR_ADMIN_RANKS,
  type EmployeeRank,
} from "@/lib/supabase";
import { cardCls, labelCls, btnPrimary, noticeError } from "@/lib/ui";

// 비밀번호 입력칸 — 우측 표시/숨김 버튼 자리(pr-16) 확보.
const pwInputCls =
  "block w-full rounded-lg border border-line bg-card px-3 py-2 pr-16 text-sm font-mono text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";

// 비밀번호 강도 점수 — rank 정책에 맞춰 시각적 표시에 사용.
// 강도 막대 색은 약함→강함을 나타내는 기능적 색이라 그대로 유지합니다.
function scorePassword(
  pw: string,
  isHrAdmin: boolean
): { score: number; max: number; label: string; cls: string } {
  if (!pw) return { score: 0, max: isHrAdmin ? 4 : 1, label: "", cls: "" };

  if (!isHrAdmin) {
    const ok = /^\d{4}$/.test(pw);
    return ok
      ? { score: 1, max: 1, label: "사용 가능", cls: "bg-emerald-500" }
      : { score: 0, max: 1, label: "4자리 숫자가 필요합니다", cls: "bg-red-500" };
  }

  let s = 0;
  if (pw.length >= 6) s += 1;
  if (/[A-Za-z]/.test(pw)) s += 1;
  if (/\d/.test(pw)) s += 1;
  if (pw.length >= 10) s += 1;
  const table = [
    { label: "매우 약함", cls: "bg-red-500" },
    { label: "약함", cls: "bg-orange-500" },
    { label: "보통", cls: "bg-amber-500" },
    { label: "강함", cls: "bg-lime-500" },
    { label: "매우 강함", cls: "bg-emerald-500" },
  ];
  return { score: s, max: 4, label: table[s].label, cls: table[s].cls };
}

export default function ChangePasswordForm({
  name,
  rank,
  mustChange,
}: {
  name: string;
  rank: EmployeeRank | null;
  mustChange: boolean;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isHrAdmin =
    !!rank && (HR_ADMIN_RANKS as readonly string[]).includes(rank);

  const strength = useMemo(
    () => scorePassword(next, isHrAdmin),
    [next, isHrAdmin]
  );

  const policyText = isHrAdmin
    ? "관장·부장은 6자리 이상, 영문을 1자 이상 포함해야 합니다."
    : "4자리 숫자 비밀번호를 사용합니다.";

  const confirmMismatch = confirm.length > 0 && confirm !== next;

  return (
    <div className="space-y-4">
      {mustChange && (
        <div className="rounded-lg border border-warning bg-warning-soft px-3 py-2.5 text-sm text-warning">
          🔒 임시 비밀번호로 로그인했습니다. 계속하려면 먼저 새 비밀번호를
          설정해주세요.
        </div>
      )}

      <section className={cardCls}>
        <h3 className="text-sm font-semibold text-ink">
          {name} 님의 비밀번호 변경
        </h3>
        <p className="mt-1 text-xs text-ink-muted">{policyText}</p>

        <form
          action={(formData) => {
            setError(null);
            if (!current || !next) {
              setError("현재 비밀번호와 새 비밀번호를 모두 입력해주세요.");
              return;
            }
            if (next !== confirm) {
              setError("새 비밀번호 확인이 일치하지 않습니다.");
              return;
            }
            if (next === current) {
              setError("새 비밀번호가 기존 비밀번호와 동일합니다.");
              return;
            }
            const check = validatePasswordStrength(next, rank);
            if (!check.ok) {
              setError(check.error ?? "비밀번호 정책을 만족하지 않습니다.");
              return;
            }
            startTransition(async () => {
              try {
                await changePassword(formData);
              } catch (e) {
                const msg =
                  e instanceof Error
                    ? e.message
                    : "비밀번호 변경 중 오류가 발생했습니다.";
                // changePassword 성공 시 redirect — NEXT_REDIRECT는 다시 던짐
                if (msg.includes("NEXT_REDIRECT")) throw e;
                setError(msg);
              }
            });
          }}
          className="mt-4 space-y-3"
        >
          <div>
            <label className={labelCls}>현재 비밀번호</label>
            <div className="relative mt-1">
              <input
                name="current_password"
                type={showCurrent ? "text" : "password"}
                required
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value.slice(0, 64))}
                className={pwInputCls}
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-ink-muted hover:text-ink"
              >
                {showCurrent ? "숨김" : "표시"}
              </button>
            </div>
          </div>

          <div>
            <label className={labelCls}>새 비밀번호</label>
            <div className="relative mt-1">
              <input
                name="new_password"
                type={showNext ? "text" : "password"}
                required
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value.slice(0, 64))}
                className={pwInputCls}
              />
              <button
                type="button"
                onClick={() => setShowNext((v) => !v)}
                className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-ink-muted hover:text-ink"
              >
                {showNext ? "숨김" : "표시"}
              </button>
            </div>
            {next.length > 0 && (
              <div className="mt-1.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                  <div
                    className={`h-full rounded-full transition-all ${strength.cls}`}
                    style={{
                      width: `${Math.max(
                        8,
                        (strength.score / strength.max) * 100
                      )}%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-xs text-ink-muted">{strength.label}</p>
              </div>
            )}
          </div>

          <div>
            <label className={labelCls}>새 비밀번호 확인</label>
            <input
              name="confirm_password"
              type={showNext ? "text" : "password"}
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.slice(0, 64))}
              className={`mt-1 block w-full rounded-lg border bg-card px-3 py-2 text-sm font-mono text-ink-body shadow-sm focus:outline-none focus:ring-1 ${
                confirmMismatch
                  ? "border-stamp focus:border-stamp focus:ring-stamp"
                  : "border-line focus:border-navy focus:ring-navy"
              }`}
            />
            {confirmMismatch && (
              <p className="mt-1 text-xs text-stamp">
                새 비밀번호와 일치하지 않습니다.
              </p>
            )}
          </div>

          {error && <p className={noticeError}>{error}</p>}

          <button
            type="submit"
            disabled={pending}
            className={`${btnPrimary} w-full`}
          >
            {pending ? "변경 중…" : "비밀번호 변경"}
          </button>
        </form>
      </section>
    </div>
  );
}
