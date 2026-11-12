import Link from "next/link";
import { redirect } from "next/navigation";
import AdminDashboard from "@/app/(app)/admin/AdminDashboard";
import PromotionAlerts from "@/app/(app)/admin/PromotionAlerts";
import {
  DeadlineCards,
  HrSection,
  Section,
  ShortcutSection,
  SystemSection,
  TodaySection,
} from "@/app/(app)/admin/AdminSections";
import { loadAdminDashboardData } from "@/app/(app)/admin/dashboardData";
import { enforcePasswordChange, isManagerAdmin, listDrivers } from "@/app/actions";

export const dynamic = "force-dynamic";

// =====================================================================
// 관리자 대시보드 — 관장·master(isManagerAdmin)만.
//   2026-11 재정리: ① 오늘 ② 기한 알림 ③ 인사·복무 ④ 시스템 상태 ⑤ 바로가기 (+ 직원 계정 관리).
//   활동일지·차량 운행 관련 카드(활동 통계·비용·작성자 TOP5·최근 활동·활동 목록 탭)는
//   대시보드에서만 뺐습니다 — 데이터·테이블·/activities 화면은 그대로입니다.
// =====================================================================
export default async function AdminPage() {
  await enforcePasswordChange();
  if (!(await isManagerAdmin())) {
    redirect("/");
  }

  const [employees, data] = await Promise.all([
    // 직원 계정 관리는 비활성 직원도 함께(퇴사자 보기 토글).
    listDrivers({ includeInactive: true }),
    loadAdminDashboardData(),
  ]);
  // 렌더 시각 기준(빨간 점 판정) — 서버 컴포넌트라 요청마다 한 번.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-ink">관리자 대시보드</h2>
        <Link href="/" className="text-sm text-ink-muted hover:underline">
          ← 메인
        </Link>
      </div>

      <TodaySection d={data} />

      <Section title="기한 알림">
        <div className="space-y-3">
          <PromotionAlerts />
          <DeadlineCards d={data} />
        </div>
      </Section>

      <HrSection d={data} />

      <SystemSection d={data} now={now} />

      <ShortcutSection />

      <Section title="직원 계정 관리">
        <AdminDashboard employees={employees} />
      </Section>
    </div>
  );
}
