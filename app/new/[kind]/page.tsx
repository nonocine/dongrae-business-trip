import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/app/components/Header";
import ActivityForm from "@/app/new/[kind]/ActivityForm";
import { getSession, listEmployeeNames } from "@/app/actions";
import {
  ACTIVITY_ICON,
  ACTIVITY_LABEL,
  isActivityKind,
} from "@/lib/supabase";

export const dynamic = "force-dynamic";

function todayKR(): string {
  const now = new Date();
  const tz = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return tz.toISOString().slice(0, 10);
}

export default async function NewActivityFormPage({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  const { kind } = await params;
  if (!isActivityKind(kind)) notFound();

  const session = await getSession();
  if (!session) redirect("/");

  let employees: string[] = [];
  try {
    employees = await listEmployeeNames();
  } catch {
    // empty
  }

  const lockedTraveler =
    session.kind === "employee" ? session.name : null;

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-5 sm:py-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">
            <span aria-hidden className="mr-1.5">
              {ACTIVITY_ICON[kind]}
            </span>
            {ACTIVITY_LABEL[kind]} 작성
          </h2>
          <Link href="/new" className="text-sm text-slate-500 hover:underline">
            ← 유형 변경
          </Link>
        </div>
        <ActivityForm
          kind={kind}
          defaultDate={todayKR()}
          employees={employees}
          lockedTraveler={lockedTraveler}
        />
      </main>
    </>
  );
}
