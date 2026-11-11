import { redirect } from "next/navigation";
import { resolveSaemAccess } from "@/lib/saemAccess";
import { saemAppUrl } from "@/lib/saem";
import { listProjects } from "@/app/(app)/hr/saems/programActions";
import { listInstructorContracts } from "@/app/(app)/hr/saems/contractActions";
import ContractsManager from "@/app/(app)/hr/saems/contracts/ContractsManager";

export const dynamic = "force-dynamic";

// 강사 계약서 — 관리 권한(M0 또는 saem 직무)만. 주민번호 앞자리·주소·강사료가 들어 있어
//   열람 직원(전 직원)에게는 탭도 보이지 않습니다(SaemTabs manage:true).
export default async function ContractsPage() {
  const access = await resolveSaemAccess();
  if (!access) redirect("/hr/saems/instructors");
  const [projects, rows] = await Promise.all([listProjects(), listInstructorContracts({})]);
  return <ContractsManager projects={projects} initialRows={rows} isM0={access.isM0} saemBase={saemAppUrl()} />;
}
