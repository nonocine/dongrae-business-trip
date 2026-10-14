import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import {
  loadOrgAgreements,
  loadOrgAwards,
  resolveOrgRecordAccess,
} from "@/lib/orgRecordsServer";
import { normalizeOrgRecordTab } from "@/lib/orgRecords";
import { kstTodayYmd } from "@/lib/trainings";
import { listPartnerOptions, listStaffOptions } from "@/app/(app)/hr/org-records/actions";
import OrgRecordsManager from "@/app/(app)/hr/org-records/OrgRecordsManager";

export const dynamic = "force-dynamic";

// 기관 대장 — 업무협약·수상(노미현 부장 요청). 로그인한 직원이면 누구나.
export default async function OrgRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await enforcePasswordChange();
  const access = await resolveOrgRecordAccess();
  if (!access) redirect("/");
  const { tab } = await searchParams;

  const [agreements, awards, partners, staff] = await Promise.all([
    loadOrgAgreements(access),
    loadOrgAwards(access),
    listPartnerOptions(),
    listStaffOptions(),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-wide text-navy">동래구청소년센터</p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">기관 대장</h2>
          <p className="mt-1 text-xs text-ink-muted">
            업무협약·수상 기록을 모아 두고 수기 양식 그대로 출력합니다. 삭제는 등록자 본인 또는
            관장·부장·인사 담당자만 할 수 있습니다.
          </p>
        </div>
        <Link href="/" className="shrink-0 text-sm text-ink-muted hover:underline">
          ← 홈
        </Link>
      </div>

      <OrgRecordsManager
        initialTab={normalizeOrgRecordTab(tab)}
        agreements={agreements}
        awards={awards}
        partners={partners}
        staff={staff}
        today={kstTodayYmd()}
      />
    </div>
  );
}
