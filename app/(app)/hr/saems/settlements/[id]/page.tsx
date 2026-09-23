import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSettlement } from "@/app/(app)/hr/saems/settlementActions";
import { resolveSaemAccess } from "@/lib/saemAccess";
import SettlementDetail from "@/app/(app)/hr/saems/settlements/[id]/SettlementDetail";

export const dynamic = "force-dynamic";

export default async function SettlementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // 금액 화면 — 목록과 같은 이유로 기존 권한 유지(settlements/page.tsx 주석).
  if (!(await resolveSaemAccess())) redirect("/hr/saems/instructors");

  const { id } = await params;
  const detail = await getSettlement(id);
  if (!detail) notFound();

  return (
    <div className="space-y-4">
      <Link
        href="/hr/saems/settlements"
        className="text-sm text-ink-muted hover:underline"
      >
        ← 정산 목록
      </Link>
      <SettlementDetail detail={detail} />
    </div>
  );
}
