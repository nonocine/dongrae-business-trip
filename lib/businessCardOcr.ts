import Anthropic from "@anthropic-ai/sdk";
import {
  parseCardFields,
  type CardFields,
} from "@/lib/businessCards";

// =====================================================================
// 명함 OCR — 명함 사진 1장을 AI 로 읽어 항목을 추출합니다.
//   * 공용 메일함 분류기(lib/mailClassifier)와 같은 SDK·같은 API 키를
//     재사용합니다(ANTHROPIC_API_KEY). 새 키를 만들지 않습니다.
//   * 텍스트 분류와 달리 이미지(vision)를 보내므로 messages 에 image 블록을
//     함께 싣습니다. 비용을 아끼려고 모델은 Haiku 로 고정합니다.
//   * ★ 완전 격리: API 실패·응답 파싱 실패는 절대 throw 하지 않습니다.
//     실패하면 null 을 돌려주고 담당자가 수기로 입력하면 됩니다.
//   * ⚠️ 개인정보: 명함 이미지·추출 결과(이름·연락처)를 로그에 남기지
//     않습니다. 실패 시에도 예외 message 만 남깁니다.
//   * 서버 전용 — ANTHROPIC_API_KEY 는 NEXT_PUBLIC_ 이 아니므로 브라우저에
//     노출되지 않습니다.
// =====================================================================

const MODEL = "claude-haiku-4-5"; // 비용 최소(명함 1장 판독은 단순 작업)
const MAX_TOKENS = 700;

const SYSTEM_PROMPT = `당신은 명함 이미지를 읽어 연락처 정보를 추출하는 도구입니다.

[규칙]
- 이미지에 실제로 적힌 내용만 사용하세요. 추측해서 채우지 마세요.
- 없는 항목은 빈 문자열("")로 두세요.
- 전화번호는 명함에 적힌 표기를 유지하되 공백은 정리하세요(예: 051-123-4567).
- 휴대전화(010 등)는 mobile, 사무실 유선은 phone 으로 구분하세요.
- 직책(팀장·과장 등)은 title, 소속 부서·팀은 department 로 구분하세요.

[출력 형식]
반드시 아래 형태의 JSON 객체 **하나만** 출력하세요.
설명·인사말·마크다운 코드펜스(백틱)를 절대 붙이지 마세요.
{"company": "", "department": "", "title": "", "person_name": "", "mobile": "", "phone": "", "fax": "", "email": "", "address": "", "website": ""}`;

export function isCardOcrConfigured(): boolean {
  return (process.env.ANTHROPIC_API_KEY ?? "").trim().length > 0;
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

export type CardOcrResult = {
  fields: CardFields;
  // ocr_raw 에 남길 감사 기록 — 원본 응답 텍스트와 모델명(이미지는 저장 안 함).
  raw: { model: string; text: string; scanned_at: string };
};

// 명함 1장 판독 — 실패하면 null(절대 throw 하지 않음).
export async function scanCardImage(input: {
  base64: string;
  mediaType: string;
}): Promise<CardOcrResult | null> {
  if (!isCardOcrConfigured()) {
    console.warn("[card-ocr] ANTHROPIC_API_KEY 미설정 — 판독 skip");
    return null;
  }
  try {
    const response = await client().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                // SDK 타입은 지원 형식 리터럴을 요구합니다. 호출부에서 이미
                // 허용 목록으로 걸러 보냅니다.
                media_type: input.mediaType as
                  | "image/jpeg"
                  | "image/png"
                  | "image/webp"
                  | "image/gif",
                data: input.base64,
              },
            },
            { type: "text", text: "이 명함에서 항목을 추출해 JSON 으로만 답하세요." },
          ],
        },
      ],
    });

    // content 는 블록 배열 — text 블록만 이어붙입니다.
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const fields = parseCardFields(text);
    if (!fields) {
      // ⚠️ 응답 본문에는 개인정보가 들어 있으므로 로그에 남기지 않습니다.
      console.warn("[card-ocr] 응답 형식이 올바르지 않습니다.");
      return null;
    }
    return {
      fields,
      raw: { model: MODEL, text, scanned_at: new Date().toISOString() },
    };
  } catch (e) {
    // 키 값·이미지가 섞이지 않도록 message 만 남깁니다.
    console.warn("[card-ocr] 판독 실패:", e instanceof Error ? e.message : e);
    return null;
  }
}
