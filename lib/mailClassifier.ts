import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { MAIL_CATEGORIES, isMailCategory, type MailCategory } from "@/lib/mail";
import { classifyByKeyword } from "@/lib/mailKeywordRules";
import { loadSenderLearning } from "@/lib/mailSenderLearning";
import { markIsStale, writeMark } from "@/lib/settingsMark";
import { sendSlack, siteBaseUrl, slackLink } from "@/lib/slack";

// =====================================================================
// 공용 메일함 2단계 — AI 분류·요약 (ML-5)
//   * 수집 직후 신규 메일마다 Anthropic API 를 1회 호출해 한 줄 요약·분류·
//     담당자 추천을 받아 ai_* 컬럼에 저장합니다.
//   * ★ 완전 격리: API 실패·응답 파싱 실패는 절대 throw 하지 않습니다.
//     실패하면 ai_* 를 null 로 둔 채 수집만 정상 완료시킵니다(메일은 이미
//     저장되어 있으므로 사람이 화면에서 직접 처리하면 됩니다).
//   * 비용 억제: 1회 실행당 최대 30건, ai_processed_at 이 있으면 건너뜁니다.
//   * 서버 전용 — ANTHROPIC_API_KEY 는 NEXT_PUBLIC_ 이 아니므로 브라우저에
//     노출되지 않습니다. 키 값은 어떤 로그에도 출력하지 않습니다.
// =====================================================================

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 300;
const BODY_CHARS = 2000; // 본문은 앞 2000자만 (비용·토큰 억제)
const BATCH_LIMIT = 30; // 1회 수집당 최대 분류 건수

// confidence 가 이 값 이상이면 assignee_name 까지 자동 지정,
// 미만이면 추천(ai_suggested_assignee)만 남기고 사람이 확정합니다.
export const AUTO_ASSIGN_CONFIDENCE = 0.7;

// 분류 목록·뱃지 색은 lib/mail.ts(클라이언트 안전) 에 있습니다.

// 배정 규칙 — 프롬프트에 그대로 넣습니다. 담당자가 바뀌면 여기만 고치면 됩니다.
const ASSIGNEE_RULES = [
  "방카·아카데미·강사·수강생·출석 관련 → 권수현",
  "토요늘봄·토요일 방과후·늘봄·통합방과후 관련 → 이민정",
  "공문·회계·세금·급여·계약·물품·정산 관련 → 김혜지",
  "청소년활동·행사·동아리·체험·참여기구 관련 → 박준우",
  "시설·안전점검·수리·대관·설비 관련 → 한지형",
].join("\n");

// 애매하거나 판단 불가일 때의 기본 담당자. ("미지정" 이 아님 — 지시 사항)
const FALLBACK_ASSIGNEE = "김혜지";

// --- 크레딧 소진 알림 ---
//   ★ 크레딧이 떨어지면 AI 분류가 조용히 멈추고 새 메일이 "기타" 로 쌓입니다.
//     2026-09 메일 수집 사고와 똑같은 모양(고장인데 아무도 모름)이라, 반드시
//     사람에게 닿아야 합니다. 수집 실패 알림과 같은 패턴으로 하루 1회만.
const CREDIT_ALERT_KEY = "mail_ai_credit_alert_at";
const CREDIT_ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CREDIT_ALERT_WEBHOOK = "SLACK_WEBHOOK_ADMIN";

