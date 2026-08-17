// =====================================================================
// 법정의무교육 — 공용 타입·순수 헬퍼 (클라이언트 안전).
//   * 서버 액션(app/hr/trainings, app/profile/hr)·대시보드·화면이 공유하는
//     단일 출처. 여기에는 DB 접근 코드를 두지 않습니다(순수 함수·상수만).
//   * D-day 는 하이드레이션 불일치를 막기 위해 항상 "서버에서" 계산해
//     숫자로 클라이언트에 내려보냅니다(kstTodayYmd 는 서버에서만 호출).
//   * 테이블: mandatory_trainings / training_completions (RLS 0개 → service_role).
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
};

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
// 대상자 자동 판정 — "교육 실시일에 재직 중이던 직원만 그 교육의 대상"
//   * 기준일 = held_on(실시일) ?? due_date(이수기한). 둘 다 없으면 판정 불가.
//   * 판정 규칙은 이 파일 한 곳에만 둡니다. 현황판·대시보드 카드·D-7 독촉·
//     마이페이지가 모두 이 함수를 호출해야 숫자가 어긋나지 않습니다.
//   * 날짜는 전부 "YYYY-MM-DD"(KST 기준 date 컬럼)라 문자열 비교로 충분합니다.
//   * 판정에 필요한 값이 없으면 "대상 유지"(안전측) — 누락 때문에 의무가 조용히
//     사라지지 않게 하고, 화면에서 사유를 표시합니다.
// =====================================================================

// 직원의 재직 구간. 입·퇴사 반복은 지금 한 구간만 표현합니다(join/resignation).
export type EmploymentSpan = {
  joinDate: string | null;
  resignationDate: string | null;
};

export type TargetReason =
  | "target" // 실시일에 재직 중 → 대상
  | "before-join" // 입사 전 교육 → 대상 아님
  | "after-resign" // 퇴사 후 교육 → 대상 아님
  | "no-join-date" // 입사일 미기재 → 대상 유지(안전측)
  | "no-base-date"; // 실시일·이수기한 둘 다 없음 → 대상 유지(안전측)

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
  if (!span.joinDate) return { isTarget: true, reason: "no-join-date" };
  if (span.joinDate > baseYmd) return { isTarget: false, reason: "before-join" };
  if (span.resignationDate && baseYmd > span.resignationDate)
    return { isTarget: false, reason: "after-resign" };
  return { isTarget: true, reason: "target" };
}

// 대상 여부만 — 집계용.
export function isTargetOn(
  span: EmploymentSpan,
  baseYmd: string | null,
): boolean {
  return targetStateOn(span, baseYmd).isTarget;
}

// 대상 아닌 셀에 붙일 짧은 사유 문구(현황판 툴팁).
export function targetReasonLabel(
  reason: TargetReason,
  baseYmd: string | null,
): string {
  const on = baseYmd ? `${baseYmd} 기준` : "기준일 없음";
  switch (reason) {
    case "before-join":
      return `대상 아님 — 입사 전 교육(${on})`;
    case "after-resign":
      return `대상 아님 — 퇴사 후 교육(${on})`;
    case "no-join-date":
      return "입사일 미기재 — 대상으로 둡니다(인사기록 확인 필요)";
    case "no-base-date":
      return "실시일·이수기한 미입력 — 대상으로 둡니다(실시일 입력 권장)";
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
