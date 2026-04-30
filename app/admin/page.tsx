import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import AdminDashboard from "@/app/admin/AdminDashboard";
import {
  getActivityAdminStats,
  isAdmin,
  listActivities,
  listEmployees,
} from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await isAdmin())) {
    redirect("/admin/login");
  }

  const [employees, stats, activities] = await Promise.all([
    listEmployees(),
    getActivityAdminStats(),
    listActivities(),
  ]);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            관리자 대시보드
          </h2>
          <Link href="/" className="text-sm text-slate-500 hover:underline">
            ← 목록
          </Link>
        </div>
        <AdminDashboard
          employees={employees}
          stats={stats}
          activities={activities}
        />
      </main>
    </>
  );
}
