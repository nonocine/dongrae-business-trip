import type { ReactNode } from "react";
import { cartBox, stepBox } from "./ui";

// 단계 박스 — 제목 왼쪽에 파란 원 + 흰 숫자.
export default function StepBox({
  step,
  title,
  right,
  tone = "plain",
  children,
}: {
  step: number;
  title: string;
  right?: ReactNode;
  tone?: "plain" | "soft";
  children: ReactNode;
}) {
  return (
    <section className={tone === "soft" ? cartBox : stepBox}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-blue text-sm font-bold text-white">
          {step}
        </span>
        <h3 className="text-base font-bold text-ink">{title}</h3>
        {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
      </div>
      {children}
    </section>
  );
}
