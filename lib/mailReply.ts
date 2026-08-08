import nodemailer from "nodemailer";

// =====================================================================
// 공용 메일함 2단계 — 답장 발신 (ML-7)
//   * 네이버 SMTP(smtp.naver.com:465, SSL). 계정은 수집기와 같은 자격증명을
//     재사용합니다 — NAVER_POP_USER / NAVER_POP_PASSWORD(앱 비밀번호).
//   * 자격증명은 환경변수로만 받고 로그에 절대 출력하지 않습니다.
//   * lib/mailer.ts(Gmail, 급여명세서 발송)와 같은 패턴이지만 계정·호스트가
//     다르므로 별도 모듈로 둡니다. 서로 영향을 주지 않습니다.
//   * 발송 실패는 호출부에서 mail_replies(status=failed) 로 기록합니다.
// =====================================================================

const SMTP_HOST = "smtp.naver.com";
const SMTP_PORT = 465;
const QUOTE_MAX_CHARS = 4000; // 원문 인용은 너무 길면 잘라 붙입니다.

const RAW_USER = () => (process.env.NAVER_POP_USER ?? "").trim();
const RAW_PASSWORD = () => (process.env.NAVER_POP_PASSWORD ?? "").trim();

// 네이버 계정은 아이디만("onnainna") 저장돼 있을 수 있어 주소를 보정합니다.
export function senderAddress(): string {
  const user = RAW_USER();
  if (!user) return "";
  return user.includes("@") ? user : `${user}@naver.com`;
}

export function isReplyConfigured(): boolean {
  return RAW_USER().length > 0 && RAW_PASSWORD().length > 0;
}

function transport() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: true, // 465 = 암시적 SSL
    auth: { user: RAW_USER(), pass: RAW_PASSWORD() },
  });
}

// "RE: 원제목" — 이미 RE: 로 시작하면 중복해서 붙이지 않습니다.
export function replySubject(original: string): string {
  const s = (original ?? "").trim();
  if (!s) return "RE: (제목 없음)";
  return /^re\s*:/i.test(s) ? s : `RE: ${s}`;
}

// 본문 하단 원문 인용 — 각 줄 앞에 "> " 를 붙인 표준 형태.
export function quoteOriginal(input: {
  fromName: string;
  fromEmail: string;
  receivedAt: string | null;
  body: string;
}): string {
  const who =
    [input.fromName, input.fromEmail ? `<${input.fromEmail}>` : ""]
      .filter(Boolean)
      .join(" ") || "(보낸사람 없음)";
  const when = input.receivedAt
    ? new Date(input.receivedAt).toISOString().slice(0, 16).replace("T", " ")
    : "";
  const header = when
    ? `${when} (UTC) ${who} 님이 쓴 글:`
    : `${who} 님이 쓴 글:`;

  const body = (input.body ?? "").slice(0, QUOTE_MAX_CHARS);
  const quoted = body
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  return `\n\n-------- 원본 메일 --------\n${header}\n${quoted}`;
}

// 답장 발송 — 실패 시 throw(호출부에서 status=failed 로 기록).
export async function sendReply(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  if (!isReplyConfigured()) {
    throw new Error(
      "발신 설정이 필요합니다. (NAVER_POP_USER / NAVER_POP_PASSWORD)",
    );
  }
  const to = (input.to ?? "").trim();
  if (!to) throw new Error("받는사람 주소가 없습니다.");

  const tp = transport();
  await tp.sendMail({
    from: `동래구청소년센터 <${senderAddress()}>`,
    to,
    subject: input.subject,
    text: input.text,
  });
}
