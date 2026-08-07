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
