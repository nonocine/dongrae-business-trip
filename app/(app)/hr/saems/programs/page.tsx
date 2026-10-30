import {
  listProjects,
  listInstructorOptions,
} from "@/app/(app)/hr/saems/programActions";
import { resolveSaemView } from "@/lib/saemAccess";
import { canBulkPrint } from "@/lib/bulkPrintAccess";
import ProgramsManager from "@/app/(app)/hr/saems/programs/ProgramsManager";

export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  const [projects, instructors, view, bulk] = await Promise.all([
    listProjects(),
    listInstructorOptions(),
    resolveSaemView(),
    canBulkPrint(),
  ]);
  const canManage = view?.canManage ?? false;
  return (
    <ProgramsManager
      projects={projects}
      instructors={instructors}
      canManage={canManage}
      canBulkPrint={canManage && bulk}
    />
  );
}
