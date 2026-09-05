// =====================================================================
// 공용 메일함 1단계 — 네이버 POP3 수집기 (Cron / 수동버튼 공용 코어).
//
//   ★ 절대 규칙: DELE 를 절대 호출하지 않습니다. 네이버 원본은 보존합니다.
//     이 파일 어디에도 DELE 는 없어야 하며, 수집은 UIDL + RETR 만 사용합니다.
//     (네이버쪽 "POP3 로 가져간 메일 원본 보관" 설정과 함께 이중 안전장치)
//
//   * 중복 방지: mail_messages.pop_uid(unique) 에 없는 UIDL 만 RETR.
//   * 1회 최대 30통 — 서버리스 실행시간 한도 대비. 백로그는 다음 주기에 이어서.
//   * 최신 메일부터 가져옵니다 — POP3 메일 번호는 오래된 순이라 앞에서부터 읽으면
//     밀린 백로그를 다 훑어야 최신에 닿습니다. selectNewUids 주석 참고.
//   * 개별 메일 파싱 실패는 건너뛰고 계속(전체를 죽이지 않음).
//   * "use server" 아님 — 라우트/액션이 각자 인증 후 호출.
// =====================================================================

import Pop3Command from "node-pop3";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseRawMail, selectNewUids, storageSafeName } from "@/lib/mailParse";
import { MAIL_BUCKET, type MailAttachmentMeta } from "@/lib/mail";
import { runMailClassification } from "@/lib/mailClassifier";
import { notifyAutoAssigned } from "@/lib/mailNotify";
import { sendSlack, siteBaseUrl, slackLink } from "@/lib/slack";
import { fmtKstDateTime } from "@/lib/datetime";

const POP_HOST = "pop.naver.com";
const POP_PORT = 995;
const FETCH_LIMIT = 30; // 1회 수집 상한
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10MB 초과는 메타데이터만

// --- 수집 실패 알림(접속·인증 단계) ---
//   ★ 2026-08 사고: 네이버 인증이 막혔는데 알림도 기록도 없어 11일간 아무도
//     몰랐습니다. 실패는 반드시 사람에게 닿아야 합니다.
//   Cron 이 10분 주기라 그대로 두면 하루 144번 도배되므로, 마지막 발송 시각을
//   settings 에 남겨 같은 실패는 1시간에 1회만 알립니다.
const FETCH_ALERT_KEY = "mail_fetch_alert_at";
const FETCH_ALERT_INTERVAL_MS = 60 * 60 * 1000;

// --- 마지막 수집 시각 ---
//   ★ 2026-09: 화면 경고가 MAX(mail_messages.fetched_at)("마지막으로 메일을
//     저장한 시각")으로 지연을 판정해, 새 메일이 없는 밤·주말이면 Cron 이
//     멀쩡히 돌아도 "가져오지 못했습니다" 가 떴습니다. "수집 실패" 와 "새 메일
//     없음" 을 구분하지 못한 것이 원인입니다.
//   그래서 "수집을 시도해 네이버 접속·인증까지 성공한 시각" 을 따로 남기고,
//   경고는 이 값으로만 판정합니다. 가져온 메일이 0건이어도 갱신됩니다.
const LAST_FETCH_KEY = "mail_last_fetch_at";
// 전용 웹훅(SLACK_WEBHOOK_MAIL)은 없으므로 관리자 채널을 씁니다 —
//   메일 다이제스트(lib/mailDigest.ts)·백업 실패(lib/backupEngine.ts)와 같은 채널.
const FETCH_ALERT_WEBHOOK = "SLACK_WEBHOOK_ADMIN";

export type MailFetchSummary = {
  ok: boolean;
  total: number; // 사서함 전체 통수
  newFound: number; // 신규(미저장) 통수
  saved: number; // 이번에 저장한 통수
  failed: number; // 파싱·저장 실패
  remaining: number; // 이번에 못 가져온 백로그
  attachmentsSaved: number;
  attachmentsSkipped: number;
  newMails: { from: string; subject: string }[];
  // --- 2단계(ML-5/ML-6) ---
  classified: number; // AI 요약·분류에 성공한 건수
  autoAssigned: number; // confidence 임계값을 넘어 담당자까지 자동 지정된 건수
  dmSent: number; // 담당자 슬랙 DM 성공 건수
  slackUnreachable: string[]; // DM 이 닿지 않은 담당자(다이제스트에서 안내)
  dmFailures: { name: string; reason: string }[]; // 담당자별 실패 사유
  message?: string;
};

