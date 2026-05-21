import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import MyEmployeeProfileForm from "@/app/profile/hr/MyEmployeeProfileForm";
import { getMyProfile } from "@/app/profile/hr/actions";
import { enforcePasswordChange, getSession } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function MyHrPage() {
  // 임시 비밀번호 사용자는 비번 변경 페이지로 강제 이동
  await enforcePasswordChange();

  const session = await getSession();
  if (!session) redirect("/");
  // 관리자는 본인 인사기록카드 개념이 없음
  if (session.kind === "admin") redirect("/admin");

  const my = await getMyProfile();
  if (!my) redirect("/");

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            내 인사기록카드
          </h2>
          <Link href="/" className="text-sm text-slate-500 hover:underline">
            ← 목록
          </Link>
        </div>
        <MyEmployeeProfileForm
          driverId={my.driver.id}
          driverName={my.driver.name}
          profile={my.profile}
        />
      </main>
    </>
  );
}
