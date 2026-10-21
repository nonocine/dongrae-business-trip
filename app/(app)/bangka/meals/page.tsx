import { listMeals } from "@/app/(app)/bangka/meals/actions";
import MealsCalendar from "@/app/(app)/bangka/meals/MealsCalendar";
import { isYm } from "@/lib/bangkaContent";
import { kstTodayYmd } from "@/lib/trainings";

export const dynamic = "force-dynamic";

// 급식 — 월 선택(?ym=2026-11) → 달력. 기본은 이번 달(KST).
export default async function BangkaMealsPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const sp = await searchParams;
  const today = kstTodayYmd();
  const ym = isYm(sp.ym) ? sp.ym : today.slice(0, 7);
  const meals = await listMeals(ym);
  return <MealsCalendar key={ym} ym={ym} meals={meals} todayYmd={today} />;
}
