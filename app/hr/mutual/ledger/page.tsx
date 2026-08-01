import { getLedger } from "@/app/hr/mutual/ledgerActions";
import LedgerManager from "@/app/hr/mutual/ledger/LedgerManager";

export const dynamic = "force-dynamic";

export default async function MutualLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year } = await searchParams;
  const y = Number(year);
  const view = await getLedger(Number.isFinite(y) && y > 1900 ? y : undefined);
  return <LedgerManager initial={view} />;
}
