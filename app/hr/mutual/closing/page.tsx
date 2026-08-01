import { getClosingSummary } from "@/app/hr/mutual/importActions";
import ClosingManager from "@/app/hr/mutual/closing/ClosingManager";

export const dynamic = "force-dynamic";

export default async function MutualClosingPage() {
  const summary = await getClosingSummary();
  return <ClosingManager initial={summary} />;
}
