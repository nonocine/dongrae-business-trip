import type { MailCategory } from "@/lib/mail";

// =====================================================================
// 공용 메일함 — 키워드 분류 규칙 (순수 함수)
//
//   왜 있는가: 예전에는 모든 메일을 AI 가 분류했습니다. Anthropic 크레딧이
//   떨어지면 새 메일이 전부 "기타" 로 쌓이는 구조라, 확실한 것은 키워드로
//   무료 분류하고 애매한 것만 AI 에 넘깁니다(하이브리드).
//
//   ★ 이 파일은 DB·AI·네트워크를 일절 쓰지 않습니다. 문자열만 봅니다.
//     그래서 scripts/test-mail-keyword.ts 로 단독 검증이 됩니다.
//
//   ★ 확신이 없으면 null 을 돌려주고 AI 에 넘깁니다. 억지로 맞추지 않습니다 —
//     틀린 분류는 분류가 없는 것보다 나쁩니다(담당자가 자기 칸에서 못 찾음).
// =====================================================================

// ---------------------------------------------------------------------
//   ★★ 키워드는 여기만 고치면 됩니다 ★★
//   아래 배열에 문자열을 넣고 빼는 것으로 규칙이 바뀝니다.
//   함수 본문은 건드릴 필요가 없습니다.
//
//   비교 규칙(normalize 참고):
//     · 대소문자를 무시합니다 — "ahnlab" 이라 적어도 "AhnLab" 에 걸립니다.
//     · 공백을 모두 지우고 비교합니다 — "방과후아카데미" 하나만 적어도
//       "방과 후 아카데미", "방과후 아카데미" 에 모두 걸립니다.
// ---------------------------------------------------------------------

// 발신자에 이 말이 있으면 광고로 보지 않습니다.
//   Goodstack 은 센터가 실제로 신청한 비영리 할인 지원 건이라, 광고 키워드에
//   걸리더라도 광고가 아닙니다. 그래서 광고 규칙보다 먼저 봅니다.
export const NOT_AD_SENDERS = ["Goodstack"];

export const AD_SUBJECTS = [
  "[광고]",
  "개인정보 이용",
  "개인정보처리방침",
  "이용약관 개정",
  "뉴스레터",
  "계정이 곧 삭제",
  "무료체험",
  "할인 혜택",
  "프로모션",
  "선물세트",
];

export const AD_SENDERS = [
  "오피스디포",
  "Miricanvas",
  "AhnLab",
  "네이버페이",
  "소셜이노베이션",
  "디지털배움터",
  "TechSoup",
  "네이버웹툰",
];

// 토요일 방과후(늘봄·통합방과후). 과목명 강의계획서가 여기로 옵니다.
export const SATURDAY_SUBJECTS = [
  // ★ "토요" 가 아니라 "토요일" 입니다 — "검토 요청" 이 "토요" 로 걸렸습니다.
  "토요일",
  "늘봄",
  "통합방과후",
  "통합 방과 후",
  "동래미래",
  "통기타",
  "바이올린",
  "오케스트라",
  "드로잉",
];

// 청소년방과후아카데미.
//   ★ 토요늘봄 키워드와 함께 나오면 이쪽이 이깁니다 — 같은 강사가 두 사업을
//     겸하는 탓에 제목이 섞이는데, "방카" 라고 적혀 있으면 방카가 맞습니다.
export const BANGKA_SUBJECTS = [
  "방카",
  "방과후아카데미",
  "방과 후 아카데미",
  "방과후 아카데미",
];

// ★ "정산"·"계약서"·"견적서" 를 뺐습니다 — 시설 공사·대관 메일에 붙습니다.
//   특히 "견적서" 는 실측 34건 중 10건(29%)이 회계가 아니었습니다
//   ("배수펌프 교체작업 견적서", "[견적서 요청] 대관 관련" 등).
//   남은 것들은 실측 충돌이 0~1건으로, 회계 밖에서 쓰일 일이 거의 없습니다.
export const ACCOUNTING_SUBJECTS = [
  "세금계산서", // 28건 · 충돌 0
  "청구서", // 10건 · 충돌 0
  "거래명세", // 9건 · 충돌 1
  "지출결의",
  "입금",
];

export const FACILITY_SUBJECTS = [
  "대관",
  "안전점검",
  "소방",
  "수리",
  // ★ "공사" 를 뺐습니다 — "한국해양진흥공사" 같은 기관명에 들어 있어
  //   청소년활동 메일이 시설로 잘못 갔습니다. 수리·설비·점검이 대신 잡습니다.
  "설비",
  "소독",
];