// 분류 기준 — 이름만으로는 가를 수 없는 칸이 있어 기준을 명시합니다.
//   ★ 특히 방카/토요늘봄은 둘 다 "방과후" 라 불리지만 사업도 담당자도 다릅니다.
//     기준 없이 이름만 주면 모델이 둘을 섞습니다(2026-09 개편 이전 상태).
//   ★ 홍보/광고도 마찬가지 — 방향이 반대입니다(우리가 하는 홍보 vs 외부가
//     보내온 광고). 이 구분이 없어 광고가 전부 "기타" 로 쌓였습니다.
const CATEGORY_RULES = `공문 = 관공서·상급기관의 공문, 지침, 협조 요청
회계 = 세금·급여·계약·정산·물품 구매 등 돈이 오가는 건
방카 = 청소년방과후아카데미. "방카", "방과후아카데미",
  부산청소년방과후아카데미연합회, 아카데미 운영지도안·운영계획서 등
토요늘봄 = 토요일 방과후·통합방과후·늘봄. "토요일", "늘봄", "통합방과후",
  "동래미래 아카데미", 그리고 과목별 강의계획서
  (댄스·미술·디지털드로잉·바이올린·오케스트라·통기타·비보이 등)
청소년활동 = 행사·동아리·체험·참여기구 등 센터 청소년활동 사업
시설 = 시설·안전점검·수리·대관·설비
홍보 = 우리 센터가 하는 홍보·보도자료·대외협력
광고 = 외부에서 보내온 광고·판촉·영업 메일
  (업체 홍보, 상품 안내, 유료 세미나 판매 등). 우리가 하는 홍보와 구분합니다
기타 = 위 어디에도 해당하지 않는 것

[분류 예시]
"26방카 수학운영계획서" → 방카
"부산청소년방과후아카데미연합회 정기회의" → 방카
"토요일 통기타 대체강사입니다!" → 토요늘봄
"늘봄 9월 10월 비보이, 유튜브 강의 계획서" → 토요늘봄
"슥샥 디지털 드로잉 : 26년 4차시 강의 계획서" → 토요늘봄`;

const SYSTEM_PROMPT = `당신은 동래구청소년센터 공용 메일함의 분류 담당자입니다.
받은 메일 한 통을 읽고 요약·분류·담당자 배정을 합니다.

[분류 기준]
${CATEGORY_RULES}

[배정 규칙]
${ASSIGNEE_RULES}
애매하거나 판단이 어려우면 → ${FALLBACK_ASSIGNEE}
(어떤 경우에도 "미지정" 으로 두지 마세요. 항상 위 5명 중 한 명을 고릅니다.)

[출력 형식]
반드시 아래 형태의 JSON 객체 **하나만** 출력하세요.
설명·인사말·마크다운 코드펜스(백틱)를 절대 붙이지 마세요.
{"summary": "한 줄 요약(40자 내외)", "category": "${MAIL_CATEGORIES.join("|")}", "assignee": "직원 이름", "confidence": 0~1 사이 숫자}

confidence 는 배정 확신도입니다. 근거가 뚜렷하면 높게, 추측이면 낮게 매기세요.`;

export type MailClassification = {
  summary: string;
  category: MailCategory;
  assignee: string;
  confidence: number;
};

export function isClassifierConfigured(): boolean {
  return (process.env.ANTHROPIC_API_KEY ?? "").trim().length > 0;
}

// 크레딧 소진·인증 거부인지 판별합니다.
//   * 401 인증 거부, 402 결제 필요, 429 한도 초과 — 크레딧이 바닥나면
//     이 중 하나로 옵니다(SDK 가 status 를 실어 줍니다).
//   * 문구로도 한 번 더 봅니다 — 같은 상황을 400 + 메시지로 주는 경우가 있어서.
//   ★ 네트워크 오류·일시적 5xx 와 구분해야 합니다. 그건 크레딧 문제가 아니라
//     다시 시도하면 되는 것이라, 알림을 보내면 늑대소년이 됩니다.
export function isCreditError(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status;
  if (status === 401 || status === 402 || status === 429) return true;
  const message = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    message.includes("insufficient") ||
    message.includes("credit balance") ||
    message.includes("quota") ||
    message.includes("billing")
  );
}

