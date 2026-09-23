// =====================================================================
// 전달·답장 발송 조립 검증 — 네트워크 없이 MIME 만 만들어 확인합니다.
//
//   왜 필요한가:
//     0단계에서 "받는 쪽에 원본 한글 파일명으로 도착하는가" 가 함정이었습니다.
//     보내는 쪽에도 같은 함정이 있습니다 — 첨부 filename 을 그냥 넣으면
//     라이브러리가 어떻게 인코딩하느냐에 따라 받는 사람에게 깨져 도착합니다.
//     실제 발송 없이 확인할 수 있는 부분이므로 여기서 먼저 막습니다.
//
//   nodemailer 의 streamTransport 로 '보내는 대신 MIME 을 만들어' 검사합니다.
//   SMTP 접속이 없으므로 자격증명도, 수신자도 필요 없습니다.
// =====================================================================

import { Buffer } from "node:buffer";
import nodemailer from "nodemailer";
import { forwardSubject, quoteForward, replySubject } from "../lib/mailReply";
import {
  MAIL_SEND_MAX_BYTES,
  sendAttachmentTotal,
  canAttachToOutgoing,
} from "../lib/mail";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

const KOREAN_NAME =
  "수정 26년 10월 5학년 이음반 영어방과후아카데미 운영지도안 양식.hwp";

// --- 1) 제목 접두사 -----------------------------------------------------
assert(
  forwardSubject("영어10월 운영지도안") === "FW: 영어10월 운영지도안",
  "전달 제목에 FW: 가 붙어야 합니다.",
);
assert(
  forwardSubject("FW: 이미 전달된 건") === "FW: 이미 전달된 건",
  "FW: 가 이미 있으면 덧붙이지 않아야 합니다.",
);
assert(
  forwardSubject("Fwd: 소문자도") === "Fwd: 소문자도",
  "Fwd: 도 중복으로 붙이지 않아야 합니다.",
);
assert(forwardSubject("") === "FW: (제목 없음)", "빈 제목 처리");
// 답장 쪽 규칙이 전달 추가로 망가지지 않았는지 함께 확인합니다.
assert(replySubject("확인") === "RE: 확인", "답장 제목 규칙이 그대로여야 합니다.");
assert(replySubject("RE: 확인") === "RE: 확인", "RE: 중복 금지");

// --- 2) 전달 원문 인용 --------------------------------------------------
//   답장은 "> " 인용, 전달은 원문 그대로 + 머리글. 섞이면 안 됩니다.
const quoted = quoteForward({
  fromName: "김진영",
  fromEmail: "gangbekho@naver.com",
  receivedAt: "2026-09-22T11:44:00.000Z",
  subject: "영어10월 운영지도안",
  body: "안녕하세요\n영어10월 운영지도안 파일로 첨부합니다.",
});
assert(quoted.includes("-------- 전달된 메일 --------"), "전달 머리글이 있어야 합니다.");
assert(quoted.includes("보낸사람: 김진영 <gangbekho@naver.com>"), "보낸사람 표기");
assert(quoted.includes("제목: 영어10월 운영지도안"), "원본 제목 표기");
assert(
  !quoted.split("\n").some((l) => l.startsWith("> ")),
  "전달은 '> ' 인용을 쓰지 않습니다(답장과 구분).",
);

// --- 3) 첨부 합계 상한 --------------------------------------------------
assert(
  sendAttachmentTotal([{ size: 1000 }, { size: 2000 }]) === 3000,
  "첨부 합계 계산",
);
assert(
  sendAttachmentTotal([{ size: MAIL_SEND_MAX_BYTES }, { size: 1 }]) >
    MAIL_SEND_MAX_BYTES,
  "상한을 넘기면 넘긴 것으로 계산되어야 합니다.",
);
// 사본이 없는 첨부는 붙일 수 없습니다(Storage 에서 읽을 것이 없음).
assert(
  canAttachToOutgoing({ name: "a.pdf", size: 1, storage_path: "mail/x/a.pdf" }),
  "사본이 있으면 붙일 수 있어야 합니다.",
);
assert(
  !canAttachToOutgoing({
    name: "big.pdf",
    size: 99,
    storage_path: null,
    skip_reason: "too_large",
  }),
  "사본이 없으면 붙일 수 없어야 합니다.",
);

// --- 4) 한글 첨부 파일명이 MIME 에 제대로 실리는가 ----------------------
//   ★ 이게 이 스크립트의 본론입니다. RFC 2231 로 인코딩돼야 받는 쪽에서
//     원본 이름으로 저장됩니다.
//   * tsx 가 CJS 로 내보내므로 top-level await 를 쓸 수 없어 main() 으로 감쌉니다.
function renderMime(): Promise<string> {
  return new Promise((resolve, reject) => {
    nodemailer
      .createTransport({ streamTransport: true, buffer: true })
      .sendMail(
        {
          from: "동래구청소년센터 <onnainna@naver.com>",
          to: "someone@example.com",
          cc: "cc@example.com",
          subject: forwardSubject("영어10월 운영지도안"),
          text: `전달합니다.${quoted}`,
          attachments: [
            { filename: KOREAN_NAME, content: Buffer.from("hwp-bytes") },
          ],
        },
        (err, info) => {
          if (err) return reject(err);
          resolve(String((info as { message: Buffer }).message));
        },
      );
  });
}

async function main() {
const mime = await renderMime();

// filename*=UTF-8''… (RFC 2231) 로 실려야 합니다.
const star = /filename\*[0-9]*\*?=(?:UTF-8'')?([^\r\n;]+)/gi;
const pieces: string[] = [];
let m: RegExpExecArray | null;
while ((m = star.exec(mime)) !== null) pieces.push(m[1]);
assert(pieces.length > 0, "첨부 filename* (RFC 2231) 이 없습니다 — 한글명이 깨집니다.");
const decoded = decodeURIComponent(pieces.join(""));
assert(
  decoded === KOREAN_NAME,
  `첨부 파일명이 어긋납니다.\n  기대: ${KOREAN_NAME}\n  실제: ${decoded}`,
);

// 참조가 헤더에 실렸는지.
assert(/^Cc: cc@example\.com/m.test(mime), "참조(Cc) 헤더가 있어야 합니다.");
// 제목은 한글이라 인코딩돼 있으므로 디코드해서 확인합니다.
const subjLine = /^Subject: (.+)$/m.exec(mime)?.[1] ?? "";
const subjDecoded = /=\?UTF-8\?B\?(.+?)\?=/i.test(subjLine)
  ? subjLine
      .split(/\s+/)
      .map((part) => {
        const b = /=\?UTF-8\?B\?(.+?)\?=/i.exec(part);
        return b ? Buffer.from(b[1], "base64").toString("utf8") : part;
      })
      .join("")
  : subjLine;
assert(
  subjDecoded.startsWith("FW: "),
  `제목이 FW: 로 시작해야 합니다. 실제: ${subjDecoded}`,
);

console.log("✓ 전달 제목·인용·첨부 상한 규칙");
console.log("✓ 참조(Cc) 헤더");
console.log(`✓ 한글 첨부 파일명 RFC 2231 인코딩 → "${decoded}"`);
console.log("\n전달·답장 조립 검증 통과");
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
