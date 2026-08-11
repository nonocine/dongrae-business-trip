import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import ChangePasswordForm from "@/app/profile/password/ChangePasswordForm";
import { getSession } from "@/app/actions";
import { type EmployeeRank } from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const session = await getSession();
  if (!session) redirect("/");

  // 직원: rank(비번 정책 분기) + must_change_password 조회.
  // 컬럼이 없거나 조회 실패 시 기본값으로 진행.
  let rank: EmployeeRank | null = null;
  let mustChange = false;
  try {
    const { data } = await supabaseAdmin
      .from("drivers")
      .select("*")
      .eq("name", session.name)
      .maybeSingle();
    if (data) {
      rank = ((data as { rank?: unknown }).rank as EmployeeRank | null) ?? null;
      mustChange =
        (data as { must_change_password?: unknown }).must_change_password ===
        true;
    }
  } catch {
    // 조회 실패 — 기본값 유지
  }

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight text-ink">
            비밀번호 변경
          </h2>
          {!mustChange && (
            <Link href="/" className="text-sm text-ink-muted hover:underline">
              ← 목록
            </Link>
          )}
        </div>
        <ChangePasswordForm
          name={session.name}
          rank={rank}
          mustChange={mustChange}
        />
      </main>
    </>
  );
}
