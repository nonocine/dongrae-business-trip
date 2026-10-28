import { canEditTalkSettings, getTalkHours } from "@/app/(app)/bangka/talk/actions";
import TalkSettingsForm from "@/app/(app)/bangka/talk/settings/TalkSettingsForm";
import { HOLIDAY_YEARS } from "@/lib/koreanHolidays";
import { currentMs } from "@/lib/talkHours";
import { kstTodayYmd } from "@/lib/trainings";

export const dynamic = "force-dynamic";

// 방카톡 운영시간(요청 10번) — 바꾸기는 관장·부장·방카 팀장, 다른 담당자는 보기만.
//   공휴일은 코드의 확정 표(lib/koreanHolidays) — 표가 끝나는 해 12월부터 "내년 표를 넣어 주세요" 알림(결정 6).
export default async function BangkaTalkSettingsPage() {
  const [hours, canEdit] = await Promise.all([getTalkHours(), canEditTalkSettings()]);
  const today = kstTodayYmd();
  const lastYear = Math.max(...HOLIDAY_YEARS);
  const year = Number(today.slice(0, 4));
  const holidayWarning =
    year > lastYear || (year === lastYear && today.slice(5, 7) === "12")
      ? `공휴일 표가 ${lastYear}년까지만 있습니다. ${lastYear + 1}년 공휴일 표를 넣어 주세요(개발 담당 — lib/koreanHolidays.ts, 동래방카 같은 파일). 그 전까지는 '추가로 막을 날'로 막아 주세요.`
      : null;
  return <TalkSettingsForm hours={hours} canEdit={canEdit} todayYmd={today} nowMs={currentMs()} holidayWarning={holidayWarning} />;
}
