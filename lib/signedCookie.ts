// =====================================================================
// 세션 쿠키 서명 (SEC-3a) — HMAC-SHA256, node:crypto 전용(외부 의존성 없음).
//   * 형식: "<payloadB64url>.<sigB64url>"
//     - payloadB64url = base64url(JSON.stringify(obj))
//     - sigB64url     = base64url(HMAC-SHA256(SESSION_SECRET, payloadB64url))
//   * 목적은 "위조 차단" — 값을 숨기는 것이 아닙니다(base64url 은 누구나 디코드
//     가능). 쿠키는 모두 httpOnly 이고, 서명이 없으면 서버가 거부합니다.
//   * 무서명(평문) 쿠키를 받아주는 폴백은 의도적으로 두지 않습니다. 폴백이 있으면
//     공격자가 서명을 떼고 보내는 것만으로 검증을 우회할 수 있습니다.
//     → 배포 시점의 기존 로그인 세션은 모두 무효가 되어 재로그인이 필요합니다.
//   * 서버 전용 모듈. 클라이언트 번들에 섞이면 빌드가 실패하도록 둡니다.
// =====================================================================

import { createHmac, timingSafeEqual } from "node:crypto";

// 모듈 로드 시 1회 확인 — 비밀키 없이 조용히 동작하는 상태를 만들지 않습니다.
const SESSION_SECRET = process.env.SESSION_SECRET ?? "";
if (!SESSION_SECRET) {
  throw new Error(
    "SESSION_SECRET 환경변수가 설정되지 않았습니다. 세션 쿠키 서명에 필요합니다. " +
      "(.env.local 및 배포 환경변수에 등록해주세요)"
  );
}

// payload 문자열에 대한 HMAC 서명(base64url).
function sign(payloadB64: string): string {
  return createHmac("sha256", SESSION_SECRET).update(payloadB64).digest(
    "base64url"
  );
}

// 임의 객체 → 서명된 쿠키 문자열.
export function signPayload(obj: unknown): string {
  const payloadB64 = Buffer.from(JSON.stringify(obj), "utf8").toString(
    "base64url"
  );
  return `${payloadB64}.${sign(payloadB64)}`;
}

// 서명된 쿠키 문자열 → 객체. 서명 불일치·형식 오류·파싱 실패 시 null.
//   * 호출부는 null 을 "미인증"으로 취급해야 합니다.
export function verifyPayload<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;

  const dot = raw.indexOf(".");
  // 구분자가 없거나 payload/서명 어느 한쪽이 비면 형식 오류.
  if (dot <= 0 || dot === raw.length - 1) return null;

  const payloadB64 = raw.slice(0, dot);
  const sigB64 = raw.slice(dot + 1);
  const expected = sign(payloadB64);

  // timingSafeEqual 은 길이가 다르면 throw 하므로 먼저 걸러냅니다.
  //   (길이 차이 자체는 비밀이 아니므로 조기 반환해도 무방)
  const given = Buffer.from(sigB64, "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length) return null;
  if (!timingSafeEqual(given, want)) return null;

  try {
    return JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    ) as T;
  } catch {
    return null;
  }
}
