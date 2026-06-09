// =====================================================================
// 채용공고 접수 상태 — now() 기준 3-state 판정(시작/마감 둘 다 반영).
//   * upcoming: now < application_start  (접수 시작 전 = "예정")
//   * open:     application_start <= now <= application_end  ("접수중")
//   * closed:   now > application_end  ("마감")
//   날짜 기반이라 시작일이 되면 자동으로 open 으로 전환됩니다.
// =====================================================================
export type RecruitmentTiming = "upcoming" | "open" | "closed";

export function recruitmentTiming(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  nowMs: number
): RecruitmentTiming {
  const start = startIso ? new Date(startIso).getTime() : NaN;
  const end = endIso ? new Date(endIso).getTime() : NaN;
  if (Number.isFinite(start) && nowMs < start) return "upcoming";
  if (Number.isFinite(end) && nowMs > end) return "closed";
  return "open";
}
