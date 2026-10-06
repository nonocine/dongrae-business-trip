import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { resolveContractAdmin, listSummaries } from "@/lib/contractServer";
import { listContractEmployees, getContractClauses } from "@/app/(app)/hr/contracts/actions";
import { getSalaryWorkspace } from "@/app/(app)/hr/contracts/salaryActions";
import ContractsManager from "@/app/(app)/hr/contracts/ContractsManager";
import SalaryContractsManager from "@/app/(app)/hr/contracts/SalaryContractsManager";
import { tabBarCls, tabNavCls, tabItemCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

// =====================================================================
// 계약서 — 근로계약서 / 연봉계약서 탭 (2026-10)
//   메뉴가 늘어나지 않게 '계약서' 한 자리에 두고 탭으로 나눴습니다.
//   흐름(보내기·직원 서명·센터장 서명·PDF·교부)은 두 탭이 같은 부품(./shared)을 씁니다.
//   접근: M0(관장·부장) 또는 hr(인사) 직무. 그 밖은 페이지 자체를 렌더하지 않습니다.
// =====================================================================

const TABS = [
  { key: "employment", label: "근로계약서" },
  { key: "salary", label: "연봉계약서" },
] as const;

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; year?: string }>;
}) {
  await enforcePasswordChange();
  const access = await resolveContractAdmin();
  if (!access) redirect("/");

  const params = await searchParams;
  const tab = params.tab === "salary" ? "salary" : "employment";
  const year = Math.min(2100, Math.max(2020, Number(params.year) || new Date().getFullYear()));

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wide text-navy">동래구청소년센터</p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">계약서</h2>
          <p className="mt-1 text-xs text-ink-muted">
            작성 → 직원에게 보내기 → 직원이 폰에서 읽고 서명 → 센터장 서명 → PDF 확정. 직원은 마이페이지
            &lsquo;내 계약서&rsquo;에서 본인 것만 보고 내려받습니다.
          </p>
        </div>
        <Link href="/" className="text-sm text-ink-muted hover:underline">
          ← 목록
        </Link>
      </div>

      <div className={`${tabBarCls} mb-5`}>
        <nav className={tabNavCls} aria-label="계약서 종류">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.key === "salary" ? `/hr/contracts?tab=salary&year=${year}` : "/hr/contracts"}
              aria-current={t.key === tab ? "page" : undefined}
              className={tabItemCls(t.key === tab)}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      {tab === "employment" ? (
        <EmploymentTab isM0={access.isM0} />
      ) : (
        <SalaryTab isM0={access.isM0} year={year} />
      )}
    </div>
  );
}

async function EmploymentTab({ isM0 }: { isM0: boolean }) {
  const [contracts, employees, clauses] = await Promise.all([
    listSummaries("employment"),
    listContractEmployees(),
    getContractClauses(),
  ]);
  return <ContractsManager contracts={contracts} employees={employees} clauses={clauses} isM0={isM0} />;
}

async function SalaryTab({ isM0, year }: { isM0: boolean; year: number }) {
  const [workspace, contracts] = await Promise.all([getSalaryWorkspace(year), listSummaries("salary")]);
  return (
    <SalaryContractsManager
      key={year}
      workspace={workspace}
      contracts={contracts.filter((c) => c.year === String(year))}
      isM0={isM0}
    />
  );
}
