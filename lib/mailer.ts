// =====================================================================
// Gmail SMTP 발송 (급여 3차 PART 1) — nodemailer.
//   * 계정: master@onnainna.kr + 앱 비밀번호. 자격증명은 환경변수로만.
//     - GMAIL_SENDER       (예: master@onnainna.kr)
//     - GMAIL_APP_PASSWORD (16자리 앱 비밀번호, 공백 제거)
//   * 값은 로그에 출력 금지. 미설정 시 isMailerConfigured()=false → UI 안내.
//   * 서버 전용 모듈("use server" 아님) — 서버 액션에서 import.
// =====================================================================

import nodemailer from "nodemailer";

const SENDER = () => (process.env.GMAIL_SENDER ?? "").trim();
const APP_PW = () => (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, "");

// 발송 자격증명이 준비되었는지(값 노출 없이 존재 여부만).
export function isMailerConfigured(): boolean {
  return SENDER().length > 0 && APP_PW().length > 0;
}

function transport() {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: SENDER(), pass: APP_PW() },
  });
}

// 첨부 없는 본문 메일 — 채용 접수완료 안내 등.
//   * 실패 시 throw. 부가기능에서 쓸 때는 호출처에서 try/catch 로 격리하세요.
export async function sendPlainMail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  if (!isMailerConfigured()) {
    throw new Error("발송 설정이 필요합니다. (GMAIL_SENDER / GMAIL_APP_PASSWORD)");
  }
  const tp = transport();
  await tp.sendMail({
    from: `동래구청소년센터 <${SENDER()}>`,
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
}

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

// 단건 발송 — 실패 시 throw(호출처에서 직원별로 catch 하여 집계).
export async function sendMailWithAttachment(input: {
  to: string;
  subject: string;
  text: string;
  attachments: MailAttachment[];
}): Promise<void> {
  if (!isMailerConfigured()) {
    throw new Error("발송 설정이 필요합니다. (GMAIL_SENDER / GMAIL_APP_PASSWORD)");
  }
  const tp = transport();
  await tp.sendMail({
    from: `동래구청소년센터 <${SENDER()}>`,
    to: input.to,
    subject: input.subject,
    text: input.text,
    attachments: input.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType ?? "application/pdf",
    })),
  });
}
