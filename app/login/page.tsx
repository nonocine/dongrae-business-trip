import Link from "next/link";
import Header from "@/app/components/Header";
import LoginForm from "@/app/login/LoginForm";
import { listDriverNames } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const driverNames = await listDriverNames();
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">운전자 로그인</h2>
          <Link href="/" className="text-sm text-slate-500 hover:underline">
            ← 목록
          </Link>
        </div>
        <LoginForm driverNames={driverNames} />
      </main>
    </>
  );
}
