// =====================================================================
// 공용 메일함 1단계 — 네이버 POP3 수집기 (Cron / 수동버튼 공용 코어).
//
//   ★ 절대 규칙: DELE 를 절대 호출하지 않습니다. 네이버 원본은 보존합니다.
//     이 파일 어디에도 DELE 는 없어야 하며, 수집은 UIDL + RETR 만 사용합니다.
//     (네이버쪽 "POP3 로 가져간 메일 원본 보관" 설정과 함께 이중 안전장치)
//
//   * 중복 방지: mail_messages.pop_uid(unique) 에 없는 UIDL 만 RETR.
//   * 1회 최대 30통 — 서버리스 실행시간 한도 대비. 백로그는 다음 주기에 이어서.
//   * 개별 메일 파싱 실패는 건너뛰고 계속(전체를 죽이지 않음).
//   * "use server" 아님 — 라우트/액션이 각자 인증 후 호출.
// =====================================================================

import Pop3Command from "node-pop3";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseRawMail, selectNewUids } from "@/lib/mailParse";
import { MAIL_BUCKET, type MailAttachmentMeta } from "@/lib/mail";
import { sendSlack, siteBaseUrl, slackLink } from "@/lib/slack";

const POP_HOST = "pop.naver.com";
const POP_PORT = 995;
const FETCH_LIMIT = 30; // 1회 수집 상한
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10MB 초과는 메타데이터만

export type MailFetchSummary = {
  ok: boolean;
  total: number; // 사서함 전체 통수
  newFound: number; // 신규(미저장) 통수
  saved: number; // 이번에 저장한 통수
  failed: number; // 파싱·저장 실패
  remaining: number; // 이번에 못 가져온 백로그
  attachmentsSaved: number;
  attachmentsSkipped: number;
  newMails: { from: string; subject: string }[]; // 슬랙 알림용(ML-3)
  message?: string;
};

function emptySummary(message: string): MailFetchSummary {
  return {
    ok: false,
    total: 0,
    newFound: 0,
    saved: 0,
    failed: 0,
    remaining: 0,
    attachmentsSaved: 0,
    attachmentsSkipped: 0,
    newMails: [],
    message,
  };
}

// RETR 스트림을 Buffer 로 모읍니다.
//   문자열로 바꾸지 않는 게 중요 — EUC-KR 8bit 본문이 깨지지 않습니다.
function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer | string) =>
      chunks.push(typeof c === "string" ? Buffer.from(c, "binary") : c),
    );
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// 저장된 pop_uid 전체를 Set 으로. (사서함 규모가 수천 통이어도 uid 문자열뿐이라 가볍습니다.)
async function loadKnownUids(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from("mail_messages")
    .select("pop_uid");
  if (error) throw new Error(error.message);
  return new Set(
    (data ?? []).map((r) => String((r as { pop_uid: unknown }).pop_uid ?? "")),
  );
}

// 비공개 버킷 준비 — 없으면 만듭니다(이미 있으면 무시). 실패해도 수집은 계속합니다.
async function ensureBucket(): Promise<void> {
  try {
    const { data } = await supabaseAdmin.storage.getBucket(MAIL_BUCKET);
    if (data) return;
    await supabaseAdmin.storage.createBucket(MAIL_BUCKET, { public: false });
  } catch (e) {
    console.warn(
      "[mail] 버킷 준비 실패(첨부는 메타데이터만 저장됩니다):",
      e instanceof Error ? e.message : e,
    );
  }
}

// ML-3. 새 메일 도착 알림 — 관리자 채널에 1건 요약. 0건이면 보내지 않습니다.
//   슬랙은 부가기능이라 sendSlack 이 내부에서 실패를 삼킵니다(수집 결과 영향 없음).
const NOTIFY_LIST_MAX = 5;

async function notifyNewMail(summary: MailFetchSummary): Promise<void> {
  if (summary.saved <= 0) return;
  const base = siteBaseUrl();
  const link = base ? slackLink(`${base}/mail`, "공용 메일함 열기") : "/mail";
  const shown = summary.newMails.slice(0, NOTIFY_LIST_MAX);
  const rest = summary.newMails.length - shown.length;

  const lines = [
    `📬 공용 메일 ${summary.saved}건 도착`,
    ...shown.map((m) => `• ${m.from} — ${m.subject}`),
  ];
  if (rest > 0) lines.push(`외 ${rest}건`);
  if (summary.remaining > 0)
    lines.push(`(백로그 ${summary.remaining}건은 다음 수집에 이어서)`);
  lines.push(link);

  await sendSlack("SLACK_WEBHOOK_ADMIN", lines.join("\n"));
}

