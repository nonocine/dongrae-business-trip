import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import ActivityDetail from "@/app/activities/[id]/ActivityDetail";
import { getActivity, getSession } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [activity, session] = await Promise.all([
    getActivity(id),
    getSession(),
  ]);
  if (!activity || !session) redirect("/");

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 sm:py-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">활동 상세</h2>
          <Link href="/" className="text-sm text-slate-500 hover:underline">
            ← 목록
          </Link>
        </div>
        <ActivityDetail
          activity={activity}
          isAdmin={session.kind === "admin"}
        />
      </main>
    </>
  );
}
