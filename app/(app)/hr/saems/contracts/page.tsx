import { redirect } from "next/navigation";
import { resolveSaemAccess } from "@/lib/saemAccess";
import { saemAppUrl } from "@/lib/saem";
import { listProjects } from "@/app/(app)/hr/saems/programActions";
import { listInstructorContracts } from "@/app/(app)/hr/saems/contractActions";
import ContractsManager from "@/app/(app)/hr/saems/contracts/ContractsManager";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 강사 계약서 — 관리 권한(M0 또는 saem 직무)만. 주민번호 앞자리·주소·강사료가 들어 있어
//   열람 직원(전 직원)에게는 탭도 보이지 않습니다(SaemTabs manage:true).
//   주소 옵션('확인할 일'·아침 슬랙 DM 바로가기):
//     ?filter=seal_pending — 관장 날인 대기(강사 서명 완료)만 + [모두 날인(n건)].
//     ?contract=<id>       — 그 계약서 창을 바로 엽니다(날인 대기면 맨 위에 [직인 날인]).
export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; contract?: string }>;
}) {
  const access = await resolveSaemAccess();
  if (!access) redirect("/hr/saems/instructors");
  const sp = await searchParams;
  const sealPending = sp.filter === "seal_pending";
  const contractId = sp.contract && UUID.test(sp.contract) ? sp.contract : null;
  const [projects, rows] = await Promise.all([
    listProjects(),
    listInstructorContracts(sealPending ? { status: "instructor_signed" } : {}),
  ]);
  return (
    <ContractsManager
      projects={projects}
      initialRows={rows}
      isM0={access.isM0}
      saemBase={saemAppUrl()}
      initialStatus={sealPending ? "instructor_signed" : ""}
      initialContractId={contractId}
    />
  );
}
