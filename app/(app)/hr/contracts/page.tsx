import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { resolveContractAdmin, listSummaries, namesById } from "@/lib/contractServer";
import { listContractEmployees, getContractClauses } from "@/app/(app)/hr/contracts/actions";
import { getSalaryWorkspace, getSalaryTemplates } from "@/app/(app)/hr/contracts/salaryActions";
import ContractsManager, { ClauseEditor } from "@/app/(app)/hr/contracts/ContractsManager";
import SalaryContractsManager, { HolidayPanel, SalaryClauseEditor } from "@/app/(app)/hr/contracts/SalaryContractsManager";
import { linkCls, noticeWarning } from "@/lib/ui";
import { contractsPath, type ContractFocus } from "@/lib/contractCore";
import Tabs from "@/app/components/Tabs";

export const dynamic = "force-dynamic";

// =====================================================================
// 계약서 — 근로계약서 / 연봉계약서 탭 (2026-10)
//   메뉴가 늘어나지 않게 '계약서' 한 자리에 두고 탭으로 나눴습니다.
//   흐름(보내기·직원 서명·센터장 서명·PDF·교부)은 두 탭이 같은 부품(./shared)을 씁니다.
//   접근: M0(관장·부장) · hr(인사) 직무 · 인사 파일 열람. 그 밖은 페이지 자체를 렌더하지 않습니다.
//   ★ 2026-10 관장 결정: 직원별 계약은 인사 파일 열람(personnel) 보유자에게만 불러옵니다.
//     그 밖(hr 직무만)은 직원 정보가 없는 서식 — 조항 문구·명절 날짜 — 만 봅니다.
//   ?driver={id}: 그 직원 것만 걸러 봅니다(인사기록카드 직원 행·슬랙 서명 알림 링크).
//     권한은 그대로 — 거르는 것은 보기 편의일 뿐, 접근 범위는 바뀌지 않습니다.
// =====================================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const contractsHref = (tab: "employment" | "salary", year: number, driverId?: string | null) =>
  contractsPath({ tab, year, driverId });

const TABS = [
  { key: "employment", label: "근로계약서", icon: "filePen" },
  { key: "salary", label: "연봉계약서", icon: "banknote" },
] as const;

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; year?: string; driver?: string }>;
}) {
  await enforcePasswordChange();
  const access = await resolveContractAdmin();
  if (!access) redirect("/");

  const params = await searchParams;
  const tab = params.tab === "salary" ? "salary" : "employment";
  const year = Math.min(2100, Math.max(2020, Number(params.year) || new Date().getFullYear()));
  // 걸러 볼 직원 — 형식이 틀리거나 없는 직원이면 거르지 않고 안내만 합니다.
  const rawDriver = (params.driver ?? "").trim();
  const driverName = UUID.test(rawDriver) ? (await namesById([rawDriver])).get(rawDriver) : undefined;
  const focus: ContractFocus | null = driverName ? { driverId: rawDriver, name: driverName } : null;

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

      <Tabs
        ariaLabel="계약서 종류"
        className="mb-5"
        value={tab}
        items={TABS.map((t) => ({ ...t, href: contractsHref(t.key, year, focus?.driverId) }))}
      />

      {focus && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-navy bg-navy-soft px-4 py-2.5 text-sm">
          <span className="font-semibold text-navy">{focus.name} 님의 계약서만 보는 중</span>
          <span className="text-ink-hint">·</span>
          <Link href={contractsHref(tab, year)} className={linkCls}>
            전체 보기
          </Link>
        </div>
      )}
      {rawDriver && !focus && (
        <p className={`mb-5 ${noticeWarning}`}>
          주소의 직원을 찾지 못해 전체 목록을 보여 줍니다.{" "}
          <Link href={contractsHref(tab, year)} className={linkCls}>
            전체 보기
          </Link>
        </p>
      )}

      {!access.isPersonnel ? (
        <TemplatesOnly tab={tab} year={year} />
      ) : tab === "employment" ? (
        <EmploymentTab isM0={access.isM0} focus={focus} />
      ) : (
        <SalaryTab isM0={access.isM0} year={year} focus={focus} />
      )}
    </div>
  );
}

// 인사 파일 열람 권한이 없는 담당자 — 서식만(직원 목록·계약 내용은 불러오지 않음).
async function TemplatesOnly({ tab, year }: { tab: "employment" | "salary"; year: number }) {
  const notice = (
    <p className={`mb-4 ${noticeWarning}`}>
      직원별 계약서는 관장·부장과 관장이 지정한 사람(인사 파일 열람)만 봅니다. 여기서는 계약서 서식만 고칠 수 있습니다.
    </p>
  );
  if (tab === "employment") {
    const clauses = await getContractClauses();
    return (
      <div>
        {notice}
        <ClauseEditor initial={clauses} />
      </div>
    );
  }
  const t = await getSalaryTemplates(year);
  return (
    <div className="space-y-4">
      {notice}
      <HolidayPanel year={t.year} holidays={t.holidays} driverId={null} />
      <SalaryClauseEditor initial={t.clauses} />
    </div>
  );
}

async function EmploymentTab({ isM0, focus }: { isM0: boolean; focus: ContractFocus | null }) {
  const [contracts, employees, clauses] = await Promise.all([
    listSummaries("employment"),
    listContractEmployees(),
    getContractClauses(),
  ]);
  return (
    <ContractsManager
      contracts={focus ? contracts.filter((c) => c.driver_id === focus.driverId) : contracts}
      employees={employees}
      clauses={clauses}
      isM0={isM0}
      focus={focus}
    />
  );
}

async function SalaryTab({ isM0, year, focus }: { isM0: boolean; year: number; focus: ContractFocus | null }) {
  const [workspace, contracts] = await Promise.all([getSalaryWorkspace(year), listSummaries("salary")]);
  const mine = (id: string) => !focus || id === focus.driverId;
  return (
    <SalaryContractsManager
      key={`${year}:${focus?.driverId ?? ""}`}
      workspace={{ ...workspace, employees: workspace.employees.filter((e) => mine(e.driverId)) }}
      contracts={contracts.filter((c) => c.year === String(year) && mine(c.driver_id))}
      isM0={isM0}
      focus={focus}
    />
  );
}
