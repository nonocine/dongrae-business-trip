// 직원 로그인 — 구글 워크스페이스 단일.
//   * 직원 비번 로그인(loginEmployee)·관리자 비번 로그인 진입점은 제거되었습니다.
//     (loginEmployee 액션 자체는 app/actions.ts 에 보존 — 다음 단계에서 정리 예정)
//   * onnainna.kr 계정만 통과(서버 콜백에서 도메인·등록 검증).
//   * next 로 로그인 후 복귀 경로를 지정(기본: 직원 메인 "/").
export default function LoginForm({ next = "/" }: { next?: string }) {
  const loginHref = `/api/auth/google/login?next=${encodeURIComponent(next)}`;

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

      {/* 구글 워크스페이스 로그인 — onnainna.kr 계정 전용(서버에서 도메인 검증) */}
      <a
        href={loginHref}
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
