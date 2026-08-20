// 공용 비밀번호 암호화 검증 (AES-256-GCM).
//   실행: npm run test:credential  (node --import tsx scripts/test-credential-crypto.ts)
//
//   ① 왕복 — 암호화한 값이 원문으로 되돌아오는지(한글·기호·긴 문자열 포함).
//   ② ★평문 유출 없음 — 암호문 어디에도 평문 조각이 남지 않는지.
//   ③ ★IV 랜덤 — 같은 평문을 두 번 암호화하면 결과가 달라야(패턴 노출 방지).
//   ④ ★변조 감지 — 암호문·태그를 1비트 바꾸면 복호화가 throw 하는지(GCM 인증).
//   ⑤ ★키 부재 — CREDENTIAL_MASTER_KEY 없으면 "마스터키" 에러로 throw 하고,
//      암호화 없이 값을 돌려주는 폴백이 없는지.
//   ⑥ 잘못된 키 길이·형식이면 명확히 throw 하는지.
//   ⑦ 다른 키로는 복호화되지 않는지.
//   ⑧ 형식 판별(looksEncrypted)·빈 평문 거부.
//   DB·네트워크를 타지 않습니다. ⚠️ 평문·키를 로그로 출력하지 않습니다.
import { randomBytes } from "node:crypto";

let failures = 0;
function expect(label: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗"} ${label}${cond ? "" : ` — ${detail ?? ""}`}`);
}

// 모듈은 키를 캐시하므로, 키를 바꿔 시험할 때마다 새로 import 합니다.
type CryptoMod = typeof import("../lib/credentialCrypto");
let loadSeq = 0;
async function loadWithKey(key: string | undefined): Promise<CryptoMod> {
  if (key === undefined) delete process.env.CREDENTIAL_MASTER_KEY;
  else process.env.CREDENTIAL_MASTER_KEY = key;
  // 쿼리스트링으로 모듈 캐시를 우회합니다(키 캐시를 초기화하려면 새 인스턴스 필요).
  return (await import(`../lib/credentialCrypto?v=${++loadSeq}`)) as CryptoMod;
}

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

const SAMPLES = [
  "abc123!@#",
  "한글비밀번호_2026",
  "sp ace and \"quotes\" and :colons:",
  "x".repeat(500),
];

async function main() {
  const c = await loadWithKey(KEY_A);

  // ① 왕복
  for (const plain of SAMPLES) {
    const enc = c.encryptSecret(plain);
    expect(
      `왕복 (${plain.length}자)`,
      c.decryptSecret(enc) === plain
    );
    // ② 평문 유출 없음 — 암호문 문자열에 원문(또는 그 앞 8자)이 들어있지 않아야.
    const probe = plain.slice(0, 8);
    expect(
      `암호문에 평문 조각 없음 (${plain.length}자)`,
      !enc.includes(plain) && !enc.includes(probe)
    );
    expect(`형식은 v1:iv:tag:cipher (${plain.length}자)`, /^v1:[^:]+:[^:]+:[^:]+$/.test(enc));
    expect(`looksEncrypted 인식 (${plain.length}자)`, c.looksEncrypted(enc));
  }

  // ③ IV 랜덤 — 같은 평문, 다른 결과.
  const e1 = c.encryptSecret("same-secret");
  const e2 = c.encryptSecret("same-secret");
  expect("같은 평문도 매번 다른 암호문(IV 랜덤)", e1 !== e2);
  expect("둘 다 같은 평문으로 복호화", c.decryptSecret(e1) === c.decryptSecret(e2));

  // ④ 변조 감지 — cipher 마지막 바이트를 바꿔치기.
  const parts = c.encryptSecret("tamper-me").split(":");
  const buf = Buffer.from(parts[3], "base64");
  buf[buf.length - 1] ^= 0x01;
  const tampered = [parts[0], parts[1], parts[2], buf.toString("base64")].join(":");
  let threw = false;
  try {
    c.decryptSecret(tampered);
  } catch {
    threw = true;
  }
  expect("암호문 변조 시 복호화 throw", threw);

  // 태그 변조도 마찬가지.
  const tagBuf = Buffer.from(parts[2], "base64");
  tagBuf[0] ^= 0x01;
  let threwTag = false;
  try {
    c.decryptSecret([parts[0], parts[1], tagBuf.toString("base64"), parts[3]].join(":"));
  } catch {
    threwTag = true;
  }
  expect("인증태그 변조 시 복호화 throw", threwTag);

  // 형식이 깨진 값도 throw(빈 문자열·잘린 값).
  for (const bad of ["", "v1:only:two", "v2:a:b:c", "plain-text-password"]) {
    let bt = false;
    try {
      c.decryptSecret(bad);
    } catch {
      bt = true;
    }
    expect(`형식 오류 거부 (${bad.length}자)`, bt);
  }

  // ⑧ 빈 평문 거부.
  let emptyThrew = false;
  try {
    c.encryptSecret("");
  } catch {
    emptyThrew = true;
  }
  expect("빈 비밀번호 암호화 거부", emptyThrew);
  expect("평문은 looksEncrypted=false", !c.looksEncrypted("plain"));

  // ⑦ 다른 키로는 복호화 불가.
  const encWithA = c.encryptSecret("cross-key");
  const cB = await loadWithKey(KEY_B);
  let crossThrew = false;
  try {
    cB.decryptSecret(encWithA);
  } catch {
    crossThrew = true;
  }
  expect("다른 마스터키로는 복호화 불가", crossThrew);

  // ⑤ 키 부재 — 암호화·복호화 모두 "마스터키" 에러로 throw(폴백 없음).
  const cNone = await loadWithKey(undefined);
  expect("키 없으면 isCredentialKeyConfigured=false", !cNone.isCredentialKeyConfigured());
  let encMsg = "";
  let encReturned: unknown = undefined;
  try {
    encReturned = cNone.encryptSecret("no-key-here");
  } catch (e) {
    encMsg = e instanceof Error ? e.message : String(e);
  }
  expect(
    "키 없으면 암호화 throw(무암호화 폴백 없음)",
    encReturned === undefined && encMsg.includes("CREDENTIAL_MASTER_KEY"),
    encMsg
  );
  expect("에러 메시지에 마스터키 안내", encMsg.includes("마스터키"), encMsg);
  let decMsg = "";
  try {
    cNone.decryptSecret(encWithA);
  } catch (e) {
    decMsg = e instanceof Error ? e.message : String(e);
  }
  expect("키 없으면 복호화 throw", decMsg.includes("CREDENTIAL_MASTER_KEY"), decMsg);

  // ⑥ 키 형식·길이 오류.
  const cShort = await loadWithKey(randomBytes(16).toString("base64"));
  let shortMsg = "";
  try {
    cShort.encryptSecret("x");
  } catch (e) {
    shortMsg = e instanceof Error ? e.message : String(e);
  }
  expect("짧은 키는 길이 오류로 throw", shortMsg.includes("길이"), shortMsg);
  expect("에러 메시지에 키 값이 없음", !shortMsg.includes("="), shortMsg);

  // 원래 키로 되돌려 두고 종료(다른 테스트에 영향 없게).
  process.env.CREDENTIAL_MASTER_KEY = KEY_A;

  console.log(failures === 0 ? "\n모두 통과" : `\n실패 ${failures}건`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
