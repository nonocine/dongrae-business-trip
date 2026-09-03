import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange, getSession } from "@/app/actions";
import MailInbox from "./MailInbox";
import { getMailList } from "./actions";

export const dynamic = "force-dynamic";

export default async function MailPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    assignee?: string;
    q?: string;
    unread?: string;
    category?: string;
  }>;
}) {
  await enforcePasswordChange();
  const session = await getSession();
  if (!session) redirect("/");
  const query = await searchParams;
  const unreadOnly = query.unread === "1";
  const view = await getMailList({
    status: query.status,
    assignee: query.assignee,
    q: query.q,
    unreadOnly,
    category: query.category,
  });

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-navy">
              동래구청소년센터
            </p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-[0.08em] text-ink">
              공용 메일함
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              센터 대표 메일을 함께 확인하고 담당을 나눕니다. 원본은 네이버에
              그대로 남아 있습니다.
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 text-sm text-ink-muted hover:underline"
          >
            ← 홈
          </Link>
        </div>
        <MailInbox
          view={view}
          filters={{
            status: query.status ?? "",
            assignee: query.assignee ?? "",
            q: query.q ?? "",
            unreadOnly,
            category: query.category ?? "",
          }}
        />
      </main>
    </>
  );
}
