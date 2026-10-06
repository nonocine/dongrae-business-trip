import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { resolveContractAdmin } from "@/lib/employmentContractServer";
import {
  listContracts,
  listContractEmployees,
  getContractClauses,
} from "@/app/(app)/hr/contracts/actions";
import ContractsManager from "@/app/(app)/hr/contracts/ContractsManager";

export const dynamic = "force-dynamic";

export default async function ContractsPage() {
  await enforcePasswordChange();

  // 접근: M0(관장·부장) 또는 hr(인사) 직무만. 그 밖은 페이지 자체를 렌더하지 않습니다.
  const access = await resolveContractAdmin();
  if (!access) redirect("/");

  const [contracts, employees, clauses] = await Promise.all([
    listContracts(),
    listContractEmployees(),
    getContractClauses(),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wide text-navy">동래구청소년센터</p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">근로계약서</h2>
          <p className="mt-1 text-xs text-ink-muted">
            작성 → 직원에게 보내기 → 직원이 폰에서 읽고 서명 → 센터장 서명 → PDF 확정. 직원은
            마이페이지 &lsquo;내 계약서&rsquo;에서 본인 것만 보고 내려받습니다.
          </p>
        </div>
        <Link href="/" className="text-sm text-ink-muted hover:underline">
          ← 목록
        </Link>
      </div>
      <ContractsManager
        contracts={contracts}
        employees={employees}
        clauses={clauses}
        isM0={access.isM0}
      />
    </div>
  );
}
