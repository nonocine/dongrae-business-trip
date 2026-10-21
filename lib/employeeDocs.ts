// =====================================================================
// 직원 인사기록 첨부서류 — 코드 고정 10종 슬롯.
//   * 채용(lib/recruitmentDocs.ts)의 RECRUITMENT_DOC_SLOTS 패턴을 그대로 본떴습니다.
//   * 채용과 달리 공고별 편집이 없어 required(필수/선택)를 코드에 고정합니다.
//   * 표시(HR 인사기록카드·직원 마이페이지)·업로드 검증이 이 단일 출처를 공유합니다.
//   * 종류 추가는 이 배열에 항목만 더하면 됩니다(순서 유지).
//   * 2026-10 노미현 부장 요청: 자격증·경력증명서·수상실적·근로계약서는 여러 장
//     (multiple). 파일은 employee_document_files 한 행 = 한 파일(서버:
//     lib/employeeDocsServer.ts). employee_profiles.documents jsonb 는 롤백용으로만
//     남아 있고 앱은 읽지 않습니다.
// =====================================================================
export type EmployeeDocItem = {
  key: string;
  label: string;
  required: boolean;
  multiple: boolean; // true = 여러 장, false = 1개(새로 올리면 교체)
};

// 슬롯 정의 — 순서·key·label·required 고정.
export const EMPLOYEE_DOC_SLOTS: EmployeeDocItem[] = [
  { key: "diploma", label: "졸업증명서", required: true, multiple: false },
  { key: "transcript", label: "성적증명서", required: true, multiple: false },
  { key: "license", label: "자격증 사본", required: true, multiple: true },
  { key: "career_cert", label: "경력증명서", required: false, multiple: true },
  { key: "award_cert", label: "수상실적 증빙", required: false, multiple: true },
  { key: "contract", label: "근로계약서", required: true, multiple: true },
  { key: "bankbook", label: "통장 사본", required: true, multiple: false },
  { key: "criminal_check", label: "성범죄경력조회 회신서", required: true, multiple: false },
  { key: "health_check", label: "건강진단서", required: false, multiple: false },
  { key: "privacy_consent", label: "개인정보 수집·이용 동의서", required: true, multiple: false },
];

// docKey 가 정의된 슬롯인지 검증 (업로드/삭제 시 허용 키 체크).
export function isEmployeeDocKey(key: string): boolean {
  return EMPLOYEE_DOC_SLOTS.some((s) => s.key === key);
}

export function employeeDocSlot(key: string): EmployeeDocItem | null {
  return EMPLOYEE_DOC_SLOTS.find((s) => s.key === key) ?? null;
}

// 화면에 내려주는 파일 한 개(경로는 내려주지 않습니다 — 열람은 서버가 서명).
export type EmployeeDocFile = {
  id: string;
  doc_key: string;
  sort_order: number;
  ext: string; // "pdf"
  file_name: string | null; // 올린 원본 이름. 이관분은 null
};

// docKey → 그 서류의 파일들(sort_order 순).
export type EmployeeDocFiles = Record<string, EmployeeDocFile[]>;

export const EMPLOYEE_DOC_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
export const EMPLOYEE_DOC_MAX_BYTES = 16 * 1024 * 1024;

// 내려받기 이름 — 올린 파일 이름과 상관없이 "서류종류(이름).확장자".
//   같은 서류가 2개 이상이면 모두 _1, _2 … (sort_order 순 위치, 1부터).
export function employeeDocDownloadName(
  label: string,
  employeeName: string,
  ext: string,
  index: number,
  count: number
): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\r\n\t]/g, "").trim();
  const who = clean(employeeName) || "직원";
  const suffix = count > 1 ? `_${index + 1}` : "";
  return `${clean(label)}(${who})${suffix}${ext ? `.${ext}` : ""}`;
}
