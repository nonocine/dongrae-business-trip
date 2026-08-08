import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isMailCategory, type MailCategory } from "@/lib/mail";

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
  "방과후·아카데미·강사·수강생·출석 관련 → 권수현",
  "공문·회계·세금·급여·계약·물품·정산 관련 → 김혜지",
  "청소년활동·행사·동아리·체험·참여기구 관련 → 박준우",
  "시설·안전점검·수리·대관·설비 관련 → 한지형",
].join("\n");

// 애매하거나 판단 불가일 때의 기본 담당자. ("미지정" 이 아님 — 지시 사항)
const FALLBACK_ASSIGNEE = "김혜지";

const SYSTEM_PROMPT = `당신은 동래구청소년센터 공용 메일함의 분류 담당자입니다.
받은 메일 한 통을 읽고 요약·분류·담당자 배정을 합니다.

[배정 규칙]
${ASSIGNEE_RULES}
애매하거나 판단이 어려우면 → ${FALLBACK_ASSIGNEE}
(어떤 경우에도 "미지정" 으로 두지 마세요. 항상 위 4명 중 한 명을 고릅니다.)

[출력 형식]
반드시 아래 형태의 JSON 객체 **하나만** 출력하세요.
설명·인사말·마크다운 코드펜스(백틱)를 절대 붙이지 마세요.
{"summary": "한 줄 요약(40자 내외)", "category": "공문|회계|방과후|청소년활동|시설|홍보|기타", "assignee": "직원 이름", "confidence": 0~1 사이 숫자}

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

// 메일 한 통 분류 — 실패하면 null(절대 throw 하지 않음).
export async function classifyMail(input: {
  from: string;
  subject: string;
  body: string;
}): Promise<MailClassification | null> {
  if (!isClassifierConfigured()) {
    console.warn("[mail-ai] ANTHROPIC_API_KEY 미설정 — 분류 skip");
    return null;
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
    if (!result) console.warn("[mail-ai] 응답 형식이 올바르지 않아 건너뜁니다.");
    return result;
  } catch (e) {
    // 키 값이 섞이지 않도록 message 만 남깁니다.
    console.warn("[mail-ai] 분류 실패:", e instanceof Error ? e.message : e);
    return null;
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
  processed: number; // 분류 성공
  skipped: number; // API 실패 등으로 ai_* 를 채우지 못한 건
  autoAssigned: AutoAssigned[];
};

// 미분류 메일 일괄 분류.
//   * 대상: ai_processed_at IS NULL AND deleted_at IS NULL, 최신순 최대 30건.
//   * ids 를 주면 그 메일들만(수집 직후 신규분) 대상으로 좁힙니다.
//   * 어떤 실패도 밖으로 던지지 않습니다.
export async function runMailClassification(options?: {
  ids?: string[];
  limit?: number;
}): Promise<ClassifyRunSummary> {
  const summary: ClassifyRunSummary = {
    processed: 0,
    skipped: 0,
    autoAssigned: [],
  };
  if (!isClassifierConfigured()) return summary;

  try {
    const limit = Math.max(1, Math.min(options?.limit ?? BATCH_LIMIT, BATCH_LIMIT));
    let query = supabaseAdmin
      .from("mail_messages")
      .select("id, from_name, from_email, subject, body_text, assignee_name")
      .is("ai_processed_at", null)
      .is("deleted_at", null)
      .order("received_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (options?.ids && options.ids.length > 0) {
      query = query.in("id", options.ids);
    }

    const { data, error } = await query;
    if (error) {
      console.warn("[mail-ai] 대상 조회 실패:", error.message);
      return summary;
    }

    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const id = String(row.id ?? "");
      if (!id) continue;
      const fromName = String(row.from_name ?? "").trim();
      const fromEmail = String(row.from_email ?? "").trim();
      const subject = String(row.subject ?? "").trim();

      const result = await classifyMail({
        from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
        subject,
        body: String(row.body_text ?? ""),
      });
      if (!result) {
        summary.skipped++;
        continue;
      }

      // confidence 가 임계값 이상이고 아직 담당자가 없을 때만 자동 지정합니다.
      // (사람이 이미 지정해 둔 담당자를 AI 가 덮어쓰지 않도록)
      const current = String(row.assignee_name ?? "").trim();
      const autoAssign =
        result.confidence >= AUTO_ASSIGN_CONFIDENCE && current.length === 0;

      const patch: Record<string, unknown> = {
        ai_summary: result.summary,
        ai_category: result.category,
        ai_suggested_assignee: result.assignee,
        ai_processed_at: new Date().toISOString(),
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
