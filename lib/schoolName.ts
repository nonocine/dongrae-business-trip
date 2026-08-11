// =====================================================================
// 학교명 표시 정규화 — "○○초" 통일. 순수 함수(외부 의존 없음).
//
//   saem_enrollments.school 은 홈페이지 신청값이 그대로 들어와서
//   "교동초등학교 / 교동초 / 교동" 이 다 같은 학교인데 따로 센다.
//   원본은 신청 기록이라 보존하고(UPDATE 금지), 화면에 그릴 때만
//   이 함수를 통과시킨다 — 표시 전용.
//
//   ⚠️ 오타는 교정하지 않는다. "깅동초등학교" 는 규칙대로 "깅동초" 가
//      될 뿐 "교동초" 로 고치지 않는다. 오타의 근본 해결은 홈페이지
//      신청값 수정이지 여기가 아니다(억지 교정 매핑 금지).
//
//   * 동래샘들(dongrae-saems)의 lib/schoolName.ts 와 동일 로직입니다.
//     같은 학생 명단을 양쪽 앱이 같은 표기로 보여야 하므로, 한쪽을 고치면
//     다른 쪽도 같이 고쳐주세요.
// =====================================================================

const REGION_PREFIX = "부산";
const LONG_SUFFIX = "초등학교";
const SHORT_SUFFIX = "초";

// 접미사("초등학교" 또는 "초")를 떼어 학교 이름만 남긴다. 없으면 그대로.
function baseName(s: string): string {
  if (s.endsWith(LONG_SUFFIX)) return s.slice(0, -LONG_SUFFIX.length);
  if (s.endsWith(SHORT_SUFFIX)) return s.slice(0, -SHORT_SUFFIX.length);
  return s;
}

// "교동초등학교" / "교동초" / "교동" / "부산교동초등학교" → 모두 "교동초".
// 빈값·null 은 "" (호출부에서 filter(Boolean) 으로 자연스럽게 빠진다).
export function normalizeSchoolName(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";

  // 지역 접두사 "부산" 제거 — 떼고 나서도 학교 이름이 남을 때만.
  // ("부산" 단독처럼 이름이 통째로 사라지는 경우는 원본을 유지한다.)
  let name = trimmed;
  if (name.startsWith(REGION_PREFIX)) {
    const stripped = name.slice(REGION_PREFIX.length);
    if (baseName(stripped)) name = stripped;
  }

  return baseName(name) + SHORT_SUFFIX;
}