// 크레딧 소진 슬랙 알림 — 하루 1회.
//   ★ 알림은 부가기능입니다. 여기서 무슨 일이 생겨도 절대 throw 하지 않습니다.
async function notifyCreditExhausted(error: unknown): Promise<void> {
  try {
    const now = Date.now();
    if (!(await markIsStale(CREDIT_ALERT_KEY, CREDIT_ALERT_INTERVAL_MS, now)))
      return;

    const base = siteBaseUrl();
    const link = base ? slackLink(`${base}/mail`, "공용 메일함 열기") : "/mail";
    const lines = [
      "⚠️ AI 메일 분류가 크레딧 부족으로 중단됐습니다. 키워드로 분류되는 메일은 계속 정리되지만, 나머지는 '기타'로 쌓입니다.",
      `오류: ${error instanceof Error ? error.message : String(error)}`,
      "※ 이 알림은 하루에 1회만 보냅니다.",
      link,
    ];
    const sent = await sendSlack(CREDIT_ALERT_WEBHOOK, lines.join("\n"));
    // 실제로 보낸 경우에만 억제합니다 — 웹훅이 미설정이면 기록하지 않아,
    //   나중에 웹훅을 넣는 즉시 알림이 나갑니다.
    if (sent) await writeMark(CREDIT_ALERT_KEY, new Date(now).toISOString());
  } catch (e) {
    console.warn(
      "[mail-ai] 크레딧 알림 실패:",
      e instanceof Error ? e.message : e,
    );
  }
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

// 모델 응답 텍스트 → MailClassification. 형식이 어긋나면 null.
//   프롬프트로 JSON 만 요구하지만, 혹시 코드펜스나 앞뒤 설명이 섞여도
//   첫 번째 { … } 구간을 잘라내 최대한 살려봅니다.
export function parseClassification(raw: string): MailClassification | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  const summary = String(o.summary ?? "").trim();
  if (!summary) return null;

  const category = isMailCategory(o.category) ? o.category : "기타";

  // 담당자는 규칙상 4명 중 하나여야 합니다. 빈 값·"미지정" 은 기본값으로.
  let assignee = String(o.assignee ?? "").trim();
  if (!assignee || assignee === "미지정") assignee = FALLBACK_ASSIGNEE;

  const rawConfidence = Number(o.confidence);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.min(1, Math.max(0, rawConfidence))
    : 0;

  return { summary: summary.slice(0, 200), category, assignee, confidence };
}

// 분류 결과 — 실패 사유를 호출부가 구분할 수 있어야 합니다.
//   크레딧 소진이면 남은 메일에 AI 를 더 부르지 않고(어차피 다 실패합니다)
//   슬랙으로 한 번 알려야 하기 때문입니다.
export type ClassifyOutcome =
  | { ok: true; value: MailClassification }
  | { ok: false; credit: boolean; error?: unknown };

// 메일 한 통 분류 — 실패해도 절대 throw 하지 않습니다.
export async function classifyMail(input: {
  from: string;
  subject: string;
  body: string;
}): Promise<ClassifyOutcome> {
  if (!isClassifierConfigured()) {
    console.warn("[mail-ai] ANTHROPIC_API_KEY 미설정 — 분류 skip");
    return { ok: false, credit: false };
  }
  try {
    const userText = [
      `보낸사람: ${input.from || "(없음)"}`,
      `제목: ${input.subject || "(없음)"}`,
      "본문:",
      input.body.slice(0, BODY_CHARS) || "(본문 없음)",
    ].join("\n");

    const response = await client().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
    });

    // content 는 블록 배열 — text 블록만 이어붙입니다.
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const result = parseClassification(text);
    if (!result) {
      console.warn("[mail-ai] 응답 형식이 올바르지 않아 건너뜁니다.");
      return { ok: false, credit: false };
    }
    return { ok: true, value: result };
  } catch (e) {
    // 키 값이 섞이지 않도록 message 만 남깁니다.
    console.warn("[mail-ai] 분류 실패:", e instanceof Error ? e.message : e);
    return { ok: false, credit: isCreditError(e), error: e };
  }
}

// 자동 지정된 메일 — 호출부(ML-6)가 담당자에게 슬랙 DM 을 보낼 때 씁니다.
export type AutoAssigned = {
  id: string;
  subject: string;
  from: string;
  summary: string;
  assignee: string;
};

export type ClassifyRunSummary = {
  processed: number; // 분류 성공(키워드 + 발신자 + AI 합계)
  byKeyword: number; // 그중 제목 키워드로 처리한 건 — AI 호출 0회
  bySender: number; // 그중 발신자 학습으로 처리한 건 — AI 호출 0회
  manualKept: number; // 사람이 고쳐 둬서 건드리지 않은 건
  skipped: number; // API 실패 등으로 ai_* 를 채우지 못한 건
  creditExhausted: boolean; // 크레딧이 바닥나 AI 호출을 중단했는지
  autoAssigned: AutoAssigned[];
};

