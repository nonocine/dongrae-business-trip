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

// "FW: 원제목" — RE: 와 같은 규칙. FW:/FWD: 어느 쪽으로 시작해도 덧붙이지 않습니다.
export function forwardSubject(original: string): string {
  const s = (original ?? "").trim();
  if (!s) return "FW: (제목 없음)";
  return /^fwd?\s*:/i.test(s) ? s : `FW: ${s}`;
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

// 전달용 원문 — 답장의 "> " 인용과 달리 원문을 그대로 싣습니다.
//   전달받는 사람은 이 메일을 처음 보므로, 인용부호로 흐리게 만들 이유가 없고
//   보낸사람·받은날짜·제목이 함께 있어야 무엇을 전달받았는지 압니다.
export function quoteForward(input: {
  fromName: string;
  fromEmail: string;
  receivedAt: string | null;
  subject: string;
  body: string;
}): string {
  const who =
    [input.fromName, input.fromEmail ? `<${input.fromEmail}>` : ""]
      .filter(Boolean)
      .join(" ") || "(보낸사람 없음)";
  const when = input.receivedAt
    ? new Date(input.receivedAt).toISOString().slice(0, 16).replace("T", " ")
    : "(날짜 없음)";
  const head = [
    "",
    "",
    "-------- 전달된 메일 --------",
    `보낸사람: ${who}`,
    `받은날짜: ${when} (UTC)`,
    `제목: ${(input.subject ?? "").trim() || "(제목 없음)"}`,
    "",
  ].join("\n");
  return head + (input.body ?? "").slice(0, QUOTE_MAX_CHARS);
}

// 첨부 한 건 — 원본 메일에서 읽어온 바이트를 그대로 다시 붙입니다.
//   ★ filename 에는 반드시 '원본' 이름을 넣습니다. Storage 키는 ASCII 안전
//     이름이라(storageSafeName) 그걸 쓰면 받는 사람에게 "1-26105.hwp" 로
//     도착합니다 — 0단계에서 고친 것과 같은 함정입니다.
export type OutgoingAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

// 발송 — 실패 시 throw(호출부에서 status=failed 로 기록).
//   답장·전달이 같은 경로를 씁니다. 차이는 제목·본문·받는사람뿐입니다.
export async function sendReply(input: {
  to: string;
  cc?: string;
  subject: string;
  text: string;
  attachments?: OutgoingAttachment[];
}): Promise<void> {
  if (!isReplyConfigured()) {
    throw new Error(
      "발신 설정이 필요합니다. (NAVER_POP_USER / NAVER_POP_PASSWORD)",
    );
  }
  const to = (input.to ?? "").trim();
  if (!to) throw new Error("받는사람 주소가 없습니다.");
  const cc = (input.cc ?? "").trim();

  const tp = transport();
  await tp.sendMail({
    from: `동래구청소년센터 <${senderAddress()}>`,
    to,
    ...(cc ? { cc } : {}),
    subject: input.subject,
    text: input.text,
    ...(input.attachments && input.attachments.length > 0
      ? {
          attachments: input.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            ...(a.contentType ? { contentType: a.contentType } : {}),
          })),
        }
      : {}),
  });
}
