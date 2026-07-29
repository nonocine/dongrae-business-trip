import { resolveSaemAccess } from "@/lib/saemAccess";
import { getTermOptions, getLogs } from "@/app/hr/saems/logActions";
import LogsManager from "@/app/hr/saems/logs/LogsManager";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const access = await resolveSaemAccess();
  const termOptions = await getTermOptions();
  // 기본 차시 = 활성 차시 중 가장 최근(없으면 첫 항목).
  const defaultTerm =
    termOptions.find((t) => t.status === "active") ?? termOptions[0] ?? null;
  const initial = await getLogs(defaultTerm ? { termId: defaultTerm.id } : {});

  return (
    <LogsManager
      termOptions={termOptions}
      initial={initial}
      defaultTermId={defaultTerm?.id ?? ""}
      isM0={access?.isM0 ?? false}
    />
  );
}
