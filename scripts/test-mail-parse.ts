// 공용 메일함 1단계 — 파서·선별 로직 단위 테스트.
//   실제 네이버 계정 접속 없이 검증합니다(네트워크·DB 접근 없음).
//   합성 MIME 만 사용 — 실제 수신 메일 내용은 테스트에 넣지 않습니다.
import { Buffer } from "node:buffer";
import iconv from "iconv-lite";
import {
  parseRawMail,
  safeFileName,
  selectNewUids,
  unstuffDots,
} from "../lib/mailParse";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

// --- 1) EUC-KR 제목(RFC 2047 B-encoding) + EUC-KR 8bit 본문 -------------
function euckrMail(): Buffer {
  const subjectRaw = iconv.encode("동래구청소년센터 공문 발송의 건", "euc-kr");
  const subject = `=?EUC-KR?B?${subjectRaw.toString("base64")}?=`;
  // 보낸사람 표시이름도 실제 메일처럼 encoded-word 로 넣습니다.
  const fromName = `=?EUC-KR?B?${iconv.encode("홍길동", "euc-kr").toString("base64")}?=`;
  const bodyBytes = iconv.encode(
    "안녕하세요.\r\n첨부와 같이 공문을 발송합니다.\r\n감사합니다.",
    "euc-kr",
  );
  const header = Buffer.from(
    [
      "Return-Path: <sender@example.org>",
      "Message-ID: <euckr-sample-1@example.org>",
      `From: ${fromName} <sender@example.org>`,
      "To: onnainna@naver.com",
      `Subject: ${subject}`,
      "Date: Thu, 07 Aug 2026 10:00:00 +0900",
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="EUC-KR"',
      "Content-Transfer-Encoding: 8bit",
      "",
      "",
    ].join("\r\n"),
    "ascii",
  );
  return Buffer.concat([header, bodyBytes, Buffer.from("\r\n", "ascii")]);
}

// --- 2) CP949(ks_c_5601-1987) 표기 + Q-encoding 제목 --------------------
function cp949Mail(): Buffer {
  const subjectRaw = iconv.encode("회신 요청", "cp949");
  const qp = [...subjectRaw]
    .map((b) => `=${b.toString(16).toUpperCase().padStart(2, "0")}`)
    .join("");
  const bodyBytes = iconv.encode("확인 부탁드립니다.", "cp949");
  const header = Buffer.from(
    [
      "Message-ID: <cp949-sample-1@example.org>",
      "From: sender2@example.org",
      `Subject: =?ks_c_5601-1987?Q?${qp}?=`,
      "Date: Thu, 07 Aug 2026 11:00:00 +0900",
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="ks_c_5601-1987"',
      "Content-Transfer-Encoding: 8bit",
      "",
      "",
    ].join("\r\n"),
    "ascii",
  );
  return Buffer.concat([header, bodyBytes, Buffer.from("\r\n", "ascii")]);
}

// --- 3) UTF-8 멀티파트 + 첨부 ------------------------------------------
function attachmentMail(): Buffer {
  const boundary = "----sample-boundary-1";
  const payload = Buffer.from("hello attachment").toString("base64");
  return Buffer.from(
    [
      "Message-ID: <attach-sample-1@example.org>",
      "From: =?UTF-8?B?" +
        Buffer.from("담당자", "utf8").toString("base64") +
        "?= <sender3@example.org>",
      "Subject: =?UTF-8?B?" +
        Buffer.from("첨부 테스트", "utf8").toString("base64") +
        "?=",
      "Date: Thu, 07 Aug 2026 12:00:00 +0900",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      "<p>본문 HTML</p>",
      "",
      `--${boundary}`,
      "Content-Type: application/pdf",
      "Content-Transfer-Encoding: base64",
      // RFC 2231 — 한글 파일명은 실제로 이렇게 옵니다.
      "Content-Disposition: attachment; filename*=UTF-8''" +
        encodeURIComponent("공문.pdf"),
      "",
      payload,
      "",
      `--${boundary}--`,
      "",
    ].join("\r\n"),
    "utf8",
  );
}

