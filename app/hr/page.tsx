import Link from "next/link";
import Header from "@/app/components/Header";
import HrDashboard from "@/app/hr/HrDashboard";
import { requireHrAdmin } from "@/app/hr/actions";

export const dynamic = "force-dynamic";

export default async function HrPage() {
  // 관장·부장 직원 세션이 아니면 / 로 redirect
  await requireHrAdmin();

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            인사 관리
          </h2>
          <Link href="/" className="text-sm text-slate-500 hover:underline">
            ← 목록
          </Link>
        </div>
        <HrDashboard />
      </main>
    </>
  );
}