// 네이버 자격증명 — 환경변수를 그대로 믿지 않고 여기서 한 번 다듬습니다.
//   * trim: 값 끝에 붙은 공백·개행 하나로도 인증이 깨집니다.
//   * @ 보정: 네이버 단체 아이디는 POP3 인증에 전체 주소가 필요한데 아이디만
//     ("onnainna") 들어 있어 수집이 멈춘 적이 있습니다. lib/mailReply.ts 의
//     senderAddress() 와 같은 방식으로 맞춰, 환경변수가 어느 형식이든 동작하게 합니다.
//   * 비어 있으면 POP3 접속을 시도하지 않고 즉시 throw — "설정이 없다" 와
//     "인증이 거부됐다" 를 로그·화면에서 구분할 수 있어야 합니다.
function popCredentials(): { user: string; password: string } {
  const rawUser = (process.env.NAVER_POP_USER ?? "").trim();
  const password = (process.env.NAVER_POP_PASSWORD ?? "").trim();
  if (!rawUser || !password) {
    throw new Error(
      "메일 계정 설정(NAVER_POP_USER/NAVER_POP_PASSWORD)이 비어 있습니다.",
    );
  }
  return {
    user: rawUser.includes("@") ? rawUser : `${rawUser}@naver.com`,
    password,
  };
}

// settings 는 프로젝트 공용 Key-Value 테이블입니다(app/actions.ts 와 같은 구조).
//   알림 억제 상태·수집 시각 하나 때문에 새 테이블을 만들지 않고 여기에 얹습니다.
//   ★ 쓰기는 upsert(onConflict:"key") — key 에 unique 제약이 있어, select 후
//     insert/update 로 나누면 Cron 과 수동 버튼이 겹칠 때 충돌합니다.
async function readMark(key: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  const value = (data as { value: unknown }).value;
  return value == null ? null : String(value);
}

async function writeMark(key: string, value: string): Promise<void> {
  await supabaseAdmin
    .from("settings")
    .upsert({ key, value }, { onConflict: "key" });
}

// 수집 성공 시각을 남깁니다(접속·인증 성공 직후 호출).
//   ★ 기록 실패는 삼킵니다 — 이건 상태 표시용이므로, 여기서 throw 하면
//     수집·저장이라는 본 작업이 부가기능 때문에 멈춥니다(프로젝트 원칙).
async function markLastFetch(at: Date): Promise<void> {
  try {
    await writeMark(LAST_FETCH_KEY, at.toISOString());
  } catch (e) {
    console.warn(
      "[mail] 마지막 수집 시각 기록 실패:",
      e instanceof Error ? e.message : e,
    );
  }
}

// 수집이 정상으로 돌아오면 억제를 풉니다 — 다음에 또 끊겼을 때 24시간을
//   기다리지 않고 바로 알리기 위해서입니다.
async function clearAlertMark(): Promise<void> {
  try {
    await supabaseAdmin.from("settings").delete().eq("key", FETCH_ALERT_KEY);
  } catch (e) {
    console.warn(
      "[mail] 수집 실패 알림 억제 해제 실패:",
      e instanceof Error ? e.message : e,
    );
  }
}

