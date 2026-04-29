import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import AdminDashboard from "@/app/admin/AdminDashboard";
import {
  getAdminStats,
  getInitialDistance,
  isAdmin,
  listDrivers,
} from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await isAdmin())) {
    redirect("/");
  }

  const [drivers, initialDistance, stats] = await Promise.all([
    listDrivers(),
    getInitialDistance(),
    getAdminStats(),
  ]);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">관리자</h2>
          <Link href="/" className="text-sm text-slate-500 hover:underline">
            ← 목록
          </Link>
        </div>
        <AdminDashboard
          drivers={drivers}
          initialDistance={initialDistance}
          stats={stats}
        />
      </main>
    </>
  );
}
