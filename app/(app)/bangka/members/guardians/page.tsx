import { listGuardians } from "@/app/(app)/bangka/members/actions";
import GuardiansList from "@/app/(app)/bangka/members/guardians/GuardiansList";

export const dynamic = "force-dynamic";

// 보호자 목록 — 상태 필터는 주소(?status=)로. 기본은 전체.
export default async function BangkaGuardiansPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const status =
    sp.status === "invited" || sp.status === "active" || sp.status === "suspended" ? sp.status : "all";
  const guardians = await listGuardians({ status: status === "all" ? undefined : status });
  return <GuardiansList guardians={guardians} statusFilter={status} />;
}
