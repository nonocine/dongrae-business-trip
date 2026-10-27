// =====================================================================
// 동래방카 공결([필수 운영서식 15] 공결확인서) — 공용 상수(서버·브라우저).
//   보호자 앱(동래방카 lib/absence.ts)과 코드값이 같아야 합니다(bk_absences 를 함께 씀).
//   흐름: 보호자 앱 신청(submitted) → 담임 확인(teacher_checked) → 팀장 결재(approved)
//         또는 반려(rejected, 사유). 보호자가 신청 단계에서 취소하면 cancelled.
//   전화 공결: 직원이 받아 적음(channel=phone, 확인자=선생님) → 받은 직원이 곧 담임 확인 → 팀장 결재.
// =====================================================================

export const ABSENCE_REASONS = [
  { key: "family", label: "가족행사", hint: "경조사, 가족여행" },
  { key: "illness", label: "질병", hint: "전염성 질환 등" },
  { key: "religion", label: "종교행사", hint: "" },
  { key: "school", label: "학교행사", hint: "수학여행 등" },
  { key: "academy", label: "학원 등 교습", hint: "학원 등 교습참석" },
  { key: "care", label: "별도 돌봄", hint: "별도 돌봄서비스 참여" },
  { key: "other", label: "기타", hint: "직접 입력" },
] as const;
export type AbsenceReasonKey = (typeof ABSENCE_REASONS)[number]["key"];
export const isAbsenceReason = (v: unknown): v is AbsenceReasonKey => ABSENCE_REASONS.some((r) => r.key === v);
export const absenceReasonLabel = (k: string | null | undefined) => ABSENCE_REASONS.find((r) => r.key === k)?.label ?? "기타";

export type AbsenceStatus = "submitted" | "teacher_checked" | "approved" | "rejected" | "cancelled";
export const ABSENCE_STATUS_LABEL: Record<AbsenceStatus, string> = {
  submitted: "신청",
  teacher_checked: "담임 확인",
  approved: "결재 완료",
  rejected: "반려",
  cancelled: "취소",
};

export type AbsenceConfirmer = "guardian" | "teacher" | "other";
export const ABSENCE_CONFIRMER_LABEL: Record<AbsenceConfirmer, string> = { guardian: "보호자", teacher: "선생님", other: "기타" };

// 증빙 — 사진·PDF. (보호자 앱은 사진을 브라우저에서 줄여 올림)
export const ABSENCE_FILE_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const ABSENCE_FILE_MAX = 15 * 1024 * 1024;

export type AbsenceRow = {
  id: string;
  student_id: string;
  start_date: string;
  end_date: string;
  reason_type: string;
  reason: string | null;
  confirmer_type: AbsenceConfirmer;
  confirmer_other: string | null;
  confirmer_name: string | null;
  guardian_id: string | null;
  signature_path: string | null;
  channel: "app" | "phone";
  received_by: string | null;
  status: AbsenceStatus;
  teacher_checked_by: string | null;
  teacher_checked_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  confirmed_on: string | null;
  created_at: string;
};

export type AbsenceView = AbsenceRow & {
  student: { name: string; school: string | null; grade: string | null; class_code: string } | null;
  files: { id: string; name: string | null; mime: string | null; size: number | null; url: string | null }[];
  signatureUrl: string | null;
};

// "2026-10-28" ~ "2026-10-30" → "10.28(수) ~ 10.30(금)"
const WD = ["일", "월", "화", "수", "목", "금", "토"];
export function absencePeriodLabel(a: string, b: string): string {
  const one = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return `${m}.${d}(${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
  };
  return a === b ? one(a) : `${one(a)} ~ ${one(b)}`;
}
