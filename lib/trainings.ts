// =====================================================================
// 법정의무교육 — 공용 타입·순수 헬퍼 (클라이언트 안전).
//   * 서버 액션(app/hr/trainings, app/profile/hr)·대시보드·화면이 공유하는
//     단일 출처. 여기에는 DB 접근 코드를 두지 않습니다(순수 함수·상수만).
//   * D-day 는 하이드레이션 불일치를 막기 위해 항상 "서버에서" 계산해
//     숫자로 클라이언트에 내려보냅니다(kstTodayYmd 는 서버에서만 호출).
//   * 테이블: mandatory_trainings / training_completions /
//     mandatory_training_targets(개별 지정 대상자) — 모두 service_role 경유.
// =====================================================================

// mandatory_trainings 한 행.
export type MandatoryTraining = {
  id: string;
  year: number;
  name: string;
  held_on: string | null; // "YYYY-MM-DD" 실시일 — 대상자 판정 기준일
  due_date: string | null; // "YYYY-MM-DD"
  site_url: string | null;
  note: string | null;
  is_active: boolean;
  display_order: number;
  // 종사자 교육 실적 반입용 — 교육(과정) 단위 속성. 마스터에 1회 입력하면
  // 모든 수료자 반입 행에 자동 적용됩니다(비어 있어도 무방).
  location: string | null;
  organizer: string | null;
  hours: string | null;
  // 교육 대상 범위 — 'all'(재직자 전원 자동 판정) / 'selected'(개별 지정자만).
  //   selected 의 명단은 mandatory_training_targets 에 있습니다.
  target_scope: TargetScope;
  // 신규 입사자 처리 규칙 — evaluateTraining 참고.
  new_hire_rule: NewHireRule;
};

export type TargetScope = "all" | "selected";

// =====================================================================
// 신규 입사자 처리 규칙(mandatory_trainings.new_hire_rule)
//   법정교육마다 대상·주기가 달라 신규 직원에게 일괄 기한을 줄 수 없습니다.
//   기존 직원(입사일 ≤ 이수기한)은 규칙과 무관하게 원래 due_date 그대로입니다
//   (after_condition 만 예외 — 조건 미충족이면 기존 직원도 대상이 아님).
// =====================================================================
export type NewHireRule =
  | "within_year"
  | "from_hire_half"
  | "after_condition"
  | "role_only"
  | "on_hire";

export const NEW_HIRE_RULES: { value: NewHireRule; label: string; desc: string }[] = [
  {
    value: "within_year",
    label: "그 해 안에 이수",
    desc: "기한이 입사 전이면 입사일+30일(12/31 넘지 않게)까지 이수",
  },
  {
    value: "from_hire_half",
    label: "입사한 반기부터",
    desc: "입사 전 반기의 교육은 제외, 입사한 반기 교육은 입사일+30일까지",
  },
  {
    value: "after_condition",
    label: "조건 충족 후",
    desc: "퇴직연금 가입 후부터 대상(입사 1년 이후로 판정)",
  },
  {
    value: "role_only",
    label: "담당자만",
    desc: "신규 직원 자동 포함 안 함 — 대상자로 지정된 경우만",
  },
  {
    value: "on_hire",
    label: "채용 시 교육",
    desc: "신규 직원만 대상, 입사일+7일까지 이수",
  },
];

export function normalizeNewHireRule(v: unknown): NewHireRule {
  return NEW_HIRE_RULES.some((r) => r.value === v)
    ? (v as NewHireRule)
    : "within_year";
}

// 신규 입사자 개인 기한 — 입사일 + N일.
export const NEW_HIRE_GRACE_DAYS = 30;
export const ON_HIRE_DUE_DAYS = 7;
// after_condition — 직원별 퇴직연금 가입 여부·가입일 칸이 없어 "입사 1년 이후"로 판정.
export const CONDITION_AFTER_YEARS = 1;