async function main() {
  // 1) EUC-KR
  const a = await parseRawMail(euckrMail());
  assert(
    a.subject === "동래구청소년센터 공문 발송의 건",
    `EUC-KR 제목 디코딩 실패: ${a.subject}`,
  );
  assert(a.body_text.includes("공문을 발송합니다"), `EUC-KR 본문 디코딩 실패: ${a.body_text}`);
  assert(a.from_name === "홍길동", `보낸사람 이름 파싱 실패: ${a.from_name}`);
  assert(a.from_email === "sender@example.org", `보낸사람 주소 파싱 실패: ${a.from_email}`);
  assert(a.received_at !== null, "수신일 파싱 실패");
  assert(a.attachments.length === 0, "첨부 없는 메일에 첨부가 잡힘");

  // 2) CP949
  const b = await parseRawMail(cp949Mail());
  assert(b.subject === "회신 요청", `CP949 제목 디코딩 실패: ${b.subject}`);
  assert(b.body_text.includes("확인 부탁드립니다"), `CP949 본문 디코딩 실패: ${b.body_text}`);

  // 3) 첨부·HTML
  const c = await parseRawMail(attachmentMail());
  assert(c.subject === "첨부 테스트", `UTF-8 제목 디코딩 실패: ${c.subject}`);
  assert(c.body_html !== null && c.body_html.includes("본문 HTML"), "HTML 본문 파싱 실패");
  assert(c.attachments.length === 1, `첨부 개수 실패: ${c.attachments.length}`);
  assert(c.attachments[0].filename === "공문.pdf", `첨부 파일명 실패: ${c.attachments[0].filename}`);
  assert(
    c.attachments[0].content.toString("utf8") === "hello attachment",
    "첨부 내용 복원 실패",
  );

  // 4) dot-stuffing 해제 — 줄머리 ".." 는 "." 한 개로.
  const stuffed = Buffer.from("line1\r\n..dot\r\n...three\r\n", "ascii");
  assert(
    unstuffDots(stuffed).toString("ascii") === "line1\r\n.dot\r\n..three\r\n",
    `dot-unstuffing 실패: ${JSON.stringify(unstuffDots(stuffed).toString("ascii"))}`,
  );

  // 5) UIDL 중복 스킵 + 30통 상한 + 백로그 이월 + 최신 메일 우선
  const known = new Set(["uid-1", "uid-3"]);
  const pairs: string[][] = [
    ["1", "uid-1"],
    ["2", "uid-2"],
    ["3", "uid-3"],
    ["4", "uid-4"],
  ];
  const picked = selectNewUids(pairs, known, 30);
  assert(picked.picks.length === 2, `중복 스킵 실패: ${picked.picks.length}`);
  // UIDL 은 오래된 순으로 오지만, 수집은 최신(뒤)부터 합니다.
  assert(
    picked.picks.map((p) => p.uid).join(",") === "uid-4,uid-2",
    "신규 선별 순서/내용 실패",
  );
  assert(picked.remaining === 0, "남은 백로그 계산 실패");

  const many: string[][] = Array.from({ length: 45 }, (_, i) => [
    String(i + 1),
    `bulk-${i + 1}`,
  ]);
  const limited = selectNewUids(many, new Set(), 30);
  assert(limited.picks.length === 30, `수집 상한 실패: ${limited.picks.length}`);
  assert(limited.remaining === 15, `백로그 이월 실패: ${limited.remaining}`);
  // ★ 최신 메일부터: 45통 중 뒤쪽 30통(bulk-45 → bulk-16)을 먼저 가져오고,
  //   가장 오래된 15통(bulk-1 ~ bulk-15)이 다음 주기로 남습니다.
  assert(
    limited.picks[0].uid === "bulk-45",
    `최신 메일부터 처리하지 않음: ${limited.picks[0].uid}`,
  );
  assert(
    limited.picks[29].uid === "bulk-16",
    `최신 30통 범위가 어긋남: ${limited.picks[29].uid}`,
  );

  // 6) 잘못된 UIDL 행 방어
  const dirty = selectNewUids([["", ""], ["x", "y"], ["5", "ok"]], new Set(), 30);
  assert(dirty.picks.length === 1 && dirty.picks[0].uid === "ok", "비정상 UIDL 방어 실패");

  // 7) 파일명 정리
  assert(safeFileName("../../etc/passwd", "f") === "_.._etc_passwd", "경로 구분자 정리 실패");
  assert(safeFileName("", "fallback.bin") === "fallback.bin", "빈 파일명 폴백 실패");
  assert(safeFileName("보고서.hwp", "f") === "보고서.hwp", "한글 파일명이 훼손됨");

  console.log(
    JSON.stringify({
      ok: true,
      checked: ["EUC-KR", "CP949", "multipart+첨부", "dot-unstuffing", "UIDL 중복/상한", "파일명"],
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