// ★ 공문은 키워드로 판별하지 않습니다 — 통째로 AI 에 맡깁니다.
//   · "협조 요청"·"제출 요청"·"개최의 건"·"알림의 건": 문서의 형식이지
//     내용이 아닙니다. 청소년활동 행사 안내에도, 회계 서류 요청에도 똑같이
//     붙어 49건이 공문으로 잘못 이동했습니다.
//   · 맨 단어 "공문": 실측 30건 중 16건이 공문이 아니었습니다
//     ("공문 첨부합니다" 같은 문장이 어느 사업 메일에나 들어갑니다).
//   · "[공문]" 대괄호 표기: 실측 28건 중 13건(46%)이 청소년활동이었습니다.
//     타 기관이 공문 형식으로 보낸 청소년활동 안내가 많습니다
//     ("[공문] 2026년 청소년 정책 제안 토론회 참가자 모집 안내" 등).
//   공문임을 제목만으로 가르려면 발신 기관까지 봐야 하는데, 그건 AI 몫입니다.
export const OFFICIAL_SUBJECTS: string[] = [];

// --- 비교 도우미 ------------------------------------------------------

// 두 가지 형태로 봅니다.
//   collapsed: 공백을 하나로 줄인 원문 ("탐험대 관련")
//   stripped : 공백을 모두 지운 형태 ("탐험대관련")
type Haystack = { collapsed: string; stripped: string };

function normalize(v: string | null | undefined): Haystack {
  const lower = String(v ?? "").toLowerCase();
  return {
    collapsed: lower.replace(/\s+/g, " ").trim(),
    stripped: lower.replace(/\s+/g, ""),
  };
}

// ★ 짧은 낱말(2~3자)은 공백을 지운 형태에서 찾지 않습니다.
//   공백을 지우면 서로 다른 두 단어가 붙어 우연히 키워드를 만들어 냅니다.
//   실제로 겪은 오탐:
//     "검토 요청" → "검토요청" 안에 "토요"      (→ 토요늘봄으로 잘못 감)
//     "탐험대 관련" → "탐험대관련" 안에 "대관"  (→ 시설로 잘못 감)
//   긴 낱말이나 원래 공백이 들어간 표현("방과 후 아카데미")은 공백을 지운
//   형태로 찾아야 하므로, 길이·공백 유무로 갈라 봅니다.
const SHORT_NEEDLE_MAX = 3;

function hits(hay: Haystack, needles: readonly string[]): boolean {
  return needles.some((raw) => {
    const n = String(raw).toLowerCase();
    const collapsed = n.replace(/\s+/g, " ").trim();
    if (collapsed.length === 0) return false;
    const stripped = n.replace(/\s+/g, "");
    const spaceInsensitive =
      stripped.length > SHORT_NEEDLE_MAX || /\s/.test(n.trim());
    if (spaceInsensitive && hay.stripped.includes(stripped)) return true;
    return hay.collapsed.includes(collapsed);
  });
}

// --- 본체 ------------------------------------------------------------

// 제목·발신자만 보고 분류합니다. 확신이 없으면 null(→ AI 가 판단).
//   순서가 곧 우선순위입니다. 위에서 먼저 잡히면 아래는 보지 않습니다.
export function classifyByKeyword(
  subject: string | null | undefined,
  fromName: string | null | undefined,
): MailCategory | null {
  const s = normalize(subject);
  const f = normalize(fromName);

  // 0) 광고 예외 — 광고 판정만 건너뛰고 아래 규칙은 계속 봅니다.
  const adExempt = hits(f, NOT_AD_SENDERS);

  // 1) 광고 — 외부에서 온 판촉·안내 메일.
  if (!adExempt && (hits(s, AD_SUBJECTS) || hits(f, AD_SENDERS))) return "광고";

  // 2) 방과후 계열 — 두 사업이 한 제목에 섞이면 방카가 이깁니다.
  const bangka = hits(s, BANGKA_SUBJECTS);
  const saturday = hits(s, SATURDAY_SUBJECTS);
  if (bangka) return "방카";
  if (saturday) return "토요늘봄";

  // 3) 나머지 — 제목만 봅니다.
  if (hits(s, ACCOUNTING_SUBJECTS)) return "회계";
  if (hits(s, FACILITY_SUBJECTS)) return "시설";
  if (hits(s, OFFICIAL_SUBJECTS)) return "공문";

  // 확신 없음 — AI 에 넘깁니다.
  return null;
}
