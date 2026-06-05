import Link from "next/link";
import type { ReactNode } from "react";

// =====================================================================
// 채용 공개 페이지 공용 UI — 공고 상세 / 지원 페이지가 공유.
//   * 순수 프레젠테이션(서버 컴포넌트). 로고 색상(빨강·초록·파랑·노랑)으로
//     포인트를 주고, 상단은 진한 네이비 배경 + 흰 글자.
// =====================================================================

// 진한 네이비 헤더 — 로고 + 색상 포인트 "직원채용공고" 뱃지 + 제목.
//   children: 하단 메타 바(분야 뱃지·모집인원·상태·D-Day 등).
export function RecruitmentHeader({
  title,
  backHref,
  children,
}: {
  title: string;
  backHref?: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-blue via-[#2f6fc4] to-navy shadow-md sm:mb-8">
      {backHref && (
        <div className="px-5 pt-4 sm:px-6">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-xs font-medium text-white/70 transition hover:text-white sm:text-sm"
          >
            ← 공고로 돌아가기
          </Link>
        </div>
      )}
      <div className="flex items-start gap-4 px-5 py-6 sm:px-6">
        <div className="shrink-0 rounded-xl bg-white p-1.5 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/dongrae-logo.png"
            alt="동래구청소년센터"
            className="h-11 w-auto object-contain sm:h-12"
          />
        </div>
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-bold tracking-[0.15em] text-white sm:text-xs">
            <span className="flex gap-0.5" aria-hidden>
              <span className="h-1.5 w-1.5 rounded-full bg-brand-red" />
              <span className="h-1.5 w-1.5 rounded-full bg-brand-green" />
              <span className="h-1.5 w-1.5 rounded-full bg-brand-blue" />
              <span className="h-1.5 w-1.5 rounded-full bg-brand-yellow" />
            </span>
            직원채용공고
          </span>
          {/* 한글 어절 단위로 줄바꿈(break-keep) — 길어도 박스 안에서 자연스럽게 감김 */}
          <h1 className="mt-1.5 break-keep text-base font-extrabold leading-snug text-white sm:text-xl">
            {title}
          </h1>
        </div>
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-white/10 bg-black/15 px-5 py-3 sm:px-6">
          {children}
        </div>
      )}
    </header>
  );
}

// 섹션 카드 색상 — 디자인 지정(접수기간=파랑, 자격=초록, 우대=주황, 임금=보라,
// 절차=빨강, 그 외=네이비). 클래스는 Tailwind JIT 가 스캔하도록 리터럴로 둡니다.
const SECTION_ACCENT = {
  blue: { border: "border-l-brand-blue", text: "text-brand-blue", dot: "bg-brand-blue" },
  green: { border: "border-l-brand-green", text: "text-brand-green", dot: "bg-brand-green" },
  orange: { border: "border-l-warning", text: "text-warning", dot: "bg-warning" },
  violet: { border: "border-l-violet-500", text: "text-violet-600", dot: "bg-violet-500" },
  red: { border: "border-l-brand-red", text: "text-brand-red", dot: "bg-brand-red" },
  navy: { border: "border-l-navy", text: "text-navy", dot: "bg-navy" },
} as const;

export type SectionAccent = keyof typeof SECTION_ACCENT;

// 왼쪽 색상 보더 포인트 + 컬러 헤딩(점) 카드.
export function SectionCard({
  title,
  accent,
  action,
  children,
}: {
  title: string;
  accent: SectionAccent;
  action?: ReactNode;
  children: ReactNode;
}) {
  const a = SECTION_ACCENT[accent];
  return (
    <section
      className={`mb-4 rounded-xl border border-line border-l-4 ${a.border} bg-card p-4 shadow-sm sm:p-5`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className={`flex items-center gap-2 text-sm font-bold ${a.text}`}>
          <span className={`h-2 w-2 rounded-full ${a.dot}`} aria-hidden />
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}
