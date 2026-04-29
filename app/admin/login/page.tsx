import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import AdminForm from "@/app/admin/AdminForm";
import { isAdmin } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  if (await isAdmin()) {
    redirect("/admin");
  }

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">관리자 로그인</h2>
          <Link href="/" className="text-sm text-slate-500 hover:underline">
            ← 목록
          </Link>
        </div>
        <AdminForm />
      </main>
    </>
  );
}
