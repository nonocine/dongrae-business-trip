import Link from "next/link";
import Header from "@/app/components/Header";
import HrDashboard, { type TabKey } from "@/app/hr/HrDashboard";
import {
  requireHrAdmin,
  listDriversForHrProfile,
  listEmployeeProfiles,
  listRecruitmentPostings,
} from "@/app/hr/actions";
import { enforcePasswordChange } from "@/app/actions";
import { isM0Grant } from "@/lib/authLevels";

export const dynamic = "force-dynamic";

const VALID_TABS: TabKey[] = [
  "records",
  "contracts",
  "certificates",
  "recruitment",
];

export default async function HrPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  // 임시 비밀번호 사용자는 비번 변경 페이지로 강제 이동
  await enforcePasswordChange();
  // 관장·부장 직원 세션이 아니면 / 로 redirect.
  //   권한등급(auth_level) 변경 가능 여부 — M0(관장·부장·master) 공유.
  const me = await requireHrAdmin();
  const canManageAuth = isM0Grant({ rank: me.rank });

  const { tab } = await searchParams;
  const initialTab: TabKey = VALID_TABS.includes(tab as TabKey)
    ? (tab as TabKey)
    : "records";

  const [drivers, profiles, recruitmentPostings] = await Promise.all([
    listDriversForHrProfile(),
    listEmployeeProfiles(),
    listRecruitmentPostings(),
  ]);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-navy">
              동래구청소년센터
            </p>
            <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
              인사 관리
            </h2>
          </div>
          <Link href="/" className="text-sm text-ink-muted hover:underline">
            ← 목록
          </Link>
        </div>
        <HrDashboard
          drivers={drivers}
          profiles={profiles}
          recruitmentPostings={recruitmentPostings}
          initialTab={initialTab}
          canManageAuth={canManageAuth}
        />
      </main>
    </>
  );
}
