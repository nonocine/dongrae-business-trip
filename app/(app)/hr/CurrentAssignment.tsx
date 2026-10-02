// =====================================================================
// 현재 소속 표시 — 인사기록카드 상단(card) · 직원 목록(compact) 공용.
//   * 계산은 lib/appointments.currentAssignment 단일 출처. 여기서는 그리기만.
//   * 발령기록이 없으면 경고 톤으로 "발령기록 없음" — drivers.rank 로 메꾸지
//     않습니다(직급과 직위는 다른 축).
//   * 오늘 이후 발효 예정 발령이 있으면 "예정" 표시를 덧붙입니다.
// =====================================================================

import {
  currentAssignment,
  formatAssignment,
  fmtAssignmentDate,
} from "@/lib/appointments";

export default function CurrentAssignment({
  appointments,
  today,
  variant,
}: {
  appointments: unknown;
  today: string; // 서버에서 계산한 KST "YYYY-MM-DD"
  variant: "card" | "compact";
}) {
  const { current, upcoming } = currentAssignment(appointments, today);
  const text = formatAssignment(current);
  const upcomingText = upcoming
    ? `${fmtAssignmentDate(upcoming.effectiveDate)}부터 ${
        formatAssignment(upcoming) ?? upcoming.type
      }`
    : null;

  if (variant === "compact") {
    return (
      <span className="block truncate text-[11px] leading-4">
        {text ? (
          <span className="text-ink-muted">{text}</span>
        ) : (
          <span className="font-semibold text-warning">발령기록 없음</span>
        )}
        {upcomingText && (
          <span className="ml-1 text-navy" title={`발령 예정 — ${upcomingText}`}>
            · 예정
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="mt-2 space-y-1">
      {text ? (
        <p className="text-sm text-ink-body">
          <span className="mr-1.5 text-xs font-medium text-ink-muted">
            현재 소속
          </span>
          <b className="font-semibold text-navy">{text}</b>
          {current?.effectiveDate && (
            <span className="ml-1.5 text-[11px] text-ink-hint">
              ({fmtAssignmentDate(current.effectiveDate)} 발령)
            </span>
          )}
        </p>
      ) : (
        <p className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm font-semibold text-warning">
          {upcoming
            ? "발효된 발령기록 없음 — 아래 예정 발령이 발효되기 전까지 현재 소속을 알 수 없습니다."
            : "발령기록 없음 — 인사발령을 입력해주세요"}
        </p>
      )}
      {upcomingText && (
        <p className="text-xs text-ink-muted">
          <span className="mr-1 rounded-full bg-navy-soft px-1.5 py-0.5 text-[10px] font-semibold text-navy">
            예정
          </span>
          {upcomingText}
        </p>
      )}
    </div>
  );
}