// notify: 새 메일 슬랙 알림 발송 여부. Cron 은 true, 화면의 [지금 가져오기] 는
//   실행한 사람이 결과를 바로 보고 있으므로 false 로 호출합니다(중복 알림 방지).
export async function runMailFetch(options?: {
  notify?: boolean;
}): Promise<MailFetchSummary> {
  const user = process.env.NAVER_POP_USER;
  const password = process.env.NAVER_POP_PASSWORD;
  if (!user || !password) {
    return emptySummary(
      "NAVER_POP_USER / NAVER_POP_PASSWORD 환경변수가 설정되지 않았습니다.",
    );
  }

  const knownUids = await loadKnownUids();

  const pop = new Pop3Command({
    user,
    password,
    host: POP_HOST,
    port: POP_PORT,
    tls: true,
    timeout: 20000,
    // 스트림을 직접 Buffer 로 모읍니다(문자열 변환 금지 — 인코딩 보존).
    parseStreamToString: false,
  });

  const summary: MailFetchSummary = {
    ok: true,
    total: 0,
    newFound: 0,
    saved: 0,
    failed: 0,
    remaining: 0,
    attachmentsSaved: 0,
    attachmentsSkipped: 0,
    newMails: [],
  };

  try {
    const uidlRaw = await pop.UIDL();
    const pairs = (Array.isArray(uidlRaw) ? uidlRaw : []) as string[][];
    summary.total = pairs.length;

    const { picks, remaining } = selectNewUids(pairs, knownUids, FETCH_LIMIT);
    summary.newFound = picks.length + remaining;
    summary.remaining = remaining;
    if (picks.length === 0) return summary;

    await ensureBucket();

    for (const pick of picks) {
      try {
        const retr = await pop.RETR(pick.msgNumber);
        const raw =
          typeof retr === "string"
            ? Buffer.from(retr, "binary")
            : await streamToBuffer(retr as unknown as NodeJS.ReadableStream);
        const mail = await parseRawMail(raw);

        // 1) 본문 먼저 저장 — 첨부 경로에 행 id 가 필요합니다.
        const { data: inserted, error: insertError } = await supabaseAdmin
          .from("mail_messages")
          .insert({
            pop_uid: pick.uid,
            message_id: mail.message_id,
            from_name: mail.from_name,
            from_email: mail.from_email,
            subject: mail.subject,
            body_text: mail.body_text,
            body_html: mail.body_html,
            received_at: mail.received_at,
            fetched_at: new Date().toISOString(),
            has_attachments: mail.attachments.length > 0,
            attachments: [],
            status: "unread",
          })
          .select("id")
          .single();
        if (insertError) {
          // 23505 = unique 위반. 수동 실행과 Cron 이 겹친 경우 — 중복이므로 건너뜁니다.
          if (insertError.code === "23505") continue;
          throw new Error(insertError.message);
        }
        const id = String((inserted as { id: string }).id);

        // 2) 첨부 업로드 — 10MB 이하만. 실패해도 메일 자체는 남깁니다.
        const metas: MailAttachmentMeta[] = [];
        for (const att of mail.attachments) {
          if (att.size > ATTACHMENT_MAX_BYTES) {
            metas.push({ name: att.filename, size: att.size, storage_path: null });
            summary.attachmentsSkipped++;
            continue;
          }
          const path = `mail/${id}/${att.filename}`;
          const { error: uploadError } = await supabaseAdmin.storage
            .from(MAIL_BUCKET)
            .upload(path, att.content, {
              contentType: att.contentType,
              upsert: true,
            });
          if (uploadError) {
            console.warn(`[mail] 첨부 업로드 실패(${att.filename}):`, uploadError.message);
            metas.push({ name: att.filename, size: att.size, storage_path: null });
            summary.attachmentsSkipped++;
            continue;
          }
          metas.push({ name: att.filename, size: att.size, storage_path: path });
          summary.attachmentsSaved++;
        }
        if (metas.length > 0) {
          await supabaseAdmin
            .from("mail_messages")
            .update({ attachments: metas })
            .eq("id", id);
        }

        summary.saved++;
        summary.newMails.push({
          from: mail.from_name || mail.from_email || "(보낸사람 없음)",
          subject: mail.subject || "(제목 없음)",
        });
      } catch (e) {
        // 개별 메일 실패는 건너뛰고 계속 — 한 통 때문에 수집 전체를 멈추지 않습니다.
        summary.failed++;
        console.warn(
          `[mail] 메일 처리 실패(uid=${pick.uid}):`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    if (options?.notify !== false) await notifyNewMail(summary);
    return summary;
  } finally {
    // DELE 없이 종료 — 원본은 네이버에 그대로 남습니다.
    try {
      await pop.QUIT();
    } catch {
      /* 연결 종료 실패는 무시 */
    }
  }
}
