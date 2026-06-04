"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cardCls, inputCls, labelCls, btnPrimary, noticeError } from "@/lib/ui";
import { loginExternalJudge } from "@/app/hr/recruitment/[slug]/actions";

export default function JudgeLoginForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 입력 즉시 숫자만 남기고 11자리로 자릅니다(하이픈/공백 자동 제거).
  function handlePhoneChange(v: string) {
    setPhone(v.replace(/\D/g, "").slice(0, 11));
  }

  function handleSubmit() {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("이름을 입력해주세요.");
      return;
    }
    if (!/^010\d{8}$/.test(phone)) {
      setError("휴대전화는 010 으로 시작하는 11자리 숫자여야 합니다.");
      return;
    }

    startTransition(async () => {
      try {
        // loginExternalJudge 가 본인 확인 + dongrae_external_judge 쿠키(8시간) 발급.
        const res = await loginExternalJudge({
          postingSlug: slug,
          name: trimmedName,
          phone,
        });
        if (!res.success) {
          setError(res.error ?? "로그인에 실패했습니다.");
          return;
        }
        router.push(`/recruitment/${slug}/interview`);
      } catch {
        setError("로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      }
    });
  }

  return (
    <section className={cardCls}>
      <h2 className="text-sm font-semibold text-ink">외부 심사위원 로그인</h2>
      <p className="mt-1 text-xs text-ink-muted">
        채용 담당자가 등록·배정한 이름과 휴대전화 번호로 본인 확인 후 면접
        채점에 입장합니다.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="mt-4 space-y-3"
      >
        <div>
          <label className={labelCls}>이름</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            autoComplete="name"
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>휴대전화</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => handlePhoneChange(e.target.value)}
            placeholder="01012345678"
            maxLength={11}
            inputMode="numeric"
            autoComplete="tel"
            className={`${inputCls} font-mono`}
          />
          <p className="mt-1 text-[11px] text-ink-hint">
            하이픈 없이 11자리 숫자로 입력하세요.
          </p>
        </div>

        {error && <p className={noticeError}>{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className={`${btnPrimary} w-full`}
        >
          {pending ? "확인 중…" : "로그인"}
        </button>
      </form>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-hint">
        ※ 인사 관리자 계정과는 별개의 로그인입니다. 채용 담당자가 외부위원으로
        등록·배정한 경우에만 입장할 수 있습니다.
      </p>
    </section>
  );
}
