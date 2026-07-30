"use client";

import { forwardRef } from "react";
import { btnPrimary, btnSecondary, btnDanger } from "@/lib/ui";

type Variant = "primary" | "secondary" | "danger";

const VARIANT_CLS: Record<Variant, string> = {
  primary: btnPrimary,
  secondary: btnSecondary,
  danger: btnDanger,
};

// 공용 버튼 — 디자인 시스템 버튼 클래스 + 제출 중 스피너/비활성(중복 클릭 방지).
//   순수 프레젠테이션: onClick 등 동작은 그대로 전달만 한다.
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", loading = false, disabled, className, children, type, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${VARIANT_CLS[variant]}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

export default Button;

// 인라인 스피너 — 현재 글자색을 따른다(currentColor).
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`h-4 w-4 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
