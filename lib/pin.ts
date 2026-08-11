// =====================================================================
// PIN 간편입력 (SEC-3 2단계) — 상수·순수 판정 함수만 두는 모듈.
//   * 클라이언트 컴포넌트(PinEntry)도 import 하므로 이 파일은 아무 서버 전용
//     모듈(node:crypto, lib/signedCookie, supabaseAdmin 등)도 import 하지
//     않습니다. 서명·DB 접근은 전부 app/auth/pinActions.ts(서버)에서 합니다.
//   * 신뢰 기기 쿠키는 "이 기기 = 이 사람"만 증명합니다. 이것만으로는 절대
//     세션이 발급되지 않으며, PIN 검증을 통과해야만 세션이 나갑니다.
// =====================================================================

export const TRUSTED_DEVICE_COOKIE = "dongrae_trusted_device";
// 신뢰 기기 30일 — 세션(8시간)보다 길지만, 이 쿠키만으로는 로그인되지 않습니다.
export const TRUSTED_DEVICE_MAX_AGE = 60 * 60 * 24 * 30;

export const PIN_LENGTH = 6;
// 연속 실패 허용 횟수. 초과하면 잠금 → 구글 재로그인으로만 해제됩니다.
export const PIN_MAX_ATTEMPTS = 5;

// PIN 형식 — 정확히 6자리 숫자.
export function isValidPinFormat(pin: string | null | undefined): boolean {
  return typeof pin === "string" && /^\d{6}$/.test(pin);
}

// 잠금 여부 — pin_locked_until 이 현재보다 미래면 잠김.
export function isPinLocked(
  lockedUntil: string | null | undefined,
  nowMs: number
): boolean {
  if (!lockedUntil) return false;
  const t = new Date(lockedUntil).getTime();
  return Number.isFinite(t) && t > nowMs;
}

// 남은 시도 횟수 — 사용자 안내용(음수 방지).
export function remainingAttempts(
  failedCount: number | null | undefined
): number {
  const used = typeof failedCount === "number" && failedCount > 0 ? failedCount : 0;
  return Math.max(0, PIN_MAX_ATTEMPTS - used);
}
