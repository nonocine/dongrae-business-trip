import { redirect } from "next/navigation";
import { resolveMutualAccess } from "@/lib/mutualAccess";
import { getClosingSummary } from "@/app/hr/mutual/importActions";
import ClosingManager from "@/app/hr/mutual/closing/ClosingManager";

export const dynamic = "force-dynamic";

// 연마감(엑셀 출력·과거 이관)은 관리 권한 전용 — 열람자는 장부로 돌려보낸다.
export default async function MutualClosingPage() {
  const access = await resolveMutualAccess();
  if (!access) redirect("/");
  if (!access.canManage) redirect("/hr/mutual/ledger");

  const summary = await getClosingSummary();
  return <ClosingManager initial={summary} />;
}
