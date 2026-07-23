import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import {
  canAccessSalary,
  listSalaryYears,
  listGradeTable,
  listConfig,
  listSalaryEmployees,
  listEmployeeSalaryRows,
} from "@/app/hr/salary/actions";
import SalaryManager from "@/app/hr/salary/SalaryManager";

export const dynamic = "force-dynamic";

export default async function SalaryPage() {
  await enforcePasswordChange();

  // 접근: M0(관장·부장·master) 또는 회계(accounting) 직무만. 그 외 / 로.
  if (!(await canAccessSalary())) {
    redirect("/");
  }

  const years = await listSalaryYears();
  // 기본 연도 — 데이터가 있으면 최신 연도, 없으면 올해.
  const initialYear = years[0] ?? new Date().getFullYear();

  const [gradeTable, config, employees, salaryRows] = await Promise.all([
    listGradeTable(initialYear),
    listConfig(initialYear),
    listSalaryEmployees(),
    listEmployeeSalaryRows(initialYear),
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
              급여 기준 관리
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              호봉표·기준값·직원별 급여 설정을 관리합니다. (급여 계산·명세서는 이후
              단계에서 제공됩니다.)
            </p>
          </div>
          <Link href="/" className="text-sm text-ink-muted hover:underline">
            ← 목록
          </Link>
        </div>

        <SalaryManager
          initialYear={initialYear}
          years={years}
          gradeTable={gradeTable}
          config={config}
          employees={employees}
          salaryRows={salaryRows}
        />
      </main>
    </>
  );
}
