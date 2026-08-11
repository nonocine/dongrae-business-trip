"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";

// =====================================================================
// PIN 설정 제안 배너 — 선택 기능이므로 강제 리다이렉트 대신 안내만 합니다.
//   * 닫으면 localStorage 에 기록해 그 기기에서는 다시 뜨지 않습니다.
//   * must_change_password(강제 비번 변경)가 우선이므로, 그 흐름에 걸린
//     사용자는 애초에 이 화면(랜딩)에 도달하지 않습니다.
//   * localStorage 는 외부 저장소이므로 useSyncExternalStore 로 구독합니다
//     (useEffect + setState 는 하이드레이션 후 깜빡임과 연쇄 렌더를 만듭니다).
// =====================================================================

const DISMISS_KEY = "dongrae_pin_suggest_dismissed";

let listeners: Array<() => void> = [];

function subscribe(cb: () => void): () => void {
  listeners.push(cb);
  // 다른 탭에서 닫은 경우도 반영.
  window.addEventListener("storage", cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
    window.removeEventListener("storage", cb);
  };
}

// 닫힘 여부 — boolean 원시값이라 스냅샷이 안정적입니다.
function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false; // localStorage 차단 환경 — 배너는 보여줍니다.
  }
}

// 서버 렌더에서는 "닫힘"으로 취급해 배너를 그리지 않습니다.
//   → 하이드레이션 불일치 없이, 클라이언트에서 실제 값으로 갱신됩니다.
function getServerSnapshot(): boolean {
  return true;
}

function dismiss() {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // 저장 실패는 무시 — 다음 방문에 다시 뜰 뿐입니다.
  }
  listeners.forEach((l) => l());
}

export default function PinSuggestBanner() {
  const dismissed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );
  if (dismissed) return null;

  return (
    <section className="flex items-start gap-3 rounded-xl border border-line border-l-4 border-l-brand-blue bg-card p-4 shadow-sm">
      <span aria-hidden className="text-lg leading-none">🔑</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ink">간편 PIN 을 설정해보세요</p>
        <p className="mt-1 text-xs text-ink-muted">
          숫자 6자리를 등록하면 이 기기에서는 다음부터 구글 로그인 없이 바로
          들어올 수 있습니다. 설정하지 않아도 지금처럼 사용하실 수 있습니다.
        </p>
        <Link
          href="/profile/pin"
          className="mt-2 inline-block text-xs font-semibold text-brand-blue hover:underline"
        >
          PIN 설정하기 →
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="배너 닫기"
        className="shrink-0 rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-surface"
      >
        ✕
      </button>
    </section>
  );
}
