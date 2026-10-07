// =====================================================================
// 동아리 활동일지 — 잠금 규칙·입력 정규화 (순수 함수, 클라이언트 안전)
//   김준호 선생님 요청(2026-10-07): 직원도 동업자씨에서 일지를 작성·수정·제출.
//   데이터는 동래샘들과 같은 saem_sessions 입니다(log_content·work_hours·
//   student_count·activity_location·session_date·instructor_submitted_at).
//
//   ★ 계획(plan_content)과 일지(log_content)는 다른 칸입니다. 계획은 미리 쓰는
//     것(계획서 편집기), 일지는 활동을 마친 뒤 쓰는 것(일지 편집기)입니다.
//
//   잠금 — 금액·보고 근거가 이미 굳은 회차는 고치지 않습니다.
//     · staff_confirmed_at  : 직원 확정(근무일지 탭). 확정 취소는 관장·부장이
//                             근무일지 탭에서 합니다 → 취소 뒤에 수정.
//     · settlement_id       : 강사비 정산에 들어간 회차. 금액 근거라 막습니다.
//     · 월간보고 확정된 달 : saem_club_monthly_reports 에 참여인원 합계가 고정돼
//                             있고, 화면에 '다시 확정' 이 없어 고치면 영영 어긋납니다.
//   경고(확인 후 진행) — 강사가 동래샘들에서 서명 제출한 일지
//     (instructor_signed_at). 서명 뒤 내용이 바뀌므로 확인을 받습니다.
//
//   제출 표시 — 직원이 동업자씨에서 제출하면 instructor_submitted_at 만 찍고
//     instructor_signed_at(강사 손서명)은 찍지 않습니다. 직원은 강사가 아니라
//     서명할 수 없기 때문입니다. 그래서 지금은 "제출됨 + 서명 없음" 이 곧
//     "동업자씨에서 제출" 입니다. (작성자 컬럼이 없어 누가 고쳤는지는 남지
//     않습니다 — 스키마 제안은 커밋 메시지 참고.)
// =====================================================================

export type ClubLogLockInput = {
  staffConfirmedAt: string | null;
  settlementId: string | null;
  monthReportConfirmed: boolean;
};

export type ClubLogLock =
  | { locked: false }
  | { locked: true; reason: "staff-confirmed" | "settled" | "report-confirmed"; message: string };

export function clubLogLock(s: ClubLogLockInput): ClubLogLock {
  if (s.settlementId)
    return {
      locked: true,
      reason: "settled",
      message: "강사비 정산에 들어간 회차라 고칠 수 없습니다. (금액 근거)",
    };
  if (s.staffConfirmedAt)
    return {
      locked: true,
      reason: "staff-confirmed",
      message:
        "직원 확정된 회차입니다. 고치려면 강사·프로그램 관리 > 근무일지 확정 탭에서 확정을 취소(관장·부장)한 뒤 수정하세요.",
    };
  if (s.monthReportConfirmed)
    return {
      locked: true,
      reason: "report-confirmed",
      message: "월간보고가 확정된 달의 회차라 고칠 수 없습니다. (보고 숫자가 이미 고정됨)",
    };
  return { locked: false };
}

// 활동시간 — 0~24시간, 소수 1자리(동래샘들 submitSession 과 같은 반올림).
export function normalizeWorkHours(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v)) return null;
  return Math.min(24, Math.max(0, Math.round(v * 10) / 10));
}

// 참여인원 — 0 이상 정수(동래샘들과 같은 규칙).
export function normalizeStudentCount(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v)) return null;
  return Math.max(0, Math.round(v));
}

// 일지 상태 표시.
//   confirmed  : 직원 확정
//   signed     : 강사가 동래샘들에서 서명 제출
//   staff      : 제출됐지만 강사 서명 없음 = 동업자씨에서 제출
//   draft      : 일지 내용은 있으나 미제출(임시저장)
//   empty      : 아직 안 씀
export type ClubLogState = "confirmed" | "signed" | "staff" | "draft" | "empty";
export function clubLogState(s: {
  staffConfirmedAt: string | null;
  submittedAt: string | null;
  signedAt: string | null;
  logContent: string;
}): ClubLogState {
  if (s.staffConfirmedAt) return "confirmed";
  if (s.submittedAt) return s.signedAt ? "signed" : "staff";
  return s.logContent.trim() ? "draft" : "empty";
}

export const CLUB_LOG_STATE_LABEL: Record<ClubLogState, string> = {
  confirmed: "확정",
  signed: "제출(강사 서명)",
  staff: "제출(동업자씨)",
  draft: "임시저장",
  empty: "미작성",
};
