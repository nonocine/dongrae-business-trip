// =====================================================================
// 직원 직무(역할) — 코드 고정 목록. (EMPLOYEE_DOC_SLOTS 패턴 복제)
//   * 직급(drivers.rank)·권한등급(auth_level)과 별개의 "담당 업무".
//   * employee_roles.role_key 에 저장되는 값과 key 가 일치해야 합니다.
//   * 한 직원이 여러 직무를 가질 수 있고(다중), 0개도 허용합니다.
//   * 향후 직무는 이 배열에 항목을 추가해 확장(연결될 실제 기능은 별도 개발).
//   * 표시(HR 인사기록카드·직원 마이페이지)·저장 검증이 이 단일 출처를 공유합니다.
// =====================================================================
export type EmployeeRole = {
  key: string;
  label: string;
  description: string;
};

export const EMPLOYEE_ROLES: EmployeeRole[] = [
  { key: "facility", label: "시설관리", description: "비품·거래처 관리" },
  { key: "accounting", label: "회계", description: "급여·예산" },
  {
    key: "hr",
    label: "인사",
    description: "직원정보·증명서·의무교육 현황",
  },
  { key: "recruitment", label: "채용", description: "지원자 심사" },
  {
    key: "saem",
    label: "강사관리",
    description: "외부 강사·프로그램·근무일지(동래샘들)",
  },
];

// 정의된 직무 key 인지 검증 (저장 시 허용 key 체크).
export function isEmployeeRoleKey(key: string): boolean {
  return EMPLOYEE_ROLES.some((r) => r.key === key);
}

// key → label (표시용). 정의에 없으면 key 그대로.
export function roleLabel(key: string): string {
  return EMPLOYEE_ROLES.find((r) => r.key === key)?.label ?? key;
}
