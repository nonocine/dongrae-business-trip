import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { getSession } from "@/app/actions";
import {
  ACTIVITY_KINDS,
  ACTIVITY_LABEL,
  ACTIVITY_ICON,
  ACTIVITY_CARD_CLASS,
} from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function NewActivityKindPage() {
  const session = await getSession();
  if (!session) redirect("/");

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-5 sm:py-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              어떤 활동을 작성하시나요?
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              유형을 선택하면 맞춤 양식이 표시됩니다.
            </p>
          </div>
          <Link href="/" className="text-sm text-slate-500 hover:underline">
            ← 목록
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {ACTIVITY_KINDS.map((kind) => (
            <Link
              key={kind}
              href={`/new/${kind}`}
              className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${ACTIVITY_CARD_CLASS[kind]}`}
            >
              <span className="text-4xl leading-none" aria-hidden>
                {ACTIVITY_ICON[kind]}
              </span>
              <span className="text-sm font-bold text-slate-800">
                {ACTIVITY_LABEL[kind]}
              </span>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
