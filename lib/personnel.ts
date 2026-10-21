// =====================================================================
// 인사 파일 열람 권한(personnel) — 순수 판정(클라이언트에서도 씀).
//   ★ 관장 결정(2026-10): "다른 직원의 인사 파일을 볼 수 있는 사람 = 관장·부장·
//     관장이 지정한 사람. 그 외 모두 본인 것만."
//   * 인사 파일 = 인사기록카드·첨부서류·사진·수상, 근로·연봉계약서, 급여설정·월별 급여·
//     급여대장·명세서, 연가사용계획서, 증명서·발급대장, 의무교육 개인별 이수·수료증.
//   * 보유 = 직급 관장·부장(자동) · master 계정(관장 권한) · employee_roles 의 'personnel'.
//     ⚠️ 권한등급(auth_level) M0 는 보지 않습니다 — 나중에 다른 사람에게 M0 가 붙어도
//     원칙이 깨지지 않게(관장 지시). hr·회계 직무도 이 권한을 주지 않습니다.
//   * 'personnel' 을 주고 빼는 것은 관장(·master)만 — 부장도 불가.
//   * 서버 판정(세션 → 보유 여부)은 lib/personnelAccess.ts.
// =====================================================================

export const PERSONNEL_ROLE_KEY = "personnel";
export const PERSONNEL_RANKS = ["관장", "부장"] as const;

export function isPersonnelHolder(input: {
  rank?: string | null;
  isMaster?: boolean;
  roles?: readonly string[] | null;
}): boolean {
  if (input.isMaster) return true;
  if (input.rank && (PERSONNEL_RANKS as readonly string[]).includes(input.rank)) return true;
  return !!input.roles?.includes(PERSONNEL_ROLE_KEY);
}

// personnel 부여·회수 가능 — 관장(·master)만.
export function canGrantPersonnel(input: { rank?: string | null; isMaster?: boolean }): boolean {
  return !!input.isMaster || input.rank === "관장";
}
