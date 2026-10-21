import { listEvents } from "@/app/(app)/bangka/events/actions";
import EventsManager from "@/app/(app)/bangka/events/EventsManager";
import { kstTodayYmd } from "@/lib/trainings";

export const dynamic = "force-dynamic";

// 연간일정 — 연도 선택(?year=2026). 기본은 올해(KST).
export default async function BangkaEventsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const sp = await searchParams;
  const thisYear = Number(kstTodayYmd().slice(0, 4));
  const y = Number(sp.year);
  const year = Number.isInteger(y) && y >= 2020 && y <= 2100 ? y : thisYear;
  const events = await listEvents(year);
  return <EventsManager year={year} events={events} />;
}
