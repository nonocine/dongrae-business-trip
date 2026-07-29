import { resolveSaemAccess } from "@/lib/saemAccess";
import { getTermOptions, getLogs } from "@/app/hr/saems/logActions";
import LogsManager from "@/app/hr/saems/logs/LogsManager";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const access = await resolveSaemAccess();
  const [termOptions, initial] = await Promise.all([
    getTermOptions(),
    getLogs({}),
  ]);
  return (
    <LogsManager
      termOptions={termOptions}
      initial={initial}
      isM0={access?.isM0 ?? false}
    />
  );
}
