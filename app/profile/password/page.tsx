import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import ChangePasswordForm from "@/app/profile/password/ChangePasswordForm";
import { getSession } from "@/app/actions";
import { supabase, type EmployeeRank } from "@/lib/supabase";
import { cardCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const session = await getSession();
  if (!session) redirect("/");

  // 관리자 비밀번호는 환경변수(ADMIN_PASSWORD)로 관리 — 이 화면 대상 아님.
  if (session.kind === "admin") {
    return (
      <>
        <Header />
        <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
          <div className={cardCls}>
            <h2 className="text-lg font-bold text-ink">비밀번호 변경</h2>
            <p className="mt-2 text-sm text-ink-body">
              관리자 비밀번호는 환경변수(ADMIN_PASSWORD)로 관리되며 이
              화면에서는 변경할 수 없습니다.
            </p>
            <Link
              href="/"
              className="mt-4 inline-block text-sm text-navy hover:underline"
            >
              ← 목록으로
            </Link>
          </div>
        </main>
      </>
    );
  }

  // 직원: rank(비번 정책 분기) + must_change_password 조회.
  // 컬럼이 없거나 조회 실패 시 기본값으로 진행.
  let rank: EmployeeRank | null = null;
  let mustChange = false;
  try {
    const { data } = await supabase
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
