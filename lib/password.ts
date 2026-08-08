import bcrypt from "bcryptjs";

// =====================================================================
// 직원 비밀번호 해시 (SEC-1)
//   * drivers.password 는 원래 평문이었습니다. 이 모듈을 거치도록 모든
//     저장 경로를 바꿔 평문 저장을 없앱니다.
//   * 강사(saem_instructors.password_hash)가 이미 쓰던 bcryptjs·cost 10 을
//     그대로 씁니다(같은 방식 유지).
//   * 컬럼명은 password 그대로 둡니다 — 같은 테이블을 쓰는 별도 앱
//     (dongrae-car)이 있어 컬럼을 바꾸면 그쪽이 깨질 수 있습니다.
//     값의 형태만 평문 → bcrypt 해시로 바뀝니다.
//   * 서버 전용 — 클라이언트 컴포넌트에서 import 하지 마세요.
// =====================================================================

const COST = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

// bcrypt 해시 형태인지 — "$2a$" / "$2b$" / "$2y$" 로 시작합니다.
//   평문 4자리 숫자는 절대 이 형태가 될 수 없어 오탐이 없습니다.
export function isHashed(stored: string | null | undefined): boolean {
  return typeof stored === "string" && /^\$2[aby]?\$/.test(stored);
}

export type VerifyResult = {
  ok: boolean;
  // 평문으로 저장돼 있던 값이 맞았을 때 true — 호출부가 그 자리에서
  // 해시로 올려 저장합니다(무통증 자동 마이그레이션).
  needsUpgrade: boolean;
};

// 비밀번호 검증.
//   * 저장값이 해시면 bcrypt.compare.
//   * 해시가 아니면(기존 평문) 평문 비교로 폴백하고 needsUpgrade=true.
//     → 직원은 쓰던 비번을 그대로 쓰고, 로그인 성공 순간 해시로 바뀝니다.
export async function verifyPassword(
  plain: string,
  stored: string | null | undefined,
): Promise<VerifyResult> {
  if (!stored || !plain) return { ok: false, needsUpgrade: false };

  if (isHashed(stored)) {
    try {
      return { ok: await bcrypt.compare(plain, stored), needsUpgrade: false };
    } catch {
      // 손상된 해시 등 — 인증 실패로 처리합니다(평문 폴백 금지).
      return { ok: false, needsUpgrade: false };
    }
  }

  // 레거시 평문 경로. 일치해도 needsUpgrade 로 표시해 즉시 해시화합니다.
  const ok = stored === plain;
  return { ok, needsUpgrade: ok };
}
