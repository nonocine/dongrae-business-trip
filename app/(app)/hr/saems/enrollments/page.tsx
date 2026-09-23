import { getTermOptions } from "@/app/(app)/hr/saems/logActions";
import { resolveSaemView } from "@/lib/saemAccess";
import EnrollmentsManager from "@/app/(app)/hr/saems/enrollments/EnrollmentsManager";

export const dynamic = "force-dynamic";

export default async function EnrollmentsPage() {
  const [termOptions, view] = await Promise.all([
    getTermOptions(),
    resolveSaemView(),
  ]);
  // 진행중 차시를 기본 선택(없으면 첫 차시).
  const defaultTermId =
    termOptions.find((t) => t.status === "active")?.id ?? termOptions[0]?.id ?? "";
  return (
    <EnrollmentsManager
      termOptions={termOptions}
      defaultTermId={defaultTermId}
      canManage={view?.canManage ?? false}
    />
  );
}
