// =====================================================================
// 채용 제출 서류 — 고정 5종 슬롯. key/label 은 고정이고, required(필수/선택)만
//   공고별로 편집해 recruitment_postings.required_documents(jsonb)에 저장합니다.
//   * 표시(지원 페이지 첨부서류 탭)·검증(제출 누락 체크)·HR 편집 폼이 모두
//     이 단일 출처를 공유합니다.
// =====================================================================
export type RecruitmentDocItem = {
  key: string;
  label: string;
  required: boolean;
};

// 슬롯 정의 — 순서·key·label 고정. defaultRequired 는 신규 공고 기본값.
export const RECRUITMENT_DOC_SLOTS: {
  key: string;
  label: string;
  defaultRequired: boolean;
}[] = [
  { key: "diploma", label: "졸업증명서", defaultRequired: true },
  { key: "transcript", label: "성적증명서", defaultRequired: true },
  { key: "license", label: "자격증 사본", defaultRequired: true },
  { key: "career_cert", label: "경력증명서", defaultRequired: false },
  { key: "award_cert", label: "수상실적 증빙", defaultRequired: false },
];

// 폼 입력(key별 required) → required_documents jsonb 배열(label/key/순서 고정).
export function buildRequiredDocuments(
  requiredByKey: Record<string, boolean>
): RecruitmentDocItem[] {
  return RECRUITMENT_DOC_SLOTS.map((s) => ({
    key: s.key,
    label: s.label,
    required: requiredByKey[s.key] ?? s.defaultRequired,
  }));
}

// 저장된 required_documents(부분/누락/구버전 가능) → key별 required 맵.
//   슬롯에 없는 항목은 무시하고, 누락 슬롯은 defaultRequired 로 채웁니다.
export function requiredMapFromDocuments(raw: unknown): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const s of RECRUITMENT_DOC_SLOTS) map[s.key] = s.defaultRequired;
  if (Array.isArray(raw)) {
    for (const d of raw) {
      if (d != null && typeof d === "object" && !Array.isArray(d)) {
        const key = String((d as Record<string, unknown>).key ?? "");
        if (key in map) {
          map[key] = (d as Record<string, unknown>).required === true;
        }
      }
    }
  }
  return map;
}
