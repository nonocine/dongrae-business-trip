import {
  listSettlements,
  listSettlementProjects,
} from "@/app/hr/saems/settlementActions";
import SettlementsManager from "@/app/hr/saems/settlements/SettlementsManager";

export const dynamic = "force-dynamic";

export default async function SettlementsPage() {
  const [rows, projects] = await Promise.all([
    listSettlements(),
    listSettlementProjects(),
  ]);
  return <SettlementsManager rows={rows} projects={projects} />;
}
