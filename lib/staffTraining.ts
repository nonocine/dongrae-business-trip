// =====================================================================
// 종사자 교육 공용 유틸 — 교육 기간(시작일~종료일) 표기·검증.
//   * 순수 함수만 둡니다(DB·docx·exceljs 모름). 클라이언트 탭
//     (app/business-results/StaffTrainingTab.tsx)과 서버 출력
//     (lib/businessResultsExport.ts)이 같은 규칙을 쓰도록 단일 출처로 둡니다.
//     → 목록에 보이는 기간과 구청 제출 서식의 기간이 어긋나지 않습니다.
//   * lib/promotionImport.ts 와 같은 성격의 모듈입니다.
//
// 기간 모델: training_date(시작) + training_end_date(종료).
//   activities(start_date/end_date) 와 같은 패턴이고 is_multi_day 같은
//   플래그는 두지 않습니다 — 종료일이 시작일과 같으면 하루 교육입니다.
// =====================================================================

// 기간 표기 — 하루면 날짜 하나, 여러 날이면 "시작 ~ 종료".
//   날짜 형식은 이 화면·서식이 이미 쓰던 ISO(YYYY-MM-DD)를 그대로 둡니다
//   (activities 출력은 점 표기를 쓰지만, 여기서 바꾸면 기존 열 표기가
//    통째로 달라지므로 규칙만 맞추고 형식은 유지합니다).
export function formatTrainingPeriod(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const s = (start ?? "").trim();
  const e = (end ?? "").trim();
  if (!s) return "";
  if (!e || e === s) return s;
  return `${s} ~ ${e}`;
}

// 폼에서 종료일을 비워 보내면 하루 교육 — 시작일과 같은 값으로 씁니다.
export function resolveTrainingEnd(start: string, end: string): string {
  const e = (end ?? "").trim();
  return e.length > 0 ? e : start;
}

// 종료일이 시작일보다 앞서면 잘못된 기간입니다.
//   DB 에 period_check 제약이 있지만, 서버에서 먼저 걸러 알기 쉬운 문구를
//   돌려줍니다(제약 위반 메시지는 담당자가 읽을 수 없습니다).
export function isTrainingPeriodValid(start: string, end: string): boolean {
  const s = (start ?? "").trim();
  const e = (end ?? "").trim();
  if (!s || !e) return true; // 값이 없으면 여기서 판단하지 않습니다.
  return e >= s;
}

// 교육 기간이 그 실적 월과 하루라도 겹치는지.
//   겹치지 않아도 저장은 막지 않습니다 — 회계상 의도적으로 다른 달에 넣는
//   경우가 있어, 화면에서 안내만 합니다.
export function periodOverlapsMonth(
  start: string,
  end: string,
  year: number,
  month: number,
): boolean {
  const s = (start ?? "").trim();
  if (!s) return true;
  const e = (end ?? "").trim() || s;
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  // 다음 달 1일(미포함). 12월이면 다음 해 1월 1일로 넘어갑니다.
  const monthEnd = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  // 구간이 겹치는 조건: 시작 < 월끝 && 종료 >= 월시작
  return s < monthEnd && e >= monthStart;
}
