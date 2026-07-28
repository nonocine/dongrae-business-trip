import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { resolveFacilityAccess } from "@/lib/facilityAccess";
import { getCheck } from "@/app/hr/facility/safetyActions";
import SafetyDetail from "@/app/hr/facility/safety/[id]/SafetyDetail";

export const dynamic = "force-dynamic";

export default async function SafetyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await resolveFacilityAccess();
  if (!access) redirect("/");

  const { id } = await params;
  const detail = await getCheck(id);
  if (!detail) notFound();

  return (
    <div className="space-y-4">
      <Link
        href="/hr/facility/safety"
        className="text-sm text-ink-muted hover:underline"
      >
        ← 안전점검 목록
      </Link>
      <SafetyDetail check={detail.check} items={detail.items} />
    </div>
  );
}
