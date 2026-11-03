// =====================================================================
// 언론 보도 자동 수집 설정 — docs/PRESS_COLLECT_동업자씨이전.md
//   * 검색어·유사 기관·묶음기사 패턴을 이 파일 한 곳에 둡니다.
//     관장이 검색어를 더하려면 여기만 고치면 됩니다(나중에 설정 표로 옮길 수 있음).
//   * 규칙은 헤르메스(D:\hermes-test\search_news_*.py, filter_news_*.py)와 같게 시작합니다.
// =====================================================================

export type SearchTerm = {
  query: string;
  // 이 검색어로만 잡힌 글은 제목·요약에 이 말이 함께 있어야 통과(예: 조선놀이터 → "동래").
  requireAlso?: string;
};

export const PRESS_SEARCH_TERMS: SearchTerm[] = [
  { query: "동래구청소년센터" },
  { query: "동래구 청소년센터" },
  { query: "동래구청소년수련관" }, // 예전 이름
  { query: "허일수 센터장" },
  { query: "어울리고GO" },
  { query: "동래읍성GO" },
  { query: "사직동 청소년 자유공간" },
  { query: "조선놀이터", requireAlso: "동래" },
];

// 제목에 있으면 "확실히 우리 기사"(규칙 통과).
export const PRESS_SURE_TITLE_TERMS = ["동래구청소년센터", "동래구 청소년센터", "허일수 센터장"];

// 본문 언급만으로는 우리 기사로 보기 어려운 이름 — 이것만 있으면 판정 대상(애매함).
export const PRESS_CENTER_TERMS = [
  "동래구청소년센터",
  "동래구 청소년센터",
  "동래구청소년수련관",
  "허일수",
  "어울리고GO",
  "동래읍성GO",
  "사직동 청소년 자유공간",
];

// 이름이 비슷한 다른 기관. 이것만 나오고 우리 센터 이름이 따로 없으면 제외.
export const PRESS_LOOKALIKE_ORGS = [
  "동래구청소년상담복지센터",
  "동래구 청소년상담복지센터",
  "동래구진로교육지원센터",
  "동래구 진로교육지원센터",
  "구덕청소년수련관",
];

// 묶음기사(여러 소식 모음) 제목 패턴 — 판정 대상으로 보내고 is_roundup 후보로 표시.
export const PRESS_ROUNDUP_TITLE_PATTERNS: RegExp[] = [
  /소식\s*\(?\d{1,2}[.\/]\d{1,2}\)?/,
  /(구정|구청|군정|시정)\s*소식/,
  /주요\s*일정/,
  /브리핑/,
  /단신/,
  /\[?(동정|게시판|알림)\]?/,
];

export const PRESS_COLLECT_DAYS = 7;
export const PRESS_NAVER_PAGE_SIZE = 100;
export const PRESS_NAVER_MAX_START = 1000; // 네이버 검색 API start 상한
export const PRESS_GOOGLE_DELAY_MS = 1500;
export const PRESS_HAIKU_DAILY_MAX = 30;
export const PRESS_HAIKU_MODEL = "claude-haiku-5-5";
