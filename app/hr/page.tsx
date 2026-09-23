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
  const canManageAuth = me.isM0;

  // 볼 수 있는 탭 — 영역(scope)에서 옵니다.
  //   인사(records) 영역 = 인사기록카드·계약서·증명서, 채용 영역 = 채용공고.
  //   ★ 화면에서 감추는 것과 별개로, 각 액션이 requireHrAdmin(scope) 로
  //     다시 막습니다. 여기서는 조회 자체를 하지 않는 것이 핵심입니다 —
  //     채용 담당자에게 전 직원 인사기록을 내려보내지 않습니다.
  const canRecords = me.scopes.includes("records");
  const canRecruitment = me.scopes.includes("recruitment");
  const allowedTabs: TabKey[] = VALID_TABS.filter((t) =>
    t === "recruitment" ? canRecruitment : canRecords,
  );

  const { tab } = await searchParams;
  const requested = VALID_TABS.includes(tab as TabKey)
    ? (tab as TabKey)
    : "records";
  // 못 보는 탭을 요청했으면 볼 수 있는 첫 탭으로 보냅니다.
  const initialTab: TabKey = allowedTabs.includes(requested)
    ? requested
    : allowedTabs[0];

  const [drivers, profiles, recruitmentPostings] = await Promise.all([
    canRecords ? listDriversForHrProfile() : Promise.resolve([]),
    canRecords ? listEmployeeProfiles() : Promise.resolve([]),
    canRecruitment ? listRecruitmentPostings() : Promise.resolve([]),
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
          allowedTabs={allowedTabs}
        />
      </main>
    </>
  );
}
