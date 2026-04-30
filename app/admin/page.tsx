import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import AdminDashboard from "@/app/admin/AdminDashboard";
import {
  getActivityAdminStats,
  isAdmin,
  listActivities,
  listDrivers,
} from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await isAdmin())) {
    redirect("/admin/login");
  }

  const [employees, stats, activities] = await Promise.all([
    // 관리자 화면은 비활성 직원도 함께 조회 (퇴사자 보기 토글에서 사용)
    listDrivers({ includeInactive: true }),
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
