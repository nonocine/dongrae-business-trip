// =====================================================================
// 직원 인사기록 첨부서류 — 코드 고정 10종 슬롯.
//   * 채용(lib/recruitmentDocs.ts)의 RECRUITMENT_DOC_SLOTS 패턴을 그대로 본떴습니다.
//   * 채용과 달리 공고별 편집이 없어 required(필수/선택)를 코드에 고정합니다.
//   * 표시(HR 인사기록카드·직원 마이페이지)·업로드 검증이 이 단일 출처를 공유합니다.
//   * 종류 추가는 이 배열에 항목만 더하면 됩니다(순서 유지).
// =====================================================================
export type EmployeeDocItem = {
  key: string;
  label: string;
  required: boolean;
};

// 슬롯 정의 — 순서·key·label·required 고정.
export const EMPLOYEE_DOC_SLOTS: EmployeeDocItem[] = [
  { key: "diploma", label: "졸업증명서", required: true },
  { key: "transcript", label: "성적증명서", required: true },
  { key: "license", label: "자격증 사본", required: true },
  { key: "career_cert", label: "경력증명서", required: false },
  { key: "award_cert", label: "수상실적 증빙", required: false },
  { key: "contract", label: "근로계약서", required: true },
  { key: "bankbook", label: "통장 사본", required: true },
  { key: "criminal_check", label: "성범죄경력조회 회신서", required: true },
  { key: "health_check", label: "건강진단서", required: false },
  { key: "privacy_consent", label: "개인정보 수집·이용 동의서", required: true },
];

// docKey 가 정의된 슬롯인지 검증 (업로드/삭제 시 허용 키 체크).
export function isEmployeeDocKey(key: string): boolean {
  return EMPLOYEE_DOC_SLOTS.some((s) => s.key === key);
}
