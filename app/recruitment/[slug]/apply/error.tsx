"use client";

// 채용 지원 라우트 단위 에러 바운더리.
//   * Server Action 본문 한도 초과, 일시적 네트워크 오류 등 의도치 못한 예외가
//     Server Component / 액션에서 throw 될 때 페이지 전체가 멈추는 대신
//     사용자에게 안내 + "다시 시도" 버튼을 보여줍니다.
//   * 입력값은 클라이언트 상태이므로 reset() 으로 동일 트리를 다시 마운트하면
//     초기 상태(서버 fetch 결과)로 돌아옵니다.

import Link from "next/link";

export default function RecruitmentApplyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-12">
      <div className="rounded-xl border-2 border-stamp bg-stamp-soft p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-bold text-stamp sm:text-xl">
          페이지를 불러오지 못했습니다
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-body">
          일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.
        </p>
        {error?.message ? (
          <p className="mt-2 break-all rounded-md bg-card px-3 py-2 font-mono text-xs text-ink-muted">
            {error.message}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-blue px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-blue-strong"
          >
            다시 시도
          </button>
          <Link
            href="/recruitment"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-line bg-card px-4 text-sm font-medium text-ink-body hover:bg-surface"
          >
            공고 목록으로
          </Link>
        </div>
      </div>
    </main>
  );
}