// training_completions 한 행.
export type TrainingCompletion = {
  id: string;
  training_id: string;
  driver_id: string;
  certificate_path: string | null;
  completed_at: string | null; // ISO
  uploaded_by: string | null;
};

// 업로드 허용 형식 — 수료증은 PDF 가 대부분(Hpdf 등), 스캔/캡처용 JPG·PNG 도 허용.
export const CERT_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};
export const CERT_MAX_BYTES = 16 * 1024 * 1024; // 16MB
export const CERT_ACCEPT = "application/pdf,image/jpeg,image/png";

const p2 = (n: number) => String(n).padStart(2, "0");

// KST 기준 오늘 "YYYY-MM-DD". DST 없는 UTC+9 고정이라 UTC ms 에 +9h.
//   * 서버 전용으로 호출하세요(Date 사용 → 클라이언트에서 부르면 하이드레이션 위험).
export function kstTodayYmd(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${p2(kst.getUTCMonth() + 1)}-${p2(
    kst.getUTCDate()
  )}`;
}

// due(YYYY-MM-DD) 까지 남은 일수. 양수=남음, 0=오늘, 음수=기한 지남. 기한 없으면 null.
export function daysUntil(
  due: string | null | undefined,
  todayYmd: string
): number | null {
  if (!due) return null;
  const d = Date.parse(`${due}T00:00:00Z`);
  const t = Date.parse(`${todayYmd}T00:00:00Z`);
  if (Number.isNaN(d) || Number.isNaN(t)) return null;
  return Math.round((d - t) / 86_400_000);
}

// D-day 표시 라벨. null(기한 없음)이면 "기한 없음".
export function ddayLabel(dday: number | null): string {
  if (dday == null) return "기한 없음";
  if (dday === 0) return "D-DAY";
  if (dday > 0) return `D-${dday}`;
  return `D+${-dday} 지남`;
}

// 기한 임박(마이페이지 강조 기준) — 미이수 & D-14 이내(지난 것 포함).
export function isDueSoon(dday: number | null): boolean {
  return dday != null && dday <= 14;
}

// =====================================================================
// 대상자 자동 판정 — "재직 직원은 입사일과 무관하게 모든 교육의 대상"
//   * 기준일 = held_on(실시일) ?? due_date(이수기한). 둘 다 없으면 판정 불가.
//   * 판정 규칙은 이 파일 한 곳에만 둡니다. 현황판·대시보드 카드·D-7 독촉·
//     마이페이지가 모두 이 함수를 호출해야 숫자가 어긋나지 않습니다.
//   * 날짜는 전부 "YYYY-MM-DD"(KST 기준 date 컬럼)라 문자열 비교로 충분합니다.
//   * 판정에 필요한 값이 없으면 "대상 유지"(안전측) — 누락 때문에 의무가 조용히
//     사라지지 않게 하고, 화면에서 사유를 표시합니다.
//
//   ⚠️ 과거에는 "실시일에 재직 중이던 직원만 대상"이라 입사 전 교육을
//     'before-join' 으로 제외했습니다. 법정의무교육은 입사일과 무관하게
//     기관의 교육대상자면 이수 여부를 관리해야 하므로(김혜지 팀장 요청)
//     그 분기를 제거했습니다. 입사 전에 실시된 교육도 대상이 되고, 안 들은
//     교육은 그대로 미이수로 남습니다.
//     퇴사 후 교육(after-resign)은 계속 제외합니다 — 퇴사자까지 대상이 되면
//     D-7 독촉 범위가 불필요하게 늘어납니다.
// =====================================================================

// 직원의 재직 구간. 입·퇴사 반복은 지금 한 구간만 표현합니다(join/resignation).
export type EmploymentSpan = {
  joinDate: string | null;
  resignationDate: string | null;
};

// 'before-join'(입사 전 교육 → 대상 아님)은 제거했습니다. 위 주석 참고.
export type TargetReason =
  | "target" // 대상
  | "not-selected" // 개별 지정 교육인데 지정되지 않음 → 대상 아님
  | "after-resign" // 퇴사 후 교육 → 대상 아님
  | "no-join-date" // 입사일 미기재 → 대상(판정에는 영향 없음, 인사기록 보완 안내용)
  | "no-base-date" // 실시일·이수기한 둘 다 없음 → 대상 유지(안전측)
  // 아래는 신규 입사자 규칙(evaluateTraining)에서만 나옵니다.
  | "joined-after-year" // 교육 연도가 끝난 뒤 입사 → 대상 아님
  | "before-hire-half" // from_hire_half: 입사한 반기보다 앞 반기 교육 → 대상 아님
  | "condition-unmet" // after_condition: 연말까지 조건(입사 1년) 미충족 → 대상 아님
  | "role-only" // role_only: 신규 직원이 담당자로 지정되지 않음 → 대상 아님
  | "not-new-hire"; // on_hire: 그 해 신규 입사자가 아님 → 대상 아님

// 교육의 판정 기준일 — 실시일 우선, 없으면 이수기한.
export function trainingBaseYmd(
  t: { held_on?: string | null; due_date?: string | null } | null | undefined,
): string | null {
  if (!t) return null;
  return t.held_on || t.due_date || null;
}

// 대상 여부 + 사유. 화면 표시는 사유로 분기합니다.
export function targetStateOn(
  span: EmploymentSpan,
  baseYmd: string | null,
): { isTarget: boolean; reason: TargetReason } {
  if (!baseYmd) return { isTarget: true, reason: "no-base-date" };
  // 퇴사 후 교육 판정을 입사일 확인보다 먼저 합니다 — 입사일이 비어 있어도
  //   퇴사일이 있으면 퇴사 후 교육은 제외되어야 하므로, 아래 no-join-date
  //   조기 반환에 가려지지 않게 순서를 둡니다.
  if (span.resignationDate && baseYmd > span.resignationDate)
    return { isTarget: false, reason: "after-resign" };
  // 입사일은 이제 대상 판정에 쓰지 않습니다(입사 전 교육도 대상).
  //   값이 없다는 사실만 사유로 남겨 인사기록 보완을 유도합니다.
  if (!span.joinDate) return { isTarget: true, reason: "no-join-date" };
  return { isTarget: true, reason: "target" };
}

// 대상 여부만 — 집계용.
export function isTargetOn(
  span: EmploymentSpan,
  baseYmd: string | null,
): boolean {
  return targetStateOn(span, baseYmd).isTarget;
}

// =====================================================================
// 교육 단위 대상 판정 — 대상 범위(target_scope)까지 반영한 "최종" 판정.
//   * 현황판·대시보드 카드·D-7 독촉·마이페이지·업로드 가드가 전부 이 함수를
//     호출합니다(위 targetStateOn 을 직접 부르지 마세요 — 개별 지정 교육에서
//     숫자가 어긋납니다).
//   * 'all'      → 종전 그대로(실시일 기준 재직자 판정, targetStateOn).
//   * 'selected' → mandatory_training_targets 에 지정된 사람만. 담당자가 명시적
//     으로 고른 명단이 곧 대상이므로 재직 구간 판정은 하지 않습니다.
//   * selectedIds 는 그 교육의 지정자 driver_id 집합. 'selected' 인데 집합이
//     없으면(로드 누락) 아무도 대상이 아닙니다 — 호출부가 반드시 실어야 합니다.
// =====================================================================
export type TrainingTargetRule = {
  held_on?: string | null;
  due_date?: string | null;
  target_scope?: string | null;
  // evaluateTraining 전용 — 없으면 within_year / 기한·실시일의 연도.
  year?: number | null;
  new_hire_rule?: string | null;
};

export function normalizeTargetScope(v: unknown): TargetScope {
  return v === "selected" ? "selected" : "all";
}

export function trainingTargetState(
  t: TrainingTargetRule,
  emp: EmploymentSpan & { driver_id: string },
  selectedIds: ReadonlySet<string> | null | undefined,
): { isTarget: boolean; reason: TargetReason } {
  if (normalizeTargetScope(t.target_scope) === "selected") {
    return selectedIds?.has(emp.driver_id)
      ? { isTarget: true, reason: "target" }
      : { isTarget: false, reason: "not-selected" };
  }
  return targetStateOn(emp, trainingBaseYmd(t));
}

export function isTrainingTarget(
  t: TrainingTargetRule,
  emp: EmploymentSpan & { driver_id: string },
  selectedIds: ReadonlySet<string> | null | undefined,
): boolean {
  return trainingTargetState(t, emp, selectedIds).isTarget;
}

// =====================================================================
// 최종 판정 — 대상 여부 + 개인 기한 + 상태. 단일 출처.
//   * 현황판·내 의무교육·메인 카드·관리 요약·슬랙 알림·MCP(training_status)가
//     전부 이 함수(또는 기준일 없는 trainingEligibility)를 씁니다.
//   * 1단계: trainingTargetState(대상 범위·퇴사 후 교육) — 업로드 가드도 쓰는
//     기존 판정. 이수 처리 로직은 그대로 두기 위해 여기에 덧씌웁니다.
//   * 2단계: 신규 입사자 규칙(new_hire_rule). "신규" = 이수기한이 입사일보다 앞.
//   * 초과일·D-n 은 개인 기한(dueDate)부터 셉니다.
// =====================================================================
export type TrainingEligibility = {
  isTarget: boolean;
  reason: TargetReason;
  dueDate: string | null; // 개인 기한(신규 입사자면 원래 due_date 와 다름)
  personalDue: boolean; // dueDate 가 원래 due_date 와 다르게 계산됐는지
};

export type TrainingStatus = "done" | "overdue" | "pending" | "no-due" | "not-target";

export type TrainingEvaluation = TrainingEligibility & {
  dday: number | null;
  status: TrainingStatus;
};

// "YYYY-MM-DD" + n일.
export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addYearsYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}

const minYmd = (a: string, b: string) => (a < b ? a : b);
const halfOf = (ymd: string) => (Number(ymd.slice(5, 7)) <= 6 ? 1 : 2);

function trainingYear(t: TrainingTargetRule): number | null {
  if (t.year && Number.isFinite(t.year) && t.year > 0) return t.year;
  const base = t.due_date || t.held_on;
  return base ? Number(base.slice(0, 4)) : null;
}

export function trainingEligibility(
  t: TrainingTargetRule,
  emp: EmploymentSpan & { driver_id: string },
  selectedIds: ReadonlySet<string> | null | undefined,
): TrainingEligibility {
  const orig = t.due_date ?? null;
  const yes = (reason: TargetReason, due = orig): TrainingEligibility => ({
    isTarget: true,
    reason,
    dueDate: due,
    personalDue: due !== orig,
  });
  const no = (reason: TargetReason): TrainingEligibility => ({
    isTarget: false,
    reason,
    dueDate: orig,
    personalDue: false,
  });

  const base = trainingTargetState(t, emp, selectedIds);
  if (!base.isTarget) return no(base.reason);

  const rule = normalizeNewHireRule(t.new_hire_rule);
  const join = emp.joinDate;
  // 입사일 미기재 — 비교 기준이 없으니 기존 직원으로 봅니다(종전 그대로).
  //   채용 시 교육만은 "신규 직원만" 이라 대상에서 뺍니다.
  if (!join) return rule === "on_hire" ? no("not-new-hire") : yes(base.reason);

  const year = trainingYear(t);
  const yearStart = year ? `${year}-01-01` : null;
  const yearEnd = year ? `${year}-12-31` : null;
  if (yearEnd && join > yearEnd) return no("joined-after-year");

  const graceDue = () => {
    const d = addDaysYmd(join, NEW_HIRE_GRACE_DAYS);
    return yearEnd ? minYmd(d, yearEnd) : d;
  };
  const isNew = !!orig && orig < join;

  switch (rule) {
    case "on_hire":
      if (yearStart && join < yearStart) return no("not-new-hire");
      return yes("target", addDaysYmd(join, ON_HIRE_DUE_DAYS));
    case "after_condition": {
      // 조건 충족일 = 입사 1년. 연내 미충족이면 대상 아님, 기한 뒤에 충족하면
      //   충족일+30일(연말 상한)이 개인 기한.
      const eligible = addYearsYmd(join, CONDITION_AFTER_YEARS);
      if (yearEnd && eligible > yearEnd) return no("condition-unmet");
      if (orig && eligible > orig) {
        const d = addDaysYmd(eligible, NEW_HIRE_GRACE_DAYS);
        return yes("target", yearEnd ? minYmd(d, yearEnd) : d);
      }
      return yes(base.reason);
    }
    case "role_only":
      if (isNew && !selectedIds?.has(emp.driver_id)) return no("role-only");
      break;
    case "from_hire_half": {
      const b = trainingBaseYmd(t);
      if (b && b.slice(0, 4) === join.slice(0, 4) && halfOf(b) < halfOf(join))
        return no("before-hire-half");
      break;
    }
  }
  return isNew ? yes("target", graceDue()) : yes(base.reason);
}

export function evaluateTraining(
  t: TrainingTargetRule,
  emp: EmploymentSpan & { driver_id: string },
  selectedIds: ReadonlySet<string> | null | undefined,
  todayYmd: string,
  completed = false,
): TrainingEvaluation {
  const el = trainingEligibility(t, emp, selectedIds);
  const dday = daysUntil(el.dueDate, todayYmd);
  const status: TrainingStatus = !el.isTarget
    ? "not-target"
    : completed
      ? "done"
      : dday == null
        ? "no-due"
        : dday < 0
          ? "overdue"
          : "pending";
  return { ...el, dday, status };
}

// "MM/DD".
export function mmdd(ymd: string | null | undefined): string {
  return ymd ? `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}` : "";
}

// 기한 문구 — 기한 전 "기한 MM/DD (D-n)", 당일 "기한 MM/DD (D-DAY)",
//   지나면 "n일 초과 (기한 MM/DD)". 초과일은 개인 기한부터 셉니다.
export function dueLabel(dueDate: string | null, dday: number | null): string {
  if (!dueDate || dday == null) return "기한 없음";
  if (dday < 0) return `${-dday}일 초과 (기한 ${mmdd(dueDate)})`;
  return `기한 ${mmdd(dueDate)} (${dday === 0 ? "D-DAY" : `D-${dday}`})`;
}

// 대상자 명단(mandatory_training_targets)을 읽어야 하는 교육 — 개별 지정 또는 담당자만.
export function needsTargetList(t: {
  target_scope?: string | null;
  new_hire_rule?: string | null;
}): boolean {
  return (
    normalizeTargetScope(t.target_scope) === "selected" ||
    normalizeNewHireRule(t.new_hire_rule) === "role_only"
  );
}

// 대상 아닌 셀에 붙일 짧은 사유 문구(현황판 툴팁).
export function targetReasonLabel(
  reason: TargetReason,
  baseYmd: string | null,
): string {
  const on = baseYmd ? `${baseYmd} 기준` : "기준일 없음";
  switch (reason) {
    case "after-resign":
      return `대상 아님 — 퇴사 후 교육(${on})`;
    case "not-selected":
      return "대상 아님 — 대상자로 지정되지 않은 교육";
    case "no-join-date":
      return "입사일 미기재 — 대상입니다(인사기록 확인 필요)";
    case "no-base-date":
      return "실시일·이수기한 미입력 — 대상으로 둡니다(실시일 입력 권장)";
    case "joined-after-year":
      return "대상 아님 — 교육 연도 이후 입사";
    case "before-hire-half":
      return "대상 아님 — 입사 전 반기의 정기교육";
    case "condition-unmet":
      return "대상 아님 — 조건 미충족(입사 1년 전)";
    case "role-only":
      return "대상 아님 — 담당자 지정 교육(신규 입사자 자동 포함 안 함)";
    case "not-new-hire":
      return "대상 아님 — 채용 시 교육(그 해 신규 입사자만)";
    default:
      return `대상 (${on})`;
  }
}

// 표시순서 → 이름 순 정렬(현황판 열·마이페이지 목록 공용).
export function sortTrainings<T extends { display_order: number; name: string }>(
  list: T[]
): T[] {
  return [...list].sort(
    (a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name)
  );
}

// --- DB row 정규화 (service_role 조회 결과 → 타입) ---
export function toTraining(raw: Record<string, unknown>): MandatoryTraining {
  return {
    id: String(raw.id ?? ""),
    year: Number(raw.year ?? 0),
    name: String(raw.name ?? ""),
    held_on: (raw.held_on as string | null) ?? null,
    due_date: (raw.due_date as string | null) ?? null,
    site_url: (raw.site_url as string | null) ?? null,
    note: (raw.note as string | null) ?? null,
    is_active: raw.is_active !== false,
    display_order: Number(raw.display_order ?? 0),
    location: (raw.location as string | null) ?? null,
    organizer: (raw.organizer as string | null) ?? null,
    hours: (raw.hours as string | null) ?? null,
    target_scope: normalizeTargetScope(raw.target_scope),
    new_hire_rule: normalizeNewHireRule(raw.new_hire_rule),
  };
}

export function toCompletion(raw: Record<string, unknown>): TrainingCompletion {
  return {
    id: String(raw.id ?? ""),
    training_id: String(raw.training_id ?? ""),
    driver_id: String(raw.driver_id ?? ""),
    certificate_path: (raw.certificate_path as string | null) ?? null,
    completed_at: (raw.completed_at as string | null) ?? null,
    uploaded_by: (raw.uploaded_by as string | null) ?? null,
  };
}

// 현황판 셀 좌표 키 — `${trainingId}:${driverId}`.
export function cellKey(trainingId: string, driverId: string): string {
  return `${trainingId}:${driverId}`;
}

// 교육별 대상 인원 / 미이수 인원 — 현황판(TrainingsManager)과 MCP 공용.
//   대상 판정은 trainingEligibility 하나로(대상 아닌 셀은 미이수로 세지 않음).
//   completed: 이수 기록이 있는 cellKey 집합.
export function trainingStatsByTraining(
  trainings: (TrainingTargetRule & { id: string })[],
  employees: (EmploymentSpan & { driver_id: string })[],
  completed: { has(key: string): boolean },
  targetSets: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, { target: number; notMet: number }> {
  const m = new Map<string, { target: number; notMet: number }>();
  for (const t of trainings) {
    const sel = targetSets.get(t.id);
    let target = 0;
    let notMet = 0;
    for (const e of employees) {
      if (!trainingEligibility(t, e, sel).isTarget) continue;
      target += 1;
      if (!completed.has(cellKey(t.id, e.driver_id))) notMet += 1;
    }
    m.set(t.id, { target, notMet });
  }
  return m;
}

// 직원별 대상 교육 수 / 이수 수 — 같은 판정 규칙(MCP 직원별 현황용).
export function trainingStatsByEmployee(
  trainings: (TrainingTargetRule & { id: string })[],
  employees: (EmploymentSpan & { driver_id: string })[],
  completed: { has(key: string): boolean },
  targetSets: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, { target: number; done: number }> {
  const m = new Map<string, { target: number; done: number }>();
  for (const e of employees) {
    let target = 0;
    let done = 0;
    for (const t of trainings) {
      if (!trainingEligibility(t, e, targetSets.get(t.id)).isTarget) continue;
      target += 1;
      if (completed.has(cellKey(t.id, e.driver_id))) done += 1;
    }
    m.set(e.driver_id, { target, done });
  }
  return m;
}
