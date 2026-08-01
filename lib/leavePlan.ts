// =====================================================================
// 미사용 연차유급휴가 사용계획서(연차 사용촉진) 공용 타입·검증 — LP-1~LP-3
//   * 근로기준법 제61조의2 사용촉진 서식의 디지털화. 연 1회, 보관용.
//     실사용 추적·ERP 휴가결재와 무관하다(계획 접수·보관까지만).
//   * 순수 모듈(DB·@/ 의존 없음) — 담당자 액션·직원 액션·엑셀 빌더가 공유한다.
//   * 일수는 0.5 단위. 부동소수 오차를 피하려고 항상 "2배 정수"로 계산한다.
// =====================================================================

// 계획 1행 — plan jsonb 의 원소.
export type LeavePlanEntry = {
  date: string; // YYYY-MM-DD
  days: number; // 0.5 또는 1
};

export const LEAVE_DAY_OPTIONS = [0.5, 1] as const;

// 서식의 계획 표는 2단 × 8행 = 16칸. 그보다 많으면 시트가 넘치므로 상한으로 둔다.
export const LEAVE_PLAN_MAX_ROWS = 16;

// 0.5 단위 반올림(입력 방어). 음수는 0.
export function roundHalf(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.round(v * 2) / 2);
}

// 0.5 단위 정수 비교용(0.1+0.2 류 오차 회피).
function half(v: number): number {
  return Math.round(v * 2);
}

// 일수 표기 — 3 → "3", 2.5 → "2.5".
export function formatDays(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "-";
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function isYmd(v: unknown): boolean {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// jsonb → 계획 배열. 형태가 깨진 원소는 버린다(과거 저장분 방어).
export function normalizeLeavePlan(v: unknown): LeavePlanEntry[] {
  const raw = Array.isArray(v)
    ? v
    : typeof v === "string"
      ? (() => {
          try {
            const p = JSON.parse(v);
            return Array.isArray(p) ? p : [];
          } catch {
            return [];
          }
        })()
      : [];
  const out: LeavePlanEntry[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    const date = typeof r.date === "string" ? r.date.trim() : "";
    if (!isYmd(date)) continue;
    const days = roundHalf(Number(r.days));
    if (days <= 0) continue;
    out.push({ date, days });
  }
  // 날짜순 — 서식에도 이 순서로 찍힌다.
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// 계획 합계(0.5 단위 유지).
export function sumLeavePlan(plan: LeavePlanEntry[]): number {
  return plan.reduce((s, p) => s + half(p.days), 0) / 2;
}

// --- 검증 -------------------------------------------------------------
export type LeavePlanIssue =
  | { kind: "empty" }
  | { kind: "tooMany"; max: number }
  | { kind: "badDate"; date: string }
  | { kind: "outOfPeriod"; date: string }
  | { kind: "duplicateDate"; date: string }
  | { kind: "badDays"; date: string };

// 저장 가능 여부(구조적 오류만). 합계 불일치는 오류가 아니라 "경고"다 —
// 지시문대로 제출 자체는 허용하고 화면에서 확인 모달로만 붙잡는다.
export function validateLeavePlan(
  plan: LeavePlanEntry[],
  period: { start: string | null; end: string | null }
): LeavePlanIssue[] {
  const issues: LeavePlanIssue[] = [];
  if (plan.length === 0) issues.push({ kind: "empty" });
  if (plan.length > LEAVE_PLAN_MAX_ROWS)
    issues.push({ kind: "tooMany", max: LEAVE_PLAN_MAX_ROWS });

  const seen = new Set<string>();
  for (const p of plan) {
    if (!isYmd(p.date)) {
      issues.push({ kind: "badDate", date: p.date });
      continue;
    }
    if (seen.has(p.date)) issues.push({ kind: "duplicateDate", date: p.date });
    seen.add(p.date);
    if (half(p.days) !== 1 && half(p.days) !== 2)
      issues.push({ kind: "badDays", date: p.date });
    // 잔여기간이 지정돼 있으면 그 안의 날짜만 허용.
    if (period.start && p.date < period.start)
      issues.push({ kind: "outOfPeriod", date: p.date });
    if (period.end && p.date > period.end)
      issues.push({ kind: "outOfPeriod", date: p.date });
  }
  return issues;
}

export function leavePlanIssueText(issue: LeavePlanIssue): string {
  switch (issue.kind) {
    case "empty":
      return "계획을 최소 1행 입력하세요.";
    case "tooMany":
      return `계획은 최대 ${issue.max}행까지 입력할 수 있습니다.`;
    case "badDate":
      return "날짜 형식이 올바르지 않습니다.";
    case "outOfPeriod":
      return `${issue.date} 은 잔여기간을 벗어납니다.`;
    case "duplicateDate":
      return `${issue.date} 이 중복되었습니다.`;
    case "badDays":
      return `${issue.date} 의 일수는 0.5 또는 1만 가능합니다.`;
  }
}

// 합계 ≠ 미사용 일수 여부(경고 판정). 미사용 일수가 없으면 비교하지 않는다.
export function planMismatch(
  total: number,
  unusedDays: number | null | undefined
): boolean {
  if (unusedDays == null || !Number.isFinite(Number(unusedDays))) return false;
  return half(total) !== half(Number(unusedDays));
}

export const PLAN_MISMATCH_TEXT = "계획 합계가 미사용 일수와 다릅니다.";

// 기간 표기 — "2026-01-01 ~ 2026-12-31". 한쪽만 있으면 그것만.
export function formatPeriod(
  start: string | null,
  end: string | null
): string {
  if (start && end) return `${start} ~ ${end}`;
  if (start) return `${start} ~`;
  if (end) return `~ ${end}`;
  return "-";
}
