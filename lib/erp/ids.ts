// =====================================================================
// 직원 1명 = ERP 계정 여러 개(팀 이동 발령 때 ERP 가 새 계정을 만듦) — 순수 함수(화면·서버 공용).
//   employee_profiles.erp_employee_id        = 현재 계정(연차·대휴 잔여는 이 계정 값만)
//   employee_profiles.erp_prior_employee_ids = 이전 계정들(복무 기록은 현재+이전 합산)
// =====================================================================

export type ErpLinkFields = {
  erp_employee_id?: string | null;
  erp_prior_employee_ids?: unknown;
};

export function priorErpIds(profile: ErpLinkFields | null | undefined): string[] {
  const v = profile?.erp_prior_employee_ids;
  return Array.isArray(v) ? [...new Set(v.map((x) => String(x ?? "").trim()).filter(Boolean))] : [];
}

// [현재, ...이전] — 중복 없이, 현재 계정이 앞.
export function getErpIdsForEmployee(profile: ErpLinkFields | null | undefined): string[] {
  const cur = (profile?.erp_employee_id ?? "").trim();
  const prior = priorErpIds(profile).filter((x) => x !== cur);
  return cur ? [cur, ...prior] : prior;
}

export const PRIOR_BALANCE_HINT = "ERP 발령 이관 확인 필요";
