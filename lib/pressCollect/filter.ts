// 걸러내기 — 4-1 규칙(무료) → 4-2 애매한 것만 Haiku. 서버 전용.
//   규칙 결과: pass(확실히 통과) / exclude(확실히 제외) / unclear(판정 대상)
//   Haiku 키(ANTHROPIC_API_KEY_PRESS)가 없거나 실패하면 판정하지 않고 needs_review 로 둡니다.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import {
  PRESS_CENTER_TERMS,
  PRESS_HAIKU_MODEL,
  PRESS_LOOKALIKE_ORGS,
  PRESS_ROUNDUP_TITLE_PATTERNS,
  PRESS_SURE_TITLE_TERMS,
  type SearchTerm,
} from "./config";
import { containsLoose } from "./text";

export type RuleVerdict = {
  verdict: "pass" | "exclude" | "unclear";
  reason: string;
  roundupHint: boolean;
};

// bodyText 를 주면 본문까지 보고 판정합니다(요약에 검색어가 안 보일 때 원문 확인용).
//   noTermInSnippet: 요약에 검색어가 없어서 원문을 확인해야 하는 경우 — run 이 원문을 열고 다시 부릅니다.
export function ruleFilter(
  item: { title: string; description: string },
  matchedTerms: SearchTerm[],
  bodyText?: string,
): RuleVerdict & { noTermInSnippet?: boolean } {
  const title = item.title;
  const text = `${item.title} ${item.description}${bodyText ? ` ${bodyText}` : ""}`;
  const roundupHint = PRESS_ROUNDUP_TITLE_PATTERNS.some((re) => re.test(title));

  // 검색어가 실제로 있어야 함 — 헤르메스 exact_match. 요약에 없으면 원문 확인 후 다시 판정.
  const hits = matchedTerms.filter((t) => containsLoose(text, t.query));
  if (hits.length === 0) {
    return bodyText === undefined
      ? { verdict: "exclude", reason: "검색어가 요약에 없음 → 원문 확인 필요", roundupHint, noTermInSnippet: true }
      : { verdict: "exclude", reason: "검색어가 제목·요약·본문에 없음", roundupHint };
  }
  // 조선놀이터 등 — 함께 있어야 하는 말
  const okHits = hits.filter((t) => !t.requireAlso || text.includes(t.requireAlso));
  if (okHits.length === 0) {
    return { verdict: "exclude", reason: `"${hits[0].query}"만 있고 "${hits[0].requireAlso}" 없음`, roundupHint };
  }

  // 유사 기관 — 그 이름을 지운 뒤에도 우리 센터 이름이 남는지
  const lookalike = PRESS_LOOKALIKE_ORGS.find((o) => containsLoose(text, o));
  if (lookalike) {
    let rest = text;
    for (const o of PRESS_LOOKALIKE_ORGS) rest = rest.split(o).join(" ");
    if (!PRESS_CENTER_TERMS.some((t) => containsLoose(rest, t))) {
      return { verdict: "exclude", reason: `유사 기관(${lookalike})만 언급`, roundupHint };
    }
  }

  if (!roundupHint && PRESS_SURE_TITLE_TERMS.some((t) => containsLoose(title, t))) {
    return { verdict: "pass", reason: "제목에 센터 이름", roundupHint };
  }
  return {
    verdict: "unclear",
    reason: roundupHint ? "묶음기사 제목" : "제목에 센터 이름 없음(요약·예전 이름·앱 이름으로만 언급)",
    roundupHint,
  };
}

// --- Haiku 판정 --------------------------------------------------------

const JudgeSchema = z.object({
  ours: z.boolean(),
  venue_only: z.boolean(),
  is_roundup: z.boolean(),
  reason: z.string(),
});
export type HaikuJudgement = z.infer<typeof JudgeSchema>;

// 관장 결정(2026-11-03)
//   * 장소로만 언급(행사 장소·상영관 중 하나 등) → venue_only=true → 저장은 하되 needs_review(사람 판단).
//   * 묶음기사는 여러 기관·여러 소식을 모은 것만("부산 브리핑 모음", "동래구 소식").
//     축제 예고처럼 한 행사 기사 안에 우리 프로그램이 소개된 것은 일반 기사(is_roundup=false).
//   * 묶음기사도 홍보 실적에 들어갑니다(관장 결정 2026-11-03). is_roundup 은 구분 표시
//     (실적 "[묶음기사]", 슬랙 "📌 지역 소식 묶음 기사" 칸, 기자 연결 안 함)에만 씁니다.
const SYSTEM = `당신은 부산 동래구청소년센터(예전 이름: 동래구청소년수련관, 센터장 허일수)의 언론 보도 모니터링 담당입니다.
주어진 기사가 이 센터에 관한 보도인지 판정합니다.

- ours: 이 센터(또는 센터 사업: 어울리고GO·동래읍성GO 앱, 조선놀이터 부스, 사직동 청소년 자유공간 등)가
  기사에 실제로 나오면 true. 장소로만 한 번 나와도 true 입니다(아래 venue_only 로 구분).
  이름이 비슷한 다른 기관(동래구청소년상담복지센터, 동래구진로교육지원센터, 구덕청소년수련관 등)만 나오면 false.
- venue_only: 센터가 다른 기관 행사의 "장소"로만 언급되고 센터나 센터 사업에 대한 내용은 없으면 true.
  예) 영화 순회상영 장소 목록·공연 개최 장소 중 하나로 이름만 나옴 → ours=true, venue_only=true.
  센터가 주최·운영·참여하거나 센터 프로그램이 소개되면 false. ours=false 이면 venue_only 도 false.
  주의: 장소로만 나왔다고 ours=false 로 하지 마세요. 판단은 사람이 합니다.
- is_roundup: 여러 기관·여러 소식을 한 기사에 모은 묶음기사일 때만 true.
  예) "부산 브리핑 모음", "동래구 소식", "[부산은 오늘]", "구정 소식", 여러 단신을 이어 붙인 기사 → true.
  한 행사·한 주제 기사(예: 축제 개막 예고 기사) 안에 우리 프로그램이 여러 행사 중 하나로 소개된 것은 묶음기사가 아니므로 false.
  묶음기사도 우리 기사로 실적에 들어갑니다. is_roundup 은 기사 형태를 구분할 뿐이니 ours 판단에 영향을 주지 마세요.
- reason: 한국어 한 줄.`;

export function haikuConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY_PRESS?.trim();
}

let _client: Anthropic | null = null;

export async function haikuJudge(input: {
  title: string;
  outlet: string;
  description: string;
  bodyHead: string;
}): Promise<HaikuJudgement | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY_PRESS?.trim();
  if (!apiKey) return null;
  if (!_client) _client = new Anthropic({ apiKey });
  try {
    const res = await _client.messages.parse({
      model: PRESS_HAIKU_MODEL,
      max_tokens: 2048,
      output_config: { effort: "low", format: zodOutputFormat(JudgeSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `제목: ${input.title}\n언론사: ${input.outlet}\n요약: ${input.description}\n본문 앞부분:\n${input.bodyHead || "(없음)"}`,
        },
      ],
    });
    if (res.stop_reason === "refusal") return null;
    return res.parsed_output ?? null;
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      console.warn("[press-collect] Haiku 판정 실패:", e.status);
    } else {
      console.warn("[press-collect] Haiku 판정 실패");
    }
    return null;
  }
}
