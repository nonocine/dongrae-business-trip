import { getTermOptions, getLogs } from "@/app/hr/saems/logActions";
import LogsManager from "@/app/hr/saems/logs/LogsManager";

export const dynamic = "force-dynamic";

// SA-17: 확정취소·초기화가 saem 직무에도 열려 isM0 게이트가 필요 없어졌다.
export default async function LogsPage() {
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
    />
  );
}
