import Link from "next/link";
import { notFound } from "next/navigation";
import { getSettlement } from "@/app/hr/saems/settlementActions";
import SettlementDetail from "@/app/hr/saems/settlements/[id]/SettlementDetail";

export const dynamic = "force-dynamic";

export default async function SettlementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
