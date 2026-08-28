import { getClubDashboard } from "@/app/hr/clubs/actions";
import ClubDashboard from "@/app/hr/clubs/ClubDashboard";
import { resolveClubAccess } from "@/lib/clubAccess";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ClubsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const access = await resolveClubAccess();
  if (!access) redirect("/");
  const now = new Date();
  const params = await searchParams;
  const year = Math.min(
    2100,
    Math.max(2020, Number(params.year) || now.getFullYear())
  );
  const month = Math.min(
    12,
    Math.max(1, Number(params.month) || now.getMonth() + 1)
  );
  const data = await getClubDashboard(year, month);
  return <ClubDashboard year={year} month={month} data={data} />;
}
