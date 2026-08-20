// =====================================================================
// 공용 비밀번호 암호화 (AES-256-GCM) — node:crypto 전용, 외부 의존성 없음.
//   * 저장 형식: "v1:<ivB64>:<tagB64>:<cipherB64>"
//     - iv     : 12바이트 랜덤(매 저장마다 새로 생성 — 재사용 금지)
//     - tag    : GCM 인증 태그 16바이트(변조되면 복호화가 throw)
//     - cipher : 평문을 AES-256-GCM 으로 암호화한 바이트
//     버전 접두사("v1")를 둔 이유는 나중에 키·알고리즘을 바꿀 때 기존 값을
//     구분해 읽어야 하기 때문입니다.
//   * 마스터키: process.env.CREDENTIAL_MASTER_KEY (base64, 정확히 32바이트).
//     키가 없거나 길이가 다르면 **throw** 합니다 — 무암호화 저장 폴백은
//     의도적으로 두지 않습니다(SESSION_SECRET 과 같은 원칙). 폴백이 있으면
//     환경변수 하나 빠진 것만으로 평문이 DB 에 들어갑니다.
//   * ⚠️ 평문·암호문·마스터키를 절대 로그로 남기지 않습니다(console 출력 금지).
//     에러 메시지에도 값 자체를 넣지 않습니다.
//   * 서버 전용 모듈("use server" 아님). 클라이언트 컴포넌트가 import 하면
//     빌드가 깨지도록 둡니다 — 브라우저 번들에 복호화 경로가 섞이면 안 됩니다.
//   * 키 확인을 모듈 로드가 아니라 호출 시점에 하는 이유: 로드 시 throw 하면
//     이 모듈을 스치는 페이지 전체(대시보드 등)가 500 이 됩니다. 키가 없을 때는
//     "비밀번호 기능만" 명확한 에러로 멈추는 편이 안전합니다.
// =====================================================================

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12; // GCM 표준 nonce 길이
const KEY_BYTES = 32; // AES-256

const MISSING_KEY =
  "비밀번호 마스터키(CREDENTIAL_MASTER_KEY)가 설정되지 않았습니다. " +
  ".env.local 및 배포 환경변수에 등록해주세요. (암호화 없이 저장하지 않습니다)";

let cachedKey: Buffer | null = null;

// 마스터키 로드 — 형식·길이를 검증합니다. 값은 어디에도 출력하지 않습니다.
function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = (process.env.CREDENTIAL_MASTER_KEY ?? "").trim();
  if (!raw) throw new Error(MISSING_KEY);
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error(
      "CREDENTIAL_MASTER_KEY 형식이 올바르지 않습니다. base64 32바이트 키여야 합니다."
    );
  }
  if (key.length !== KEY_BYTES) {
    // 길이만 알려줍니다 — 키 값 자체는 메시지에 넣지 않습니다.
    throw new Error(
      `CREDENTIAL_MASTER_KEY 길이가 올바르지 않습니다(${key.length}바이트). ` +
        "base64 로 디코딩했을 때 32바이트여야 합니다."
    );
  }
  cachedKey = key;
  return key;
}

// 마스터키가 설정돼 있는지(값은 반환하지 않습니다) — 화면에 "설정 필요" 안내를
//   띄우기 위한 확인용. 등록·열람 액션은 이 값과 무관하게 실제 암복호화에서
//   다시 검증됩니다.
export function isCredentialKeyConfigured(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

// 평문 → "v1:iv:tag:cipher". 빈 문자열은 저장 대상이 아니므로 거부합니다.
export function encryptSecret(plain: string): string {
  const text = String(plain ?? "");
  if (!text) throw new Error("암호화할 비밀번호가 비어 있습니다.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(":");
}

// "v1:iv:tag:cipher" → 평문. 형식 오류·태그 불일치(변조·다른 키)면 throw.
export function decryptSecret(encrypted: string): string {
  const raw = String(encrypted ?? "");
  const parts = raw.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("저장된 비밀번호 형식을 읽을 수 없습니다.");
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const data = Buffer.from(parts[3], "base64");
  if (iv.length !== IV_BYTES || tag.length !== 16 || data.length === 0) {
    throw new Error("저장된 비밀번호 형식을 읽을 수 없습니다.");
  }
  const decipher = createDecipheriv(ALGO, masterKey(), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8"
    );
  } catch {
    // 태그 검증 실패 — 값이 바뀌었거나 키가 다릅니다. 원인 값은 남기지 않습니다.
    throw new Error(
      "비밀번호를 복호화할 수 없습니다. 마스터키가 저장 당시와 다를 수 있습니다."
    );
  }
}

// 저장된 값이 이 모듈이 만든 형식인지 — 마이그레이션·점검용(복호화는 하지 않음).
export function looksEncrypted(value: string | null | undefined): boolean {
  const parts = String(value ?? "").split(":");
  if (parts.length !== 4) return false;
  const v = Buffer.from(parts[0], "utf8");
  const want = Buffer.from(VERSION, "utf8");
  return v.length === want.length && timingSafeEqual(v, want);
}
