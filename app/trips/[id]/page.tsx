import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import TripDetail from "@/app/trips/[id]/TripDetail";
import { getBusinessTrip, getSession } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [trip, session] = await Promise.all([
    getBusinessTrip(id),
    getSession(),
  ]);
  // 권한 없거나 미존재 → 메인으로 리다이렉트 (로그인 필요 시 로그인 화면)
  if (!trip || !session) redirect("/");

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 sm:py-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">출장일지 상세</h2>
          <Link href="/" className="text-sm text-slate-500 hover:underline">
            ← 목록
          </Link>
        </div>
        <TripDetail trip={trip} isAdmin={session.kind === "admin"} />
      </main>
    </>
  );
}