// 접속·인증 실패 슬랙 알림.
//   ★ 알림은 부가기능 — 여기서 무슨 일이 생겨도 절대 throw 하지 않습니다
//     (프로젝트 원칙: 알림 실패가 본 작업을 막지 않는다).
//   실제로 발송된 경우에만 억제 기록을 남깁니다. 웹훅이 미설정이면 기록하지
//   않으므로, 나중에 웹훅을 넣는 즉시 알림이 나갑니다.
async function notifyFetchFailure(error: unknown): Promise<void> {
  try {
    const now = new Date();
    const last = await readMark(FETCH_ALERT_KEY);
    if (last) {
      const at = Date.parse(last);
      if (!Number.isNaN(at) && now.getTime() - at < FETCH_ALERT_INTERVAL_MS)
        return;
    }

    const base = siteBaseUrl();
    const link = base ? slackLink(`${base}/mail`, "공용 메일함 열기") : "/mail";
    const lines = [
      "🚨 공용 메일함이 메일을 가져오지 못하고 있습니다. 네이버 계정 설정을 확인해주세요.",
      `실패 시각: ${fmtKstDateTime(now.toISOString())} (KST)`,
      `오류: ${error instanceof Error ? error.message : String(error)}`,
      "※ 같은 실패가 반복돼도 이 알림은 1시간에 1회만 보냅니다.",
      link,
    ];
    const sent = await sendSlack(FETCH_ALERT_WEBHOOK, lines.join("\n"));
    if (sent) await writeMark(FETCH_ALERT_KEY, now.toISOString());
  } catch (e) {
    console.warn(
      "[mail] 수집 실패 알림 실패:",
      e instanceof Error ? e.message : e,
    );
  }
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

// ML-6. 관리자 채널 알림은 "수집할 때마다 건별" → "하루 1회 다이제스트" 로
//   옮겼습니다(10분 주기라 알림이 너무 잦았음). lib/mailDigest.ts 참고.
//   대신 수집 직후에는 AI 분류 → 담당자 본인에게만 DM 을 보냅니다.
//
// ★ ML-9 수정: 담당자 DM 은 트리거(Cron / 화면의 [지금 가져오기])와 무관하게
//   항상 보냅니다.
//   ML-6 에서 [지금 가져오기] 에 notify:false 를 넘겨 DM 을 막았는데, 이는
//   ML-3 의 "관리자 채널 요약" 억제 규칙을 그대로 가져온 실수였습니다.
//   관리자 채널 요약은 버튼을 누른 사람이 화면에서 결과를 바로 보므로 중복이
//   맞지만, 담당자 DM 은 받는 사람이 다릅니다 — 버튼을 누른 사람이 화면을
//   보고 있다는 사실은 김혜지가 알림을 받았는지와 아무 상관이 없습니다.
//   그래서 수동 수집으로 들어온 메일은 담당자가 영영 알림을 못 받았습니다.
//   ★ AI·슬랙은 전부 부가기능 — 여기서 실패해도 수집·저장 결과는 유지됩니다.
//   notify 옵션은 제거했습니다 — 다시 생기면 같은 버그가 재발합니다.
export async function runMailFetch(): Promise<MailFetchSummary> {
  // 설정이 비어 있으면 접속을 시도하지 않고 알린 뒤 throw 합니다.
  //   예전에는 ok:false 요약을 조용히 돌려줘 Cron 이 200 으로 끝났고, 그래서
  //   아무도 눈치채지 못했습니다.
  let user: string;
  let password: string;
  try {
    ({ user, password } = popCredentials());
  } catch (e) {
    await notifyFetchFailure(e);
    throw e;
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
    classified: 0,
    autoAssigned: 0,
    dmSent: 0,
    slackUnreachable: [],
    dmFailures: [],
  };

  // 이번 수집으로 새로 저장한 메일 id — AI 분류 대상을 이 건들로 좁힙니다.
  const savedIds: string[] = [];

  try {
    // node-pop3 는 첫 명령에서 접속·USER/PASS 인증을 함께 수행합니다 —
    //   자격증명이 틀리면 네이버의 -ERR 응답이 여기서 그대로 예외로 올라옵니다.
    let pairs: string[][] = [];
    try {
      const uidlRaw = await pop.UIDL();
      pairs = (Array.isArray(uidlRaw) ? uidlRaw : []) as string[][];
    } catch (e) {
      await notifyFetchFailure(e);
      throw e;
    }
    // 여기까지 왔으면 접속·인증은 성공 — 이전 실패의 알림 억제를 풀고,
    //   "수집이 돌았다" 는 사실을 남깁니다.
    //   ★ 이 자리는 아래 `picks.length === 0` 조기 return 보다 위입니다.
    //     새 메일이 0건인 밤·주말에도 시각이 갱신돼야 하기 때문입니다.
    //     아래로 내리면 2026-09 오작동이 그대로 재발합니다.
    await clearAlertMark();
    await markLastFetch(new Date());
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
        //    키는 ASCII 안전 이름(storageSafeName)으로 만듭니다. 한글 파일명을
        //    그대로 키에 쓰면 Supabase Storage 가 거부해 업로드가 실패합니다.
        //    표시용 원본 이름은 meta.name 에 그대로 남습니다.
        const metas: MailAttachmentMeta[] = [];
        for (const [attIndex, att] of mail.attachments.entries()) {
          if (att.size > ATTACHMENT_MAX_BYTES) {
            metas.push({
              name: att.filename,
              size: att.size,
              storage_path: null,
              skip_reason: "too_large",
            });
            summary.attachmentsSkipped++;
            continue;
          }
          const path = `mail/${id}/${storageSafeName(att.filename, attIndex)}`;
          const { error: uploadError } = await supabaseAdmin.storage
            .from(MAIL_BUCKET)
            .upload(path, att.content, {
              contentType: att.contentType,
              upsert: true,
            });
          if (uploadError) {
            console.warn(`[mail] 첨부 업로드 실패(${att.filename}):`, uploadError.message);
            metas.push({
              name: att.filename,
              size: att.size,
              storage_path: null,
              skip_reason: "failed",
            });
            summary.attachmentsSkipped++;
            continue;
          }
          metas.push({
            name: att.filename,
            size: att.size,
            storage_path: path,
            skip_reason: null,
          });
          summary.attachmentsSaved++;
        }
        if (metas.length > 0) {
          await supabaseAdmin
            .from("mail_messages")
            .update({ attachments: metas })
            .eq("id", id);
        }

        summary.saved++;
        savedIds.push(id);
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
    // --- ML-5/ML-6: AI 분류 → 담당자 DM ---
    //   runMailClassification 과 notifyAutoAssigned 는 내부에서 모든 예외를
    //   삼키므로 여기서 try/catch 를 더 두지 않아도 수집 결과가 보호됩니다.
    if (savedIds.length > 0) {
      const ai = await runMailClassification({ ids: savedIds });
      summary.classified = ai.processed;
      summary.autoAssigned = ai.autoAssigned.length;

      // 트리거와 무관하게 항상 발송합니다(위 ML-9 주석 참고).
      if (ai.autoAssigned.length > 0) {
        const dm = await notifyAutoAssigned(ai.autoAssigned);
        summary.dmSent = dm.sent;
        summary.slackUnreachable = dm.unreachable;
        summary.dmFailures = dm.failures;
      }
    }
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
