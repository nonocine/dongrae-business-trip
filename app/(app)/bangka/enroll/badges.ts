// 신규 접수 화면 공용 배지 색(서버·클라이언트 공용 순수 모듈).
import { allergySymptomLabel, type AllergyInfo, type AppStatus, type RecruitmentStatus } from "@/lib/bangkaEnroll";
import { badgeDanger, badgeNavy, badgeNeutral, badgeSuccess, badgeWarning } from "@/lib/ui";

export const RECRUIT_STATUS_BADGE: Record<RecruitmentStatus, string> = {
  draft: badgeNeutral,
  scheduled: badgeNavy,
  open: badgeSuccess,
  closed: badgeWarning,
  ended: badgeNavy,
};

export const APP_STATUS_BADGE: Record<AppStatus, string> = {
  draft: badgeNeutral,
  submitted: badgeNavy,
  needs_fix: badgeWarning,
  docs_ok: badgeNavy,
  accepted: badgeSuccess,
  waitlisted: badgeWarning,
  rejected: badgeDanger,
};

export const FILE_STATUS_LABEL: Record<string, string> = {
  uploaded: "확인 전",
  confirmed: "확인",
  needs_fix: "보완요청",
};
export const FILE_STATUS_BADGE: Record<string, string> = {
  uploaded: badgeNeutral,
  confirmed: badgeSuccess,
  needs_fix: badgeWarning,
};

// 알레르기 증상 — '기타'는 직접 기재한 글(symptom_other)로 보여 줍니다.
export function allergySymptomsText(a: Pick<AllergyInfo, "symptoms" | "symptom_other">): string {
  return (a.symptoms ?? [])
    .map((k) => (k === "other" ? (a.symptom_other ?? "").trim() || "기타" : allergySymptomLabel(k)))
    .join(", ");
}
