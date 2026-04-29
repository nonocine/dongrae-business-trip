import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import NewLogForm from "@/app/new/NewLogForm";
import { getDriverSession, getLatestCumulative } from "@/app/actions";

export const dynamic = "force-dynamic";

function todayKR(): string {
  const now = new Date();
  const tz = new Date(now.getTime() + 9 * 60 * 60 * 1000); // KST
  return tz.toISOString().slice(0, 10);
}

export default async function NewLogPage() {
  const driver = await getDriverSession();
  if (!driver) redirect("/");

  const previous = await getLatestCumulative();
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-5 sm:py-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">운행일지 작성</h2>
          <Link href="/" className="text-sm text-slate-500 hover:underline">
            ← 목록
          </Link>
        </div>
        <NewLogForm
          defaultDate={todayKR()}
          previousCumulative={previous}
          driverName={driver.name}
        />
      </main>
    </>
  );
}