// 키워드·발신자 경로의 저장 — 분류와 출처만 남깁니다.
//   ai_summary 는 채우지 않습니다(요약은 AI 몫이고, 지어내면 "AI가 요약했다"
//   는 화면 신호가 거짓이 됩니다). ai_processed_at 은 찍습니다 — 안 찍으면
//   매 수집마다 같은 메일을 다시 집어 자동 경로가 끝나지 않습니다.
async function saveCategory(
  id: string,
  category: MailCategory,
  source: "keyword" | "sender",
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("mail_messages")
    .update({
      ai_category: category,
      ai_processed_at: new Date().toISOString(),
      category_source: source,
    })
    .eq("id", id);
  if (error) {
    console.warn(`[mail-ai] 저장 실패(id=${id}):`, error.message);
    return false;
  }
  return true;
}

// 미분류 메일 일괄 분류.
//   * 대상: ai_processed_at IS NULL AND deleted_at IS NULL, 최신순 최대 30건.
//   * ids 를 주면 그 메일들만(수집 직후 신규분) 대상으로 좁힙니다.
//   * force 면 ai_processed_at 조건을 빼고 재분석합니다 — 화면의 [AI 분석]
//     버튼처럼 사람이 명시적으로 요청한 경우에만 씁니다(자동 경로는 항상
//     미분류만 처리해 중복 과금을 막습니다).
//   * keepAssignee 면 담당자를 일절 건드리지 않습니다 — 분류 기준이 바뀌어
//     기존 메일을 일괄 재분류할 때(scripts/reclassify-mail.ts) 씁니다.
//     ★ 이게 없으면 담당자가 비어 있던 메일 수백 통이 한꺼번에 자동 배정되고,
//       호출부에 따라 슬랙 DM 까지 쏟아집니다. autoAssigned 를 비워 두므로
//       DM 경로도 함께 막힙니다.
//   * 어떤 실패도 밖으로 던지지 않습니다.
export async function runMailClassification(options?: {
  ids?: string[];
  limit?: number;
  force?: boolean;
  keepAssignee?: boolean;
}): Promise<ClassifyRunSummary> {
  const summary: ClassifyRunSummary = {
    processed: 0,
    byKeyword: 0,
    bySender: 0,
    manualKept: 0,
    skipped: 0,
    creditExhausted: false,
    autoAssigned: [],
  };
  // ★ 키가 없어도 키워드 분류는 돌아야 합니다 — 크레딧이 떨어졌을 때 최소한
  //   확실한 메일은 계속 정리되게 하는 것이 이 하이브리드의 목적입니다.
  //   (예전에는 여기서 바로 return 이라 아무것도 분류되지 않았습니다.)

  try {
    const limit = Math.max(1, Math.min(options?.limit ?? BATCH_LIMIT, BATCH_LIMIT));
    let query = supabaseAdmin
      .from("mail_messages")
      .select(
        "id, from_name, from_email, subject, body_text, assignee_name, category_source",
      )
      .is("deleted_at", null)
      // ★ 사람이 고친 분류는 자동 경로가 절대 덮어쓰지 않습니다.
      //   force(재분류)여도 마찬가지입니다 — 사람 판단이 가장 정확합니다.
      .or("category_source.is.null,category_source.neq.manual")
      .order("received_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (!options?.force) query = query.is("ai_processed_at", null);
    if (options?.ids && options.ids.length > 0) {
      query = query.in("id", options.ids);
    }

    const { data, error } = await query;
    if (error) {
      console.warn("[mail-ai] 대상 조회 실패:", error.message);
      return summary;
    }

    const rows = (data ?? []) as Record<string, unknown>[];

    // 발신자 학습 — 이 배치에 등장하는 발신자들의 분포를 한 번에 읽습니다.
    //   ★ 메일마다 쿼리하면 30건 배치에 30회가 나갑니다. 반드시 배치로.
    const sender = await loadSenderLearning(
      rows.map((r) => ({
        fromEmail: String(r.from_email ?? ""),
        fromName: String(r.from_name ?? ""),
      })),
    );

    for (const row of rows) {
      const id = String(row.id ?? "");
      if (!id) continue;
      // 사람이 고친 건은 건드리지 않습니다. 쿼리에서도 걸렀지만, ids 를
      //   직접 넘기는 호출(재분류 스크립트)까지 확실히 막기 위해 한 번 더.
      if (String(row.category_source ?? "") === "manual") {
        summary.manualKept++;
        continue;
      }
      const fromName = String(row.from_name ?? "").trim();
      const fromEmail = String(row.from_email ?? "").trim();
      const subject = String(row.subject ?? "").trim();

      // --- 1) 키워드 우선 ---
      //   확실한 것은 여기서 끝냅니다(AI 호출 0회 = 비용 0).
      //   ai_summary 는 채우지 않습니다 — 요약은 AI 몫이고, 빈 요약을 지어내면
      //   화면에서 "AI가 요약했다" 는 신호가 거짓이 됩니다.
      //   ai_processed_at 은 찍습니다 — 안 찍으면 매 수집마다 같은 메일을
      //   다시 집어 자동 경로가 영영 끝나지 않습니다.
      const keyword = classifyByKeyword(subject, fromName);
      if (keyword) {
        if (await saveCategory(id, keyword, "keyword")) {
          summary.processed++;
          summary.byKeyword++;
        } else summary.skipped++;
        continue;
      }

      // --- 2) 발신자 학습 ---
      //   "이 발신자는 늘 광고였다". 키워드보다 뒤인 이유: 한 발신자가 여러
      //   사업 메일을 보내므로(양정수련관이 방카 연합회 건과 행사 홍보를 모두
      //   보냅니다), 제목에 명시적 단서가 있으면 그쪽이 더 정확합니다.
      const learned = sender.predict({
        fromEmail: String(row.from_email ?? ""),
        fromName,
      });
      if (learned) {
        if (await saveCategory(id, learned, "sender")) {
          summary.processed++;
          summary.bySender++;
        } else summary.skipped++;
        continue;
      }

      // --- 3) 키워드·발신자로 안 잡힌 것만 AI ---
      //   크레딧이 이미 바닥난 것을 확인했으면 더 부르지 않습니다.
      //   ★ 이 판정이 키워드 블록 "아래" 에 있는 게 중요합니다 — 크레딧이
      //     없어도 키워드로 잡히는 메일은 계속 저장돼야 하기 때문입니다.
      if (summary.creditExhausted) {
        summary.skipped++;
        continue;
      }

      const outcome = await classifyMail({
        from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
        subject,
        body: String(row.body_text ?? ""),
      });
      if (!outcome.ok) {
        // 크레딧 소진이면 ai_category 를 건드리지 않고 넘어갑니다 — "기타" 로
        //   강제하면 나중에 재분류 대상으로 찾을 수 없습니다.
        if (outcome.credit) {
          summary.creditExhausted = true;
          await notifyCreditExhausted(outcome.error);
        }
        summary.skipped++;
        continue;
      }
      const result = outcome.value;

      // confidence 가 임계값 이상이고 아직 담당자가 없을 때만 자동 지정합니다.
      // (사람이 이미 지정해 둔 담당자를 AI 가 덮어쓰지 않도록)
      const current = String(row.assignee_name ?? "").trim();
      const autoAssign =
        !options?.keepAssignee &&
        result.confidence >= AUTO_ASSIGN_CONFIDENCE &&
        current.length === 0;

      const patch: Record<string, unknown> = {
        ai_summary: result.summary,
        ai_category: result.category,
        ai_suggested_assignee: result.assignee,
        ai_processed_at: new Date().toISOString(),
        category_source: "ai",
      };
      if (autoAssign) patch.assignee_name = result.assignee;

      const { error: updateError } = await supabaseAdmin
        .from("mail_messages")
        .update(patch)
        .eq("id", id);
      if (updateError) {
        console.warn(`[mail-ai] 저장 실패(id=${id}):`, updateError.message);
        summary.skipped++;
        continue;
      }

      summary.processed++;
      if (autoAssign) {
        summary.autoAssigned.push({
          id,
          subject: subject || "(제목 없음)",
          from: fromName || fromEmail || "(보낸사람 없음)",
          summary: result.summary,
          assignee: result.assignee,
        });
      }
    }
  } catch (e) {
    console.warn(
      "[mail-ai] 분류 처리 중 오류:",
      e instanceof Error ? e.message : e,
    );
  }
  return summary;
}
