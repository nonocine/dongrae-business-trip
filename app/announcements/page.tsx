import { redirect } from "next/navigation";
import Link from "next/link";
import Header from "@/app/components/Header";
import { enforcePasswordChange, getSession } from "@/app/actions";
import { listAnnouncements, amIM0 } from "./actions";
import AnnouncementsView from "./AnnouncementsView";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  await enforcePasswordChange();
  // 로그인한 직원만 — 비로그인은 공개 관문으로.
  const session = await getSession();
  if (!session) redirect("/");

  const [announcements, isM0] = await Promise.all([
    listAnnouncements(),
    amIM0(),
  ]);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 sm:py-6">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-navy">
              동래구청소년센터
            </p>
            <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
              공지사항
            </h2>
          </div>
          <Link href="/" className="text-sm text-ink-muted hover:underline">
            ← 메인
          </Link>
        </div>
        <AnnouncementsView announcements={announcements} isM0={isM0} />
      </main>
    </>
  );
}
